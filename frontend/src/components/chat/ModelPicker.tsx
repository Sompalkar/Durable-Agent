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

export function ModelPicker({
  models,
  efforts,
  model,
  effort,
  disabled,
  onChange,
}: {
  models: ModelOption[];
  efforts: string[];
  model: string;
  effort: string;
  disabled: boolean;
  onChange: (next: { model?: string; effort?: string }) => void;
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
          "flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1.5",
          "text-[12px] font-medium text-ink transition-colors",
          "hover:border-line-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
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
        {current?.label ?? model}
        <span className="text-ink-faint">· {effort}</span>
        <ChevronIcon
          className={classNames(
            "h-3 w-3 text-ink-faint transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        <div className="animate-in absolute right-0 z-50 mt-1.5 w-[19rem] overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/40">
          <div className="px-3 pb-1.5 pt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              Model
            </p>
          </div>

          <ul>
            {models.map((option) => (
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
                      ? "bg-accent text-accent-ink"
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
        </div>
      ) : null}
    </div>
  );
}
