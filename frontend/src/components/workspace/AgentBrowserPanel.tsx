"use client";

/**
 * A browser running inside the container, driven from here.
 *
 * Not an iframe: the page is loaded by Chromium in the sandbox, so it sees the
 * container's network — localhost ports, private hosts — and the agent and the
 * user drive the same session. What comes back is a screenshot, and clicks are
 * mapped from the image back into viewport coordinates.
 */

import { useRef, useState } from "react";
import { classNames } from "@/lib/format";
import { BROWSER_VIEWPORT } from "@/lib/types";
import type { BrowserSession } from "@/lib/useBrowser";
import { EmptyState, ErrorBanner, LoadingDots } from "@/components/ui/Feedback";
import { EnablePersistentButton } from "./ShellPanel";
import { BrowserIcon, ChevronIcon, RefreshIcon } from "@/components/ui/icons";

export function AgentBrowserPanel({
  browser,
  persistent,
  onEnablePersistent,
}: {
  browser: BrowserSession;
  persistent: boolean;
  onEnablePersistent: () => Promise<void>;
}) {
  const [address, setAddress] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);

  if (!persistent) {
    return (
      <EmptyState
        icon={<BrowserIcon className="h-6 w-6" />}
        title="No browser on this runtime"
        description="The browser lives in the container, so it needs one that survives between actions."
        action={<EnablePersistentButton onEnable={onEnablePersistent} />}
      />
    );
  }

  const { view, busy, act } = browser;

  const go = () => {
    const url = address.trim();
    if (url) void act({ type: "navigate", url });
  };

  /** Map a click on the screenshot back to where it landed in the page. */
  const clickAt = (event: React.MouseEvent<HTMLImageElement>) => {
    const image = imageRef.current;
    if (!image || busy) return;

    const box = image.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * BROWSER_VIEWPORT.width;
    const y = ((event.clientY - box.top) / box.height) * BROWSER_VIEWPORT.height;
    void act({ type: "click", x: Math.round(x), y: Math.round(y) });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <NavButton label="Back" onClick={() => act({ type: "back" })} disabled={busy}>
          <ChevronIcon className="h-4 w-4 rotate-180" />
        </NavButton>
        <NavButton label="Forward" onClick={() => act({ type: "forward" })} disabled={busy}>
          <ChevronIcon className="h-4 w-4" />
        </NavButton>
        <NavButton label="Reload" onClick={() => act({ type: "reload" })} disabled={busy}>
          <RefreshIcon className="h-4 w-4" />
        </NavButton>

        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") go();
          }}
          placeholder={view?.url ?? "Enter a URL"}
          spellCheck={false}
          aria-label="Address"
          className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-2.5 py-1 font-mono text-[11.5px] text-ink outline-none focus:border-line-strong"
        />

        {busy ? <LoadingDots className="shrink-0 px-1 text-accent" /> : null}
      </div>

      {browser.error ? (
        <div className="shrink-0 px-3 py-2">
          <ErrorBanner message={browser.error} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-raised p-2">
        {view ? (
          // eslint-disable-next-line @next/next/no-img-element -- a base64 frame, not an asset
          <img
            ref={imageRef}
            src={`data:image/jpeg;base64,${view.image}`}
            alt={view.title || view.url}
            onClick={clickAt}
            onWheel={(event) => {
              if (!busy) void act({ type: "scroll", dy: event.deltaY > 0 ? 400 : -400 });
            }}
            className={classNames(
              "w-full rounded-lg border border-line bg-white",
              busy ? "cursor-wait opacity-70" : "cursor-pointer",
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<BrowserIcon className="h-6 w-6" />}
              title="Nothing loaded"
              description="Enter a URL above. The page loads inside the container, so localhost ports work."
            />
          </div>
        )}
      </div>

      {view ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5">
          <p className="min-w-0 flex-1 truncate text-[11.5px] text-ink-faint" title={view.url}>
            {view.title || view.url}
          </p>
          {view.consoleErrors.length > 0 ? (
            <span
              className="shrink-0 text-[11px] text-negative"
              title={view.consoleErrors.join("\n")}
            >
              {view.consoleErrors.length} console error
              {view.consoleErrors.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}
