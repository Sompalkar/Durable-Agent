/**
 * Shared domain types.
 *
 * These are the contract between the Durable Objects, the HTTP routes, and the
 * frontend. Anything crossing an RPC or network boundary is defined here.
 */

/** A file as stored in the workspace's SQLite database. */
export interface FileRecord {
	path: string;
	size: number;
	createdAt: number;
	updatedAt: number;
	version: number;
}

/** A file plus its contents. */
export interface FileWithContent extends FileRecord {
	content: string;
}

/** One historical revision of a file. */
export interface FileRevision {
	version: number;
	size: number;
	createdAt: number;
	summary: string;
}

/** A single match produced by the `grep` tool. */
export interface GrepMatch {
	path: string;
	line: number;
	text: string;
}

/** Aggregate numbers describing a workspace, shown in the UI header. */
export interface WorkspaceStats {
	fileCount: number;
	totalBytes: number;
	revisionCount: number;
}

/** Roles we persist in a session transcript. */
export type MessageRole = 'user' | 'assistant';

/** A turn in the conversation, as replayed to the UI. */
export interface TranscriptMessage {
	id: number;
	role: MessageRole;
	/** Rendered text for the UI. */
	text: string;
	createdAt: number;
	/** Tools used during this turn, so reloaded history still shows the work. */
	tools?: ToolRecord[];
	/** Set when the turn was started by a schedule rather than by the user. */
	trigger?: string;
}

/**
 * The lightweight shape the sidebar needs. The registry stores these; the full
 * `SessionSummary` is only assembled when a session is actually opened.
 */
export interface SessionListItem {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

/** Everything about a session, read from the session object itself. */
export interface SessionSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	/** Cumulative token spend, so the cost of the session is never a surprise. */
	usage: SessionUsage;
	/** Follow-up actions offered at the end of the last turn. */
	proposals: Proposal[];
	/** The agent's checklist for the work in progress. Empty when there is none. */
	plan: PlanStep[];
	/** Turns used, against the demo cap when one is configured. */
	turnsUsed: number;
	turnLimit: number | null;
	/**
	 * Where this session's work happens: "durable" rents a container per command,
	 * "sandbox" keeps one alive between turns. Changeable per session.
	 */
	runtime: string;
	/** Model and effort this session runs on. Changeable per session. */
	model: string;
	effort: string;
}

export interface SessionUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	/** Estimated USD, from the configured model's published rates. */
	estimatedCostUsd: number;
}

/** Result of executing a single tool, as reported back to the model and UI. */
export interface ToolOutcome {
	ok: boolean;
	/** Text handed back to the model as the tool_result content. */
	content: string;
	/** Short human-readable line for the UI timeline. */
	summary: string;
	/**
	 * Output worth keeping for the user to read after the fact — command logs,
	 * mostly. Streamed live over SSE either way; this is what survives a reload,
	 * so it is capped where the streamed copy is not.
	 */
	output?: string;
}

/**
 * A follow-up action the agent offers at the end of a turn.
 * Rendered as a button; clicking it sends `prompt` as the next message.
 */
export interface Proposal {
	title: string;
	prompt: string;
}

/**
 * One step of the agent's plan.
 *
 * The plan is rewritten wholesale on every update rather than patched
 * step-by-step. Asking a model to emit a stable id and then mutate it by that id
 * is a reliable source of drift; re-sending the whole short list is not.
 */
export interface PlanStep {
	step: string;
	status: PlanStatus;
}

export type PlanStatus = 'pending' | 'active' | 'done';

/**
 * A repository attached to a session.
 *
 * Deliberately credential-free. The clone URL is assembled at turn time from a
 * token fetched out of the main API, so revoking the token on GitHub takes
 * effect immediately instead of leaving a working credential in storage.
 */
/** A pull request this session opened, and how far its review has been read. */
export interface StoredPullRequest {
	number: number;
	url: string;
	branch: string;
	/**
	 * Timestamp of the newest comment already handled.
	 *
	 * Kept so a wake-up can ask GitHub only for what is new, and so a restart
	 * cannot make the agent answer the same review twice.
	 */
	reviewedThrough: string | null;
}

export interface StoredRepo {
	/** `owner/name`. */
	fullName: string;
	/** Branch the pull request will target. */
	branch: string;
	/** Commit the checkout is pinned to, so every turn starts from the same tree. */
	commitSha: string;
	/** Detected from the repo's manifest, e.g. `npm ci`. */
	installCommand: string;
	/** The issue this task came from, when it came from one. */
	issueNumber: number | null;
	issueTitle: string | null;
}

/**
 * One piece of a turn, in the order it happened.
 *
 * A turn is a sequence — the model says something, calls a tool, says more —
 * not a pile of text and a separate pile of tools. Storing the order is what
 * lets a reloaded transcript read like the work instead of a summary of it.
 */
export type TurnSegment =
	| { kind: 'text'; text: string }
	| { kind: 'tool'; tool: ToolRecord };

/** One tool call, persisted so replayed history shows the work, not just the reply. */
export interface ToolRecord {
	id: string;
	name: string;
	input: unknown;
	ok: boolean;
	summary: string;
	durationMs: number;
	/** Captured command output, so a reloaded turn still shows what happened. */
	output?: string;
}

/**
 * Events streamed to the browser over SSE while a turn runs.
 * The frontend renders these directly, so keep the shapes narrow and stable.
 */
export type AgentEvent =
	| { type: 'turn_start' }
	| { type: 'thinking_delta'; text: string }
	| { type: 'text_delta'; text: string }
	| { type: 'tool_call'; id: string; name: string; input: unknown }
	| {
			type: 'tool_result';
			id: string;
			name: string;
			ok: boolean;
			summary: string;
			durationMs: number;
	  }
	| { type: 'workspace_changed' }
	/** Memory or skills were written, so those panels should refresh. */
	| { type: 'brain_changed' }
	/** A schedule was created or fired. */
	| { type: 'schedule_changed' }
	| { type: 'proposals'; proposals: Proposal[] }
	/** The agent rewrote its checklist. */
	| { type: 'plan'; plan: PlanStep[] }
	/** Output from a shell command, while it is still running. */
	| { type: 'command_output'; id: string; chunk: string }
	| { type: 'turn_end'; stopReason: string | null; usage: TurnUsage }
	| { type: 'error'; message: string };

export interface TurnUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
}
