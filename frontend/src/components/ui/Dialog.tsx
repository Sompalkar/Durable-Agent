"use client";

/**
 * A small centred modal.
 *
 * Closes on Escape and on a backdrop click, because a modal you can only leave
 * by finding the right button is a trap.
 */

import { useEffect } from "react";
import { IconButton } from "./Button";
import { CloseIcon } from "./icons";

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex w-full max-w-md flex-col gap-3.5 rounded-xl border border-line bg-panel p-5 shadow-xl"
      >
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose} className="-mr-1 -mt-1">
            <CloseIcon className="h-4 w-4" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
