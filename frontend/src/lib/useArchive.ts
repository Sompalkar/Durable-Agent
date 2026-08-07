"use client";

/**
 * The durable transcript, from MongoDB.
 *
 * Every other panel reads a Durable Object. This one does not: it reads the
 * copy the Worker archives after each turn, which is the only record that
 * survives clearing the conversation — and the only one that carries what each
 * turn actually cost.
 *
 * Loaded lazily. The archive is the least-opened tab, and there is no reason to
 * query it for a session nobody asked about.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ArchivedTurn } from "./types";

export interface ArchiveState {
  turns: ArchivedTurn[];
  loading: boolean;
  error: string | null;
  /** True once the first load has been requested for this session. */
  loaded: boolean;
  refresh: () => void;
}

export function useArchive(sessionId: string, active: boolean): ArchiveState {
  const [turns, setTurns] = useState<ArchivedTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  // Reset when the session changes, so a stale archive never renders under a
  // new session's header while the fetch is in flight.
  const [lastSessionId, setLastSessionId] = useState(sessionId);
  if (sessionId !== lastSessionId) {
    setLastSessionId(sessionId);
    setTurns([]);
    setLoaded(false);
    setError(null);
  }

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();

    void (async () => {
      setLoading(true);
      try {
        const { turns: archived } = await api.archivedTurns(sessionId);
        if (controller.signal.aborted) return;
        setTurns(archived);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load the archive.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();

    return () => controller.abort();
  }, [sessionId, active, reloadToken]);

  return { turns, loading, error, loaded, refresh };
}
