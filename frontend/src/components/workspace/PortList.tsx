"use client";

/**
 * Every port the container is serving, and the processes behind them.
 *
 * A real application is a frontend and an API, so a single stored preview shows
 * the wrong half about as often as the right one. Each listening process gets a
 * row; opening one mints a fresh signed link and points the browser at it.
 *
 * Ports are read out of each process's own log rather than from `ss` or
 * `lsof` — neither is guaranteed to be installed in an arbitrary image, and a
 * dev server announces its port on startup anyway.
 */

import { useState } from "react";
import { classNames } from "@/lib/format";
import type { SandboxProcess } from "@/lib/types";
import type { SandboxState } from "@/lib/useSandbox";
import { IconButton } from "@/components/ui/Button";
import { StopIcon } from "@/components/ui/icons";

export function PortList({
  sandbox,
  activePort,
  onOpen,
}: {
  sandbox: SandboxState;
  /** The port currently shown in the browser frame, if any. */
  activePort: number | null;
  onOpen: (port: number) => void;
}) {
  const running = sandbox.status.processes.filter((process) => process.running);
  if (running.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-line">
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
        Running
      </p>
      <ul className="pb-1.5">
        {running.map((process) => (
          <ProcessRow
            key={process.name}
            process={process}
            active={process.port !== null && process.port === activePort}
            onOpen={onOpen}
            onStop={sandbox.stopProcess}
          />
        ))}
      </ul>
    </div>
  );
}

function ProcessRow({
  process,
  active,
  onOpen,
  onStop,
}: {
  process: SandboxProcess;
  active: boolean;
  onOpen: (port: number) => void;
  onStop: (name: string) => Promise<void>;
}) {
  const [stopping, setStopping] = useState(false);

  const stop = async () => {
    setStopping(true);
    try {
      await onStop(process.name);
    } finally {
      setStopping(false);
    }
  };

  return (
    <li className="group flex items-center gap-2 px-3 py-1">
      <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />

      {process.port !== null ? (
        <button
          onClick={() => onOpen(process.port!)}
          className={classNames(
            "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors",
            active
              ? "bg-accent-dim text-accent"
              : "text-ink-soft hover:bg-hover hover:text-ink",
          )}
          title={`Open port ${process.port}`}
        >
          :{process.port}
        </button>
      ) : (
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">—</span>
      )}

      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft" title={process.command}>
        {process.name}
      </span>

      <IconButton
        label={`Stop ${process.name}`}
        variant="danger"
        className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        disabled={stopping}
        onClick={stop}
      >
        <StopIcon className="h-3 w-3" />
      </IconButton>
    </li>
  );
}
