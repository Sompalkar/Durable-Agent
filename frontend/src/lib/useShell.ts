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

/** Where the wrapped command is staged inside the container. */
const SCRIPT_FILE = "/tmp/.da-shell-cmd";

export interface ShellState {
  entries: ShellEntry[];
  running: boolean;
  /** Working directory, carried across commands so `cd` behaves normally. */
  cwd: string;
  /** Set when the session's runtime has no persistent container. */
  unavailable: string | null;
  error: string | null;
  /** `columns` is the panel width in characters, for tty-aware output. */
  run: (command: string, columns?: number) => Promise<void>;
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
    async (command: string, columns = 80) => {
      const trimmed = command.trim();
      if (!trimmed || running) return;

      // Handled here rather than in the container: `clear` is about this
      // scrollback, and a real one would only wipe a screen the container does
      // not have. Sending it would cost a round trip to accomplish nothing.
      if (trimmed === "clear") {
        setEntries([]);
        setError(null);
        return;
      }

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
          body: JSON.stringify({ command: buildCommand(trimmed, cwd, columns) }),
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
        let trailer: Trailer = { cwd: null, exitCode: null };
        // Accumulated outside React state: the marker can be split across two
        // chunks, so the raw text has to be reassembled somewhere stable before
        // it can be parsed out.
        let raw = "";

        await readEventStream(response.body, (event) => {
          if (event.type === "output") {
            raw += clean(event.chunk);
            const found = splitTrailer(raw);
            if (found.trailer.cwd) trailer = found.trailer;
            // Stripped on the way in, so the marker never flashes on screen.
            patchLast((entry) => ({ ...entry, output: found.output }));
          } else if (event.type === "exit") {
            const found = splitTrailer(raw);
            if (found.trailer.cwd) trailer = found.trailer;
            patchLast((entry) => ({
              ...entry,
              output: found.output,
              // The provider's exit code is the wrapper's, not the command's.
              exitCode: trailer.exitCode ?? event.exitCode,
              durationMs: event.durationMs,
            }));
            if (event.changedFiles.length > 0) wroteFiles = true;
          } else {
            setError(event.message);
            patchLast((entry) => ({ ...entry, exitCode: -1 }));
          }
        });

        if (trailer.cwd) setCwd(trailer.cwd);
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

/**
 * Wrap the user's command so it runs on a real terminal.
 *
 * Without a tty `ls` prints one name per line, `git` and `less` disable their
 * pagers, and nothing colourises — programs check `isatty` and quite reasonably
 * assume they are talking to a pipe. `script` allocates a pseudo-terminal for a
 * single command, which is enough to make output look the way it does in a
 * shell, and it is in util-linux so it is present on essentially any image. If
 * it is missing the command still runs, just without the tty.
 *
 * The script is delivered base64-encoded rather than quoted. `script -c` takes
 * a command string, and nesting arbitrary user input inside that string inside
 * the provider's own wrapper is three levels of quoting waiting to break.
 */
function buildCommand(command: string, cwd: string, columns: number): string {
  const inner = [
    // Match the pty to the panel, so wrapping and column counts line up.
    `stty cols ${columns} rows 24 2>/dev/null || true`,
    `export COLUMNS=${columns} TERM=xterm-256color`,
    `cd ${shellQuote(cwd)} 2>/dev/null || cd ${shellQuote(HOME)} 2>/dev/null || true`,
    // The newline is load-bearing: it terminates the command, so a trailing `#`
    // comment cannot swallow what follows.
    `${command}\n__da_code=$?`,
    `printf '\\n%s%s\\t%s\\n' '${CWD_MARKER}' "$(pwd)" "$__da_code"`,
  ].join("\n");

  const encoded = base64(inner);

  // No `exit` anywhere: the provider wraps this in a script of its own to
  // detect changed files, and exiting kills that wrapper before it finishes —
  // which hangs the terminal. The exit code rides on the marker line instead.
  const run = `sh ${SCRIPT_FILE}`;

  // `script` comes in two incompatible flavours — util-linux takes
  // `-qec CMD FILE`, BSD takes `-q FILE CMD` — and some minimal images have
  // neither. Each form is probed with a trivial command before use, so the
  // terminal degrades to no-tty rather than failing outright.
  //
  // Every form reads stdin from /dev/null. There is no way to type into a
  // running command here, so anything that waits on input — a bare `cat`, a
  // package manager asking to confirm — would otherwise block until the
  // 180-second timeout with the terminal frozen. EOF makes it exit instead.
  // It also stops a probe from landing in an interactive shell on an image
  // whose `script` takes neither form.
  return (
    `printf %s ${shellQuote(encoded)} | base64 -d > ${SCRIPT_FILE}; ` +
    `if script -qec true /dev/null </dev/null >/dev/null 2>&1; then ` +
    `script -qec ${shellQuote(run)} /dev/null </dev/null; ` +
    `elif script -q /dev/null true </dev/null >/dev/null 2>&1; then ` +
    `script -q /dev/null ${run} </dev/null; ` +
    `else ${run} </dev/null; fi`
  );
}

/** UTF-8 safe base64, which `btoa` alone is not. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Make pty output printable.
 *
 * A pseudo-terminal ends lines with CRLF and sprays escape sequences for
 * colour and cursor movement. Without stripping them every line double-spaces
 * and the escapes render as mojibake. Colour is dropped rather than rendered:
 * showing it means an ANSI-to-DOM parser, which is a bigger thing than this.
 */
function clean(text: string): string {
  return text
    // CSI and OSC sequences, plus single-character escapes.
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B[@-Z\\-_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
    // Everything else in C0 except tab and newline. A pty echoes an EOF as
    // `^D`, and control bytes otherwise render as mojibake. Tabs stay: `ls`
    // separates its columns with them.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

/** Single-quote a string for `sh`, closing and reopening around any quote. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface Trailer {
  cwd: string | null;
  exitCode: number | null;
}

/**
 * Split the wrapper's trailing marker off a command's output.
 *
 * Tolerates a partial marker at the end of the buffer: mid-stream the line may
 * be half-arrived, and showing half of it is no better than showing all of it.
 */
function splitTrailer(output: string): { output: string; trailer: Trailer } {
  const at = output.lastIndexOf(CWD_MARKER);

  if (at === -1) {
    // The marker itself may be split across chunks. Hide any suffix of the
    // buffer that could still turn into one.
    for (let length = CWD_MARKER.length - 1; length > 0; length -= 1) {
      if (output.endsWith(CWD_MARKER.slice(0, length))) {
        return { output: output.slice(0, -length), trailer: BLANK_TRAILER };
      }
    }
    return { output, trailer: BLANK_TRAILER };
  }

  const line = output.slice(at + CWD_MARKER.length).split("\n")[0];
  const [cwd, code] = line.split("\t");
  const parsed = Number(code);

  return {
    // Also drop the newline the wrapper printed before the marker.
    output: output.slice(0, at).replace(/\n$/, ""),
    trailer: {
      cwd: cwd?.trim() || null,
      exitCode: Number.isFinite(parsed) ? parsed : null,
    },
  };
}

const BLANK_TRAILER: Trailer = { cwd: null, exitCode: null };

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
