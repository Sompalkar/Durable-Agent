"use client";

/**
 * The container, and the switch that turns it off.
 *
 * Offering an always-on runtime without a visible stop button is how people get
 * a surprise bill: the thing that costs money does so while nobody is looking
 * at it, which is exactly when it is easiest to forget. So the state is stated
 * plainly — up or not, since when — and stopping it is one click, always in the
 * same place.
 *
 * Stopping the container does not touch the session. Files, history and the
 * conversation were never in it.
 */

import { useEffect, useState } from "react";
import { classNames, formatDuration } from "@/lib/format";
import type { SandboxState } from "@/lib/useSandbox";
import { ServerIcon, StopIcon } from "@/components/ui/icons";

export function ContainerBar({ sandbox }: { sandbox: SandboxState }) {
  const [stopping, setStopping] = useState(false);
  // Uptime is derived from a ticking clock rather than read during render:
  // `Date.now()` in a render body is impure and gives a value that changes
  // only when something unrelated happens to re-render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const { status } = sandbox;
  const uptime = status.startedAt ? now - status.startedAt : 0;

  if (!status.running) return null;

  const stop = async () => {
    setStopping(true);
    try {
      await sandbox.stop();
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      className={classNames(
        "flex shrink-0 items-center gap-2 border-b border-line px-3 py-2",
        // Only the billed state gets colour. An ephemeral container is gone in
        // seconds and does not warrant a warning.
        status.persistent ? "bg-accent-dim" : "bg-raised",
      )}
    >
      <ServerIcon
        className={classNames(
          "h-3.5 w-3.5 shrink-0",
          status.persistent ? "text-accent" : "text-ink-faint",
        )}
      />
      <p className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
        <span className="font-medium text-ink">Container up</span>
        {uptime > 1000 ? ` · ${formatDuration(uptime)}` : ""}
        {status.persistent ? " · billed while idle" : ""}
      </p>
      <button
        onClick={stop}
        disabled={stopping}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        <StopIcon className="h-3 w-3" />
        {stopping ? "Stopping…" : "Stop"}
      </button>
    </div>
  );
}
