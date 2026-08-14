"use client";

/**
 * A drag-to-resize width, remembered across sessions.
 *
 * The rail holds a file tree, a diff, and a terminal — three things whose
 * useful width differs by a factor of two. A fixed width means one of them is
 * always wrong, so the width is the user's to set, and it persists because
 * re-dragging it on every visit would be its own annoyance.
 *
 * Pointer events rather than mouse events, so a trackpad drag and a touch drag
 * take the same path. The listeners live on `window` for the duration of the
 * drag: the pointer routinely leaves the 4px handle mid-gesture, and a handler
 * bound to the handle alone would lose it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface Resizable {
  width: number;
  dragging: boolean;
  /** Spread onto the drag handle. */
  handleProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    role: "separator";
    "aria-orientation": "vertical";
    "aria-valuenow": number;
    "aria-valuemin": number;
    "aria-valuemax": number;
    tabIndex: 0;
    onKeyDown: (event: React.KeyboardEvent) => void;
  };
  reset: () => void;
}

export function useResizable({
  storageKey,
  initial,
  min,
  max,
  /** Which edge the handle sits on. The rail grows leftwards. */
  edge = "left",
}: {
  storageKey: string;
  initial: number;
  min: number;
  max: number;
  edge?: "left" | "right";
}): Resizable {
  /**
   * Seeded from storage in the initialiser rather than in an effect.
   *
   * That would normally risk a hydration mismatch, but callers apply this width
   * only once they know they are on a wide viewport — which is itself decided
   * after mount — so the value is not part of the first render's output.
   */
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return initial;
    try {
      const stored = Number(window.localStorage.getItem(storageKey));
      return Number.isFinite(stored) && stored > 0
        ? Math.min(Math.max(stored, min), max)
        : initial;
    } catch {
      return initial;
    }
  });
  const [dragging, setDragging] = useState(false);
  const frame = useRef<number | null>(null);

  const commit = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, min), max);
      setWidth(clamped);
      try {
        window.localStorage.setItem(storageKey, String(Math.round(clamped)));
      } catch {
        // Blocked storage costs the user persistence, not the drag itself.
      }
    },
    [max, min, storageKey],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      setDragging(true);

      const move = (moveEvent: PointerEvent) => {
        // Coalesced into one update per frame. Pointer events fire faster than
        // the screen refreshes, and re-laying out the rail on each one makes
        // the drag feel heavier than the pointer.
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          commit(
            edge === "left"
              ? window.innerWidth - moveEvent.clientX
              : moveEvent.clientX,
          );
        });
      };

      const release = () => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    },
    [commit, edge],
  );

  // Keyboard resizing, because a drag handle that only responds to a pointer is
  // unreachable for anyone not using one.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 64 : 16;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        commit(edge === "left" ? width + step : width - step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        commit(edge === "left" ? width - step : width + step);
      }
    },
    [commit, edge, width],
  );

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const reset = useCallback(() => commit(initial), [commit, initial]);

  return {
    width,
    dragging,
    reset,
    handleProps: {
      onPointerDown,
      onKeyDown,
      role: "separator",
      "aria-orientation": "vertical",
      "aria-valuenow": Math.round(width),
      "aria-valuemin": min,
      "aria-valuemax": max,
      tabIndex: 0,
    },
  };
}
