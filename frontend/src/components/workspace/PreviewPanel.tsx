"use client";

/**
 * The running app, shown inside the app — the "Browser" tab.
 *
 * The Daytona proxy sets no X-Frame-Options and no frame-ancestors, so the
 * sandbox can be embedded directly rather than only linked. Seeing the thing
 * the agent just built is the difference between reading a claim and checking
 * one.
 */

import { useEffect, useRef, useState } from "react";
import { classNames } from "@/lib/format";
import type { SessionPreview } from "@/lib/types";
import { EmptyState } from "@/components/ui/Feedback";
import { BrowserIcon } from "@/components/ui/icons";
import { EnablePersistentButton } from "./ShellPanel";
import { ContainerBar } from "./ContainerBar";
import { PortList } from "./PortList";
import type { SandboxState } from "@/lib/useSandbox";

export function PreviewPanel({
  preview,
  persistent,
  sandbox,
  onEnablePersistent,
}: {
  preview: SessionPreview | null;
  /** Whether the session keeps a container between turns. */
  persistent: boolean;
  sandbox: SandboxState;
  onEnablePersistent: () => Promise<void>;
}) {
  // Bumping this remounts the iframe. Reloading it directly is not possible —
  // the frame is cross-origin, so its history and location are off limits.
  const [reloadKey, setReloadKey] = useState(0);

  // Expiry is derived, not stored. A clock that ticks and a value computed from
  // it is simpler than an effect trying to keep a boolean in sync — and React
  // rejects setting state during an effect anyway.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const expired = preview !== null && preview.expiresAt <= now;

  // Nothing shown but something serving is the state everyone reads as broken,
  // so the first port opens itself. Tried once per port: minting a link is a
  // call into the container, and a failing one must not retry every poll.
  const opened = useRef<number | null>(null);
  const firstPort = sandbox.status.ports[0]?.port ?? null;
  useEffect(() => {
    if (preview || firstPort === null || opened.current === firstPort) return;
    opened.current = firstPort;
    void sandbox.openPort(firstPort);
  }, [preview, firstPort, sandbox]);

  if (!preview) {
    // On the ephemeral runtime a dev server cannot survive the turn that
    // started it, so the honest empty state is about the runtime, not the port.
    return persistent ? (
      <div className="flex h-full min-h-0 flex-col">
        <ContainerBar sandbox={sandbox} />
        <PortList
          sandbox={sandbox}
          activePort={null}
          onOpen={(port) => void sandbox.openPort(port)}
        />
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<BrowserIcon className="h-6 w-6" />}
            title={firstPort ? "Opening…" : "Nothing is running"}
            description={
              firstPort
                ? "A port is serving. Fetching a link to it."
                : "Start a dev server — from the shell or by asking the agent. Whatever binds a port appears here."
            }
          />
        </div>
      </div>
    ) : (
      <EmptyState
        icon={<BrowserIcon className="h-6 w-6" />}
        title="No browser on this runtime"
        description="A dev server needs a container that outlives the turn that started it. On demand destroys it as soon as the turn ends."
        action={<EnablePersistentButton onEnable={onEnablePersistent} />}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ContainerBar sandbox={sandbox} />
      <PortList
        sandbox={sandbox}
        activePort={preview.port}
        onOpen={(port) => void sandbox.openPort(port)}
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <span
          className={classNames(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            expired ? "bg-ink-faint" : "pulse-dot bg-positive",
          )}
        />
        <span className="shrink-0 font-mono text-[11px] text-ink-soft">
          :{preview.port}
        </span>

        <a
          href={preview.url}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-accent hover:text-accent-hover"
          title={preview.url}
        >
          {preview.url.replace(/^https?:\/\//, "")}
        </a>

        <button
          onClick={() => setReloadKey((value) => value + 1)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-soft transition-colors hover:bg-hover hover:text-ink"
        >
          Reload
        </button>
      </div>

      {expired ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-xs text-center text-[13px] leading-relaxed text-ink-faint">
            This preview link has expired. Ask the agent for the preview URL
            again and a fresh one will open here.
          </p>
        </div>
      ) : (
        <iframe
          key={reloadKey}
          src={preview.url}
          title={`Preview of port ${preview.port}`}
          // Sandboxed because this renders whatever the agent wrote. Scripts and
          // same-origin are allowed so a real app works; top-level navigation is
          // not, so a page cannot redirect the whole tab out from under the user.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          className="flex-1 border-0 bg-white"
        />
      )}
    </div>
  );
}
