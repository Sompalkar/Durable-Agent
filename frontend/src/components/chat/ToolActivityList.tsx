"use client";

/**
 * The tool timeline.
 *
 * There is no shell to show a terminal for, so this is the closest thing the
 * user has to watching the agent work: one row per explicit method call, with
 * its arguments and how long it took.
 */

import { useState } from "react";
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
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded ? (
        <pre className="max-h-56 overflow-auto border-t border-line bg-canvas px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-soft">
          {JSON.stringify(activity.input, null, 2)}
        </pre>
      ) : null}
    </li>
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
