/**
 * AgentSessionDO — one Durable Object per chat session.
 *
 * This is the agent's home. It holds the conversation in SQLite, runs the agent
 * loop, and streams events straight to the browser. Because the object lives on
 * Cloudflare's edge near whoever created it, there is no VM to boot before the
 * first token and nothing to keep warm between turns.
 *
 * It runs turns two ways: interactively (SSE, driven by the user) and headlessly
 * (driven by the scheduler, with nobody watching). Both go through the same
 * loop, so a background run is a real turn — it reads files, saves memories, and
 * lands in the transcript exactly like one you typed.
 */

import { DurableObject } from 'cloudflare:workers';
import Anthropic from '@anthropic-ai/sdk';
import { fetchBudget, fetchGitHubToken, reportTurn } from '../auth/api-client';
import { GitHubClient } from '../github/client';
import { describeAgentError } from '../agent/errors';
import { addUsage, EMPTY_USAGE, estimateCostUsd } from '../agent/pricing';
import { runAgentTurn } from '../agent/runner';
import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	isSelectableModel,
	isValidEffort,
	isValidModel,
} from '../agent/models';
import { createSandbox } from '../agent/sandbox';
import { DEFAULT_RUNTIME, isRuntime, keepsSandboxWarm, type Runtime } from '../agent/runtime';
import { SandboxWorkspace } from '../agent/workspace/sandbox-workspace';
import type { CommandRecord, RepoContext, ToolContext } from '../agent/tool-runtime';
import type {
	AgentEvent,
	PlanStep,
	Proposal,
	SessionSummary,
	SessionUsage,
	StoredPullRequest,
	StoredRepo,
	ToolRecord,
	TranscriptMessage,
	TurnSegment,
} from '../types';
import type { BrainDO } from './brain-do';
import type { SchedulerDO } from './scheduler-do';
import type { WorkspaceDO } from './workspace-do';

/**
 * How many repository facts are loaded into a turn.
 *
 * Tighter than personal recall: repo knowledge is only relevant while a repo is
 * attached, and it competes for the same context as the code itself.
 */
const REPO_RECALL_LIMIT = 25;

interface MessageRow extends Record<string, SqlStorageValue> {
	id: number;
	role: string;
	content: string;
	created_at: number;
}

interface TranscriptRow extends Record<string, SqlStorageValue> {
	id: number;
	role: string;
	text: string;
	tools: string | null;
	segments: string | null;
	trigger: string | null;
	created_at: number;
}

export class AgentSessionDO extends DurableObject<Env> {
	/** Guards against two turns running in the same session at once. */
	private running = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.migrate();
	}

	private migrate(): void {
		const sql = this.ctx.storage.sql;

		sql.exec(`
			CREATE TABLE IF NOT EXISTS meta (
				key   TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`);
		// Raw Anthropic message params — the context we resend on every turn.
		sql.exec(`
			CREATE TABLE IF NOT EXISTS messages (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				role       TEXT    NOT NULL,
				content    TEXT    NOT NULL,
				created_at INTEGER NOT NULL
			);
		`);
		// A flattened, render-ready view of the same conversation for the UI,
		// including the tool timeline so replayed history shows the work.
		sql.exec(`
			CREATE TABLE IF NOT EXISTS transcript (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				role       TEXT    NOT NULL,
				text       TEXT    NOT NULL,
				tools      TEXT,
				segments   TEXT,
				trigger    TEXT,
				created_at INTEGER NOT NULL
			);
		`);
		// Objects created before ordered segments existed keep working: the
		// column is added if missing, and rows without it fall back to text+tools.
		try {
			sql.exec('ALTER TABLE transcript ADD COLUMN segments TEXT');
		} catch {
			// Already present.
		}
	}

	// ------------------------------------------------------------- lifecycle

	/**
	 * Called once when the session is created. Safe to call repeatedly.
	 *
	 * `model` and `effort` are the account's saved defaults, passed in by the
	 * caller rather than read from anywhere here. The Worker has them from the
	 * browser, which already knows the signed-in user's settings — so applying
	 * them costs nothing, where fetching the profile from the API would add a
	 * network hop to every session creation.
	 *
	 * They are only ever applied at creation. Changing your default later must
	 * not silently re-point sessions you are already in the middle of.
	 */
	async init(options: {
		sessionId: string;
		title: string;
		userId: string;
		model?: string;
		effort?: string;
	}): Promise<SessionSummary> {
		if (!this.getMeta('sessionId')) {
			this.setMeta('sessionId', options.sessionId);
			this.setMeta('title', options.title);
			this.setMeta('createdAt', String(Date.now()));
			this.setMeta('updatedAt', String(Date.now()));

			// Validated rather than trusted: these arrive from a browser, and an
			// unknown model would fail at the API with a much worse error than
			// quietly falling back to the deployment default.
			if (options.model && isSelectableModel(options.model)) {
				this.setMeta('model', options.model);
			}
			if (options.effort && isValidEffort(options.effort)) {
				this.setMeta('effort', options.effort);
			}
		}
		// Recorded so the object can address its owner's workspace, memory, and
		// scheduler later — including from an alarm, where there is no request to
		// read a cookie from.
		this.setMeta('userId', options.userId);
		return this.summary();
	}

	/** The account this session belongs to. */
	private userId(): string {
		return this.getMeta('userId') ?? 'anonymous';
	}

	// ------------------------------------------------------------ repository

	/**
	 * Attach a repository to this session.
	 *
	 * Note what is *not* stored: the clone URL, because it carries the user's
	 * GitHub token. Only the coordinates are persisted, and the token is fetched
	 * fresh from the main API on each turn and injected then. A credential in
	 * Durable Object storage would outlive the user revoking it.
	 */
	async attachRepo(repo: StoredRepo): Promise<void> {
		this.setMeta('repo', JSON.stringify(repo));
		// A new task starts from a clean diff.
		this.setMeta('changedPaths', '[]');
		this.setMeta('commands', '[]');
	}

	/** Remember the pull request this session opened, so it can be watched. */
	async attachPullRequest(pull: StoredPullRequest): Promise<void> {
		this.setMeta('pullRequest', JSON.stringify(pull));
	}

	async pullRequest(): Promise<StoredPullRequest | null> {
		const stored = this.getMeta('pullRequest');
		return stored ? (JSON.parse(stored) as StoredPullRequest) : null;
	}

	/**
	 * Answer whatever a reviewer has said since the last pass.
	 *
	 * Driven by an alarm, which is the whole point: the container that opened the
	 * pull request was destroyed the moment that turn ended, possibly days ago.
	 * Nothing is resumed — the diff is rebuilt from this object's own record of
	 * what changed, a fresh sandbox is checked out underneath it, and the work
	 * continues. The machine was never the thing that mattered.
	 */
	async runReviewPass(trigger: string): Promise<{ text: string; ok: boolean }> {
		const [pull, repo] = await Promise.all([this.pullRequest(), this.repo()]);
		if (!pull || !repo) return { text: 'Skipped: no pull request to watch.', ok: false };
		if (this.running) return { text: 'Skipped: a turn was already running.', ok: false };

		const credentials = await fetchGitHubToken(this.env, this.userId()).catch(() => null);
		if (!credentials) return { text: 'Skipped: GitHub is no longer connected.', ok: false };

		const [owner, name] = repo.fullName.split('/') as [string, string];
		const client = new GitHubClient(credentials.token, owner, name);

		const comments = await client.reviewComments(
			pull.number,
			credentials.login,
			pull.reviewedThrough ?? undefined,
		);
		if (comments.length === 0) return { text: 'No new review comments.', ok: true };

		// Marked as read before the work, not after. A turn that crashes halfway
		// must not leave the agent answering the same review on every alarm — a
		// missed comment is recoverable, an infinite loop on a paid API is not.
		const newest = comments[comments.length - 1]?.createdAt ?? pull.reviewedThrough;
		await this.attachPullRequest({ ...pull, reviewedThrough: newest });

		const prompt = [
			`A reviewer has left ${comments.length} comment${comments.length === 1 ? '' : 's'} on pull request #${pull.number}.`,
			'Address them in the code. Do not argue with the reviewer, and do not make changes they did not ask for.',
			'',
			...comments.map((comment) =>
				comment.path
					? `- ${comment.author} on ${comment.path}:${comment.line ?? '?'} — ${comment.body}`
					: `- ${comment.author} — ${comment.body}`,
			),
			'',
			'When you are done, verify the change the same way you did originally.',
		].join('\n');

		const before = new Set(await this.changedPaths());
		const result = await this.runHeadless(prompt, trigger);
		if (!result.ok) return result;

		// Push whatever the turn touched onto the same branch. Everything the
		// agent has ever changed goes up, not just this pass — the branch is a
		// snapshot of the work, not a log of the passes.
		const changed = await this.changedPaths();
		const workspace = this.workspaceStub();
		const changes = await Promise.all(
			changed.map(async (path) => {
				const file = await workspace.read(path).catch(() => null);
				return { path: path.replace(/^\//, ''), content: file?.content ?? null };
			}),
		);

		try {
			await client.commitToBranch({
				branch: pull.branch,
				message: `Address review feedback on #${pull.number}`,
				changes,
			});
			await client.comment(
				pull.number,
				`Pushed a change addressing the ${comments.length} comment${comments.length === 1 ? '' : 's'} above.\n\n${result.text.slice(0, 1_000)}`,
			);
		} catch (error) {
			return {
				text: `Made the change but could not push it: ${error instanceof Error ? error.message : 'unknown error'}`,
				ok: false,
			};
		}

		const added = changed.filter((path) => !before.has(path)).length;
		return {
			text: `Addressed ${comments.length} comment${comments.length === 1 ? '' : 's'} and pushed to ${pull.branch}${added > 0 ? ` (${added} new file${added === 1 ? '' : 's'})` : ''}.`,
			ok: true,
		};
	}

	async repo(): Promise<StoredRepo | null> {
		const stored = this.getMeta('repo');
		return stored ? (JSON.parse(stored) as StoredRepo) : null;
	}

	/**
	 * The files the agent has changed relative to the checkout.
	 *
	 * This is the diff, and it is the reason the sandbox can be destroyed after
	 * every turn: the container is disposable, this list is not.
	 */
	async changedPaths(): Promise<string[]> {
		return parseJson<string[]>(this.getMeta('changedPaths'), []);
	}

	/** Commands run across the whole task, cited as evidence in the pull request. */
	async commands(): Promise<CommandRecord[]> {
		return parseJson<CommandRecord[]>(this.getMeta('commands'), []);
	}

	async summary(): Promise<SessionSummary> {
		const [row] = this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) AS count FROM transcript')
			.toArray();

		return {
			id: this.getMeta('sessionId') ?? '',
			title: this.getMeta('title') ?? 'Untitled session',
			createdAt: Number(this.getMeta('createdAt') ?? Date.now()),
			updatedAt: Number(this.getMeta('updatedAt') ?? Date.now()),
			messageCount: row?.count ?? 0,
			usage: this.getUsage(),
			proposals: this.getProposals(),
			plan: this.getPlan(),
			turnsUsed: Number(this.getMeta('turnsUsed') ?? 0),
			turnLimit: this.turnLimit(),
			model: this.model(),
			effort: this.effort(),
			runtime: this.runtime(),
		};
	}

	/**
	 * Which runtime this session uses. Defaults to the cheap one — a user who has
	 * not asked for a warm container should never be billed for one.
	 */
	private runtime(): Runtime {
		const stored = this.getMeta('runtime');
		return stored && isRuntime(stored) ? stored : DEFAULT_RUNTIME;
	}

	/** The model this session runs on. Falls back to the deployment default. */
	private model(): string {
		const stored = this.getMeta('model');
		if (stored && isSelectableModel(stored)) return stored;
		const configured = this.env.AGENT_MODEL || '';
		return isValidModel(configured) ? configured : DEFAULT_MODEL;
	}

	private effort(): string {
		const stored = this.getMeta('effort');
		if (stored && isValidEffort(stored)) return stored;
		const configured = this.env.AGENT_EFFORT || '';
		return isValidEffort(configured) ? configured : DEFAULT_EFFORT;
	}

	/** Switch model, effort or runtime mid-session — takes effect on the next turn. */
	async configure(options: {
		model?: string;
		effort?: string;
		runtime?: string;
	}): Promise<SessionSummary> {
		if (options.model !== undefined) {
			if (!isSelectableModel(options.model)) throw new Error(`Unknown model: ${options.model}`);
			this.setMeta('model', options.model);
		}
		if (options.effort !== undefined) {
			if (!isValidEffort(options.effort)) throw new Error(`Unknown effort: ${options.effort}`);
			this.setMeta('effort', options.effort);
		}
		if (options.runtime !== undefined) {
			if (!isRuntime(options.runtime)) throw new Error(`Unknown runtime: ${options.runtime}`);
			// Dropping to the cheap runtime has to take effect now, not next turn.
			// Otherwise a user turning it off keeps paying for the warm container
			// until they happen to send another message.
			if (!keepsSandboxWarm(options.runtime)) await this.disposeSandbox();
			this.setMeta('runtime', options.runtime);
		}
		return this.summary();
	}

	/**
	 * Destroy this session's container, if it has one.
	 *
	 * Safe to call when there is none. Failure is ignored on purpose: the
	 * provider's own idle timeout will reap anything left behind, and a dead
	 * container must never be the reason a turn reports an error.
	 */
	private async disposeSandbox(): Promise<void> {
		const sandboxId = this.getMeta('sandboxId');
		if (!sandboxId) return;
		this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = 'sandboxId'");
		const sandbox = createSandbox(this.env, {
			sessionId: this.getMeta('sessionId') ?? 'default',
			sandboxId,
			onSandboxCreated: () => {},
		});
		await sandbox?.dispose().catch(() => {});
	}

	async rename(title: string): Promise<SessionSummary> {
		this.setMeta('title', title);
		return this.summary();
	}

	/** Replayable conversation for the UI. */
	async transcript(): Promise<TranscriptMessage[]> {
		return this.ctx.storage.sql
			.exec<TranscriptRow>('SELECT * FROM transcript ORDER BY id')
			.toArray()
			.map((row) => ({
				id: row.id,
				role: row.role as TranscriptMessage['role'],
				text: row.text,
				createdAt: row.created_at,
				tools: row.tools ? (JSON.parse(row.tools) as ToolRecord[]) : undefined,
				segments: row.segments
					? (JSON.parse(row.segments) as TurnSegment[])
					: undefined,
				trigger: row.trigger ?? undefined,
			}));
	}

	/** Clear the conversation. The workspace, memory, and skills are untouched. */
	async clearHistory(): Promise<void> {
		this.ctx.storage.sql.exec('DELETE FROM messages');
		this.ctx.storage.sql.exec('DELETE FROM transcript');
		this.setMeta('proposals', '[]');
		this.setMeta('plan', '[]');
		this.setMeta('updatedAt', String(Date.now()));
	}

	// -------------------------------------------------------------- the turn

	/**
	 * `POST /run` with `{ "message": "..." }` returns an SSE stream of AgentEvents.
	 */
	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.method !== 'POST' || url.pathname !== '/run') {
			return new Response('Not found', { status: 404 });
		}
		if (this.running) {
			return Response.json({ error: 'A turn is already running in this session.' }, { status: 409 });
		}
		if (!this.env.ANTHROPIC_API_KEY) {
			return Response.json(
				{ error: 'ANTHROPIC_API_KEY is not configured on the Worker.' },
				{ status: 500 },
			);
		}

		// Demo cap. Without one, a public link is an open tap on someone's key.
		const limit = this.turnLimit();
		const used = Number(this.getMeta('turnsUsed') ?? 0);
		if (limit !== null && used >= limit) {
			return Response.json(
				{
					error: `This demo session has reached its limit of ${limit} turns. Start a new session to keep going.`,
				},
				{ status: 429 },
			);
		}

		const body = (await request.json()) as { message?: unknown };
		const userMessage = typeof body.message === 'string' ? body.message.trim() : '';
		if (!userMessage) {
			return Response.json({ error: '"message" must be a non-empty string.' }, { status: 400 });
		}

		this.running = true;
		const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
		this.ctx.waitUntil(this.streamTurn(userMessage, writable));

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
			},
		});
	}

	/**
	 * Run a turn with nobody watching, for the scheduler.
	 *
	 * Same loop, same tools, same transcript — the only differences are that the
	 * events go nowhere and the message is tagged with what triggered it.
	 */
	async runHeadless(prompt: string, trigger: string): Promise<{ text: string; ok: boolean }> {
		if (this.running) return { text: 'Skipped: a turn was already running.', ok: false };
		if (!this.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured.');

		// The interactive path checks these in the Worker route, before it ever
		// reaches this object. A scheduled run has no route and no request — the
		// alarm calls straight in — so without these two checks a background agent
		// spends past a zero balance and past the demo cap. That is precisely the
		// agent you least want running unmetered, because nobody is watching it.
		const limit = this.turnLimit();
		const used = Number(this.getMeta('turnsUsed') ?? 0);
		if (limit !== null && used >= limit) {
			return {
				text: `Skipped: this session has reached its limit of ${limit} turns.`,
				ok: false,
			};
		}

		const budget = await fetchBudget(this.env, this.userId()).catch(() => null);
		if (budget?.exhausted) {
			return {
				text: 'Skipped: the account has no credits left.',
				ok: false,
			};
		}

		this.running = true;
		try {
			const result = await this.executeTurn(prompt, trigger, () => {});
			return { text: result.text, ok: true };
		} finally {
			this.running = false;
		}
	}

	private async streamTurn(userMessage: string, writable: WritableStream<Uint8Array>): Promise<void> {
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		// Buffer events and flush them in order: writing per-delta keeps the UI
		// responsive without awaiting inside the model's stream loop.
		const pending: AgentEvent[] = [];
		let flushing: Promise<void> = Promise.resolve();

		const emit = (event: AgentEvent) => {
			pending.push(event);
			flushing = flushing.then(async () => {
				const batch = pending.splice(0, pending.length);
				for (const item of batch) {
					await writer.write(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
				}
			});
		};

		try {
			await this.executeTurn(userMessage, null, emit);
		} catch (error) {
			emit({ type: 'error', message: describeAgentError(error) });
		} finally {
			this.running = false;
			await flushing;
			await writer.close().catch(() => {});
		}
	}

	/** The shared body of both interactive and headless turns. */
	private async executeTurn(
		userMessage: string,
		trigger: string | null,
		emit: (event: AgentEvent) => void,
	) {
		const sessionId = this.getMeta('sessionId') ?? 'default';
		const model = this.model();

		this.appendMessage('user', userMessage);
		this.appendTranscript('user', userMessage, undefined, trigger);
		if (this.getMeta('title') === 'Untitled session') {
			this.setMeta('title', deriveTitle(userMessage));
		}

		const brain = this.brainStub();
		const repo = await this.repoContext();
		// Addressed by name, so a repository the agent has never touched simply
		// resolves to an empty object rather than needing to be created first.
		const repoBrain = repo ? this.repoBrainStub(repo.fullName) : null;

		const [memories, skills, repoMemories] = await Promise.all([
			brain.recall(),
			brain.skillCatalogue(),
			repoBrain ? repoBrain.recall(REPO_RECALL_LIMIT) : Promise.resolve([]),
		]);

		// One provider instance per turn, shared by the tools and — on the sandbox
		// runtime — by the workspace. Two instances would mean two containers.
		const sandbox = createSandbox(this.env, {
			sessionId,
			sandboxId: this.getMeta('sandboxId') ?? undefined,
			keepWarm: keepsSandboxWarm(this.runtime()),
			onSandboxCreated: (id) => this.setMeta('sandboxId', id),
		});

		// On the sandbox runtime the container holds the files and the object keeps
		// their history. Chosen here rather than inside the tools, which is the
		// whole point of the workspace interface.
		const durableWorkspace = this.workspaceStub();
		const filesLiveInSandbox = keepsSandboxWarm(this.runtime()) && sandbox !== null;
		const workspace =
			filesLiveInSandbox && sandbox
				? new SandboxWorkspace(sandbox, durableWorkspace, repo?.checkout ?? null)
				: durableWorkspace;

		const context: ToolContext = {
			sessionId,
			userId: this.userId(),
			// Seeded from storage so a follow-up turn can carry on from the plan
			// the previous turn left behind rather than starting blank.
			plan: this.getPlan(),
			emit,
			workspace,
			filesLiveInSandbox,
			brain,
			repoBrain,
			scheduler: this.schedulerStub(),
			// Reuse this session's sandbox if one was already booted, so only the
			// first command in a session pays for startup.
			sandbox,
			proposals: [],
			// Reset per turn: a fresh turn may reuse a warm sandbox, but the safe
			// assumption after a restart is that nothing is mirrored yet.
			syncedVersions: new Map(),
			repo,
			// Carried across turns. The container from the last turn is gone, but
			// the list of what the agent changed is what rebuilds it.
			changedPaths: new Set(await this.changedPaths()),
			commands: [],
		};

		const result = await runAgentTurn({
			client: new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY }),
			model,
			effort: this.effort(),
			context,
			memories,
			repoMemories,
			skills,
			messages: this.loadContext(),
			emit,
		});

		for (const message of result.newMessages) {
			this.appendMessage(message.role, message.content);
		}
		if (result.text || result.tools.length > 0) {
			this.appendTranscript('assistant', result.text, result.tools, trigger, result.segments);
		}

		// On the durable runtime the container goes as soon as the turn ends.
		// Booting costs ~2s; leaving one idling costs money for as long as it
		// lives, and a chat session can sit open for hours between messages.
		//
		// On the sandbox runtime it is kept deliberately — a dev server that dies
		// between turns is not a dev server. The provider's idle timeout is the
		// backstop for a session nobody comes back to.
		if (context.sandbox && !keepsSandboxWarm(this.runtime())) {
			await context.sandbox.dispose().catch(() => {});
			this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = 'sandboxId'");
		}

		// Priced per model, then summed. A routed turn runs on more than one, and
		// they bill at different rates — costing the whole turn at a single rate
		// would be wrong in whichever direction the routing went.
		let running = this.getUsage();
		for (const [ranOn, tokens] of Object.entries(result.usageByModel)) {
			running = addUsage(running, tokens, ranOn);
		}
		this.setUsage(running);
		this.setMeta('proposals', JSON.stringify(result.proposals));
		this.setMeta('plan', JSON.stringify(result.plan));
		this.setMeta('changedPaths', JSON.stringify([...context.changedPaths]));
		// Appended rather than replaced: the pull request cites every command run
		// across the task, not only the ones from the final turn. Capped so a long
		// task cannot grow this without bound.
		if (context.commands.length > 0) {
			const history = [...(await this.commands()), ...context.commands];
			this.setMeta('commands', JSON.stringify(history.slice(-50)));
		}
		this.setMeta('turnsUsed', String(Number(this.getMeta('turnsUsed') ?? 0) + 1));
		this.setMeta('updatedAt', String(Date.now()));

		// Archive the turn in MongoDB. Deliberately outside the caller's await:
		// the turn is already complete and paid for, so a slow or unreachable
		// history service must not delay the reply or fail the request.
		const summary = await this.summary();
		this.ctx.waitUntil(
			reportTurn(this.env, {
				sessionId,
				userId: this.userId(),
				prompt: userMessage,
				reply: result.text,
				tools: result.tools.map((tool) => tool.name),
				model,
				usage: {
					...result.usage,
					estimatedCostUsd: Object.entries(result.usageByModel).reduce(
						(total, [ranOn, tokens]) => total + estimateCostUsd(ranOn, tokens),
						0,
					),
				},
				trigger,
				messageCount: summary.messageCount,
			}),
		);

		return result;
	}

	/**
	 * The repository, with a usable clone URL.
	 *
	 * The token is fetched per turn rather than stored, so revoking it on GitHub
	 * takes effect on the very next turn. A failure here is not fatal: the agent
	 * simply runs without repo mode rather than the turn dying.
	 */
	private async repoContext(): Promise<RepoContext | null> {
		const stored = await this.repo();
		if (!stored) return null;

		const credentials = await fetchGitHubToken(this.env, this.userId()).catch(() => null);
		if (!credentials) return null;

		return {
			fullName: stored.fullName,
			installCommand: stored.installCommand,
			token: credentials.token,
			checkout: {
				cloneUrl: `https://x-access-token:${credentials.token}@github.com/${stored.fullName}.git`,
				branch: stored.branch,
				commitSha: stored.commitSha,
			},
		};
	}

	// --------------------------------------------------------------- private

	// Object names mirror http/stubs.ts. They must stay in step: a name is an
	// address, so a mismatch does not error — it silently opens an empty object.
	private workspaceStub(): DurableObjectStub<WorkspaceDO> {
		const sessionId = this.getMeta('sessionId') ?? 'default';
		return this.env.WORKSPACE.get(
			this.env.WORKSPACE.idFromName(`workspace:${this.userId()}:${sessionId}`),
		);
	}

	/**
	 * What the agent knows about one repository.
	 *
	 * The same class as the personal brain, addressed differently. An agent that
	 * lives in an ephemeral sandbox has to version this knowledge into a file and
	 * commit it somewhere to survive; here it is simply an object that persists.
	 */
	private repoBrainStub(fullName: string): DurableObjectStub<BrainDO> {
		return this.env.BRAIN.get(
			this.env.BRAIN.idFromName(`repo:${this.userId()}:${fullName}`),
		);
	}

	/** Memory and skills are shared across all of this user's sessions. */
	private brainStub(): DurableObjectStub<BrainDO> {
		return this.env.BRAIN.get(this.env.BRAIN.idFromName(`brain:${this.userId()}`));
	}

	private schedulerStub(): DurableObjectStub<SchedulerDO> {
		return this.env.SCHEDULER.get(this.env.SCHEDULER.idFromName(`scheduler:${this.userId()}`));
	}

	/** Rebuild the model-facing conversation from storage. */
	private loadContext(): Anthropic.MessageParam[] {
		return this.ctx.storage.sql
			.exec<MessageRow>('SELECT * FROM messages ORDER BY id')
			.toArray()
			.map((row) => ({
				role: row.role as Anthropic.MessageParam['role'],
				content: JSON.parse(row.content) as Anthropic.MessageParam['content'],
			}));
	}

	private appendMessage(role: string, content: unknown): void {
		this.ctx.storage.sql.exec(
			'INSERT INTO messages (role, content, created_at) VALUES (?1, ?2, ?3)',
			role,
			JSON.stringify(content),
			Date.now(),
		);
	}

	private appendTranscript(
		role: string,
		text: string,
		tools?: ToolRecord[],
		trigger?: string | null,
		segments?: TurnSegment[],
	): void {
		this.ctx.storage.sql.exec(
			'INSERT INTO transcript (role, text, tools, segments, trigger, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
			role,
			text,
			tools && tools.length > 0 ? JSON.stringify(tools) : null,
			segments && segments.length > 0 ? JSON.stringify(segments) : null,
			trigger ?? null,
			Date.now(),
		);
	}

	private turnLimit(): number | null {
		const raw = Number(this.env.DEMO_TURN_LIMIT ?? 0);
		return Number.isFinite(raw) && raw > 0 ? raw : null;
	}

	private getUsage(): SessionUsage {
		return parseJson<SessionUsage>(this.getMeta('usage'), EMPTY_USAGE);
	}

	private setUsage(usage: SessionUsage): void {
		this.setMeta('usage', JSON.stringify(usage));
	}

	/**
	 * The current checklist.
	 *
	 * Persisted like proposals so it survives a reload mid-task — a plan that
	 * vanished when you refreshed the page would be worse than no plan.
	 */
	private getPlan(): PlanStep[] {
		return parseJson<PlanStep[]>(this.getMeta('plan'), []);
	}

	private getProposals(): Proposal[] {
		return parseJson<Proposal[]>(this.getMeta('proposals'), []);
	}

	private getMeta(key: string): string | null {
		const [row] = this.ctx.storage.sql
			.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?1', key)
			.toArray();
		return row?.value ?? null;
	}

	private setMeta(key: string, value: string): void {
		this.ctx.storage.sql.exec(
			'INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2',
			key,
			value,
		);
	}
}

/** First line of the opening message, trimmed, used as the session title. */
function deriveTitle(message: string): string {
	const firstLine = message.split('\n')[0].trim();
	return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine || 'Untitled session';
}

function parseJson<T>(raw: string | null, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}
