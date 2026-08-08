"use client";

/**
 * Session orchestrator.
 *
 * Owns the pieces that have to agree with each other: the transcript, the live
 * turn, and the four stores behind the right rail. Everything below this
 * component is presentational.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { classNames } from "@/lib/format";
import type {
  ModelOption,
  PlanStep,
  Proposal,
  SessionSummary,
  ToolActivity,
  TranscriptMessage,
  TurnUsage,
} from "@/lib/types";
import { useAgentStream, type TurnSegment } from "@/lib/useAgentStream";
import { useArchive } from "@/lib/useArchive";
import { useRepo } from "@/lib/useRepo";
import { useBrain } from "@/lib/useBrain";
import { useSchedules } from "@/lib/useSchedules";
import { useWorkspace } from "@/lib/useWorkspace";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { UsageMeter } from "@/components/chat/UsageMeter";
import { BackgroundActivity } from "@/components/BackgroundActivity";
import { RightRail, type RailTab } from "@/components/RightRail";
import { useLeftPanel } from "@/components/layout/AppShell";
import { EmptyState, ErrorBanner } from "@/components/ui/Feedback";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { AlertIcon, PanelIcon, PanelRightIcon } from "@/components/ui/icons";

const XL = 1280;

export function SessionView({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Right rail: null = responsive default (open from xl up), true/false override.
  const [rail, setRail] = useState<boolean | null>(null);
  const [tab, setTab] = useState<RailTab>("files");
  const leftPanel = useLeftPanel();

  const toggleRail = () => {
    const wide = typeof window !== "undefined" && window.innerWidth >= XL;
    const effective = rail === null ? wide : rail;
    setRail(!effective);
  };
  const [models, setModels] = useState<ModelOption[]>([]);
  const [efforts, setEfforts] = useState<string[]>([]);

  const workspace = useWorkspace(sessionId);
  const brain = useBrain();
  const schedules = useSchedules(sessionId);
  // Loaded only while its tab is open — the archive is a query against Mongo,
  // and there is no reason to run it for a panel nobody is looking at.
  const archive = useArchive(sessionId, tab === "archive");
  const repo = useRepo(sessionId);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { session: summary, messages: history } = await api.getSession(sessionId);
        if (cancelled) return;
        setSession(summary);
        setMessages(history);
        setProposals(summary.proposals);
        // Restored from the session, so refreshing mid-task does not lose the
        // checklist the agent is partway through.
        setPlan(summary.plan);
        setLoadError(null);
      } catch (cause) {
        if (!cancelled) {
          setLoadError(
            cause instanceof Error ? cause.message : "Failed to load session.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // The model catalogue is static config, so fetch it once per mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalogue = await api.models();
        if (cancelled) return;
        setModels(catalogue.models);
        setEfforts(catalogue.efforts);
      } catch {
        // The picker just stays empty; the session still runs on its default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Switch model or effort. Takes effect on the next turn. */
  const configure = useCallback(
    async (next: { model?: string; effort?: string }) => {
      const { session: updated } = await api.configureSession(sessionId, next);
      setSession(updated);
    },
    [sessionId],
  );

  /** Refresh the header's usage counters once a turn settles. */
  const refreshSession = useCallback(async () => {
    try {
      const { session: summary } = await api.getSession(sessionId);
      setSession(summary);
    } catch {
      // The turn already succeeded; a stale counter is not worth an error.
    }
  }, [sessionId]);

  /** Move the finished turn out of the stream and into the transcript. */
  const handleComplete = useCallback(
    (
      text: string,
      _usage: TurnUsage,
      activities: ToolActivity[],
      segments: TurnSegment[],
    ) => {
      if (text || activities.length > 0) {
        setMessages((current) => [
          ...current,
          {
            id: Date.now(),
            role: "assistant",
            text,
            createdAt: Date.now(),
            tools: activities.map((activity) => ({
              id: activity.id,
              name: activity.name,
              input: activity.input,
              ok: activity.status !== "failed",
              summary: activity.summary ?? "",
              durationMs: activity.durationMs ?? 0,
            })),
            // Carried over from the live stream so the finished turn keeps the
            // order it was shown in. The server stores the same thing, so a
            // reload renders identically.
            segments: segments.map((segment) =>
              segment.kind === "text"
                ? segment
                : {
                    kind: "tool" as const,
                    tool: {
                      id: segment.activity.id,
                      name: segment.activity.name,
                      input: segment.activity.input,
                      ok: segment.activity.status !== "failed",
                      summary: segment.activity.summary ?? "",
                      durationMs: segment.activity.durationMs ?? 0,
                    },
                  },
            ),
          },
        ]);
      }
      void refreshSession();
    },
    [refreshSession],
  );

  const refreshWorkspace = workspace.refresh;
  const refreshRepo = repo.refresh;
  const refreshBrain = brain.refresh;
  const refreshSchedules = schedules.refresh;

  const stream = useAgentStream(sessionId, {
    onComplete: handleComplete,
    onWorkspaceChanged: useCallback(() => {
      refreshWorkspace();
      // The diff grew, so the repo strip's changed-file count is now stale.
      refreshRepo();
    }, [refreshWorkspace, refreshRepo]),
    onBrainChanged: useCallback(() => refreshBrain(), [refreshBrain]),
    onScheduleChanged: useCallback(() => refreshSchedules(), [refreshSchedules]),
    onProposals: useCallback((next: Proposal[]) => setProposals(next), []),
    onPlan: useCallback((next: PlanStep[]) => setPlan(next), []),
  });

  const send = useCallback(
    (message: string) => {
      // Show the user's message immediately; the server has already accepted it
      // by the time the first event arrives.
      setMessages((current) => [
        ...current,
        { id: Date.now(), role: "user", text: message, createdAt: Date.now() },
      ]);
      setProposals([]);
      setPlan([]);
      void stream.send(message);
    },
    [stream],
  );

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md space-y-3">
          <ErrorBanner message={loadError} />
          <p className="text-center text-xs text-ink-faint">
            Start the backend with <code className="font-mono">npm run dev</code>{" "}
            inside <code className="font-mono">./backend</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-ink-faint">Loading session…</p>
      </div>
    );
  }

  if (!session.id) {
    return (
      <EmptyState
        icon={<AlertIcon className="h-6 w-6" />}
        title="Session not found"
        description="It may have been deleted. Create a new session from the sidebar."
      />
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
          <button
            onClick={leftPanel.toggle}
            aria-label="Toggle sessions"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-hover hover:text-ink"
          >
            <PanelIcon className="h-[18px] w-[18px]" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">
              {session.title}
            </h2>
            <p className="truncate text-xs leading-tight text-ink-faint">
              Durable Object <code className="font-mono">{session.id}</code>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden xl:block">
              <UsageMeter session={session} />
            </div>
            {models.length > 0 ? (
              <ModelPicker
                models={models}
                efforts={efforts}
                model={session.model}
                effort={session.effort}
                disabled={stream.streaming}
                onChange={(next) => void configure(next)}
              />
            ) : null}
            <button
              onClick={toggleRail}
              aria-label="Toggle agent panel"
              title="Files, memory, skills, and agents"
              className={classNames(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                rail === true
                  ? "border-accent/40 bg-accent-dim text-accent"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
              )}
            >
              <PanelRightIcon className="h-[18px] w-[18px]" />
            </button>
            <ThemeToggle className="hidden sm:inline-flex" />
          </div>
        </header>

        <BackgroundActivity onChanged={refreshSchedules} />

        <ChatPanel
          sessionId={sessionId}
          messages={messages}
          stream={stream}
          proposals={proposals}
          plan={plan}
          onSend={send}
        />
      </div>

      {/* Backdrop for the rail drawer, only where it overlays (below xl). */}
      {rail === true ? (
        <div
          role="presentation"
          onClick={() => setRail(false)}
          className="absolute inset-0 z-30 bg-black/50 xl:hidden"
        />
      ) : null}

      <div
        className={classNames(
          "absolute bottom-0 right-0 top-0 z-40 w-full max-w-[27rem] transition-transform duration-200",
          "xl:static xl:z-auto xl:w-[27rem] xl:max-w-none xl:shrink-0",
          rail === true
            ? "translate-x-0"
            : rail === false
              ? "translate-x-full xl:hidden"
              : "translate-x-full xl:translate-x-0",
        )}
      >
        <RightRail
          sessionId={sessionId}
          tab={tab}
          onTabChange={setTab}
          onClose={() => setRail(false)}
          workspace={workspace}
          brain={brain}
          schedules={schedules}
          archive={archive}
          repo={repo}
          onTaskReady={send}
        />
      </div>
    </div>
  );
}
