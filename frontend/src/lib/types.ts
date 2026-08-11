/**
 * Types mirroring the backend contract.
 *
 * Kept hand-written and small rather than generated: this is the only place the
 * two halves of the project have to agree, so it is worth reading in one sitting.
 */

/** The signed-in account, as the main API reports it. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  plan: string;
  /** Remaining spend in USD. Turns are refused at zero. */
  creditsUsd: number;
  settings: {
    theme: "dark" | "light";
    defaultModel: string;
    defaultEffort: string;
  };
  /** Connection state only. The token never reaches the browser. */
  github: { login: string; scopes: string[]; connectedAt: string } | null;
}

/** Lifetime totals across every session, from MongoDB. */
export interface AccountUsage {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

/**
 * One archived turn.
 *
 * The live transcript comes from the session's Durable Object; this is the copy
 * that survives it, and the record billing is built on.
 */
export interface ArchivedTurn {
  sessionId: string;
  createdAt: string;
  prompt: string;
  reply: string;
  tools: string[];
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    estimatedCostUsd: number;
  };
  trigger: string | null;
}

/** The lightweight shape the sidebar list uses. */
export interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

/** A follow-up action the agent offers; clicking it sends `prompt`. */
export interface Proposal {
  title: string;
  prompt: string;
}

/**
 * One step of the agent's checklist.
 *
 * Rewritten wholesale on each update rather than patched — the agent re-sends
 * the whole short list, so there are no ids to keep in sync.
 */
export interface PlanStep {
  step: string;
  status: PlanStatus;
}

export type PlanStatus = "pending" | "active" | "done";

/** A repository attached to a session. Credential-free by design. */
export interface AttachedRepo {
  fullName: string;
  branch: string;
  commitSha: string;
  installCommand: string;
  issueNumber: number | null;
  issueTitle: string | null;
}

/** One command the agent ran, cited as evidence in the pull request. */
export interface CommandRecord {
  command: string;
  exitCode: number;
  durationMs: number;
}

/** A pull request this session opened and is now watching. */
export interface WatchedPullRequest {
  number: number;
  url: string;
  branch: string;
  reviewedThrough: string | null;
}

export interface GitHubRepoOption {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubIssueOption {
  number: number;
  title: string;
  labels: string[];
}

export interface SessionSummary extends SessionListItem {
  usage: SessionUsage;
  proposals: Proposal[];
  /** The agent's checklist for work in progress. Empty when there is none. */
  plan: PlanStep[];
  turnsUsed: number;
  turnLimit: number | null;
  /**
   * Where this session's work happens: "durable" rents a container per command,
   * "sandbox" keeps one alive between turns.
   */
  runtime: string;
  /** Model and effort this session runs on. Changeable per session. */
  model: string;
  effort: string;
}

/** One entry in the model picker, with the prices that drive the cost meter. */
export interface ModelOption {
  id: string;
  label: string;
  blurb: string;
  inputPerMTok: number;
  outputPerMTok: number;
  tier: "cheapest" | "balanced" | "most capable";
}

/** One tool call as persisted with the turn it belonged to. */
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

export interface TranscriptMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  /** Tools used during this turn. Present for both live and replayed turns. */
  tools?: ToolRecord[];
  /**
   * The turn as an ordered timeline of text and tools. Present on turns saved
   * after this feature shipped; older turns fall back to text + tools.
   */
  segments?: PersistedSegment[];
  /** Set when a schedule started the turn rather than the user. */
  trigger?: string;
}

/** A stored turn segment. The live equivalent carries a ToolActivity instead. */
export type PersistedSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: ToolRecord };

// ------------------------------------------------------------------ workspace

export interface FileRecord {
  path: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface FileWithContent extends FileRecord {
  content: string;
}

export interface FileRevision {
  version: number;
  size: number;
  createdAt: number;
  summary: string;
}

export interface WorkspaceStats {
  fileCount: number;
  totalBytes: number;
  revisionCount: number;
}

export interface WorkspaceTree {
  directories: string[];
  files: FileRecord[];
  stats: WorkspaceStats;
}

// ---------------------------------------------------------------------- brain

export type MemoryCategory = "preference" | "project" | "fact" | "correction";

export interface Memory {
  id: number;
  content: string;
  category: MemoryCategory;
  createdAt: number;
  updatedAt: number;
  recalls: number;
  sourceSessionId: string | null;
}

export interface Skill {
  id: number;
  name: string;
  description: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  uses: number;
}

export interface BrainSnapshot {
  memories: Memory[];
  skills: Skill[];
}

// ------------------------------------------------------------------ schedules

export type Cadence = "once" | "hourly" | "daily" | "interval";

export interface Schedule {
  id: number;
  /** True when the agent created it and it is waiting for your approval. */
  needsApproval: boolean;
  runCount: number;
  maxRuns: number;
  sessionId: string;
  label: string;
  prompt: string;
  cadence: Cadence;
  intervalMinutes: number | null;
  minuteOfDay: number | null;
  nextRunAt: number;
  lastRunAt: number | null;
  status: "active" | "paused" | "done";
  createdAt: number;
}

/** Whether a background run is happening right now. */
export interface ScheduleActivity {
  running: boolean;
  label: string | null;
  activeCount: number;
}

export interface ScheduledRun {
  id: number;
  scheduleId: number;
  startedAt: number;
  finishedAt: number;
  ok: boolean;
  summary: string;
}

// --------------------------------------------------------------------- health

/** What this deployment can actually do, so the UI never over-promises. */
export interface Health {
  status: string;
  model: string;
  apiKeyConfigured: boolean;
  sandboxEnabled: boolean;
  sandboxProvider: string | null;
  limits: {
    perSessionTurns: number | null;
    perHourTurns: number | null;
  };
}

// --------------------------------------------------------------------- events

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** Events streamed from the session Durable Object while a turn runs. */
export type AgentEvent =
  | { type: "turn_start" }
  | { type: "thinking_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      durationMs: number;
    }
  | { type: "workspace_changed" }
  | { type: "brain_changed" }
  | { type: "schedule_changed" }
  | { type: "proposals"; proposals: Proposal[] }
  | { type: "plan"; plan: PlanStep[] }
  | { type: "command_output"; id: string; chunk: string }
  | { type: "turn_end"; stopReason: string | null; usage: TurnUsage }
  | { type: "error"; message: string };

/** One tool invocation, assembled from its `tool_call` and `tool_result` events. */
export interface ToolActivity {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "ok" | "failed";
  summary?: string;
  durationMs?: number;
  /** Command output — streamed while running, then restored from the record. */
  output?: string;
}

/** Normalise a persisted record into the shape the timeline renders. */
export function toolRecordToActivity(record: ToolRecord): ToolActivity {
  return {
    id: record.id,
    name: record.name,
    input: record.input,
    status: record.ok ? "ok" : "failed",
    summary: record.summary,
    durationMs: record.durationMs,
    ...(record.output ? { output: record.output } : {}),
  };
}
