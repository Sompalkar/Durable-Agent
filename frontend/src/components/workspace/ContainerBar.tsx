"use client";

/**
 * The container, and the switch that turns it off.
 *
 * An always-on container bills while nobody is watching, so the state and the
 * stop button are always visible. Stopping it does not touch the session —
 * files and history were never in the container.
 */

import { useEffect, useState } from "react";
import { classNames, formatDuration } from "@/lib/format";
import type { SandboxState } from "@/lib/useSandbox";
import { ServerIcon, StopIcon } from "@/components/ui/icons";

export function ContainerBar({ sandbox }: { sandbox: SandboxState }) {
  const [stopping, setStopping] = useState(false);
  // A ticking clock, because `Date.now()` in render is impure.
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
        // Only the billed state gets colour.
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
