"use client";

/**
 * Bridges the theme to the signed-in account.
 *
 * Kept separate from `theme.ts` on purpose. That module runs in a blocking
 * script before React hydrates, and on the landing and login pages where there
 * is no user at all — giving it a dependency on auth would break both. So the
 * theme stays a standalone browser concern, and this is the one place that
 * knows both halves exist.
 *
 * Two directions, and the order matters:
 *
 *   on sign-in   the account's saved theme wins, because it is the durable
 *                preference and localStorage on a new device is just a guess
 *   on toggle    the new choice is written back, so the next device inherits it
 */

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/useAuth";

export function useThemeSync(): void {
  const { user, setUser } = useAuth();
  const { theme, setTheme } = useTheme();

  /** The account we have already applied, so the pull runs once per sign-in. */
  const appliedFor = useRef<string | null>(null);

  // Pull: adopt the account's theme the first time we see this user.
  useEffect(() => {
    if (!user || appliedFor.current === user.id) return;
    appliedFor.current = user.id;
    if (user.settings.theme !== theme) setTheme(user.settings.theme);
  }, [user, theme, setTheme]);

  // Push: persist a toggle. Skipped until the pull has run, so the very first
  // render cannot write the browser's guess over the account's real preference.
  useEffect(() => {
    if (!user || appliedFor.current !== user.id) return;
    if (user.settings.theme === theme) return;

    let cancelled = false;
    void (async () => {
      try {
        const updated = await api.updateProfile({ settings: { theme } });
        if (!cancelled) setUser(updated);
      } catch {
        // A failed save is not worth interrupting anyone over. The theme is
        // already applied locally; it just will not follow them to the next
        // device, and the next toggle will try again.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [theme, user, setUser]);
}
