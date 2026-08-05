"use client";

/**
 * Workspace state for one session: the file tree plus whichever file is open.
 *
 * The agent writes into the same Durable Object, so `refresh()` is called
 * whenever a turn reports that files changed — and if the file currently on
 * screen was one of them, it is re-read in the same pass.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { FileRevision, FileWithContent, WorkspaceTree } from "./types";

export interface WorkspaceState {
  tree: WorkspaceTree | null;
  loading: boolean;
  error: string | null;
  openFile: FileWithContent | null;
  revisions: FileRevision[];
  fileLoading: boolean;
  refresh: () => void;
  open: (path: string) => Promise<void>;
  close: () => void;
  save: (path: string, content: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

const EMPTY_TREE: WorkspaceTree = {
  directories: [],
  files: [],
  stats: { fileCount: 0, totalBytes: 0, revisionCount: 0 },
};

/** Fetch a file and its history together. Pure I/O — no state involved. */
async function fetchFile(sessionId: string, path: string) {
  const [{ file }, { revisions }] = await Promise.all([
    api.readFile(sessionId, path),
    api.fileHistory(sessionId, path),
  ]);
  return { file, revisions };
}

export function useWorkspace(sessionId: string): WorkspaceState {
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<FileWithContent | null>(null);
  const [revisions, setRevisions] = useState<FileRevision[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  /** Bumped to reload the tree; see the effect below. */
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Which file is on screen, mirrored outside React state so the reload effect
   * can consult it without re-running every time the editor updates. Written
   * only from async callbacks, never during render.
   */
  const openRef = useRef<{ sessionId: string; path: string; version: number } | null>(
    null,
  );

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  // Switching sessions swaps the entire backing store, so clear everything
  // during render rather than showing the previous session's files for a frame.
  const [activeSession, setActiveSession] = useState(sessionId);
  if (sessionId !== activeSession) {
    setActiveSession(sessionId);
    setTree(null);
    setLoading(true);
    setError(null);
    setOpenFile(null);
    setRevisions([]);
  }

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const next = await api.getWorkspace(sessionId);
        if (controller.signal.aborted) return;
        setTree(next);
        setError(null);
        setLoading(false);

        // If the agent rewrote the file being viewed, pull the new contents in.
        const current = openRef.current;
        if (!current || current.sessionId !== sessionId) return;

        const latest = next.files.find((file) => file.path === current.path);
        if (!latest || latest.version === current.version) return;

        const { file, revisions: history } = await fetchFile(
          sessionId,
          current.path,
        );
        if (controller.signal.aborted) return;
        openRef.current = { sessionId, path: file.path, version: file.version };
        setOpenFile(file);
        setRevisions(history);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setTree(EMPTY_TREE);
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "Failed to load files.");
      }
    })();

    return () => controller.abort();
  }, [sessionId, reloadToken]);

  const open = useCallback(
    async (path: string) => {
      setFileLoading(true);
      try {
        const { file, revisions: history } = await fetchFile(sessionId, path);
        openRef.current = { sessionId, path: file.path, version: file.version };
        setOpenFile(file);
        setRevisions(history);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to open file.");
      } finally {
        setFileLoading(false);
      }
    },
    [sessionId],
  );

  const close = useCallback(() => {
    openRef.current = null;
    setOpenFile(null);
    setRevisions([]);
  }, []);

  const save = useCallback(
    async (path: string, content: string) => {
      await api.writeFile(sessionId, path, content);
      await open(path);
      refresh();
    },
    [open, refresh, sessionId],
  );

  const remove = useCallback(
    async (path: string) => {
      await api.deleteFile(sessionId, path);
      if (openRef.current?.path === path) close();
      refresh();
    },
    [close, refresh, sessionId],
  );

  return {
    tree,
    loading,
    error,
    openFile,
    revisions,
    fileLoading,
    refresh,
    open,
    close,
    save,
    remove,
  };
}
