"use client";

/**
 * Application shell.
 *
 * There is no global top bar — each view supplies its own single header, which
 * hosts the sidebar toggle (via `useLeftPanel`) so no vertical space is spent
 * on a second bar. The session list is an in-flow column from `lg` up (where it
 * can be collapsed to give the conversation the full width) and a slide-over
 * drawer below `lg`.
 *
 * `left` is tri-state: `null` follows the responsive default (open on wide
 * screens, closed on narrow); `true`/`false` are explicit overrides. The toggle
 * reads the viewport width at click time, so one button does the right thing at
 * every breakpoint without a layout effect.
 */

import { usePathname } from "next/navigation";
import { useState } from "react";
import { classNames } from "@/lib/format";
import { SessionSidebar } from "@/components/sessions/SessionSidebar";
import { LeftPanelContext } from "./left-panel";

const LG = 1024;

export { useLeftPanel } from "./left-panel";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [left, setLeft] = useState<boolean | null>(null);
  const pathname = usePathname();

  // Navigating on a narrow screen means the drawer has done its job.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (typeof window !== "undefined" && window.innerWidth < LG) setLeft(false);
  }

  const toggle = () => {
    const wide = typeof window !== "undefined" && window.innerWidth >= LG;
    const effective = left === null ? wide : left;
    setLeft(!effective);
  };

  const overlayOpen = left === true;

  return (
    <LeftPanelContext.Provider value={{ toggle }}>
      <div className="relative flex h-full overflow-hidden bg-canvas">
        {overlayOpen ? (
          <div
            role="presentation"
            onClick={() => setLeft(false)}
            className="animate-in absolute inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden"
          />
        ) : null}

        <div
          className={classNames(
            "absolute inset-y-0 left-0 z-40 shadow-pop transition-transform duration-200",
            "lg:static lg:z-auto lg:shadow-none",
            left === true
              ? "translate-x-0"
              : left === false
                ? "-translate-x-full lg:hidden"
                : "-translate-x-full lg:translate-x-0",
          )}
        >
          <SessionSidebar />
        </div>

        <main className="flex min-h-0 min-w-0 flex-1">{children}</main>
      </div>
    </LeftPanelContext.Provider>
  );
}
