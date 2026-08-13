"use client";

/**
 * The right rail: everything the agent has that is not the conversation.
 *
 * Five tabs, one per store. Four read Durable Objects — files and revisions for
 * this session, memory and skills shared across all of them, and the alarms
 * that run the agent when nobody is watching. The fifth reads MongoDB, and is
 * the only one whose contents outlive the session.
 */

import { classNames } from "@/lib/format";
import type { ArchiveState } from "@/lib/useArchive";
import type { BrainState } from "@/lib/useBrain";
import type { RepoState } from "@/lib/useRepo";
import type { ScheduleState } from "@/lib/useSchedules";
import type { WorkspaceState } from "@/lib/useWorkspace";
import type { SessionPreview } from "@/lib/types";
import { ArchivePanel } from "@/components/archive/ArchivePanel";
import { MemoryPanel } from "@/components/brain/MemoryPanel";
import { SkillsPanel } from "@/components/brain/SkillsPanel";
import { SchedulePanel } from "@/components/schedule/SchedulePanel";
import { PreviewPanel } from "@/components/workspace/PreviewPanel";
import { WorkspacePanel } from "@/components/workspace/WorkspacePanel";
import {
  BookmarkIcon,
  BrainIcon,
  ClockIcon,
  CloseIcon,
  FolderIcon,
  HistoryIcon,
  TerminalIcon,
} from "@/components/ui/icons";

export type RailTab = "files" | "preview" | "memory" | "skills" | "schedule" | "archive";

const TABS: Array<{
  id: RailTab;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  { id: "files", label: "Files", icon: FolderIcon },
  { id: "preview", label: "Preview", icon: TerminalIcon },
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
  onTaskReady,
}: {
  sessionId: string;
  /** The port the sandbox is currently serving, if any. */
  preview: SessionPreview | null;
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
    // The port, so the tab reads "Preview 8020" while something is serving.
    preview: preview?.port ?? 0,
    memory: brain.memories.length,
    skills: brain.skills.length,
    schedule: schedules.schedules.filter((s) => s.status === "active").length,
    archive: archive.turns.length,
  };

  return (
    <aside className="flex h-full min-h-0 w-full shrink-0 flex-col border-line bg-panel xl:border-l">
      <nav
        role="tablist"
        aria-label="Agent state"
        className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-2"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTabChange(id)}
            className={classNames(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2",
              "text-[13px] font-medium transition-colors",
              tab === id
                ? "bg-raised text-ink"
                : "text-ink-faint hover:bg-hover hover:text-ink-soft",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
            {counts[id] > 0 ? (
              <span className="font-mono text-[11px] text-ink-faint">
                {counts[id]}
              </span>
            ) : null}
          </button>
        ))}
        {onClose ? (
          <button
            onClick={onClose}
            aria-label="Close agent panel"
            title="Close panel"
            className="ml-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        ) : null}
      </nav>

      <div className="min-h-0 flex-1">
        {tab === "files" ? (
          <WorkspacePanel
            sessionId={sessionId}
            workspace={workspace}
            repo={repo}
            onTaskReady={onTaskReady}
          />
        ) : null}
        {tab === "preview" ? <PreviewPanel preview={preview} /> : null}
        {tab === "memory" ? <MemoryPanel brain={brain} /> : null}
        {tab === "skills" ? <SkillsPanel brain={brain} /> : null}
        {tab === "schedule" ? <SchedulePanel schedules={schedules} /> : null}
        {tab === "archive" ? <ArchivePanel archive={archive} /> : null}
      </div>
    </aside>
  );
}
