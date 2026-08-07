/**
 * GitHub routes: attach a repository to a session, and ship the result.
 *
 * The division of labour is the interesting part.
 *
 *   The sandbox  gets a real checkout, so tests run against the actual project
 *                with its actual dependencies. It is destroyed every turn.
 *   The workspace gets a readable subset of the source, so the agent can browse
 *                and edit with cheap tools instead of booting a container to
 *                read a file.
 *   The session  remembers which files the agent changed. That set is the diff,
 *                and it is what survives the container being torn down.
 *
 * Opening the pull request is an explicit user action. An agent that can push
 * to someone's repository unattended is not a feature.
 */

import { Hono } from 'hono';
import { fetchGitHubToken } from '../auth/api-client';
import { authenticate, type AuthEnv } from '../auth/middleware';
import { GitHubClient, GitHubError } from '../github/client';
import { describeImport, planImport } from '../github/import';
import { buildPullRequestBody } from '../github/report';
import { ApiError } from '../http/errors';
import { repoBrainStub, sessionStub, workspaceStub } from '../http/stubs';

export const githubRoutes = new Hono<AuthEnv>();

githubRoutes.use('*', authenticate);

/** Manifests, most specific first — a lockfile beats the manifest beside it. */
const INSTALL_COMMANDS: Array<{ file: string; command: string }> = [
	{ file: 'pnpm-lock.yaml', command: 'pnpm install --frozen-lockfile' },
	{ file: 'yarn.lock', command: 'yarn install --frozen-lockfile' },
	{ file: 'package-lock.json', command: 'npm ci' },
	{ file: 'package.json', command: 'npm install' },
	{ file: 'requirements.txt', command: 'pip install -r requirements.txt' },
	{ file: 'pyproject.toml', command: 'pip install -e .' },
	{ file: 'go.mod', command: 'go mod download' },
	{ file: 'Cargo.toml', command: 'cargo fetch' },
	{ file: 'Gemfile', command: 'bundle install' },
];

/** How many packages to install in a monorepo before giving up on guessing. */
const MAX_INSTALL_TARGETS = 4;

/**
 * Work out how to install this repository's dependencies.
 *
 * The obvious implementation — look for a manifest at the root — is wrong for
 * any monorepo, which is most real repositories now. A repo with
 * `backend/package.json` and `client/package.json` and nothing at the root
 * would be reported as having no dependencies at all, and then every test run
 * would fail on a missing module.
 *
 * So: find the manifest directories, prefer the root when there is one, and
 * otherwise install each package in place.
 */
function detectInstallCommand(paths: string[]): string {
	const found = new Set(paths);

	// A root manifest wins — in a workspace setup it installs everything anyway.
	const root = INSTALL_COMMANDS.find((candidate) => found.has(candidate.file));
	if (root) return root.command;

	// Otherwise group by directory and install each one, shallowest first.
	const byDirectory = new Map<string, string>();
	for (const candidate of INSTALL_COMMANDS) {
		for (const path of paths) {
			const slash = path.lastIndexOf('/');
			if (slash === -1 || path.slice(slash + 1) !== candidate.file) continue;

			const directory = path.slice(0, slash);
			// First match wins: INSTALL_COMMANDS is ordered most specific first, so
			// a lockfile already claimed the directory before its package.json.
			if (!byDirectory.has(directory)) byDirectory.set(directory, candidate.command);
		}
	}

	const targets = [...byDirectory.entries()]
		.sort((a, b) => a[0].split('/').length - b[0].split('/').length)
		.slice(0, MAX_INSTALL_TARGETS);

	if (targets.length === 0) return 'true';

	// Each in a subshell so one failure does not abandon the rest, and the
	// agent still gets a usable environment for the packages that did install.
	return targets
		.map(([directory, command]) => `(cd ${JSON.stringify(directory)} && ${command})`)
		.join(' ; ');
}

/**
 * POST /api/sessions/:id/github/attach
 *
 * Pins the session to a commit, imports a readable slice of the source, and —
 * when an issue was named — makes the issue the task.
 */
githubRoutes.post('/:id/github/attach', async (c) => {
	const user = c.get('user');
	const sessionId = c.req.param('id');
	const body = await readJson<{ repo?: string; issue?: number }>(c.req.raw);

	const slug = String(body.repo ?? '');
	const match = /^([\w.-]+)\/([\w.-]+)$/.exec(slug);
	if (!match) throw ApiError.badRequest('"repo" must look like owner/name.');
	const [, owner, repo] = match as unknown as [string, string, string];

	const credentials = await fetchGitHubToken(c.env, user.id);
	if (!credentials) {
		throw ApiError.badRequest('Connect a GitHub account in Settings first.');
	}

	const client = new GitHubClient(credentials.token, owner, repo);

	try {
		const branch = await client.defaultBranch();
		// Pinned to a commit, not a branch. Every turn of this task then sees the
		// same tree even if somebody pushes to the branch while the agent works.
		const commitSha = await client.headCommit(branch);
		const tree = await client.tree(commitSha);

		const installCommand = detectInstallCommand(tree.map((entry) => entry.path));

		const issue = typeof body.issue === 'number' ? await client.issue(body.issue) : null;

		const session = sessionStub(c.env, user.id, sessionId);
		await session.attachRepo({
			fullName: slug,
			branch,
			commitSha,
			installCommand,
			issueNumber: issue?.number ?? null,
			issueTitle: issue?.title ?? null,
		});

		// Import a readable subset into the workspace. The sandbox has the full
		// checkout; this is so the agent can browse and edit without paying for a
		// container on every read.
		const plan = planImport(tree);
		const workspace = workspaceStub(c.env, user.id, sessionId);
		await workspace.clear();

		// Fetched in batches. All at once would open two hundred sockets and get
		// us rate limited; one at a time would take minutes.
		for (let index = 0; index < plan.include.length; index += 10) {
			const batch = plan.include.slice(index, index + 10);
			const contents = await Promise.all(batch.map((entry) => client.blob(entry.sha)));
			await Promise.all(
				batch.map((entry, position) =>
					workspace.write(`/${entry.path}`, contents[position] ?? '', 'imported from GitHub'),
				),
			);
		}

		return c.json({
			repo: {
				fullName: slug,
				branch,
				commitSha,
				installCommand,
				issueNumber: issue?.number ?? null,
				issueTitle: issue?.title ?? null,
			},
			imported: {
				files: plan.include.length,
				bytes: plan.totalBytes,
				summary: describeImport(plan, slug),
			},
			// Handed back so the client can open the task with it rather than the
			// user retyping what the issue already says.
			task: issue
				? `Work on issue #${issue.number}: ${issue.title}\n\n${issue.body}\n\n` +
					`The repository ${slug} is attached. ${describeImport(plan, slug)}`
				: null,
		});
	} catch (error) {
		throw asApiError(error);
	}
});

/** GET /api/sessions/:id/github — repo state, the current diff, and what the agent has learned. */
githubRoutes.get('/:id/github', async (c) => {
	const user = c.get('user');
	const session = sessionStub(c.env, user.id, c.req.param('id'));

	const [repo, changedPaths, commands] = await Promise.all([
		session.repo(),
		session.changedPaths(),
		session.commands(),
	]);

	// Knowledge is keyed on the repository, not the session, so this is what
	// every task on this codebase has accumulated — not just this one.
	const knowledge = repo ? await repoBrainStub(c.env, user.id, repo.fullName).listMemories() : [];

	return c.json({ repo, changedPaths, commands, knowledge });
});

/** DELETE /api/sessions/:id/github/knowledge/:memoryId — forget one repo fact. */
githubRoutes.delete('/:id/github/knowledge/:memoryId', async (c) => {
	const user = c.get('user');
	const session = sessionStub(c.env, user.id, c.req.param('id'));

	const repo = await session.repo();
	if (!repo) throw ApiError.badRequest('This session has no repository attached.');

	const id = Number(c.req.param('memoryId'));
	if (!Number.isFinite(id)) throw ApiError.badRequest('Expected a numeric memory id.');

	const removed = await repoBrainStub(c.env, user.id, repo.fullName).forget(id);
	if (!removed) throw ApiError.notFound('No such fact.');
	return c.body(null, 204);
});

/**
 * POST /api/sessions/:id/github/pull-request
 *
 * Reads the changed files out of the workspace, commits them onto a new branch,
 * and opens a pull request whose body is the evidence: the plan the agent
 * followed, the files it touched with their revision counts, and every command
 * it ran with the exit code.
 */
githubRoutes.post('/:id/github/pull-request', async (c) => {
	const user = c.get('user');
	const sessionId = c.req.param('id');
	const body = await readJson<{ title?: string; branch?: string }>(c.req.raw);

	const session = sessionStub(c.env, user.id, sessionId);
	const [repo, changedPaths, commands, summary] = await Promise.all([
		session.repo(),
		session.changedPaths(),
		session.commands(),
		session.summary(),
	]);

	if (!repo) throw ApiError.badRequest('This session has no repository attached.');
	if (changedPaths.length === 0) {
		throw ApiError.badRequest('The agent has not changed any files yet.');
	}

	const credentials = await fetchGitHubToken(c.env, user.id);
	if (!credentials) throw ApiError.badRequest('Connect a GitHub account in Settings first.');

	const [owner, name] = repo.fullName.split('/') as [string, string];
	const client = new GitHubClient(credentials.token, owner, name);
	const workspace = workspaceStub(c.env, user.id, sessionId);

	// A deleted file reads back as missing, which is exactly the null the tree
	// API wants to remove it.
	const changes = await Promise.all(
		changedPaths.map(async (path) => {
			const file = await workspace.read(path).catch(() => null);
			return {
				// Workspace paths are absolute; git paths are not.
				path: path.replace(/^\//, ''),
				content: file?.content ?? null,
			};
		}),
	);

	const title =
		body.title?.trim() ||
		(repo.issueTitle ? `${repo.issueTitle}` : `Changes from session ${sessionId.slice(0, 8)}`);

	const branch =
		body.branch?.trim() ||
		`agent/${repo.issueNumber ? `issue-${repo.issueNumber}` : sessionId.slice(0, 8)}-${Date.now().toString(36)}`;

	try {
		const pull = await client.openPullRequest({
			baseBranch: repo.branch,
			baseCommitSha: repo.commitSha,
			branch,
			commitMessage: repo.issueNumber ? `${title}\n\nCloses #${repo.issueNumber}` : title,
			title,
			body: buildPullRequestBody({
				repo,
				plan: summary.plan,
				changedPaths,
				commands,
				usage: summary.usage,
				model: summary.model,
			}),
			changes,
		});

		return c.json({ pullRequest: pull });
	} catch (error) {
		throw asApiError(error);
	}
});

function asApiError(error: unknown): ApiError {
	if (error instanceof GitHubError) {
		// 404 from GitHub usually means "no permission" rather than "absent" — a
		// token without repo scope cannot tell the difference, and neither can we.
		if (error.status === 404) {
			return ApiError.notFound(
				`${error.message}. If the repository exists, your token may not have access to it.`,
			);
		}
		if (error.status === 401 || error.status === 403) {
			return new ApiError(403, `GitHub refused the request: ${error.message}`);
		}
		return ApiError.badRequest(error.message);
	}
	return error instanceof ApiError
		? error
		: ApiError.badRequest(error instanceof Error ? error.message : 'GitHub request failed.');
}

async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		throw ApiError.badRequest('Request body must be valid JSON.');
	}
}
