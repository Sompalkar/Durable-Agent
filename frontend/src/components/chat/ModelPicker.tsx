"use client";

/**
 * Model and effort picker.
 *
 * Shows the price of what you are about to run before you run it. The whole
 * reason this exists is that an agentic loop multiplies every turn, so the
 * difference between Haiku and Opus is not 5x on paper — it is 5x on every
 * iteration of every turn, and that adds up while you are still debugging.
 */

import { useEffect, useRef, useState } from "react";
import { classNames } from "@/lib/format";
import type { ModelOption } from "@/lib/types";
import { ChevronIcon } from "@/components/ui/icons";

const TIER_TONE: Record<ModelOption["tier"], string> = {
  cheapest: "text-positive",
  balanced: "text-info",
  "most capable": "text-accent",
};

/**
 * Routing, offered as if it were a model.
 *
 * It is a strategy, not a model — but from the picker's point of view it is
 * simply another thing a session can run on, and describing it as a separate
 * concept would make the control harder to use, not more honest.
 */
const AUTO: ModelOption = {
  id: "auto",
  label: "Auto",
  blurb: "Starts on Haiku and moves up only when a step actually fails.",
  inputPerMTok: 1,
  outputPerMTok: 5,
  tier: "cheapest",
};

/**
 * The two runtimes, described by what they cost rather than by how they work.
 *
 * Someone choosing here is deciding whether to pay for an idle container, and
 * that is the only part of the distinction they can feel.
 */
const RUNTIMES = [
  {
    id: "durable",
    label: "On demand",
    blurb:
      "A container is rented per command and destroyed after. Nothing is billed between messages.",
  },
  {
    id: "sandbox",
    label: "Always on",
    blurb:
      "Keeps one container alive between turns, so a dev server stays up and dependencies survive. Costs while idle.",
  },
] as const;

export function ModelPicker({
  models,
  efforts,
  model,
  effort,
  runtime,
  disabled,
  onChange,
}: {
  models: ModelOption[];
  efforts: string[];
  model: string;
  effort: string;
  runtime: string;
  disabled: boolean;
  onChange: (next: { model?: string; effort?: string; runtime?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — a menu that traps you is worse than
  // no menu at all.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = models.find((option) => option.id === model);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className={classNames(
          "flex h-9 items-center gap-1.5 rounded-full px-2.5",
          "text-[12.5px] font-medium text-ink-soft transition-colors",
          "hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
          open && "bg-hover text-ink",
        )}
      >
        <span
          className={classNames(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            current?.tier === "cheapest" ? "bg-positive" : "",
            current?.tier === "balanced" ? "bg-info" : "",
            current?.tier === "most capable" ? "bg-accent" : "",
          )}
        />
        <span className="max-w-[7.5rem] truncate">{current?.label ?? model}</span>
        <span className="hidden text-ink-faint sm:inline">· {effort}</span>
        <ChevronIcon
          className={classNames(
            "h-3 w-3 shrink-0 text-ink-faint transition-transform",
            open ? "-rotate-90" : "rotate-90",
          )}
        />
      </button>

      {open ? (
        // Opens upward: the picker lives on the composer, at the bottom edge.
        <div className="animate-in absolute bottom-full right-0 z-50 mb-2 max-h-[70vh] w-[19rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-line bg-panel shadow-pop">
          <div className="px-3 pb-1.5 pt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              Model
            </p>
          </div>

          <ul>
            {[AUTO, ...models].map((option) => (
              <li key={option.id}>
                <button
                  onClick={() => {
                    onChange({ model: option.id });
                    setOpen(false);
                  }}
                  className={classNames(
                    "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
                    option.id === model ? "bg-raised" : "hover:bg-hover",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">
                        {option.label}
                      </span>
                      <span
                        className={classNames(
                          "text-[10px] font-medium",
                          TIER_TONE[option.tier],
                        )}
                      >
                        {option.tier}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
                      {option.blurb}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-ink-faint">
                      ${option.inputPerMTok}/M in · ${option.outputPerMTok}/M out
                    </span>
                  </span>
                  {option.id === model ? (
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-line px-3 pb-2.5 pt-2.5">
            <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              Effort
            </p>
            <div className="flex gap-1">
              {efforts.map((level) => (
                <button
                  key={level}
                  onClick={() => onChange({ effort: level })}
                  className={classNames(
                    "flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium capitalize transition-colors",
                    level === effort
                      ? "bg-ink text-canvas"
                      : "bg-raised text-ink-soft hover:bg-hover hover:text-ink",
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="pt-1.5 text-[10px] leading-snug text-ink-faint">
              Lower effort means less thinking per step. Start low while building.
            </p>
          </div>

          {/* Runtime. Cost is the whole trade-off here, so the copy leads with
              it rather than with the capability it buys. */}
          <div className="border-t border-line px-3 py-2.5">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Runtime
            </p>
            <div className="flex gap-1">
              {RUNTIMES.map((option) => (
                <button
                  key={option.id}
                  onClick={() => onChange({ runtime: option.id })}
                  className={classNames(
                    "flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors",
                    option.id === runtime
                      ? "bg-ink text-canvas"
                      : "bg-raised text-ink-soft hover:bg-hover hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="pt-1.5 text-[10px] leading-snug text-ink-faint">
              {RUNTIMES.find((option) => option.id === runtime)?.blurb ??
                RUNTIMES[0].blurb}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
