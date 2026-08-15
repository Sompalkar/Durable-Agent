"use client";

/**
 * A terminal for the session's container.
 *
 * One surface, not a log plus a form. The prompt is the last line of the
 * scrollback and you type directly on it, because a box docked underneath the
 * output is a search field with a shell behind it — everything about where the
 * cursor sits and how the history reads is wrong.
 *
 * What it is not is a pty. There is no pseudo-terminal on the other end, so no
 * `vim`, no colours, no job control, and Ctrl-C abandons the request rather
 * than signalling the process. The working directory does carry between
 * commands (see `useShell`); environment variables do not.
 *
 * History is per-mount and lives in memory. Persisting it would imply the
 * container is permanent, and it is not.
 */

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import type { ShellState } from "@/lib/useShell";
import { EmptyState } from "@/components/ui/Feedback";
import { Button, IconButton } from "@/components/ui/Button";
import { TerminalIcon, TrashIcon } from "@/components/ui/icons";

/** Where a container's checkout lives; shown as `~` the way a shell would. */
const HOME = "/home/daytona/workspace";

export function ShellPanel({
  shell,
  onEnablePersistent,
}: {
  shell: ShellState;
  /** Switches the session to the runtime that keeps a container alive. */
  onEnablePersistent: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  /** Index into past commands, counting back from the most recent. */
  const [historyStep, setHistoryStep] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow output as it streams, the way a terminal does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shell.entries, shell.running]);

  // Put the caret back on the prompt the moment a command finishes, so the
  // next one can be typed without reaching for the mouse.
  useEffect(() => {
    if (!shell.running) inputRef.current?.focus();
  }, [shell.running]);

  if (shell.unavailable) {
    // The fix is one setting, so it is offered here rather than described.
    // Telling someone which switch to flip and then not flipping it is the
    // most annoying shape an error message can take.
    return (
      <EmptyState
        icon={<TerminalIcon className="h-6 w-6" />}
        title="No shell on this runtime"
        description={shell.unavailable}
        action={<EnablePersistentButton onEnable={onEnablePersistent} />}
      />
    );
  }

  const submit = () => {
    const command = value.trim();
    if (!command || shell.running) return;
    void shell.run(command);
    setValue("");
    setHistoryStep(0);
  };

  /** Walk the command history with the arrow keys. */
  const recall = (direction: 1 | -1) => {
    const past = shell.entries.map((entry) => entry.command);
    if (past.length === 0) return;
    const next = Math.min(Math.max(historyStep + direction, 0), past.length);
    setHistoryStep(next);
    setValue(next === 0 ? "" : past[past.length - next]);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      recall(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      recall(-1);
    } else if (event.key === "c" && event.ctrlKey) {
      // Only when nothing is selected — otherwise this is a copy, and stealing
      // Ctrl-C from a selection is the rudest thing a terminal can do.
      if (!window.getSelection()?.toString()) {
        event.preventDefault();
        if (shell.running) shell.stop();
        else setValue("");
      }
    } else if (event.key === "l" && event.ctrlKey) {
      event.preventDefault();
      shell.clear();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        <p className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-faint">
          {prettyPath(shell.cwd)}
        </p>
        {shell.entries.length > 0 ? (
          <IconButton label="Clear scrollback (Ctrl-L)" onClick={shell.clear}>
            <TrashIcon className="h-4 w-4" />
          </IconButton>
        ) : null}
      </header>

      {/*
        Clicking anywhere puts the caret on the prompt, which is what a terminal
        does. Guarded so it does not fight a selection the user is making.
      */}
      <div
        onMouseUp={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
        className="min-h-0 flex-1 cursor-text overflow-y-auto bg-canvas px-3 py-2.5 font-mono text-[12.5px] leading-relaxed"
      >
        {shell.entries.length === 0 && !shell.running ? (
          <p className="pb-2 text-ink-faint">
            Type a command. <span className="text-ink-soft">↑</span> for history,{" "}
            <span className="text-ink-soft">Ctrl-C</span> to cancel,{" "}
            <span className="text-ink-soft">Ctrl-L</span> to clear.
          </p>
        ) : null}

        {shell.entries.map((entry) => (
          <div key={entry.id}>
            <p className="flex items-baseline gap-1.5">
              <Prompt />
              <span className="min-w-0 whitespace-pre-wrap break-all text-ink">
                {entry.command}
              </span>
            </p>

            {entry.output ? (
              <pre className="whitespace-pre-wrap break-all text-ink-soft">
                {entry.output}
              </pre>
            ) : null}

            {/* Only a failure is annotated. Printing `exit 0` after every
                command is noise no terminal produces. */}
            {entry.exitCode !== null && entry.exitCode !== 0 ? (
              <p className="text-[11.5px] text-negative">
                exit {entry.exitCode}
                {entry.durationMs > 0 ? ` · ${formatDuration(entry.durationMs)}` : ""}
              </p>
            ) : null}

            {entry.exitCode === null ? (
              <span className="cursor-blink text-accent">▍</span>
            ) : null}
          </div>
        ))}

        {/* The live prompt. Part of the scrollback, not a bar beneath it. */}
        {!shell.running ? (
          <div className="flex items-baseline gap-1.5">
            <Prompt />
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Shell command"
              // Styled to disappear: the surrounding surface is the terminal, so
              // anything that reads as a form control here is wrong.
              className="min-w-0 flex-1 bg-transparent p-0 font-mono text-[12.5px] leading-relaxed text-ink caret-accent outline-none focus-visible:outline-none"
            />
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      {shell.error ? (
        <p className="shrink-0 border-t border-line bg-negative/10 px-3 py-2 text-[12px] text-negative">
          {shell.error}
        </p>
      ) : null}
    </div>
  );
}

function Prompt() {
  return <span className="shrink-0 select-none text-accent">$</span>;
}

/** `~` for the workspace root, the way a shell shortens `$HOME`. */
function prettyPath(cwd: string): string {
  if (cwd === HOME) return "~";
  if (cwd.startsWith(`${HOME}/`)) return `~${cwd.slice(HOME.length)}`;
  return cwd;
}

/**
 * Switches the session to the persistent runtime.
 *
 * Shared by the shell and the browser, because both are unavailable for the
 * same reason and the remedy is identical.
 */
export function EnablePersistentButton({
  onEnable,
}: {
  onEnable: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await onEnable();
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : "Could not switch runtime.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant="primary" size="sm" onClick={enable} disabled={busy}>
        {busy ? "Switching…" : "Switch to Always on"}
      </Button>
      <p className="max-w-xs text-[11px] leading-relaxed text-ink-faint">
        Keeps one container alive between turns. It costs while idle, so switch
        back to On demand when you are done.
      </p>
      {failed ? <p className="text-[12px] text-negative">{failed}</p> : null}
    </div>
  );
}
