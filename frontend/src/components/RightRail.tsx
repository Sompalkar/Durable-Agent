"use client";

/**
 * The right rail: everything the agent has that is not the conversation.
 *
 * Seven tabs. Most read Durable Objects — files and revisions for this session,
 * memory and skills shared across all of them, and the alarms that run the
 * agent when nobody is watching. Archive reads MongoDB, and is the only one
 * whose contents outlive the session. Shell and Preview are the exceptions:
 * both address the container itself, and both are empty without one.
 */

import { classNames } from "@/lib/format";
import type { ArchiveState } from "@/lib/useArchive";
import type { BrainState } from "@/lib/useBrain";
import type { RepoState } from "@/lib/useRepo";
import type { ScheduleState } from "@/lib/useSchedules";
import type { WorkspaceState } from "@/lib/useWorkspace";
import type { SessionPreview } from "@/lib/types";
import type { ShellState } from "@/lib/useShell";
import { ArchivePanel } from "@/components/archive/ArchivePanel";
import { MemoryPanel } from "@/components/brain/MemoryPanel";
import { SkillsPanel } from "@/components/brain/SkillsPanel";
import { SchedulePanel } from "@/components/schedule/SchedulePanel";
import { PreviewPanel } from "@/components/workspace/PreviewPanel";
import { ReviewPanel } from "@/components/workspace/ReviewPanel";
import { ShellPanel } from "@/components/workspace/ShellPanel";
import { WorkspacePanel } from "@/components/workspace/WorkspacePanel";
import {
  BookmarkIcon,
  BrainIcon,
  BrowserIcon,
  ClockIcon,
  CloseIcon,
  FolderIcon,
  GitBranchIcon,
  HistoryIcon,
  TerminalIcon,
} from "@/components/ui/icons";

export type RailTab =
  | "files"
  | "review"
  | "shell"
  | "browser"
  | "memory"
  | "skills"
  | "schedule"
  | "archive";

const TABS: Array<{
  id: RailTab;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  { id: "files", label: "Files", icon: FolderIcon },
  { id: "review", label: "Review", icon: GitBranchIcon },
  { id: "shell", label: "Shell", icon: TerminalIcon },
  { id: "browser", label: "Browser", icon: BrowserIcon },
  { id: "memory", label: "Memory", icon: BrainIcon },
  { id: "skills", label: "Skills", icon: BookmarkIcon },
  { id: "schedule", label: "Agents", icon: ClockIcon },
  { id: "archive", label: "Archive", icon: HistoryIcon },
];

export function RightRail({
  sessionId,
  tab,
  onTabChange,
  onClose,
  workspace,
  brain,
  schedules,
  archive,
  repo,
  preview,
  shell,
  persistent,
  onEnablePersistent,
  onTaskReady,
}: {
  sessionId: string;
  /** The port the sandbox is currently serving, if any. */
  preview: SessionPreview | null;
  shell: ShellState;
  /** Whether the session keeps a container between turns. */
  persistent: boolean;
  onEnablePersistent: () => Promise<void>;
  tab: RailTab;
  onTabChange: (tab: RailTab) => void;
  onClose?: () => void;
  workspace: WorkspaceState;
  brain: BrainState;
  schedules: ScheduleState;
  archive: ArchiveState;
  repo: RepoState;
  onTaskReady: (task: string) => void;
}) {
  const counts: Record<RailTab, number> = {
    files: workspace.tree?.stats.fileCount ?? 0,
    // Files this session has changed — the size of the review waiting for you.
    review: repo.changedPaths.length,
    // Commands run this session. Zero reads as "nothing typed yet".
    shell: shell.entries.length,
    // The port, so the tab reads "Browser 8020" while something is serving.
    browser: preview?.port ?? 0,
    memory: brain.memories.length,
    skills: brain.skills.length,
    schedule: schedules.schedules.filter((s) => s.status === "active").length,
    archive: archive.turns.length,
  };

  return (
    <aside className="flex h-full min-h-0 w-full shrink-0 flex-col border-line bg-panel xl:border-l">
      {/*
        Seven labelled tabs need far more width than the rail has, so giving
        each an equal share truncates every label and letting the row scroll
        hides whichever tab is last. Only the selected tab is labelled instead:
        the one you need named is the one you are looking at, and the rest stay
        as icons with a tooltip and an accessible name.
      */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <nav
          role="tablist"
          aria-label="Agent state"
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={selected}
                aria-label={label}
                title={label}
                onClick={() => onTabChange(id)}
                className={classNames(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2",
                  "text-[12.5px] font-medium transition-colors",
                  selected
                    ? "bg-raised text-ink"
                    : "text-ink-faint hover:bg-hover hover:text-ink-soft",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {selected ? label : null}
                {counts[id] > 0 ? (
                  <span
                    className={classNames(
                      "font-mono text-[10.5px] leading-none",
                      selected ? "text-ink-soft" : "text-ink-faint",
                    )}
                  >
                    {counts[id]}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        {onClose ? (
          <button
            onClick={onClose}
            aria-label="Close agent panel"
            title="Close panel"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "files" ? (
          <WorkspacePanel
            sessionId={sessionId}
            workspace={workspace}
            repo={repo}
            onTaskReady={onTaskReady}
          />
        ) : null}
        {tab === "review" ? <ReviewPanel sessionId={sessionId} repo={repo} /> : null}
        {tab === "shell" ? (
          <ShellPanel shell={shell} onEnablePersistent={onEnablePersistent} />
        ) : null}
        {tab === "browser" ? (
          <PreviewPanel
            preview={preview}
            persistent={persistent}
            onEnablePersistent={onEnablePersistent}
          />
        ) : null}
        {tab === "memory" ? <MemoryPanel brain={brain} /> : null}
        {tab === "skills" ? <SkillsPanel brain={brain} /> : null}
        {tab === "schedule" ? <SchedulePanel schedules={schedules} /> : null}
        {tab === "archive" ? <ArchivePanel archive={archive} /> : null}
      </div>
    </aside>
  );
}
