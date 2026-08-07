"use client";

/**
 * The repository attached to a session, and the diff the agent has built up.
 *
 * Refreshed after every turn rather than polled: the diff only changes when the
 * agent writes a file, and the turn already tells us when that happened.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { AttachedRepo, CommandRecord, Memory } from "./types";

export interface RepoState {
  repo: AttachedRepo | null;
  changedPaths: string[];
  commands: CommandRecord[];
  /** What the agent has learned about this codebase, across every task on it. */
  knowledge: Memory[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  attach: (input: { repo: string; issue?: number }) => Promise<string | null>;
  openPullRequest: (title?: string) => Promise<{ number: number; url: string }>;
  forget: (memoryId: number) => Promise<void>;
}

export function useRepo(sessionId: string): RepoState {
  const [repo, setRepo] = useState<AttachedRepo | null>(null);
  const [changedPaths, setChangedPaths] = useState<string[]>([]);
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [knowledge, setKnowledge] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const state = await api.sessionRepo(sessionId);
        if (controller.signal.aborted) return;
        setRepo(state.repo);
        setChangedPaths(state.changedPaths);
        setCommands(state.commands);
        setKnowledge(state.knowledge);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not read the repository.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [sessionId, reloadToken]);

  /**
   * Attach a repository.
   *
   * Returns the opening task when the repo came with an issue, so the caller can
   * start the conversation with it instead of making the user retype what the
   * issue already says.
   */
  const attach = useCallback(
    async (input: { repo: string; issue?: number }) => {
      const result = await api.attachRepo(sessionId, input);
      setRepo(result.repo);
      setChangedPaths([]);
      setCommands([]);
      // Not cleared: knowledge belongs to the repository, not the session, so
      // attaching the same repo again should arrive already knowing things.
      refresh();
      return result.task;
    },
    [sessionId, refresh],
  );

  const openPullRequest = useCallback(
    async (title?: string) => {
      const { pullRequest } = await api.openPullRequest(sessionId, { title });
      return pullRequest;
    },
    [sessionId],
  );

  const forget = useCallback(
    async (memoryId: number) => {
      await api.forgetRepoKnowledge(sessionId, memoryId);
      setKnowledge((current) => current.filter((entry) => entry.id !== memoryId));
    },
    [sessionId],
  );

  return {
    repo,
    changedPaths,
    commands,
    knowledge,
    loading,
    error,
    refresh,
    attach,
    openPullRequest,
    forget,
  };
}
