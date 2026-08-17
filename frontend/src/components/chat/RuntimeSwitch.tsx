"use client";

/**
 * Where this session's work happens.
 *
 * In the header rather than a submenu: it decides whether the session has a
 * shell and a browser at all, and whether anything is billed between messages.
 * Named for what you get, not for how it works.
 */

import { useEffect, useRef, useState } from "react";
import { classNames } from "@/lib/format";
import { CheckIcon, ChevronIcon, ServerIcon } from "@/components/ui/icons";

const MODES = [
  {
    id: "durable",
    label: "On demand",
    blurb: "A container is rented per command and destroyed after it. Nothing is billed between messages.",
    gives: "Files, memory and history persist. No shell, no dev server.",
  },
  {
    id: "sandbox",
    label: "Always on",
    blurb: "One container stays alive between turns, so a dev server keeps serving and installed packages survive.",
    gives: "Adds the shell and the browser. Costs while it idles.",
  },
] as const;

export function RuntimeSwitch({
  runtime,
  disabled,
  onChange,
}: {
  runtime: string;
  disabled: boolean;
  onChange: (runtime: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const current = MODES.find((mode) => mode.id === runtime) ?? MODES[0];
  const persistent = current.id === "sandbox";

  const pick = async (id: string) => {
    setOpen(false);
    if (id === runtime) return;
    setBusy(true);
    try {
      await onChange(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={disabled || busy}
        title={`Runtime: ${current.label}`}
        className={classNames(
          "flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
          persistent
            ? "bg-accent-dim text-accent"
            : "text-ink-soft hover:bg-hover hover:text-ink",
        )}
      >
        {/* A live container is the one state worth a colour: it costs money. */}
        <span
          className={classNames(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            persistent ? "pulse-dot bg-accent" : "bg-ink-faint",
          )}
        />
        <ServerIcon className="hidden h-3.5 w-3.5 sm:block" />
        <span className="hidden sm:inline">{busy ? "Switching…" : current.label}</span>
        <ChevronIcon
          className={classNames(
            "h-3 w-3 shrink-0 opacity-60 transition-transform",
            open ? "-rotate-90" : "rotate-90",
          )}
        />
      </button>

      {open ? (
        <div className="animate-in absolute right-0 z-50 mt-1.5 w-[19rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-panel shadow-pop">
          <p className="px-3 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            Where this session runs
          </p>
          <ul>
            {MODES.map((mode) => (
              <li key={mode.id}>
                <button
                  onClick={() => void pick(mode.id)}
                  className={classNames(
                    "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors",
                    mode.id === runtime ? "bg-raised" : "hover:bg-hover",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">
                      {mode.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
                      {mode.blurb}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-ink-soft">
                      {mode.gives}
                    </span>
                  </span>
                  {mode.id === runtime ? (
                    <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
