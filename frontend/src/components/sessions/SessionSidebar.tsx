"use client";

/**
 * Left rail: the session list.
 *
 * Each session is a separate Durable Object with its own conversation and its
 * own workspace, so switching here switches the entire backing store.
 *
 * Layout follows the shape people already know from every other agent tool:
 * identity at the top, the actions that create something below it, then the
 * list, then the quiet stuff. Sessions are grouped by age rather than listed
 * flat — with a dozen of them a single undifferentiated list gives you nothing
 * to navigate by — and a filter appears once there are enough to lose track of.
 */

import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { classNames, formatRelativeTime } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import type { SessionListItem } from "@/lib/types";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { useLeftPanel } from "@/components/layout/left-panel";
import { IconButton } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Feedback";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
  CloseIcon,
  PanelIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
} from "@/components/ui/icons";

const DAY = 24 * 60 * 60 * 1000;

/** Below this many sessions the filter is clutter, so it stays hidden. */
const SEARCHABLE_AT = 6;

export function SessionSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ sessionId?: string }>();
  const activeId = params?.sessionId;
  const leftPanel = useLeftPanel();

  const { user } = useAuth();

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const { sessions: list } = await api.listSessions();
        if (controller.signal.aborted) return;
        setSessions(list);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Failed to load sessions.");
      }
    })();

    return () => controller.abort();
  }, [activeId, reloadToken]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? sessions.filter((session) => session.title.toLowerCase().includes(needle))
      : sessions;
    return groupByAge(matching);
  }, [sessions, query]);

  const openSearch = () => {
    setSearching(true);
    // The input mounts in the same commit, so focus on the next frame.
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };

  const createSession = async () => {
    setCreating(true);
    try {
      // Start the session on whatever the account's settings say, so the
      // preference on the settings page is the one that actually takes effect.
      const { session } = await api.createSession(undefined, {
        model: user?.settings.defaultModel,
        effort: user?.settings.defaultEffort,
      });
      reload();
      router.push(`/sessions/${session.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create session.");
    } finally {
      setCreating(false);
    }
  };

  const deleteSession = async (id: string) => {
    await api.deleteSession(id);
    reload();
    if (id === activeId) router.push("/sessions");
  };

  return (
    <aside className="flex h-full w-[17.5rem] shrink-0 flex-col border-r border-line bg-sidebar">
      <header className="flex items-center gap-1 px-2.5 pb-1 pt-2.5">
        <div className="min-w-0 flex-1">
          <AccountMenu />
        </div>
        {sessions.length >= SEARCHABLE_AT ? (
          <IconButton
            label="Search sessions"
            className="h-8 w-8"
            onClick={searching ? closeSearch : openSearch}
          >
            {searching ? (
              <CloseIcon className="h-4 w-4" />
            ) : (
              <SearchIcon className="h-4 w-4" />
            )}
          </IconButton>
        ) : null}
        <IconButton
          label="Collapse sidebar"
          className="h-8 w-8"
          onClick={leftPanel.toggle}
        >
          <PanelIcon className="h-4 w-4" />
        </IconButton>
      </header>

      {searching ? (
        <div className="px-2.5 pb-1 pt-1.5">
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSearch();
            }}
            placeholder="Filter sessions…"
            aria-label="Filter sessions"
            className="w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-line-strong"
          />
        </div>
      ) : null}

      <div className="space-y-0.5 px-2.5 py-1.5">
        <button
          onClick={createSession}
          disabled={creating}
          className={classNames(
            "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
            "text-[13.5px] font-medium text-ink transition-colors",
            "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/12 text-accent">
            <PlusIcon className="h-3.5 w-3.5" />
          </span>
          {creating ? "Creating…" : "New session"}
        </button>

        <NavRow
          href="/settings"
          active={pathname === "/settings"}
          icon={<SettingsIcon className="h-3.5 w-3.5" />}
          label="Settings & usage"
        />
      </div>

      {error ? (
        <div className="px-2.5 pb-2">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 && !error ? (
          <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-ink-faint">
            No sessions yet.
            <br />
            Create one to give the agent a workspace.
          </p>
        ) : null}

        {groups.length === 0 && query.trim() ? (
          <p className="px-3 py-8 text-center text-[13px] text-ink-faint">
            Nothing matches “{query.trim()}”.
          </p>
        ) : null}

        {groups.map(({ label, items }) => (
          <section key={label} className="pt-3 first:pt-1">
            <h2 className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-faint">
              {label}
            </h2>
            <ul className="space-y-px">
              {items.map((session) => {
                const active = session.id === activeId;
                return (
                  <li key={session.id} className="group relative">
                    <Link
                      href={`/sessions/${session.id}`}
                      className={classNames(
                        "block rounded-lg py-1.5 pl-2.5 pr-8 transition-colors",
                        active
                          ? "bg-raised text-ink"
                          : "text-ink-soft hover:bg-hover hover:text-ink",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {/* Active marker: a small accent dot, not a full wash. */}
                        {active ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                        ) : null}
                        <span className="block truncate text-[13.5px] leading-snug">
                          {session.title}
                        </span>
                      </span>
                      <span
                        className={classNames(
                          "mt-0.5 block truncate text-[11.5px] leading-snug text-ink-faint",
                          active && "pl-3",
                        )}
                      >
                        {session.messageCount || "No"} message
                        {session.messageCount === 1 ? "" : "s"} ·{" "}
                        {formatRelativeTime(session.updatedAt)}
                      </span>
                    </Link>

                    <IconButton
                      label={`Delete ${session.title}`}
                      variant="danger"
                      className="absolute right-1 top-1.5 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => void deleteSession(session.id)}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      <footer className="space-y-2 border-t border-line px-2.5 py-2.5">
        <ThemeToggle variant="segmented" />
        <p className="flex items-center gap-1.5 px-1 text-[11px] leading-relaxed text-ink-faint">
          <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
          Nothing runs between your messages.
        </p>
      </footer>
    </aside>
  );
}

/** A destination in the sidebar's action block. Same metrics as New session. */
function NavRow({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={classNames(
        "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] transition-colors",
        active ? "bg-raised text-ink" : "text-ink-soft hover:bg-hover hover:text-ink",
      )}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-faint">
        {icon}
      </span>
      {label}
    </Link>
  );
}

/** Bucket sessions into Today / Yesterday / Earlier, dropping empty groups. */
function groupByAge(
  sessions: SessionListItem[],
): Array<{ label: string; items: SessionListItem[] }> {
  const now = Date.now();
  const buckets: Record<string, SessionListItem[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };

  for (const session of sessions) {
    const age = now - session.updatedAt;
    if (age < DAY) buckets.Today.push(session);
    else if (age < 2 * DAY) buckets.Yesterday.push(session);
    else buckets.Earlier.push(session);
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}
