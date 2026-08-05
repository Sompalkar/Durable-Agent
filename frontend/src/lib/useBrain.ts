"use client";

/**
 * The agent's memory and skills.
 *
 * Global rather than per-session — this is the state that follows the agent
 * between conversations, so the hook is deliberately not keyed on a session id.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Memory, Skill } from "./types";

export interface BrainState {
  memories: Memory[];
  skills: Skill[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  addMemory: (content: string, category: string) => Promise<void>;
  correctMemory: (id: number, content: string) => Promise<void>;
  forgetMemory: (id: number) => Promise<void>;
  deleteSkill: (name: string) => Promise<void>;
}

export function useBrain(): BrainState {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const snapshot = await api.getBrain();
        if (controller.signal.aborted) return;
        setMemories(snapshot.memories);
        setSkills(snapshot.skills);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Failed to load memory.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [reloadToken]);

  const addMemory = useCallback(
    async (content: string, category: string) => {
      await api.addMemory(content, category);
      refresh();
    },
    [refresh],
  );

  const correctMemory = useCallback(
    async (id: number, content: string) => {
      await api.correctMemory(id, content);
      refresh();
    },
    [refresh],
  );

  const forgetMemory = useCallback(
    async (id: number) => {
      await api.forgetMemory(id);
      refresh();
    },
    [refresh],
  );

  const deleteSkill = useCallback(
    async (name: string) => {
      await api.deleteSkill(name);
      refresh();
    },
    [refresh],
  );

  return {
    memories,
    skills,
    loading,
    error,
    refresh,
    addMemory,
    correctMemory,
    forgetMemory,
    deleteSkill,
  };
}
