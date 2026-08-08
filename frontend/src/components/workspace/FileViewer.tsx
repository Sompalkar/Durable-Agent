"use client";

/**
 * File viewer and editor.
 *
 * The user edits the same rows the agent's tools write to, and every save
 * creates a revision — which is why the history list sits right underneath.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  classNames,
  formatBytes,
  formatRelativeTime,
  languageForPath,
} from "@/lib/format";
import type { FileRevision, FileWithContent } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Feedback";
import { CloseIcon, HistoryIcon, TrashIcon } from "@/components/ui/icons";
import { FileDiff } from "./FileDiff";

export function FileViewer({
  sessionId,
  file,
  revisions,
  onClose,
  onSave,
  onDelete,
}: {
  sessionId: string;
  file: FileWithContent;
  revisions: FileRevision[];
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset when the file changes, so a pending confirm cannot carry over and
  // delete a different file than the one it was aimed at.
  const [lastPath, setLastPath] = useState(file.path);
  if (file.path !== lastPath) {
    setLastPath(file.path);
    setConfirmDelete(false);
  }

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);
  /** The revision being compared against the current contents, if any. */
  const [diff, setDiff] = useState<{ version: number; content: string } | null>(null);

  // Reset the draft when a different file — or a newer version of the same
  // file — is opened. Done during render so the editor never shows one file's
  // contents under another file's header.
  const identity = `${file.path}@${file.version}`;
  const [syncedIdentity, setSyncedIdentity] = useState(identity);
  if (identity !== syncedIdentity) {
    setSyncedIdentity(identity);
    setDraft(file.content);
  }

  const dirty = draft !== file.content;

  /** Clicking a revision diffs it against what is on screen now. */
  const compare = async (version: number) => {
    if (diff?.version === version) {
      setDiff(null);
      return;
    }
    const { revision } = await api.fileRevision(sessionId, file.path, version);
    setDiff({ version, content: revision.content });
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px] text-ink">{file.path}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span>{languageForPath(file.path)}</span>
            <span>·</span>
            <span>{formatBytes(file.size)}</span>
            <span>·</span>
            <span>{formatRelativeTime(file.updatedAt)}</span>
          </p>
        </div>

        <Badge tone="accent">v{file.version}</Badge>

        <IconButton
          label="File history"
          onClick={() => setShowHistory((value) => !value)}
          className={classNames(showHistory && "bg-hover text-ink")}
        >
          <HistoryIcon className="h-4 w-4" />
        </IconButton>
        {/* Two steps, because this sits next to Close and History and deletes
            work the agent may have just produced. The confirm state times out
            so a stray first click does not leave a live delete button waiting. */}
        {confirmDelete ? (
          <button
            onClick={() => void onDelete()}
            className="shrink-0 rounded-lg border border-negative/40 bg-negative/10 px-2 py-1 text-[11px] font-medium text-negative transition-colors hover:bg-negative/20"
          >
            Delete?
          </button>
        ) : (
          <IconButton
            label="Delete file"
            variant="danger"
            onClick={() => setConfirmDelete(true)}
          >
            <TrashIcon className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton label="Close file" onClick={onClose}>
          <CloseIcon className="h-4 w-4" />
        </IconButton>
      </header>

      {showHistory ? (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-line bg-panel px-3 py-2">
          <p className="pb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Revisions
          </p>
          <ul className="space-y-1">
            {revisions.map((revision) => (
              <li key={revision.version}>
                <button
                  onClick={() => void compare(revision.version)}
                  className={classNames(
                    "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left font-mono text-[12px] transition-colors",
                    diff?.version === revision.version
                      ? "bg-raised text-ink"
                      : "text-ink-soft hover:bg-hover",
                  )}
                >
                  <Badge tone={diff?.version === revision.version ? "accent" : "neutral"}>
                    v{revision.version}
                  </Badge>
                  <span className="flex-1 truncate">{revision.summary}</span>
                  <span className="text-ink-faint">
                    {formatRelativeTime(revision.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="pt-1.5 text-[11px] text-ink-faint">
            Click a revision to diff it against the current contents.
          </p>
        </div>
      ) : null}

      {diff ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5">
            <span className="font-mono text-[11px] text-ink-faint">
              v{diff.version} → v{file.version}
            </span>
            <button
              onClick={() => setDiff(null)}
              className="ml-auto text-[11px] font-medium text-ink-faint hover:text-ink"
            >
              Back to editor
            </button>
          </div>
          <FileDiff before={diff.content} after={file.content} />
        </div>
      ) : (
        <textarea
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-0 flex-1 resize-none bg-canvas px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink-soft outline-none"
        />
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <p className="text-[12px] text-ink-faint">
          {dirty ? "Unsaved changes" : "Saved"}
        </p>
        <div className="flex gap-2">
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={() => setDraft(file.content)}>
              Revert
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
