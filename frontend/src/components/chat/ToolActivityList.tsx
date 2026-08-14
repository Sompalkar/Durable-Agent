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
import { ChangedFileDiff } from "@/components/github/ChangedFileDiff";

export function ToolActivityList({
  activities,
  sessionId,
}: {
  activities: ToolActivity[];
  /** Enables inline diffs for file writes. Omitted where the session is unknown. */
  sessionId?: string;
}) {
  if (activities.length === 0) return null;

  return (
    <ul className="space-y-1">
      {activities.map((activity) => (
        <ToolActivityRow key={activity.id} activity={activity} sessionId={sessionId} />
      ))}
    </ul>
  );
}

/** The path a file-writing tool touched, or null if this is not one. */
function writtenPath(activity: ToolActivity): string | null {
  if (!WRITE_TOOLS.has(activity.name)) return null;
  const input = activity.input as { path?: unknown; to?: unknown } | null;
  // `move_file` names its destination `to`; everything else uses `path`.
  const path = typeof input?.path === "string" ? input.path : input?.to;
  return typeof path === "string" && path ? path : null;
}

/** Tools whose result is best understood as a diff. */
const WRITE_TOOLS = new Set(["write_file", "edit_file", "move_file", "restore_file"]);

function ToolActivityRow({
  activity,
  sessionId,
}: {
  activity: ToolActivity;
  sessionId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const args = formatArguments(activity.input);
  // Shell commands read better as a command line than as JSON arguments.
  const shellCommand = extractCommand(activity);

  // A running command opens itself, so output is visible as it arrives rather
  // than waiting for a click nobody knows to make. Once it finishes the row
  // collapses back and stops competing with the reply for attention.
  const streaming = activity.status === "running" && Boolean(activity.output);
  const open = expanded || streaming;

  // Only for a finished write — mid-write the file has no new revision yet, so
  // there is nothing to diff against.
  const editedPath = activity.status === "ok" ? writtenPath(activity) : null;

  return (
    <li className="animate-in overflow-hidden rounded-xl border border-line bg-panel">
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
        ) : editedPath && sessionId ? (
          // A write is only meaningful as a diff. Raw arguments would show the
          // whole new file with no indication of what actually changed.
          <div className="border-t border-line bg-raised p-2">
            <ChangedFileDiff sessionId={sessionId} path={editedPath} against="previous" />
          </div>
        ) : (
          <pre className="max-h-56 overflow-auto border-t border-line bg-raised px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-soft">
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

  // A unified diff is the one kind of command output where plain text throws
  // away the meaning — the +/- prefix is the whole point of reading it.
  const lines = looksLikeDiff(text) ? text.split("\n") : null;

  return (
    <div className="max-h-56 overflow-auto border-t border-line bg-raised">
      <pre className="px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-soft">
        {lines
          ? lines.map((line, index) => (
              <span key={index} className={diffLineClass(line)}>
                {line}
                {index < lines.length - 1 ? "\n" : null}
              </span>
            ))
          : text}
        {live ? <span className="cursor-blink text-accent">▍</span> : null}
      </pre>
      <div ref={endRef} />
    </div>
  );
}

/** True for output that is a unified diff, so it can be coloured as one. */
function looksLikeDiff(text: string): boolean {
  return /^diff --git |^@@ .* @@/m.test(text);
}

function diffLineClass(line: string): string {
  // Order matters: "+++" and "---" are file headers, not added or removed
  // lines, so they have to be matched before the single-character prefixes.
  if (line.startsWith("+++") || line.startsWith("---")) return "text-ink-faint";
  if (line.startsWith("@@")) return "text-info";
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "text-ink-faint";
  if (line.startsWith("+")) return "text-positive";
  if (line.startsWith("-")) return "text-negative";
  return "";
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
