"use client";

/**
 * The user's own shell into a session's container.
 *
 * The agent already has one — this is the same container, driven by hand. It
 * exists because the moment you can see a workspace you want to poke at it, and
 * asking the model to run `ls` for you is a slow and expensive way to do that.
 *
 * Only the sandbox runtime keeps a container between commands, so the server
 * refuses on any other one. That refusal is surfaced as `unavailable` rather
 * than as an error, because it is a fact about the session's configuration and
 * the fix is a setting, not a retry.
 *
 * Each command is its own exec, so nothing carries over between them by
 * itself — including the working directory, which makes `cd` look broken to
 * anyone who has used a shell before. The directory is therefore tracked here
 * and re-entered ahead of every command, and the resulting one is read back on
 * a marker line that is stripped before display. Environment variables are not
 * carried the same way: `export` still does not persist, because faking that
 * convincingly would mean reimplementing a shell in the client.
 */

import { useCallback, useRef, useState } from "react";
import { api } from "./api";
import { readSessionToken } from "./session-token";
import type { ShellEntry, ShellEvent } from "./types";

/** Scrollback cap. Long enough to follow a build, short enough to stay quick. */
const MAX_ENTRIES = 100;

/** Where a container's checkout lives. Matches the sandbox workspace. */
const HOME = "/home/daytona/workspace";

/**
 * Sentinel the wrapper prints the working directory on.
 *
 * Long and unlikely enough that no ordinary output collides with it — if it
 * did, the line would be eaten from the user's output.
 */
const CWD_MARKER = "__DA_CWD_9f3a__";

export interface ShellState {
  entries: ShellEntry[];
  running: boolean;
  /** Working directory, carried across commands so `cd` behaves normally. */
  cwd: string;
  /** Set when the session's runtime has no persistent container. */
  unavailable: string | null;
  error: string | null;
  run: (command: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export function useShell(
  sessionId: string,
  options: {
    /**
     * The session's current runtime. Only used to decide when the refusal
     * above is stale: switching to a runtime that keeps a container is exactly
     * the fix the message asks for, and the panel has to become usable again
     * without a reload.
     */
    runtime: string | undefined;
    /** Called once a command has written files back, so the tree can refresh. */
    onWorkspaceChanged?: () => void;
  },
): ShellState {
  const { runtime, onWorkspaceChanged } = options;
  const [entries, setEntries] = useState<ShellEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cwd, setCwd] = useState(HOME);
  const abortRef = useRef<AbortController | null>(null);

  // Reset during render rather than in an effect: an effect would paint the
  // stale refusal for a frame first.
  const [lastRuntime, setLastRuntime] = useState(runtime);
  if (runtime !== lastRuntime) {
    setLastRuntime(runtime);
    if (unavailable) setUnavailable(null);
  }

  /** Update the entry currently running. It is always the last one. */
  const patchLast = useCallback((change: (entry: ShellEntry) => ShellEntry) => {
    setEntries((current) =>
      current.map((entry, index) =>
        index === current.length - 1 ? change(entry) : entry,
      ),
    );
  }, []);

  const run = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!trimmed || running) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);

      // Appended before the request so the prompt echoes immediately, the way a
      // terminal does — waiting for the server to acknowledge would feel laggy.
      setEntries((current) =>
        [
          ...current,
          {
            id: Date.now(),
            command: trimmed,
            output: "",
            exitCode: null,
            durationMs: 0,
          },
        ].slice(-MAX_ENTRIES),
      );

      try {
        const response = await fetch(api.shellUrl(sessionId), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(readSessionToken()
              ? { Authorization: `Bearer ${readSessionToken()}` }
              : {}),
          },
          credentials: "include",
          // `cd` into the tracked directory first, run the command in a group so
          // its exit code is the one reported, then print where we ended up.
          // `|| true` on the cd keeps a deleted directory from swallowing the
          // command silently — it falls back to the container's default.
          //
          // The newline before `}` is load-bearing: it terminates the user's
          // command, so a trailing `#` comment cannot swallow what follows. A
          // `;` there instead is a syntax error, because after a newline the
          // shell sees a `;` with no command in front of it.
          body: JSON.stringify({
            command:
              `cd ${shellQuote(cwd)} 2>/dev/null || cd ${shellQuote(HOME)} 2>/dev/null || true; ` +
              `{ ${trimmed}\n}; __da_code=$?; ` +
              `printf '\\n%s%s\\n' '${CWD_MARKER}' "$(pwd)"; exit $__da_code`,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          const message = payload?.error ?? `The shell failed (${response.status}).`;
          // A wrong runtime is a state to explain, not an error to dismiss.
          if (payload?.code === "runtime_unsupported" || payload?.code === "no_sandbox") {
            setUnavailable(message);
            setEntries((current) => current.slice(0, -1));
          } else {
            setError(message);
            patchLast((entry) => ({ ...entry, exitCode: -1 }));
          }
          return;
        }

        setUnavailable(null);
        let wroteFiles = false;
        let nextCwd: string | null = null;

        await readEventStream(response.body, (event) => {
          if (event.type === "output") {
            patchLast((entry) => ({ ...entry, output: entry.output + event.chunk }));
          } else if (event.type === "exit") {
            // Pull the marker out of the finished output and adopt the
            // directory the command left us in.
            patchLast((entry) => {
              const found = readCwdMarker(entry.output);
              if (found.cwd) nextCwd = found.cwd;
              return { ...entry, output: found.output };
            });
            patchLast((entry) => ({
              ...entry,
              exitCode: event.exitCode,
              durationMs: event.durationMs,
            }));
            if (event.changedFiles.length > 0) wroteFiles = true;
          } else {
            setError(event.message);
            patchLast((entry) => ({ ...entry, exitCode: -1 }));
          }
        });

        if (nextCwd) setCwd(nextCwd);
        if (wroteFiles) onWorkspaceChanged?.();
      } catch (cause) {
        if (controller.signal.aborted) {
          patchLast((entry) => ({
            ...entry,
            output: `${entry.output}\n^C`,
            exitCode: 130,
          }));
        } else {
          setError(cause instanceof Error ? cause.message : "The command failed.");
          patchLast((entry) => ({ ...entry, exitCode: -1 }));
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [cwd, onWorkspaceChanged, patchLast, running, sessionId],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => {
    setEntries([]);
    setError(null);
  }, []);

  return { entries, running, cwd, unavailable, error, run, stop, clear };
}

/** Single-quote a string for `sh`, closing and reopening around any quote. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Split the trailing working-directory marker off a command's output. */
function readCwdMarker(output: string): { output: string; cwd: string | null } {
  const at = output.lastIndexOf(CWD_MARKER);
  if (at === -1) return { output, cwd: null };

  const after = output.slice(at + CWD_MARKER.length);
  const cwd = after.split("\n")[0].trim();
  // Also drop the newline the wrapper printed before the marker.
  const before = output.slice(0, at).replace(/\n$/, "");
  return { output: before, cwd: cwd || null };
}

/** Parse `data: {...}` frames out of the byte stream and dispatch each one. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ShellEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line; anything after the last one is a
    // partial frame that stays in the buffer until more bytes arrive.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((part) => part.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as ShellEvent);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    }
  }
}
