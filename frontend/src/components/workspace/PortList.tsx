"use client";

/**
 * Every port the container is serving, and what is behind each one.
 *
 * The list comes from the kernel, not from a log, so a dev server the user
 * started by hand in the shell shows up next to the ones the agent started.
 * Opening a row mints a fresh signed link. Only agent-started processes can be
 * stopped from here — the rest have no name to stop them by.
 */

import { useState } from "react";
import { classNames } from "@/lib/format";
import type { ListeningPort } from "@/lib/types";
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
  const { ports } = sandbox.status;
  if (ports.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-line">
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
        Serving
      </p>
      <ul className="pb-1.5">
        {ports.map((entry) => (
          <PortRow
            key={entry.port}
            entry={entry}
            active={entry.port === activePort}
            onOpen={onOpen}
            onStop={sandbox.stopProcess}
          />
        ))}
      </ul>
    </div>
  );
}

function PortRow({
  entry,
  active,
  onOpen,
  onStop,
}: {
  entry: ListeningPort;
  active: boolean;
  onOpen: (port: number) => void;
  onStop: (name: string) => Promise<void>;
}) {
  const [stopping, setStopping] = useState(false);

  const stop = async () => {
    if (!entry.name) return;
    setStopping(true);
    try {
      await onStop(entry.name);
    } finally {
      setStopping(false);
    }
  };

  return (
    <li className="group flex items-center gap-2 px-3 py-1">
      <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />

      <button
        onClick={() => onOpen(entry.port)}
        className={classNames(
          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors",
          active
            ? "bg-accent-dim text-accent"
            : "text-ink-soft hover:bg-hover hover:text-ink",
        )}
        title={`Open port ${entry.port}`}
      >
        :{entry.port}
      </button>

      <span
        className="min-w-0 flex-1 truncate text-[12px] text-ink-soft"
        title={entry.command}
      >
        {entry.name ?? shortCommand(entry.command)}
      </span>

      {entry.name ? (
        <IconButton
          label={`Stop ${entry.name}`}
          variant="danger"
          className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          disabled={stopping}
          onClick={stop}
        >
          <StopIcon className="h-3 w-3" />
        </IconButton>
      ) : null}
    </li>
  );
}

/** `/usr/bin/node .../next dev` reads as `next dev`. */
function shortCommand(command: string): string {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "unknown";
  const [binary, ...rest] = parts;
  return [binary.split("/").pop(), ...rest.slice(0, 2)].join(" ");
}
