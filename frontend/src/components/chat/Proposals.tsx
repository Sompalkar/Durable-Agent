"use client";

/**
 * Next-step proposals.
 *
 * The agent decides what is worth doing next and offers it as a button, so the
 * conversation does not stall waiting for the user to think of the follow-up.
 */

import type { Proposal } from "@/lib/types";
import { ArrowRightIcon, SparkIcon } from "@/components/ui/icons";

export function Proposals({
  proposals,
  disabled,
  onPick,
}: {
  proposals: Proposal[];
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  if (proposals.length === 0) return null;

  return (
    <div className="animate-in space-y-1.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-faint">
        <SparkIcon className="h-3 w-3 text-accent" />
        Suggested next
      </p>

      <div className="flex flex-col gap-1.5">
        {proposals.map((proposal) => (
          <button
            key={proposal.title}
            disabled={disabled}
            onClick={() => onPick(proposal.prompt)}
            title={proposal.prompt}
            className="group flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">
                {proposal.title}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-ink-faint">
                {proposal.prompt}
              </span>
            </span>
            <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-colors group-hover:text-accent" />
          </button>
        ))}
      </div>
    </div>
  );
}
