"use client";

/**
 * Running cost of the session.
 *
 * Visible on purpose. The architectural claim this project makes is about cost,
 * so hiding the number would be a strange thing to do — and if a demo link is
 * shared publicly, the turn cap next to it is the thing protecting the key.
 */

import { classNames } from "@/lib/format";
import type { SessionSummary } from "@/lib/types";

export function UsageMeter({ session }: { session: SessionSummary }) {
  const { usage, turnsUsed, turnLimit } = session;
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const nearLimit = turnLimit !== null && turnsUsed >= turnLimit * 0.8;

  return (
    <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-ink-faint">
      <span title="Input + output tokens across this session">
        {formatCompact(totalTokens)} tok
      </span>

      {usage.cacheReadTokens > 0 ? (
        <span
          className="text-positive"
          title="Tokens served from the prompt cache, billed at about a tenth of the input rate"
        >
          {formatCompact(usage.cacheReadTokens)} cached
        </span>
      ) : null}

      <span title="Estimated cost at the model's published rates">
        ${usage.estimatedCostUsd.toFixed(4)}
      </span>

      {turnLimit !== null ? (
        <span
          className={classNames(nearLimit && "text-accent")}
          title="Turns used against this demo's per-session cap"
        >
          {turnsUsed}/{turnLimit} turns
        </span>
      ) : null}
    </div>
  );
}

function formatCompact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}
