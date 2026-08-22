"use client";

/**
 * The account switcher at the head of the sidebar.
 *
 * Collapsed it is one line — avatar, name, chevron. Expanded it shows the email
 * and the two things people actually come here for: settings, and signing out.
 *
 * The menu drops downward: this sits at the head of the rail, so there is no
 * room above it and plenty below.
 */

import Link from "next/link";
import { useState } from "react";
import { classNames } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";

export function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="relative">
      {open ? (
        // Click-away layer. Sits under the menu but over everything else, so a
        // click anywhere outside closes it without a document listener.
        <div
          role="presentation"
          className="fixed inset-0 z-10"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-full min-w-[13rem] overflow-hidden rounded-xl border border-line bg-panel shadow-pop">
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-[13px] font-medium text-ink">
              {user.name}
            </p>
            <p className="truncate text-[11px] text-ink-faint">{user.email}</p>
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-[13px] text-ink-soft transition-colors hover:bg-hover hover:text-ink"
          >
            Settings & usage
          </Link>
          <button
            onClick={() => void signOut()}
            className="block w-full px-3 py-2 text-left text-[13px] text-ink-soft transition-colors hover:bg-hover hover:text-negative"
          >
            Sign out
          </button>
        </div>
      ) : null}

      <button
        onClick={() => setOpen((value) => !value)}
        className={classNames(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
          open ? "bg-hover" : "hover:bg-hover",
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink text-[11px] font-semibold uppercase text-canvas">
          {user.name.slice(0, 1) || user.email.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
          {user.name}
        </span>
        <svg
          viewBox="0 0 16 16"
          className={classNames(
            "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
            open ? "rotate-180" : "",
          )}
          aria-hidden
        >
          <path
            d="M4 6.5 8 10l4-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
