"use client";

/**
 * The agent's checklist for the task in progress.
 *
 * Sits between the conversation and the composer: visible the whole time the
 * agent is working, without pushing the chat around. Collapsed it is one line —
 * progress and the step currently running, which is the only thing most people
 * want to know. Expanded it is the whole list.
 *
 * It opens itself while a turn is streaming and closes when the work finishes,
 * so watching the agent work costs no clicks and a finished plan does not eat
 * space forever.
 */

import { useState } from "react";
import { classNames } from "@/lib/format";
import type { PlanStep } from "@/lib/types";

export function PlanStrip({
  plan,
  streaming,
}: {
  plan: PlanStep[];
  streaming: boolean;
}) {
  // `null` means "follow the turn"; a boolean is the user overriding that.
  const [override, setOverride] = useState<boolean | null>(null);

  // Reset the override when a new turn starts, so the strip goes back to
  // opening itself rather than staying shut from a previous task.
  const [lastStreaming, setLastStreaming] = useState(streaming);
  if (streaming !== lastStreaming) {
    setLastStreaming(streaming);
    if (streaming) setOverride(null);
  }

  if (plan.length === 0) return null;

  const open = override ?? streaming;
  const done = plan.filter((step) => step.status === "done").length;
  const active = plan.find((step) => step.status === "active");
  const complete = done === plan.length;

  return (
    // A card on the canvas rather than a bar welded to the composer, so the
    // plan reads as part of the conversation it belongs to.
    <div className="shrink-0 bg-canvas px-3 pt-2 sm:px-4">
      <div className="mx-auto max-w-3xl rounded-xl border border-line bg-panel px-3">
        <button
          onClick={() => setOverride(!open)}
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 py-2 text-left"
        >
          <ProgressRing done={done} total={plan.length} />

          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
            {complete ? (
              <span className="text-positive">Plan complete</span>
            ) : (
              (active?.step ?? "Planning…")
            )}
          </span>

          <span className="font-mono text-[11px] tabular-nums text-ink-faint">
            {done}/{plan.length}
          </span>

          <svg
            viewBox="0 0 16 16"
            className={classNames(
              "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
              open ? "" : "rotate-180",
            )}
            aria-hidden
          >
            <path
              d="M4 6.5 8 10l4-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open ? (
          <ol className="space-y-1 pb-2.5 pl-1">
            {plan.map((step, index) => (
              <li
                key={`${index}-${step.step}`}
                className="flex items-start gap-2.5 text-[13px] leading-snug"
              >
                <StatusMark status={step.status} />
                <span
                  className={classNames(
                    "min-w-0 flex-1",
                    step.status === "done"
                      ? "text-ink-faint line-through decoration-ink-faint/40"
                      : step.status === "active"
                        ? "text-ink"
                        : "text-ink-soft",
                  )}
                >
                  {step.step}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

/** Progress as a filled arc — readable at a glance, unlike a bare fraction. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const fraction = total === 0 ? 0 : done / total;

  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 -rotate-90" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-line-strong"
      />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        className={done === total ? "text-positive" : "text-accent"}
      />
    </svg>
  );
}

function StatusMark({ status }: { status: PlanStep["status"] }) {
  if (status === "done") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="mt-[3px] h-3.5 w-3.5 shrink-0 text-positive"
        aria-label="Done"
      >
        <path
          d="M3.5 8.5 6.5 11.5 12.5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (status === "active") {
    return (
      <span
        className="pulse-dot mt-[6px] h-2 w-2 shrink-0 rounded-full bg-accent"
        aria-label="In progress"
      />
    );
  }

  return (
    <span
      className="mt-[6px] h-2 w-2 shrink-0 rounded-full border border-line-strong"
      aria-label="Pending"
    />
  );
}
