"use client";

/**
 * The sessions-rail toggle, as context.
 *
 * Lives apart from `AppShell` so that the sidebar — which `AppShell` renders —
 * can reach the toggle without the two modules importing each other.
 */

import { createContext, useContext } from "react";

type LeftPanel = { toggle: () => void };

export const LeftPanelContext = createContext<LeftPanel>({ toggle: () => {} });

/** Lets any header render the sessions toggle without prop-drilling. */
export function useLeftPanel(): LeftPanel {
  return useContext(LeftPanelContext);
}
