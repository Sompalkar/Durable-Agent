"use client";

import { EmptyState } from "@/components/ui/Feedback";
import { useLeftPanel } from "@/components/layout/AppShell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { DatabaseIcon, PanelIcon } from "@/components/ui/icons";

/** Shown when no session is selected. */
export default function SessionsIndexPage() {
  const leftPanel = useLeftPanel();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <button
          onClick={leftPanel.toggle}
          aria-label="Toggle sessions"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-hover hover:text-ink"
        >
          <PanelIcon className="h-[18px] w-[18px]" />
        </button>
        <span className="flex-1 truncate text-[15px] font-semibold tracking-tight">
          Durable Agent
        </span>
        <ThemeToggle />
      </header>

      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={<DatabaseIcon className="h-6 w-6" />}
          title="Pick a session, or start a new one"
          description="Each session gets its own Durable Object: a private conversation and a private SQLite filesystem that the agent reads and writes through explicit tools — no container, no shell, nothing to boot."
        />
      </div>
    </div>
  );
}
