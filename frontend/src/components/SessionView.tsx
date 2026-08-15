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
  SessionPreview,
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
import { useResizable } from "@/lib/useResizable";
import { useShell } from "@/lib/useShell";
import { useSandbox } from "@/lib/useSandbox";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { RuntimeSwitch } from "@/components/chat/RuntimeSwitch";
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

  // Width applies only from xl up, where the rail is a column rather than an
  // overlay; below that it is full-width and the inline style would fight the
  // drawer's own sizing.
  const resize = useResizable({
    storageKey: "rail-width",
    initial: 432,
    min: 320,
    max: 880,
  });
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${XL}px)`);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const railStyle = wide ? { width: `${resize.width}px` } : undefined;

  const workspace = useWorkspace(sessionId);
  const brain = useBrain();
  const schedules = useSchedules(sessionId);
  // Loaded only while its tab is open — the archive is a query against Mongo,
  // and there is no reason to run it for a panel nobody is looking at.
  const archive = useArchive(sessionId, tab === "archive");
  const repo = useRepo(sessionId);
  // The user's own commands can write files, so the tree refreshes on the same
  // signal the agent's commands use.
  // Polled only while a panel that shows it is open — a status read runs a
  // command inside the container, and the container is billed while it lives.
  const sandbox = useSandbox(
    sessionId,
    tab === "browser" || tab === "shell",
    useCallback(
      (preview: SessionPreview) =>
        setSession((current) => (current ? { ...current, preview } : current)),
      [],
    ),
  );

  const shell = useShell(sessionId, {
    runtime: session?.runtime,
    onWorkspaceChanged: workspace.refresh,
  });

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
    async (next: { model?: string; effort?: string; runtime?: string }) => {
      const { session: updated } = await api.configureSession(sessionId, next);
      setSession(updated);
    },
    [sessionId],
  );

  /**
   * Switch this session to the runtime that keeps a container alive.
   *
   * Offered from the shell and browser panels, which are the two places where
   * the ephemeral runtime is what stopped you.
   */
  const enablePersistent = useCallback(async () => {
    await configure({ runtime: "sandbox" });
  }, [configure]);

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
              ...(activity.output ? { output: activity.output } : {}),
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
                      ...(segment.activity.output
                        ? { output: segment.activity.output }
                        : {}),
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
    // Held here rather than refetched: the panel should show the running app
    // the moment the port binds, not after the turn settles.
    onPreviewReady: useCallback(
      (next: { port: number; url: string }) =>
        setSession((current) =>
          current
            ? { ...current, preview: { ...next, expiresAt: Date.now() + 3_600_000 } }
            : current,
        ),
      [],
    ),
    onProposals: useCallback((next: Proposal[]) => setProposals(next), []),
    onPlan: useCallback((next: PlanStep[]) => setPlan(next), []),
  });

  // An issue becomes a draft, not a turn. It arrives with a counter so picking
  // the same issue twice still refills the box.
  const [draft, setDraft] = useState<{ key: number; text: string } | undefined>();
  const prefill = useCallback((task: string) => {
    setDraft({ key: Date.now(), text: task });
  }, []);

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
        <header className="flex h-13 shrink-0 items-center gap-1.5 border-b border-line bg-canvas px-2 sm:px-3">
          <button
            onClick={leftPanel.toggle}
            aria-label="Toggle sessions"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-hover hover:text-ink"
          >
            <PanelIcon className="h-[18px] w-[18px]" />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="truncate text-[14px] font-semibold leading-tight tracking-tight">
              {session.title}
            </h2>
            {/* The Durable Object id, as a chip. It is the thing you quote when
                something goes wrong, so it stays visible where there is room.

                Only the leading segment: a full UUID is 36 characters, and at
                `shrink-0` it collided with the usage meter and overprinted the
                title. The prefix is enough to identify a session, and the whole
                id is on the tooltip and one click away in the URL. */}
            <code
              title={`Durable Object ${session.id}`}
              className="hidden min-w-0 shrink truncate rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] leading-none text-ink-faint 2xl:inline-block"
            >
              {session.id.slice(0, 8)}
            </code>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div className="hidden xl:block">
              <UsageMeter session={session} />
            </div>
            <RuntimeSwitch
              runtime={session.runtime}
              disabled={stream.streaming}
              onChange={(runtime) => configure({ runtime })}
            />
            <button
              onClick={toggleRail}
              aria-label="Toggle agent panel"
              title="Files, memory, skills, and agents"
              className={classNames(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                rail === true
                  ? "bg-raised text-ink"
                  : "text-ink-soft hover:bg-hover hover:text-ink",
              )}
            >
              <PanelRightIcon className="h-[18px] w-[18px]" />
            </button>
            {/* Shown at every width: the header has room for it once the
                Durable Object chip and usage meter drop away, and the previous
                `hidden sm:inline-flex` never applied — `hidden` and the base
                `inline-flex` are both display utilities, and Tailwind emits
                `inline-flex` last, so it won at every breakpoint. */}
            <ThemeToggle />
          </div>
        </header>

        <BackgroundActivity onChanged={refreshSchedules} />

        <ChatPanel
          sessionId={sessionId}
          draft={draft}
          messages={messages}
          stream={stream}
          proposals={proposals}
          plan={plan}
          onSend={send}
          composerControls={
            models.length > 0 ? (
              <ModelPicker
                models={models}
                efforts={efforts}
                model={session.model}
                effort={session.effort}
                disabled={stream.streaming}
                onChange={(next) => void configure(next)}
              />
            ) : null
          }
        />
      </div>

      {/* Backdrop for the rail drawer, only where it overlays (below xl). */}
      {rail === true ? (
        <div
          role="presentation"
          onClick={() => setRail(false)}
          className="animate-in absolute inset-0 z-30 bg-black/40 backdrop-blur-[2px] xl:hidden"
        />
      ) : null}

      <div
        style={railStyle}
        className={classNames(
          "absolute bottom-0 right-0 top-0 z-40 w-full max-w-[27rem] shadow-pop",
          // `xl:w-[27rem]` is the pre-JS fallback: the dragged width is applied
          // inline and only once the viewport is known to be wide, so without a
          // class width the rail would briefly span the whole column.
          "xl:static xl:z-auto xl:w-[27rem] xl:max-w-none xl:shrink-0 xl:shadow-none",
          // Transitions are suppressed mid-drag: animating a width that is
          // already being driven by the pointer makes it lag behind the cursor.
          resize.dragging ? "" : "transition-transform duration-200",
          rail === true
            ? "translate-x-0"
            : rail === false
              ? "translate-x-full xl:hidden"
              : "translate-x-full xl:translate-x-0",
        )}
      >
        {/*
          Drag handle. Only from xl up, where the rail is in flow — below that
          it is an overlay pinned to the viewport, and there is no second column
          for it to trade width with.
        */}
        <div
          {...resize.handleProps}
          onDoubleClick={resize.reset}
          title="Drag to resize · double-click to reset"
          aria-label="Resize agent panel"
          className={classNames(
            "absolute inset-y-0 left-0 z-10 hidden w-1 cursor-col-resize xl:block",
            "after:absolute after:inset-y-0 after:-left-1 after:w-3 after:content-['']",
            "transition-colors hover:bg-accent/40 focus-visible:bg-accent/60",
            resize.dragging && "bg-accent/60",
          )}
        />

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
          preview={session?.preview ?? null}
          shell={shell}
          sandbox={sandbox}
          persistent={session?.runtime === "sandbox"}
          onEnablePersistent={enablePersistent}
          onTaskReady={prefill}
        />
      </div>
    </div>
  );
}
