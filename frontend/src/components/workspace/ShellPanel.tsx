"use client";

/**
 * A terminal for the session's container.
 *
 * Not an emulator — there is no pty behind it, so no `vim`, no colours, no
 * job control. It is a command box with scrollback, which covers the reason
 * people reach for a shell here: looking at what is actually on disk, running
 * a test, installing something the agent forgot.
 *
 * History is per-mount and lives in memory. Persisting it would imply the
 * container is permanent, and it is not.
 */

import { useEffect, useRef, useState } from "react";
import { classNames, formatDuration } from "@/lib/format";
import type { ShellState } from "@/lib/useShell";
import { EmptyState } from "@/components/ui/Feedback";
import { IconButton } from "@/components/ui/Button";
import { ArrowUpIcon, StopIcon, TerminalIcon, TrashIcon } from "@/components/ui/icons";

export function ShellPanel({ shell }: { shell: ShellState }) {
  const [value, setValue] = useState("");
  /** Index into past commands, counting back from the most recent. */
  const [historyStep, setHistoryStep] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow output as it streams, the way a terminal does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shell.entries]);

  if (shell.unavailable) {
    return (
      <EmptyState
        icon={<TerminalIcon className="h-6 w-6" />}
        title="No shell on this runtime"
        description={shell.unavailable}
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/12 text-accent">
          <TerminalIcon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold tracking-tight">Shell</h2>
          <p className="truncate text-[12px] text-ink-faint">
            {shell.running
              ? "Running…"
              : "The same container the agent runs commands in"}
          </p>
        </div>
        {shell.entries.length > 0 ? (
          <IconButton label="Clear scrollback" onClick={shell.clear}>
            <TrashIcon className="h-4 w-4" />
          </IconButton>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
        {shell.entries.length === 0 ? (
          <p className="px-1 py-6 text-center text-ink-faint">
            Nothing run yet. Try <span className="text-ink-soft">ls -la</span>.
          </p>
        ) : null}

        {shell.entries.map((entry) => (
          <div key={entry.id} className="pb-2.5">
            <p className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-accent">$</span>
              <span className="min-w-0 break-all text-ink">{entry.command}</span>
            </p>

            {entry.output ? (
              <pre className="whitespace-pre-wrap break-all pt-0.5 text-ink-soft">
                {entry.output}
                {entry.exitCode === null ? (
                  <span className="cursor-blink text-accent">▍</span>
                ) : null}
              </pre>
            ) : null}

            {entry.exitCode !== null ? (
              <p
                className={classNames(
                  "pt-0.5 text-[11px]",
                  entry.exitCode === 0 ? "text-ink-faint" : "text-negative",
                )}
              >
                exit {entry.exitCode}
                {entry.durationMs > 0 ? ` · ${formatDuration(entry.durationMs)}` : ""}
              </p>
            ) : null}
          </div>
        ))}

        <div ref={endRef} />
      </div>

      {shell.error ? (
        <p className="shrink-0 border-t border-line bg-negative/10 px-3 py-2 text-[12px] text-negative">
          {shell.error}
        </p>
      ) : null}

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <span className="shrink-0 font-mono text-[13px] text-accent">$</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              recall(1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              recall(-1);
            }
          }}
          placeholder={shell.running ? "Waiting for the command to finish…" : "Type a command"}
          disabled={shell.running}
          spellCheck={false}
          autoComplete="off"
          aria-label="Shell command"
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-ink-faint disabled:cursor-not-allowed"
        />

        {shell.running ? (
          <button
            onClick={shell.stop}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-ink transition-colors hover:bg-hover"
          >
            <StopIcon className="h-3.5 w-3.5" />
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim()}
            aria-label="Run command"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-canvas transition-opacity hover:opacity-90 disabled:bg-raised disabled:text-ink-faint"
          >
            <ArrowUpIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
