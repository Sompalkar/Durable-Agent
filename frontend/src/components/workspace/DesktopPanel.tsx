"use client";

/**
 * The container's desktop, over noVNC.
 *
 * Unlike the Browser tab this is not screenshots — the iframe speaks VNC, so
 * mouse and keyboard go straight to the X display and anything with a window
 * shows up, not just a browser.
 */

import { useState } from "react";
import type { DesktopState } from "@/lib/useDesktop";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorBanner, LoadingDots } from "@/components/ui/Feedback";
import { EnablePersistentButton } from "./ShellPanel";
import { MonitorIcon, StopIcon } from "@/components/ui/icons";

export function DesktopPanel({
  desktop,
  persistent,
  onEnablePersistent,
}: {
  desktop: DesktopState;
  persistent: boolean;
  onEnablePersistent: () => Promise<void>;
}) {
  const [address, setAddress] = useState("");

  if (!persistent) {
    return (
      <EmptyState
        icon={<MonitorIcon className="h-6 w-6" />}
        title="No desktop on this runtime"
        description="The desktop runs in the container, so it needs one that survives between turns."
        action={<EnablePersistentButton onEnable={onEnablePersistent} />}
      />
    );
  }

  if (!desktop.url) {
    return (
      <div className="flex h-full flex-col">
        {desktop.error ? (
          <div className="shrink-0 px-3 py-2">
            <ErrorBanner message={desktop.error} />
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<MonitorIcon className="h-6 w-6" />}
            title="Desktop is off"
            description="Starts a virtual display in the container and streams it here. Anything with a window shows up."
            action={
              <Button variant="primary" size="sm" onClick={() => void desktop.start()} disabled={desktop.busy}>
                {desktop.busy ? "Starting…" : "Start desktop"}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const open = () => {
    const url = address.trim();
    if (url) void desktop.open(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") open();
          }}
          placeholder="Open a URL in the desktop browser"
          spellCheck={false}
          aria-label="Open on desktop"
          className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-2.5 py-1 font-mono text-[11.5px] text-ink outline-none focus:border-line-strong"
        />
        {desktop.busy ? <LoadingDots className="shrink-0 text-accent" /> : null}
        <button
          onClick={() => void desktop.stop()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:bg-hover hover:text-ink"
        >
          <StopIcon className="h-3 w-3" />
          Stop
        </button>
      </div>

      {desktop.error ? (
        <div className="shrink-0 px-3 py-2">
          <ErrorBanner message={desktop.error} />
        </div>
      ) : null}

      <iframe
        // `resize=scale` fits the whole 1280x800 display into the frame. The
        // rail is a few hundred pixels wide, and `remote` needs a randr-capable
        // server anyway — without one it leaves the desktop cropped.
        src={`${desktop.url}/vnc.html?autoconnect=1&reconnect=1&resize=scale&show_dot=1`}
        title="Container desktop"
        className="min-h-0 flex-1 border-0 bg-black"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
