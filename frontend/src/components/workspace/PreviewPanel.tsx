"use client";

/**
 * The running app, shown inside the app.
 *
 * The Daytona proxy sets no X-Frame-Options and no frame-ancestors, so the
 * sandbox can be embedded directly rather than only linked. Seeing the thing
 * the agent just built is the difference between reading a claim and checking
 * one.
 */

import { useEffect, useState } from "react";
import { classNames } from "@/lib/format";
import type { SessionPreview } from "@/lib/types";
import { EmptyState } from "@/components/ui/Feedback";
import { TerminalIcon } from "@/components/ui/icons";

export function PreviewPanel({ preview }: { preview: SessionPreview | null }) {
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

  if (!preview) {
    return (
      <EmptyState
        icon={<TerminalIcon className="h-6 w-6" />}
        title="Nothing is running"
        description="Ask the agent to start a dev server. When it binds a port, the running app appears here."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
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
