"use client";

/**
 * Collapsible summary of the model's reasoning for the current turn.
 *
 * Collapsed by default — it is useful for understanding a decision after the
 * fact, not something to read line by line while waiting.
 */

import { useState } from "react";
import { classNames } from "@/lib/format";
import { ChevronIcon, SparkIcon } from "@/components/ui/icons";

export function ThinkingPanel({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;

  return (
    <div className="animate-in overflow-hidden rounded-xl border border-line bg-panel">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-hover"
      >
        <SparkIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="flex-1 text-[13px] font-medium text-ink-soft">
          Reasoning
        </span>
        <span className="font-mono text-[11px] text-ink-faint">
          {text.length.toLocaleString()} chars
        </span>
        <ChevronIcon
          className={classNames(
            "h-3.5 w-3.5 text-ink-faint transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded ? (
        <div className="max-h-64 overflow-y-auto border-t border-line px-3 py-2.5">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-faint">
            {text}
          </p>
        </div>
      ) : null}
    </div>
  );
}
