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

/** Tar works in fixed 512-byte blocks. */
const BLOCK = 512;

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

/** One thing a human asked for on the pull request. */
export interface ReviewComment {
	id: number;
	author: string;
	body: string;
	createdAt: string;
	/** File and line, when the comment was left on the diff rather than the thread. */
	path?: string;
	line?: number;
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

	/**
	 * The whole repository, in one request.
	 *
	 * Fetching blobs one at a time is the obvious implementation and it does not
	 * survive contact with Cloudflare: a Worker gets 50 subrequests per
	 * invocation on the free plan, and a 200-file import needs 200. The tarball
	 * endpoint returns everything in a single response, which is both legal and
	 * far faster.
	 *
	 * Gzip is undone by the platform's own `DecompressionStream`, and tar is a
	 * simple enough format to walk by hand — 512-byte header, then the content
	 * padded to the next 512-byte boundary.
	 */
	async tarball(ref: string): Promise<Map<string, string>> {
		const response = await fetch(`${API}/repos/${this.slug()}/tarball/${ref}`, {
			headers: {
				Authorization: `Bearer ${this.token}`,
				Accept: 'application/vnd.github+json',
				'User-Agent': 'durable-agent',
			},
			// GitHub redirects to codeload; fetch follows it for us.
			signal: AbortSignal.timeout(60_000),
		});

		if (!response.ok || !response.body) {
			throw new GitHubError(`Could not download the repository (${response.status}).`, response.status);
		}

		const unzipped = response.body.pipeThrough(new DecompressionStream('gzip'));
		return parseTar(await new Response(unzipped).arrayBuffer());
	}

	/**
	 * Everything a human has said on the pull request.
	 *
	 * Two endpoints, because GitHub keeps them apart: comments left on specific
	 * lines of the diff, and comments in the conversation thread. A reviewer does
	 * not think of those as different things, so neither should the agent.
	 *
	 * Comments by the token's own account are dropped — the agent replying to
	 * itself would loop forever, and it has nothing to learn from its own words.
	 */
	async reviewComments(number: number, self: string, since?: string): Promise<ReviewComment[]> {
		const query = since ? `?since=${encodeURIComponent(since)}` : '';

		const [inline, thread] = await Promise.all([
			this.request<
				Array<{
					id: number;
					user: { login: string } | null;
					body: string;
					created_at: string;
					path?: string;
					line?: number | null;
				}>
			>(`/repos/${this.slug()}/pulls/${number}/comments${query}`),
			this.request<
				Array<{ id: number; user: { login: string } | null; body: string; created_at: string }>
			>(`/repos/${this.slug()}/issues/${number}/comments${query}`),
		]);

		const mapped: ReviewComment[] = [
			...inline.map((comment) => ({
				id: comment.id,
				author: comment.user?.login ?? 'unknown',
				body: comment.body,
				createdAt: comment.created_at,
				...(comment.path ? { path: comment.path } : {}),
				...(typeof comment.line === 'number' ? { line: comment.line } : {}),
			})),
			...thread.map((comment) => ({
				id: comment.id,
				author: comment.user?.login ?? 'unknown',
				body: comment.body,
				createdAt: comment.created_at,
			})),
		];

		return mapped
			.filter((comment) => comment.author !== self && comment.body.trim() !== '')
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	/** File a new issue. */
	async createIssue(title: string, body: string): Promise<{ number: number; url: string }> {
		const data = await this.request<{ number: number; html_url: string }>(
			`/repos/${this.slug()}/issues`,
			{ method: 'POST', body: { title, body } },
		);
		return { number: data.number, url: data.html_url };
	}

	/** Leave a reply on the pull request thread. */
	async comment(number: number, body: string): Promise<void> {
		await this.request(`/repos/${this.slug()}/issues/${number}/comments`, {
			method: 'POST',
			body: { body },
		});
	}

	// ----------------------------------------------------------------- write

	/**
	 * Add a commit to a branch that already exists.
	 *
	 * Same object dance as opening a pull request, with two differences: the
	 * parent is the branch's current head rather than the original base, and the
	 * ref is updated instead of created. Reading the head fresh each time is what
	 * makes this safe to run from an alarm days later — the branch may have moved.
	 */
	async commitToBranch(options: {
		branch: string;
		message: string;
		changes: FileChange[];
	}): Promise<{ sha: string }> {
		if (options.changes.length === 0) {
			throw new GitHubError('There is nothing to commit.', 400);
		}

		const head = await this.headCommit(options.branch);
		const parent = await this.request<{ tree: { sha: string } }>(
			`/repos/${this.slug()}/git/commits/${head}`,
		);

		const tree = await this.buildTree(parent.tree.sha, options.changes);
		const commit = await this.request<{ sha: string }>(`/repos/${this.slug()}/git/commits`, {
			method: 'POST',
			body: { message: options.message, tree, parents: [head] },
		});

		await this.request(
			`/repos/${this.slug()}/git/refs/heads/${encodeURIComponent(options.branch)}`,
			{ method: 'PATCH', body: { sha: commit.sha } },
		);

		return { sha: commit.sha };
	}

	/** Blobs for each change, layered onto an existing tree. */
	private async buildTree(baseTreeSha: string, changes: FileChange[]): Promise<string> {
		const blobs = await Promise.all(
			changes.map(async (change) => {
				if (change.content === null) return { path: change.path, sha: null };
				const blob = await this.request<{ sha: string }>(`/repos/${this.slug()}/git/blobs`, {
					method: 'POST',
					body: { content: encodeBase64(change.content), encoding: 'base64' },
				});
				return { path: change.path, sha: blob.sha };
			}),
		);

		const tree = await this.request<{ sha: string }>(`/repos/${this.slug()}/git/trees`, {
			method: 'POST',
			body: {
				base_tree: baseTreeSha,
				tree: blobs.map((blob) => ({
					path: blob.path,
					mode: '100644',
					type: 'blob',
					sha: blob.sha,
				})),
			},
		});

		return tree.sha;
	}

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

		// Layered on the base tree, so files the agent never touched are carried
		// over instead of being deleted.
		const tree = await this.buildTree(baseCommit.tree.sha, options.changes);

		const commit = await this.request<{ sha: string }>(`/repos/${this.slug()}/git/commits`, {
			method: 'POST',
			body: {
				message: options.commitMessage,
				tree,
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

/**
 * Files in a tar archive, keyed by path with the top-level directory stripped.
 *
 * Exported so it can be checked against a real archive without a token or a
 * running stack — it is the only hand-rolled binary parsing in the codebase.
 */
export function parseTar(buffer: ArrayBuffer): Map<string, string> {
	const bytes = new Uint8Array(buffer);
	const decoder = new TextDecoder();
	const files = new Map<string, string>();

	let offset = 0;
	while (offset + BLOCK <= bytes.length) {
		const header = bytes.subarray(offset, offset + BLOCK);

		// Two consecutive zero blocks mark the end. One is enough to stop on.
		if (header.every((byte) => byte === 0)) break;

		const name = readString(header, 0, 100, decoder);
		const prefix = readString(header, 345, 155, decoder);
		const size = parseInt(readString(header, 124, 12, decoder) || '0', 8) || 0;
		const type = String.fromCharCode(header[156] ?? 0);

		offset += BLOCK;

		// '0' and NUL both mean a regular file. Directories, symlinks and the
		// long-name extensions are skipped — the import only wants source text.
		if (type === '0' || type === '\0') {
			const full = prefix ? `${prefix}/${name}` : name;
			// The archive nests everything under `owner-repo-sha/`, which is not
			// part of any path in the repository itself.
			const path = full.slice(full.indexOf('/') + 1);
			if (path) {
				files.set(path, decoder.decode(bytes.subarray(offset, offset + size)));
			}
		}

		// Content is padded up to the next block boundary.
		offset += Math.ceil(size / BLOCK) * BLOCK;
	}

	return files;
}

/** A NUL-terminated fixed-width field. */
function readString(
	block: Uint8Array,
	start: number,
	length: number,
	decoder: TextDecoder,
): string {
	const field = block.subarray(start, start + length);
	const end = field.indexOf(0);
	return decoder.decode(end === -1 ? field : field.subarray(0, end)).trim();
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
