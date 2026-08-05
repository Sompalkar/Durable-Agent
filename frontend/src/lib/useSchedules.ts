"use client";

/**
 * Background agents for one session.
 *
 * Each schedule is a row that arms a Durable Object alarm. Nothing polls and
 * nothing runs between firings, so the list here is genuinely the whole system.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Cadence, Schedule, ScheduledRun } from "./types";

export interface ScheduleState {
  schedules: Schedule[];
  runs: Record<number, ScheduledRun[]>;
  loading: boolean;
  error: string | null;
  busyId: number | null;
  refresh: () => void;
  create: (input: {
    label: string;
    prompt: string;
    cadence: Cadence;
    intervalMinutes?: number;
    minuteOfDay?: number;
    delayMinutes?: number;
  }) => Promise<void>;
  toggle: (schedule: Schedule) => Promise<void>;
  remove: (id: number) => Promise<void>;
  runNow: (id: number) => Promise<void>;
  loadRuns: (id: number) => Promise<void>;
}

export function useSchedules(sessionId: string): ScheduleState {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<Record<number, ScheduledRun[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const { schedules: list } = await api.listSchedules(sessionId);
        if (controller.signal.aborted) return;
        setSchedules(list);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Failed to load schedules.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [sessionId, reloadToken]);

  const create = useCallback<ScheduleState["create"]>(
    async (input) => {
      await api.createSchedule({ sessionId, ...input });
      refresh();
    },
    [refresh, sessionId],
  );

  const toggle = useCallback(
    async (schedule: Schedule) => {
      await api.setScheduleStatus(
        schedule.id,
        schedule.status === "active" ? "paused" : "active",
      );
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      await api.deleteSchedule(id);
      refresh();
    },
    [refresh],
  );

  const loadRuns = useCallback(async (id: number) => {
    const { runs: list } = await api.scheduleRuns(id);
    setRuns((current) => ({ ...current, [id]: list }));
  }, []);

  /**
   * Fire a schedule immediately. A background agent you have to wait an hour to
   * see is impossible to demo, so this runs the same path the alarm would.
   */
  const runNow = useCallback(
    async (id: number) => {
      setBusyId(id);
      try {
        await api.runScheduleNow(id);
        await loadRuns(id);
        refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The run failed.");
      } finally {
        setBusyId(null);
      }
    },
    [loadRuns, refresh],
  );

  return {
    schedules,
    runs,
    loading,
    error,
    busyId,
    refresh,
    create,
    toggle,
    remove,
    runNow,
    loadRuns,
  };
}
