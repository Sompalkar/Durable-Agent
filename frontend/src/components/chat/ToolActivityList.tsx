"use client";

/**
 * The tool timeline.
 *
 * There is no shell to show a terminal for, so this is the closest thing the
 * user has to watching the agent work: one row per explicit method call, with
 * its arguments and how long it took.
 */

import { useEffect, useRef, useState } from "react";
import { classNames, formatDuration } from "@/lib/format";
import type { ToolActivity } from "@/lib/types";
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  TerminalIcon,
} from "@/components/ui/icons";
import { LoadingDots } from "@/components/ui/Feedback";

export function ToolActivityList({ activities }: { activities: ToolActivity[] }) {
  if (activities.length === 0) return null;

  return (
    <ul className="space-y-1">
      {activities.map((activity) => (
        <ToolActivityRow key={activity.id} activity={activity} />
      ))}
    </ul>
  );
}

function ToolActivityRow({ activity }: { activity: ToolActivity }) {
  const [expanded, setExpanded] = useState(false);
  const args = formatArguments(activity.input);
  // Shell commands read better as a command line than as JSON arguments.
  const shellCommand = extractCommand(activity);

  // A running command opens itself, so output is visible as it arrives rather
  // than waiting for a click nobody knows to make. Once it finishes the row
  // collapses back and stops competing with the reply for attention.
  const streaming = activity.status === "running" && Boolean(activity.output);
  const open = expanded || streaming;

  return (
    <li className="animate-in overflow-hidden rounded-lg border border-line bg-panel/60">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-hover"
      >
        <StatusMark status={activity.status} />

        {shellCommand ? (
          <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        ) : null}

        <code className="shrink-0 font-mono text-[13px] text-ink">
          {shellCommand ? "$" : activity.name}
        </code>

        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-faint">
          {shellCommand ?? activity.summary ?? args}
        </span>

        {shellCommand && activity.summary ? (
          <span className="shrink-0 font-mono text-[11px] text-ink-faint">
            {activity.summary}
          </span>
        ) : null}

        {activity.durationMs !== undefined ? (
          <span className="shrink-0 font-mono text-[11px] text-ink-faint">
            {formatDuration(activity.durationMs)}
          </span>
        ) : null}

        <ChevronIcon
          className={classNames(
            "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        activity.output ? (
          <CommandLog text={activity.output} live={activity.status === "running"} />
        ) : (
          <pre className="max-h-56 overflow-auto border-t border-line bg-canvas px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-soft">
            {JSON.stringify(activity.input, null, 2)}
          </pre>
        )
      ) : null}
    </li>
  );
}

/**
 * The tail of a command's output.
 *
 * Pinned to the bottom while the command runs, the way a terminal behaves —
 * scrolling up to read something and having it yanked back is worse than not
 * following at all, so the pin stops the moment the command finishes.
 */
function CommandLog({ text, live }: { text: string; live: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: "end" });
  }, [text, live]);

  return (
    <div className="max-h-56 overflow-auto border-t border-line bg-canvas">
      <pre className="px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-soft">
        {text}
        {live ? <span className="cursor-blink text-accent">▍</span> : null}
      </pre>
      <div ref={endRef} />
    </div>
  );
}

function StatusMark({ status }: { status: ToolActivity["status"] }) {
  if (status === "running") {
    return <LoadingDots className="w-6 shrink-0 justify-center text-accent" />;
  }
  if (status === "failed") {
    return <AlertIcon className="h-4 w-4 shrink-0 text-negative" />;
  }
  return <CheckIcon className="h-4 w-4 shrink-0 text-positive" />;
}

/** The command text, when this activity is a shell run. */
function extractCommand(activity: ToolActivity): string | null {
  if (activity.name !== "run_command") return null;
  const input = activity.input as { command?: unknown } | null;
  return typeof input?.command === "string" ? input.command : null;
}

/** One-line preview of a tool's arguments, used before the result arrives. */
function formatArguments(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>);
  return entries
    .map(([key, value]) => {
      const rendered = typeof value === "string" ? value : JSON.stringify(value);
      const trimmed =
        rendered.length > 48 ? `${rendered.slice(0, 45)}…` : rendered;
      return `${key}=${trimmed}`;
    })
    .join("  ");
}
