"use client";

/**
 * The session's container: what is up, what it runs, how to stop either.
 *
 * Polled only while a panel showing it is open — a status read costs a command
 * inside a container that is billed while it lives.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { SandboxStatus, SessionPreview } from "./types";

/** Slow on purpose: a dev server does not start and stop every few seconds. */
const POLL_MS = 15_000;

const IDLE: SandboxStatus = {
  running: false,
  persistent: false,
  startedAt: null,
  processes: [],
  ports: [],
};

export interface SandboxState {
  status: SandboxStatus;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  stop: () => Promise<void>;
  stopProcess: (name: string) => Promise<void>;
  /** Mint a fresh link for a port and return it. */
  openPort: (port: number) => Promise<SessionPreview | null>;
}

export function useSandbox(
  sessionId: string,
  /** Only polls while true — pass whether the panel is on screen. */
  active: boolean,
  onPreviewChanged?: (preview: SessionPreview) => void,
): SandboxState {
  const [status, setStatus] = useState<SandboxStatus>(IDLE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const read = async (first = false) => {
      // Only the first read shows a spinner; later polls update quietly.
      if (first) setLoading(true);
      try {
        const next = await api.sandboxStatus(sessionId);
        if (cancelled) return;
        setStatus(next);
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not read the container.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void read(true);

    // Stops while the tab is hidden.
    const tick = () => {
      if (document.visibilityState === "visible") void read();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, sessionId, token]);

  const stop = useCallback(async () => {
    await api.stopSandbox(sessionId);
    setStatus(IDLE);
    refresh();
  }, [refresh, sessionId]);

  const stopProcess = useCallback(
    async (name: string) => {
      await api.stopSandboxProcess(sessionId, name);
      refresh();
    },
    [refresh, sessionId],
  );

  const openPort = useCallback(
    async (port: number) => {
      try {
        const { preview } = await api.sandboxPreview(sessionId, port);
        onPreviewChanged?.(preview);
        return preview;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not open that port.");
        return null;
      }
    },
    [onPreviewChanged, sessionId],
  );

  return { status, loading, error, refresh, stop, stopProcess, openPort };
}
