"use client";

/**
 * Left rail: the session list.
 *
 * Each session is a separate Durable Object with its own conversation and its
 * own workspace, so switching here switches the entire backing store.
 *
 * Sessions are grouped by age rather than listed flat — with a dozen of them a
 * single undifferentiated list gives you nothing to navigate by.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { classNames, formatRelativeTime } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import type { SessionListItem } from "@/lib/types";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { IconButton } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Feedback";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";

const DAY = 24 * 60 * 60 * 1000;

export function SessionSidebar() {
  const router = useRouter();
  const params = useParams<{ sessionId?: string }>();
  const activeId = params?.sessionId;

  const { user } = useAuth();

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

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

  const groups = useMemo(() => groupByAge(sessions), [sessions]);

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
    <aside className="flex h-full w-[18rem] shrink-0 flex-col border-r border-line bg-panel">
      <header className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Mark />
        <span className="text-[15px] font-semibold tracking-tight">
          Durable Agent
        </span>
      </header>

      <div className="px-3 pb-2">
        <button
          onClick={createSession}
          disabled={creating}
          className={classNames(
            "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5",
            "text-sm font-medium text-accent-ink shadow-sm shadow-accent/20 transition-colors",
            "hover:bg-accent-hover disabled:opacity-50",
          )}
        >
          <PlusIcon className="h-4 w-4" />
          {creating ? "Creating…" : "New session"}
        </button>
      </div>

      {error ? (
        <div className="px-3 pb-2">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {sessions.length === 0 && !error ? (
          <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-ink-faint">
            No sessions yet.
            <br />
            Create one to give the agent a workspace.
          </p>
        ) : null}

        {groups.map(({ label, items }) => (
          <section key={label} className="pt-3 first:pt-1">
            <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              {label}
            </h2>
            <ul>
              {items.map((session) => {
                const active = session.id === activeId;
                return (
                  <li key={session.id} className="group relative">
                    <Link
                      href={`/sessions/${session.id}`}
                      className={classNames(
                        "block rounded-lg py-1.5 pl-3 pr-8 transition-colors",
                        active
                          ? "bg-raised text-ink"
                          : "text-ink-soft hover:bg-hover hover:text-ink",
                      )}
                    >
                      {/* Active marker: a clay bar, not a full highlight. */}
                      {active ? (
                        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent" />
                      ) : null}
                      <span className="block truncate text-[14px] leading-snug">
                        {session.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] leading-snug text-ink-faint">
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

      <footer className="space-y-2.5 border-t border-line px-3 py-3">
        <AccountMenu />
        <ThemeToggle variant="segmented" />
        <p className="flex items-center gap-1.5 px-1 text-[11px] leading-relaxed text-ink-faint">
          <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
          Nothing runs between your messages.
        </p>
      </footer>
    </aside>
  );
}

/** The logomark: a stack of rows, because the filesystem is a table. */
function Mark() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
        <rect x="2" y="3" width="12" height="2.4" rx="1.2" fill="currentColor" />
        <rect
          x="2"
          y="6.8"
          width="12"
          height="2.4"
          rx="1.2"
          fill="currentColor"
          opacity="0.65"
        />
        <rect
          x="2"
          y="10.6"
          width="12"
          height="2.4"
          rx="1.2"
          fill="currentColor"
          opacity="0.35"
        />
      </svg>
    </span>
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
