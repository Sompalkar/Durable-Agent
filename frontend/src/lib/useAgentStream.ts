"use client";

/**
 * Consumes the Server-Sent Events stream produced by a turn.
 *
 * The hook owns only the *in-flight* state: partial assistant text, the
 * reasoning summary, and the tool calls currently on screen. Once the turn ends
 * it hands the finished text to the caller and clears itself, so the completed
 * conversation lives in exactly one place.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type {
  AgentEvent,
  PlanStep,
  Proposal,
  ToolActivity,
  TurnUsage,
} from "./types";

interface StreamCallbacks {
  onComplete: (text: string, usage: TurnUsage, activities: ToolActivity[]) => void;
  onWorkspaceChanged: () => void;
  /** Memory or skills were written during the turn. */
  onBrainChanged: () => void;
  /** A schedule was created during the turn. */
  onScheduleChanged: () => void;
  /** Follow-up actions the agent offered before finishing. */
  onProposals: (proposals: Proposal[]) => void;
  /** Fires mid-turn, each time the agent rewrites its checklist. */
  onPlan: (plan: PlanStep[]) => void;
}

export interface AgentStream {
  streaming: boolean;
  assistantText: string;
  thinkingText: string;
  activities: ToolActivity[];
  error: string | null;
  send: (message: string) => Promise<void>;
  stop: () => void;
  dismissError: () => void;
}

export function useAgentStream(
  sessionId: string,
  callbacks: StreamCallbacks,
): AgentStream {
  const [streaming, setStreaming] = useState(false);
  const [assistantText, setAssistantText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Read inside the stream loop without making `send` depend on render state.
  const textRef = useRef("");
  const activitiesRef = useRef<ToolActivity[]>([]);
  // Held in a ref so `applyEvent` stays stable while still seeing the latest
  // callbacks. Assigned in an effect — refs must not be written during render.
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const reset = useCallback(() => {
    textRef.current = "";
    activitiesRef.current = [];
    setAssistantText("");
    setThinkingText("");
    setActivities([]);
  }, []);

  const applyEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "text_delta":
        textRef.current += event.text;
        setAssistantText(textRef.current);
        break;

      case "thinking_delta":
        setThinkingText((current) => current + event.text);
        break;

      case "tool_call":
        activitiesRef.current = [
          ...activitiesRef.current,
          {
            id: event.id,
            name: event.name,
            input: event.input,
            status: "running",
          },
        ];
        setActivities(activitiesRef.current);
        break;

      case "tool_result":
        activitiesRef.current = activitiesRef.current.map((activity) =>
          activity.id === event.id
            ? {
                ...activity,
                status: event.ok ? "ok" : "failed",
                summary: event.summary,
                durationMs: event.durationMs,
              }
            : activity,
        );
        setActivities(activitiesRef.current);
        break;

      case "workspace_changed":
        callbacksRef.current.onWorkspaceChanged();
        break;

      case "brain_changed":
        callbacksRef.current.onBrainChanged();
        break;

      case "schedule_changed":
        callbacksRef.current.onScheduleChanged();
        break;

      case "plan":
        callbacksRef.current.onPlan(event.plan);
        break;

      case "proposals":
        callbacksRef.current.onProposals(event.proposals);
        break;

      case "turn_end":
        // Hand the finished turn to the caller, then clear the live buffers so
        // the same reply is not rendered twice.
        callbacksRef.current.onComplete(
          textRef.current.trim(),
          event.usage,
          activitiesRef.current,
        );
        reset();
        break;

      case "error":
        setError(event.message);
        break;
    }
  }, [reset]);

  const send = useCallback(
    async (message: string) => {
      if (streaming) return;

      const controller = new AbortController();
      abortRef.current = controller;
      reset();
      setError(null);
      setStreaming(true);

      try {
        const response = await fetch(api.messagesUrl(sessionId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Hand-rolled rather than routed through `api`, because this one
          // reads a stream instead of a JSON body — but it still needs the
          // session cookie, so the Worker knows whose session to run.
          credentials: "include",
          body: JSON.stringify({ message }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error: unknown }).error)
              : `The agent could not start (status ${response.status}).`,
          );
        }

        await readEventStream(response.body, applyEvent);
      } catch (cause) {
        if (controller.signal.aborted) {
          setError("Turn stopped.");
        } else {
          setError(
            cause instanceof Error ? cause.message : "Something went wrong.",
          );
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [applyEvent, reset, sessionId, streaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return {
    streaming,
    assistantText,
    thinkingText,
    activities,
    error,
    send,
    stop,
    dismissError,
  };
}

/** Parse `data: {...}` frames out of the byte stream and dispatch each one. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line; anything after the last one is a
    // partial frame that stays in the buffer until more bytes arrive.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((part) => part.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AgentEvent);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    }
  }
}
