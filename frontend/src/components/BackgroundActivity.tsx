"use client";

/**
 * Background-run banner.
 *
 * A scheduled agent spends money with nobody watching, so the one thing the UI
 * must never do is stay silent about it. This sits above the conversation
 * whenever a background run is in flight — or whenever any schedule is armed —
 * and puts the kill switch one click away.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { classNames } from "@/lib/format";
import type { ScheduleActivity } from "@/lib/types";
import { ClockIcon, PauseIcon } from "@/components/ui/icons";

/**
 * How often to ask whether something is running.
 *
 * Was 5s, which meant a Durable Object RPC twelve times a minute forever. That
 * is a lot of churn for a value that changes rarely, and it was destabilising
 * `wrangler dev` locally. Background runs are minutes apart at best, so a slow
 * poll loses nothing — and it stops entirely when the tab is hidden.
 */
const POLL_MS = 30_000;

export function BackgroundActivity({ onChanged }: { onChanged: () => void }) {
  const [activity, setActivity] = useState<ScheduleActivity | null>(null);
  const [pausing, setPausing] = useState(false);

  /** Bumped to force an immediate re-poll after the kill switch is used. */
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await api.scheduleActivity();
        if (!cancelled) setActivity(next);
      } catch {
        // A failed probe is not worth surfacing — the next tick will retry.
      }
    };

    // Only poll while the tab is actually being looked at.
    const tick = () => {
      if (document.visibilityState === "visible") void poll();
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshToken]);

  const pauseAll = async () => {
    setPausing(true);
    try {
      await api.pauseAllSchedules();
      setRefreshToken((token) => token + 1);
      onChanged();
    } finally {
      setPausing(false);
    }
  };

  if (!activity || (!activity.running && activity.activeCount === 0)) return null;

  const running = activity.running;

  return (
    <div
      className={classNames(
        "relative flex shrink-0 items-center gap-2.5 overflow-hidden border-b px-4 py-2",
        running
          ? "border-accent/30 bg-accent/10"
          : "border-line bg-raised",
      )}
    >
      {running ? <span className="sweep absolute inset-0" aria-hidden /> : null}

      <ClockIcon
        className={classNames(
          "relative h-3.5 w-3.5 shrink-0",
          running ? "pulse-dot text-accent" : "text-ink-faint",
        )}
      />

      <p className="relative min-w-0 flex-1 truncate text-[12px] text-ink-soft">
        {running ? (
          <>
            <span className="font-medium text-ink">Background agent running</span>
            {activity.label ? ` · ${activity.label}` : null} · spending tokens now
          </>
        ) : (
          <>
            <span className="font-medium text-ink">
              {activity.activeCount} background agent
              {activity.activeCount === 1 ? "" : "s"} armed
            </span>{" "}
            · will run on schedule without you
          </>
        )}
      </p>

      <button
        onClick={pauseAll}
        disabled={pausing}
        className={classNames(
          "relative flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1",
          "text-[12px] font-medium transition-colors disabled:opacity-50",
          running
            ? "border-accent/40 text-accent hover:bg-accent/15"
            : "border-line-strong text-ink-soft hover:bg-hover hover:text-ink",
        )}
      >
        <PauseIcon className="h-3 w-3" />
        {pausing ? "Pausing…" : "Pause all"}
      </button>
    </div>
  );
}
