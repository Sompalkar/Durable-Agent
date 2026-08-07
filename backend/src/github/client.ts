/**
 * GitHub, over REST only.
 *
 * There is no git binary here and no sandbox involved. A Worker cannot shell out
 * to `git`, so committing is done through GitHub's Git Data API — build blobs,
 * build a tree, build a commit, point a ref at it. That turns out to be better
 * than shelling out anyway: no clone, no working copy, no credentials on disk,
 * and every change lands as one atomic commit, which is what a reviewer wants to
 * look at.
 *
 * The whole file is `fetch`. That is the point.
 */

const API = 'https://api.github.com';

export class GitHubError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = 'GitHubError';
	}
}

export interface Issue {
	number: number;
	title: string;
	body: string;
	labels: string[];
	url: string;
}

export interface TreeEntry {
	path: string;
	/** Blob size in bytes. Absent for very large entries. */
	size: number;
	sha: string;
}

export interface FileChange {
	path: string;
	/** `null` deletes the file in the new tree. */
	content: string | null;
}

export interface PullRequest {
	number: number;
	url: string;
	branch: string;
}

export class GitHubClient {
	constructor(
		private readonly token: string,
		private readonly owner: string,
		private readonly repo: string,
	) {}

	// ------------------------------------------------------------------ read

	async issue(number: number): Promise<Issue> {
		const data = await this.request<{
			number: number;
			title: string;
			body: string | null;
			html_url: string;
			labels: Array<{ name: string }>;
		}>(`/repos/${this.slug()}/issues/${number}`);

		return {
			number: data.number,
			title: data.title,
			body: data.body ?? '',
			labels: data.labels.map((label) => label.name),
			url: data.html_url,
		};
	}

	/** The commit a branch currently points at. Everything else is relative to it. */
	async headCommit(branch: string): Promise<string> {
		const data = await this.request<{ object: { sha: string } }>(
			`/repos/${this.slug()}/git/ref/heads/${encodeURIComponent(branch)}`,
		);
		return data.object.sha;
	}

	async defaultBranch(): Promise<string> {
		const data = await this.request<{ default_branch: string }>(`/repos/${this.slug()}`);
		return data.default_branch;
	}

	/** Every file in the repo at a commit, in one call. */
	async tree(commitSha: string): Promise<TreeEntry[]> {
		const data = await this.request<{
			truncated: boolean;
			tree: Array<{ path: string; type: string; size?: number; sha: string }>;
		}>(`/repos/${this.slug()}/git/trees/${commitSha}?recursive=1`);

		// GitHub truncates enormous trees rather than paginating. Worth knowing
		// about, but a partial listing is still useful, so carry on.
		if (data.truncated) {
			console.warn(`Tree for ${this.slug()} was truncated by GitHub.`);
		}

		return data.tree
			.filter((entry) => entry.type === 'blob')
			.map((entry) => ({ path: entry.path, size: entry.size ?? 0, sha: entry.sha }));
	}

	/**
	 * A file's contents.
	 *
	 * Read by blob sha rather than by path, because the sha came from the tree we
	 * already fetched — so this cannot race a push that lands mid-import and
	 * return a file from a different commit than its neighbours.
	 */
	async blob(sha: string): Promise<string> {
		const data = await this.request<{ content: string; encoding: string }>(
			`/repos/${this.slug()}/git/blobs/${sha}`,
		);

		if (data.encoding !== 'base64') {
			throw new GitHubError(`Unexpected blob encoding: ${data.encoding}`, 500);
		}
		return decodeBase64(data.content);
	}

	// ----------------------------------------------------------------- write

	/**
	 * Commit a set of changes onto a new branch and open a pull request.
	 *
	 * Ordered so nothing is visible until it is complete: blobs and trees are
	 * invisible objects until a ref points at them, so a failure partway through
	 * leaves the repository exactly as it was. No half-created branch to clean up.
	 */
	async openPullRequest(options: {
		baseBranch: string;
		baseCommitSha: string;
		branch: string;
		commitMessage: string;
		title: string;
		body: string;
		changes: FileChange[];
	}): Promise<PullRequest> {
		if (options.changes.length === 0) {
			throw new GitHubError('There are no changes to open a pull request with.', 400);
		}

		const baseCommit = await this.request<{ tree: { sha: string } }>(
			`/repos/${this.slug()}/git/commits/${options.baseCommitSha}`,
		);

		// One blob per changed file. Independent, so they go together.
		const blobs = await Promise.all(
			options.changes.map(async (change) => {
				if (change.content === null) return { path: change.path, sha: null };
				const blob = await this.request<{ sha: string }>(
					`/repos/${this.slug()}/git/blobs`,
					{
						method: 'POST',
						body: { content: encodeBase64(change.content), encoding: 'base64' },
					},
				);
				return { path: change.path, sha: blob.sha };
			}),
		);

		const tree = await this.request<{ sha: string }>(`/repos/${this.slug()}/git/trees`, {
			method: 'POST',
			body: {
				// Layered on the base tree, so files the agent never touched are
				// carried over instead of being deleted.
				base_tree: baseCommit.tree.sha,
				tree: blobs.map((blob) => ({
					path: blob.path,
					mode: '100644',
					type: 'blob',
					sha: blob.sha,
				})),
			},
		});

		const commit = await this.request<{ sha: string }>(`/repos/${this.slug()}/git/commits`, {
			method: 'POST',
			body: {
				message: options.commitMessage,
				tree: tree.sha,
				parents: [options.baseCommitSha],
			},
		});

		await this.request(`/repos/${this.slug()}/git/refs`, {
			method: 'POST',
			body: { ref: `refs/heads/${options.branch}`, sha: commit.sha },
		});

		const pull = await this.request<{ number: number; html_url: string }>(
			`/repos/${this.slug()}/pulls`,
			{
				method: 'POST',
				body: {
					title: options.title,
					body: options.body,
					head: options.branch,
					base: options.baseBranch,
				},
			},
		);

		return { number: pull.number, url: pull.html_url, branch: options.branch };
	}

	// --------------------------------------------------------------- private

	private slug(): string {
		return `${this.owner}/${this.repo}`;
	}

	private async request<T = unknown>(
		path: string,
		options: { method?: string; body?: unknown } = {},
	): Promise<T> {
		const response = await fetch(`${API}${path}`, {
			method: options.method ?? 'GET',
			headers: {
				Authorization: `Bearer ${this.token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				// GitHub rejects requests without one.
				'User-Agent': 'durable-agent',
				...(options.body ? { 'Content-Type': 'application/json' } : {}),
			},
			...(options.body ? { body: JSON.stringify(options.body) } : {}),
			signal: AbortSignal.timeout(30_000),
		});

		if (!response.ok) {
			// GitHub's error bodies are genuinely useful — a failed PR usually says
			// exactly which permission is missing — so surface the message rather
			// than just the status.
			const detail = await response.text().catch(() => '');
			const message = parseGitHubMessage(detail) ?? `GitHub returned ${response.status}`;
			throw new GitHubError(message, response.status);
		}

		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}
}

function parseGitHubMessage(body: string): string | null {
	try {
		const parsed = JSON.parse(body) as { message?: string; errors?: Array<{ message?: string }> };
		const detail = parsed.errors?.map((error) => error.message).filter(Boolean).join('; ');
		if (parsed.message && detail) return `${parsed.message}: ${detail}`;
		return parsed.message ?? null;
	} catch {
		return null;
	}
}

// Base64 helpers that survive non-ASCII. `atob`/`btoa` are byte-oriented, so
// text has to cross through UTF-8 explicitly or accented characters corrupt.
function decodeBase64(value: string): string {
	const binary = atob(value.replace(/\s/g, ''));
	return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function encodeBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
