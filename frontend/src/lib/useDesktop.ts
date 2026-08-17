"use client";

/** The container's desktop: whether it is serving, and where. */

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { DesktopInfo } from "./types";

export interface DesktopState {
  url: string | null;
  busy: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  open: (url: string) => Promise<void>;
}

export function useDesktop(sessionId: string, active: boolean): DesktopState {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    void api
      .desktop(sessionId)
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [active, sessionId]);

  const call = useCallback(async (run: () => Promise<DesktopInfo | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await run();
      if (next) setInfo(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The desktop failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(
    () => call(() => api.startDesktop(sessionId)),
    [call, sessionId],
  );

  const stop = useCallback(
    () =>
      call(async () => {
        await api.stopDesktop(sessionId);
        setInfo(null);
      }),
    [call, sessionId],
  );

  const open = useCallback(
    (url: string) => call(() => api.startDesktop(sessionId, url)),
    [call, sessionId],
  );

  return { url: info?.url ?? null, busy, error, start, stop, open };
}
