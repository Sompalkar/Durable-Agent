"use client";

/**
 * Theme: light or dark, applied as `data-theme` on <html>.
 *
 * A tiny blocking script in the root layout sets the attribute before paint
 * (from localStorage, falling back to the OS preference), so there is no flash
 * and no hydration mismatch. This hook just reads that attribute on mount and
 * keeps it, localStorage, and React state in sync when the user toggles.
 */

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "da-theme";

/** Inline, dependency-free — runs in <head> before React hydrates. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

/**
 * The current theme is external state — it lives on the DOM (set by the init
 * script before hydration) and in localStorage, not in React. Reading it with
 * useSyncExternalStore keeps every hook instance in sync and sidesteps the
 * hydration mismatch a plain useState/useEffect pair would cause.
 */
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);

  const setTheme = useCallback((next: Theme) => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    notify();
  }, []);

  const toggle = useCallback(() => {
    setTheme(readTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
