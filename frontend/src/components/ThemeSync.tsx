"use client";

import { useThemeSync } from "@/lib/useThemeSync";

/**
 * Renders nothing. It exists so the theme/account bridge runs once, high in the
 * tree, rather than being called from whichever component happens to be mounted.
 */
export function ThemeSync(): null {
  useThemeSync();
  return null;
}
