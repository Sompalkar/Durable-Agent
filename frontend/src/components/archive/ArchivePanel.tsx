"use client";

/**
 * The durable transcript.
 *
 * The conversation above comes from this session's Durable Object and can be
 * cleared. This comes from MongoDB and cannot — it is what the Worker archived
 * after each turn finished, and it is the only place that records what a turn
 * actually cost.
 *
 * It is also the only view that shows background runs and typed messages in one
 * list, because from the archive's point of view they are the same thing: a
 * turn that happened, tagged with what triggered it.
 */

import { useState } from "react";
import { classNames, formatRelativeTime } from "@/lib/format";
import type { ArchivedTurn } from "@/lib/types";
import type { ArchiveState } from "@/lib/useArchive";
import { IconButton } from "@/components/ui/Button";
import { Badge, EmptyState, ErrorBanner, LoadingDots } from "@/components/ui/Feedback";
import { ClockIcon, HistoryIcon, RefreshIcon } from "@/components/ui/icons";

export function ArchivePanel({ archive }: { archive: ArchiveState }) {
  const totalCost = archive.turns.reduce(
    (sum, turn) => sum + turn.usage.estimatedCostUsd,
    0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold tracking-tight">Archive</p>
          <p className="truncate text-[12px] text-ink-faint">
            {archive.turns.length} turn{archive.turns.length === 1 ? "" : "s"} in
            MongoDB
            {totalCost > 0 ? ` · $${totalCost.toFixed(4)}` : ""}
          </p>
        </div>
        <IconButton label="Reload the archive" onClick={archive.refresh}>
          <RefreshIcon className="h-4 w-4" />
        </IconButton>
      </header>

      {archive.error ? (
        <div className="px-3 pt-2.5">
          <ErrorBanner message={archive.error} />
        </div>
      ) : null}

      {archive.loading && !archive.loaded ? (
        <div className="flex flex-1 items-center justify-center text-ink-faint">
          <LoadingDots />
        </div>
      ) : null}

      {archive.loaded && archive.turns.length === 0 && !archive.error ? (
        <EmptyState
          icon={<HistoryIcon className="h-5 w-5" />}
          title="Nothing archived yet"
          description="Every finished turn is written here, including background runs. It survives clearing the conversation."
        />
      ) : null}

      {archive.turns.length > 0 ? (
        <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {archive.turns.map((turn, index) => (
            <TurnRow key={`${turn.createdAt}-${index}`} turn={turn} index={index} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function TurnRow({ turn, index }: { turn: ArchivedTurn; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={classNames(
          "flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors",
          open ? "bg-raised" : "hover:bg-hover",
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-ink-faint">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
            {turn.prompt}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          {turn.trigger ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-caution">
              <ClockIcon className="h-3 w-3" />
              {turn.trigger}
            </span>
          ) : null}
          <span className="font-mono text-[11px] text-ink-faint">
            ${turn.usage.estimatedCostUsd.toFixed(4)}
          </span>
          <span className="text-[11px] text-ink-faint">·</span>
          <span className="font-mono text-[11px] text-ink-faint">
            {turn.usage.inputTokens.toLocaleString()} in
          </span>
          <span className="text-[11px] text-ink-faint">·</span>
          <span className="text-[11px] text-ink-faint">
            {formatRelativeTime(Date.parse(turn.createdAt))}
          </span>
        </div>
      </button>

      {open ? (
        <div className="space-y-2.5 border-t border-line bg-canvas px-3 py-2.5 pl-9">
          <Field label="Reply">
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-soft">
              {turn.reply || <span className="text-ink-faint">No reply text.</span>}
            </p>
          </Field>

          {turn.tools.length > 0 ? (
            <Field label="Tools">
              <div className="flex flex-wrap gap-1">
                {turn.tools.map((tool, position) => (
                  <Badge key={`${tool}-${position}`}>{tool}</Badge>
                ))}
              </div>
            </Field>
          ) : null}

          <Field label="Model">
            <span className="font-mono text-[11px] text-ink-faint">
              {turn.model} · {turn.usage.outputTokens.toLocaleString()} out
              {turn.usage.cacheReadTokens > 0
                ? ` · ${turn.usage.cacheReadTokens.toLocaleString()} cached`
                : ""}
            </span>
          </Field>
        </div>
      ) : null}
    </li>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}
