/**
 * The single place the frontend talks to the backend.
 *
 * There are two of them, and the split is deliberate:
 *
 *   the Worker (:8787)  — the live agent. Conversations, files, memory,
 *                         schedules. All of it lives in Durable Objects.
 *   the main API (:4000) — accounts, session history, settings, usage. MongoDB.
 *
 * Both are addressed on `localhost` rather than `127.0.0.1`, because a cookie is
 * scoped by hostname and shared across ports: one login on :4000 is therefore
 * also sent to :8787. Mixing the two spellings would look identical and quietly
 * log you out of half the app.
 *
 * Every call goes through `request`, so error handling, JSON parsing, base URLs,
 * and credentials are defined once. Components never build a fetch by hand.
 */

import { readSessionToken, writeSessionToken } from "./session-token";
import type {
  AccountUsage,
  AttachedRepo,
  CommandRecord,
  GitHubIssueOption,
  GitHubRepoOption,
  WatchedPullRequest,
  ArchivedTurn,
  AuthUser,
  BrainSnapshot,
  Cadence,
  FileRevision,
  FileWithContent,
  Health,
  Memory,
  ModelOption,
  Schedule,
  ScheduleActivity,
  ScheduledRun,
  SessionListItem,
  SessionSummary,
  Skill,
  TranscriptMessage,
  WorkspaceTree,
} from "./types";

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787"
).replace(/\/$/, "");

const MAIN_API_URL = (
  process.env.NEXT_PUBLIC_MAIN_API_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

/** The bearer header, when a token is being held client-side. */
function authHeader(): Record<string, string> {
  const token = readSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return send<T>(
    BASE_URL,
    path,
    init,
    "Cannot reach the agent backend. Is `npm run dev` running in ./backend?",
  );
}

/** Same contract, aimed at the main API instead of the Worker. */
function main<T>(path: string, init?: RequestInit): Promise<T> {
  return send<T>(
    MAIN_API_URL,
    path,
    init,
    "Cannot reach the main backend. Is `npm run dev` running in ./api?",
  );
}

async function send<T>(
  baseUrl: string,
  path: string,
  init: RequestInit | undefined,
  offlineMessage: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      // Without this the session cookie is never sent, and every call is
      // anonymous — the single most common way to break cross-origin auth.
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        // Only present on split deployments; same-origin setups use the cookie.
        ...authHeader(),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, offlineMessage);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

/** A session row as MongoDB stores it, before timestamps are normalised. */
interface StoredSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export const api = {
  // ----------------------------------------------------------------- auth

  /** Who is signed in, or null. Never throws for "signed out" — that is normal. */
  async me(): Promise<AuthUser | null> {
    try {
      const { user } = await main<{ user: AuthUser }>("/api/auth/me");
      return user;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) return null;
      throw cause;
    }
  },

  async register(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<AuthUser> {
    const { user, token } = await main<{ user: AuthUser; token?: string }>(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify(input) },
    );
    writeSessionToken(token ?? null);
    return user;
  },

  async login(input: { email: string; password: string }): Promise<AuthUser> {
    const { user, token } = await main<{ user: AuthUser; token?: string }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify(input) },
    );
    writeSessionToken(token ?? null);
    return user;
  },

  async logout(): Promise<void> {
    await main("/api/auth/logout", { method: "POST" });
    // Cleared even if the request failed — the intent was to sign out.
    writeSessionToken(null);
  },

  // --------------------------------------------------------------- github

  /** Store a personal access token. Validated against GitHub before it is saved. */
  async connectGitHub(token: string): Promise<AuthUser> {
    const { user } = await main<{ user: AuthUser }>("/api/github/connect", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    return user;
  },

  async disconnectGitHub(): Promise<AuthUser> {
    const { user } = await main<{ user: AuthUser }>("/api/github/connect", {
      method: "DELETE",
    });
    return user;
  },

  /** Only repositories this token can actually push to. */
  githubRepos(): Promise<{ repos: GitHubRepoOption[] }> {
    return main("/api/github/repos");
  },

  githubIssues(repo: string): Promise<{ issues: GitHubIssueOption[] }> {
    return main(`/api/github/issues?repo=${encodeURIComponent(repo)}`);
  },

  /**
   * Repo state for a session. Hits the Worker, not the main API — the diff
   * lives in the session's Durable Object.
   */
  sessionRepo(
    sessionId: string,
  ): Promise<{
    repo: AttachedRepo | null;
    changedPaths: string[];
    commands: CommandRecord[];
    knowledge: Memory[];
    pullRequest: WatchedPullRequest | null;
  }> {
    return request(`/api/sessions/${sessionId}/github`);
  },

  /** Forget one thing the agent learned about the repository. */
  forgetRepoKnowledge(sessionId: string, memoryId: number): Promise<void> {
    return request(`/api/sessions/${sessionId}/github/knowledge/${memoryId}`, {
      method: "DELETE",
    });
  },

  attachRepo(
    sessionId: string,
    input: { repo: string; issue?: number },
  ): Promise<{
    repo: AttachedRepo;
    imported: { files: number; bytes: number; summary: string };
    task: string | null;
  }> {
    return request(`/api/sessions/${sessionId}/github/attach`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  openPullRequest(
    sessionId: string,
    input: { title?: string } = {},
  ): Promise<{ pullRequest: { number: number; url: string; branch: string } }> {
    return request(`/api/sessions/${sessionId}/github/pull-request`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  // -------------------------------------------------------- profile

  async updateProfile(patch: {
    name?: string;
    settings?: Partial<AuthUser["settings"]>;
  }): Promise<AuthUser> {
    const { user } = await main<{ user: AuthUser }>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return user;
  },

  changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    return main("/api/profile/password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** Lifetime spend across every session, for the settings page. */
  async usage(): Promise<AccountUsage> {
    const { usage } = await main<{ usage: AccountUsage }>("/api/profile/usage");
    return usage;
  },

  /** The durable transcript, which outlives the session's Durable Object. */
  archivedTurns(sessionId: string): Promise<{ turns: ArchivedTurn[] }> {
    return main(`/api/sessions/${sessionId}/turns`);
  },

  /** What this deployment supports — read once so the UI never over-promises. */
  health(): Promise<Health> {
    return request("/api/health");
  },

  // ------------------------------------------------------------- sessions

  /** The model catalogue the picker renders. */
  models(): Promise<{
    models: ModelOption[];
    efforts: string[];
    auto?: { id: string; label: string; blurb: string };
  }> {
    return request("/api/sessions/models");
  },

  /** Switch the model, effort or runtime a session runs on. */
  configureSession(
    id: string,
    next: { model?: string; effort?: string; runtime?: string },
  ): Promise<{ session: SessionSummary }> {
    return request(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(next),
    });
  },

  /**
   * The sidebar list, from MongoDB rather than from a Durable Object.
   *
   * Timestamps arrive as ISO strings and are converted to epoch milliseconds
   * here, so everything downstream keeps working with plain numbers.
   */
  async listSessions(): Promise<{ sessions: SessionListItem[] }> {
    const { sessions } = await main<{ sessions: StoredSession[] }>(
      "/api/sessions",
    );
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: Date.parse(session.createdAt),
        updatedAt: Date.parse(session.updatedAt),
        messageCount: session.messageCount,
      })),
    };
  },

  /**
   * Create a session.
   *
   * `defaults` carries the account's preferred model and effort. The browser
   * already knows them from the signed-in user, so passing them here saves the
   * Worker a round trip to the main API on every session creation.
   */
  createSession(
    title?: string,
    defaults?: { model?: string; effort?: string },
  ): Promise<{ session: SessionSummary }> {
    return request("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title, ...defaults }),
    });
  },

  getSession(
    id: string,
  ): Promise<{ session: SessionSummary; messages: TranscriptMessage[] }> {
    return request(`/api/sessions/${id}`);
  },

  renameSession(id: string, title: string): Promise<{ session: SessionSummary }> {
    return request(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  },

  deleteSession(id: string): Promise<void> {
    return request(`/api/sessions/${id}`, { method: "DELETE" });
  },

  clearMessages(id: string): Promise<void> {
    return request(`/api/sessions/${id}/messages`, { method: "DELETE" });
  },

  // ------------------------------------------------------------ workspace

  getWorkspace(id: string): Promise<WorkspaceTree> {
    return request(`/api/sessions/${id}/workspace`);
  },

  readFile(id: string, path: string): Promise<{ file: FileWithContent }> {
    return request(
      `/api/sessions/${id}/workspace/file?path=${encodeURIComponent(path)}`,
    );
  },

  writeFile(
    id: string,
    path: string,
    content: string,
  ): Promise<{ file: FileWithContent }> {
    return request(`/api/sessions/${id}/workspace/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    });
  },

  deleteFile(id: string, path: string): Promise<void> {
    return request(
      `/api/sessions/${id}/workspace/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
  },

  /** One historical revision, contents included, for the diff view. */
  fileRevision(
    id: string,
    path: string,
    version: number,
  ): Promise<{ revision: FileRevision & { content: string } }> {
    return request(
      `/api/sessions/${id}/workspace/revision?path=${encodeURIComponent(path)}&version=${version}`,
    );
  },

  fileHistory(id: string, path: string): Promise<{ revisions: FileRevision[] }> {
    return request(
      `/api/sessions/${id}/workspace/history?path=${encodeURIComponent(path)}`,
    );
  },

  // ---------------------------------------------------- memory and skills

  getBrain(): Promise<BrainSnapshot> {
    return request("/api/brain");
  },

  addMemory(content: string, category: string): Promise<{ memory: Memory }> {
    return request("/api/brain/memories", {
      method: "POST",
      body: JSON.stringify({ content, category }),
    });
  },

  correctMemory(id: number, content: string): Promise<{ memory: Memory }> {
    return request(`/api/brain/memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
  },

  forgetMemory(id: number): Promise<void> {
    return request(`/api/brain/memories/${id}`, { method: "DELETE" });
  },

  saveSkill(
    name: string,
    description: string,
    body: string,
  ): Promise<{ skill: Skill }> {
    return request("/api/brain/skills", {
      method: "PUT",
      body: JSON.stringify({ name, description, body }),
    });
  },

  deleteSkill(name: string): Promise<void> {
    return request(`/api/brain/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },

  // ------------------------------------------------------------ schedules

  listSchedules(sessionId?: string): Promise<{ schedules: Schedule[] }> {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    return request(`/api/schedules${query}`);
  },

  createSchedule(input: {
    sessionId: string;
    label: string;
    prompt: string;
    cadence: Cadence;
    intervalMinutes?: number;
    minuteOfDay?: number;
    delayMinutes?: number;
  }): Promise<{ schedule: Schedule }> {
    return request("/api/schedules", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  setScheduleStatus(
    id: number,
    status: "active" | "paused",
  ): Promise<{ schedule: Schedule }> {
    return request(`/api/schedules/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },

  deleteSchedule(id: number): Promise<void> {
    return request(`/api/schedules/${id}`, { method: "DELETE" });
  },

  /** Is a background run in flight right now? Polled by the banner. */
  scheduleActivity(): Promise<ScheduleActivity> {
    return request("/api/schedules/activity");
  },

  /** Kill switch: pause every armed schedule. */
  pauseAllSchedules(): Promise<{ paused: number }> {
    return request("/api/schedules/pause-all", { method: "POST" });
  },

  scheduleRuns(id: number): Promise<{ runs: ScheduledRun[] }> {
    return request(`/api/schedules/${id}/runs`);
  },

  /** Fire a schedule immediately rather than waiting for its alarm. */
  runScheduleNow(id: number): Promise<{ run: ScheduledRun }> {
    return request(`/api/schedules/${id}/run`, { method: "POST" });
  },

  /** URL for the streaming turn endpoint, consumed by `useAgentStream`. */
  messagesUrl(id: string): string {
    return `${BASE_URL}/api/sessions/${id}/messages`;
  },
};
