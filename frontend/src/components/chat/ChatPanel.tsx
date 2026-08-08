"use client";

/**
 * The conversation column: history, the turn currently streaming, the agent's
 * proposed next steps, and the composer. Purely presentational — all state is
 * owned by `SessionView`.
 */

import { useEffect, useRef } from "react";
import type { AgentStream } from "@/lib/useAgentStream";
import {
  toolRecordToActivity,
  type PlanStep,
  type Proposal,
  type TranscriptMessage,
} from "@/lib/types";
import { EmptyState, ErrorBanner } from "@/components/ui/Feedback";
import { ClockIcon, SparkIcon } from "@/components/ui/icons";
import { AssistantMessage, UserMessage } from "./Message";
import { Composer } from "./Composer";
import { PlanStrip } from "./PlanStrip";
import { Proposals } from "./Proposals";
import { TurnTimeline } from "./TurnTimeline";
import { ThinkingPanel } from "./ThinkingPanel";
import { ToolActivityList } from "./ToolActivityList";

const SUGGESTIONS = [
  "Remember that I prefer TypeScript with strict mode, then tell me what you know about me.",
  "Create a small TypeScript module at /src/queue.ts with tests alongside it.",
  "Schedule yourself to summarise this workspace every hour, then run it now.",
];

export function ChatPanel({
  sessionId,
  messages,
  stream,
  proposals,
  plan,
  onSend,
  draft,
}: {
  sessionId: string;
  /** Text to load into the composer for editing rather than sending. */
  draft?: { key: number; text: string };
  messages: TranscriptMessage[];
  stream: AgentStream;
  proposals: Proposal[];
  plan: PlanStep[];
  onSend: (message: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows and as tokens arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, stream.assistantText, stream.activities.length]);

  const isEmpty = messages.length === 0 && !stream.streaming;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          {isEmpty ? (
            <EmptyState
              icon={<SparkIcon className="h-6 w-6" />}
              title="This agent has no machine"
              description="Its files, its memory, its skills, and its schedule are all rows in Durable Object SQLite. Nothing boots, nothing idles, and everything is still here tomorrow."
              action={
                <div className="flex flex-col gap-2 pt-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => onSend(suggestion)}
                      className="rounded-xl border border-line bg-panel px-3.5 py-2.5 text-left text-[13px] leading-relaxed text-ink-soft transition-colors hover:border-line-strong hover:bg-hover hover:text-ink"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              }
            />
          ) : null}

          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="space-y-1">
                {message.trigger ? <TriggerBadge label={message.trigger} /> : null}
                <UserMessage text={message.text} />
              </div>
            ) : message.segments && message.segments.length > 0 ? (
              // Saved with ordering — render the real sequence.
              <div key={message.id} className="animate-in space-y-2">
                <TurnTimeline
                  sessionId={sessionId}
                  segments={message.segments.map((segment) =>
                    segment.kind === "tool"
                      ? {
                          kind: "tool" as const,
                          activity: toolRecordToActivity(segment.tool),
                        }
                      : segment,
                  )}
                />
              </div>
            ) : (
              // Older turns kept only text and a flat tool list.
              <AssistantMessage key={message.id} text={message.text}>
                <ToolActivityList
                  activities={(message.tools ?? []).map(toolRecordToActivity)}
                  sessionId={sessionId}
                />
              </AssistantMessage>
            ),
          )}

          {/*
            The live turn. It clears itself once `turn_end` moves the reply into
            the transcript above, so nothing is rendered twice — but it stays put
            after an error, where there is no transcript entry to fall back on.
          */}
          {stream.streaming ||
          stream.activities.length > 0 ||
          stream.assistantText ? (
            <div className="animate-in space-y-2">
              <ThinkingPanel text={stream.thinkingText} />
              <TurnTimeline
                sessionId={sessionId}
                segments={stream.segments}
                streaming={stream.streaming}
              />
            </div>
          ) : null}

          {stream.error ? (
            <ErrorBanner message={stream.error} onDismiss={stream.dismissError} />
          ) : null}

          {!stream.streaming ? (
            <Proposals
              proposals={proposals}
              disabled={stream.streaming}
              onPick={onSend}
            />
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <PlanStrip plan={plan} streaming={stream.streaming} />

      {/* Remounted whenever a new draft arrives — that is what loads the text,
          and it means picking the same issue twice still refills a cleared box. */}
      <Composer
        key={draft?.key ?? "empty"}
        initialValue={draft?.text}
        streaming={stream.streaming}
        onSend={onSend}
        onStop={stream.stop}
      />
    </section>
  );
}

/** Marks a turn that a background schedule started rather than the user. */
function TriggerBadge({ label }: { label: string }) {
  return (
    <p className="flex items-center justify-end gap-1.5 text-[10px] text-ink-faint">
      <ClockIcon className="h-3 w-3" />
      ran in the background · {label}
    </p>
  );
}
