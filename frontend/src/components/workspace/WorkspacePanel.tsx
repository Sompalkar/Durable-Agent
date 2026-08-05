"use client";

/**
 * The workspace column: a live view of the Durable Object's SQLite database.
 *
 * When the agent writes a file, the turn emits `workspace_changed`, the tree
 * refetches, and the change shows up here — the same rows, read two ways.
 */

import { formatBytes } from "@/lib/format";
import type { RepoState } from "@/lib/useRepo";
import type { WorkspaceState } from "@/lib/useWorkspace";
import { RepoStrip } from "@/components/github/RepoStrip";
import { IconButton } from "@/components/ui/Button";
import { EmptyState, ErrorBanner } from "@/components/ui/Feedback";
import { DatabaseIcon, FolderIcon, RefreshIcon } from "@/components/ui/icons";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";

export function WorkspacePanel({
  sessionId,
  workspace,
  repo,
  onTaskReady,
}: {
  sessionId: string;
  workspace: WorkspaceState;
  repo: RepoState;
  onTaskReady: (task: string) => void;
}) {
  const stats = workspace.tree?.stats;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* When a repository is attached the workspace *is* the repository, so
          this belongs here rather than in a tab of its own. */}
      <RepoStrip sessionId={sessionId} repo={repo} onTaskReady={onTaskReady} />
      <header className="flex items-center gap-2 border-b border-line px-3 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/12 text-accent">
          <DatabaseIcon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold tracking-tight">Workspace</h2>
          <p className="truncate text-[12px] text-ink-faint">
            {stats
              ? `${stats.fileCount} file${stats.fileCount === 1 ? "" : "s"} · ${formatBytes(stats.totalBytes)} · ${stats.revisionCount} revision${stats.revisionCount === 1 ? "" : "s"}`
              : "Reading SQLite…"}
          </p>
        </div>
        <IconButton
          label="Refresh workspace"
          onClick={workspace.refresh}
        >
          <RefreshIcon className="h-4 w-4" />
        </IconButton>
      </header>

      {workspace.error ? (
        <div className="px-3 py-3">
          <ErrorBanner message={workspace.error} />
        </div>
      ) : null}

      {/* Tree on top, viewer below — the viewer takes over when a file is open. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {workspace.loading ? (
          <p className="px-3 py-6 text-center text-[13px] text-ink-faint">
            Loading files…
          </p>
        ) : workspace.tree && workspace.tree.files.length > 0 ? (
          <FileTree
            files={workspace.tree.files}
            activePath={workspace.openFile?.path}
            onSelect={(path) => void workspace.open(path)}
          />
        ) : (
          <EmptyState
            icon={<FolderIcon className="h-6 w-6" />}
            title="No files yet"
            description="Ask the agent to create something. Files it writes appear here immediately and persist after you close the tab."
          />
        )}
      </div>

      {workspace.openFile ? (
        <div className="h-[60%] min-h-0 shrink-0 border-t border-line">
          <FileViewer
            sessionId={sessionId}
            file={workspace.openFile}
            revisions={workspace.revisions}
            onClose={workspace.close}
            onSave={(content) =>
              workspace.save(workspace.openFile!.path, content)
            }
            onDelete={() => workspace.remove(workspace.openFile!.path)}
          />
        </div>
      ) : null}
    </div>
  );
}
