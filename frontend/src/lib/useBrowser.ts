"use client";

/**
 * The container's browser, driven from the panel.
 *
 * Every action returns a fresh screenshot, so the view is always the result of
 * the last thing that happened rather than a stale frame.
 */

import { useCallback, useState } from "react";
import { api } from "./api";
import type { BrowserAction, BrowserView } from "./types";

export interface BrowserSession {
  view: BrowserView | null;
  busy: boolean;
  error: string | null;
  act: (action: BrowserAction) => Promise<void>;
}

export function useBrowser(sessionId: string): BrowserSession {
  const [view, setView] = useState<BrowserView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (action: BrowserAction) => {
      setBusy(true);
      setError(null);
      try {
        setView(await api.browserAction(sessionId, action));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The browser failed.");
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  return { view, busy, error, act };
}
