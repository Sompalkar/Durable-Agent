"use client";

/**
 * Background agents.
 *
 * Each row is a Durable Object alarm. Between firings there is no process, no
 * container, and no cost — the object is asleep until Cloudflare wakes it to
 * run the turn. "Run now" fires the same code path the alarm would, because a
 * schedule you have to wait an hour to see is impossible to demo.
 */

import { useState } from "react";
import { classNames, formatRelativeTime, formatTimestamp } from "@/lib/format";
import type { Cadence, Schedule } from "@/lib/types";
import type { ScheduleState } from "@/lib/useSchedules";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, EmptyState, ErrorBanner, LoadingDots } from "@/components/ui/Feedback";
import {
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/ui/icons";

export function SchedulePanel({ schedules }: { schedules: ScheduleState }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold tracking-tight">Background agents</p>
          <p className="truncate text-[12px] text-ink-faint">
            Durable Object alarms · zero cost between runs
          </p>
        </div>
        <IconButton
          label={creating ? "Cancel" : "New schedule"}
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? <CloseIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
        </IconButton>
      </header>

      {creating ? (
        <ScheduleForm
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            await schedules.create(input);
            setCreating(false);
          }}
        />
      ) : null}

      {schedules.error ? (
        <div className="px-3 py-2.5">
          <ErrorBanner message={schedules.error} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {schedules.loading ? (
          <p className="px-3 py-6 text-center text-[13px] text-ink-faint">Loading schedules…</p>
        ) : schedules.schedules.length === 0 ? (
          <EmptyState
            icon={<ClockIcon className="h-6 w-6" />}
            title="No background agents"
            description="Schedule a task and the agent will wake itself up to run it — no browser open, no server running, nothing billed while it waits."
          />
        ) : (
          <ul className="divide-y divide-line">
            {schedules.schedules.map((schedule) => (
              <ScheduleRow key={schedule.id} schedule={schedule} schedules={schedules} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ScheduleRow({
  schedule,
  schedules,
}: {
  schedule: Schedule;
  schedules: ScheduleState;
}) {
  const [expanded, setExpanded] = useState(false);
  const runs = schedules.runs[schedule.id] ?? [];
  const busy = schedules.busyId === schedule.id;

  const toggleExpanded = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !schedules.runs[schedule.id]) await schedules.loadRuns(schedule.id);
  };

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <button onClick={toggleExpanded} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <ChevronIcon
              className={classNames(
                "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
                expanded && "rotate-90",
              )}
            />
            <span className="truncate text-[13px] font-medium text-ink">{schedule.label}</span>
            {schedule.needsApproval ? (
              <Badge tone="accent">needs approval</Badge>
            ) : (
              <Badge tone={schedule.status === "active" ? "positive" : "neutral"}>
                {schedule.status}
              </Badge>
            )}
          </div>
          <p className="mt-1 pl-5 text-[12px] text-ink-faint">
            {describeCadence(schedule)} ·{" "}
            {schedule.status === "active"
              ? `next ${formatRelativeTime(schedule.nextRunAt)}`
              : "not scheduled"}{" "}
            · {schedule.runCount}/{schedule.maxRuns} runs
          </p>
        </button>

        <div className="flex shrink-0 gap-0.5">
          <IconButton
            label="Run now"
            disabled={busy}
            onClick={() => void schedules.runNow(schedule.id)}
          >
            {busy ? (
              <LoadingDots className="text-accent" />
            ) : (
              <PlayIcon className="h-3.5 w-3.5" />
            )}
          </IconButton>
          <IconButton
            label={schedule.status === "active" ? "Pause" : "Resume"}
            onClick={() => void schedules.toggle(schedule)}
          >
            {schedule.status === "active" ? (
              <PauseIcon className="h-3.5 w-3.5" />
            ) : (
              <PlayIcon className="h-3.5 w-3.5" />
            )}
          </IconButton>
          <IconButton
            label="Delete schedule"
            variant="danger"
            onClick={() => void schedules.remove(schedule.id)}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {schedule.needsApproval ? (
        <div className="mt-2 ml-5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-2">
          <p className="text-[12px] leading-relaxed text-ink-soft">
            The agent asked to schedule this. It will not run — and will not spend
            anything — until you approve it.
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void schedules.toggle(schedule)}
            >
              Approve &amp; arm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void schedules.remove(schedule.id)}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-2 space-y-2 pl-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Prompt
            </p>
            <p className="mt-1 rounded-lg border border-line bg-canvas px-2.5 py-2 text-[12px] leading-relaxed text-ink-soft">
              {schedule.prompt}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              Past runs
            </p>
            {runs.length === 0 ? (
              <p className="mt-1 text-[12px] text-ink-faint">
                Not run yet. Next firing {formatTimestamp(schedule.nextRunAt)}.
              </p>
            ) : (
              <ul className="mt-1 space-y-1">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    className="rounded-lg border border-line bg-canvas px-2.5 py-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge tone={run.ok ? "positive" : "negative"}>
                        {run.ok ? "ok" : "failed"}
                      </Badge>
                      <span className="text-[11px] text-ink-faint">
                        {formatRelativeTime(run.startedAt)} ·{" "}
                        {Math.round((run.finishedAt - run.startedAt) / 100) / 10}s
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
                      {run.summary}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function ScheduleForm({
  onCreate,
  onCancel,
}: {
  onCreate: (input: {
    label: string;
    prompt: string;
    cadence: Cadence;
    intervalMinutes?: number;
    minuteOfDay?: number;
    delayMinutes?: number;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<Cadence>("once");
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [time, setTime] = useState("09:00");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!prompt.trim()) return;
    setSaving(true);
    try {
      const [hours, minutes] = time.split(":").map(Number);
      await onCreate({
        label: label.trim() || "Scheduled run",
        prompt: prompt.trim(),
        cadence,
        intervalMinutes: cadence === "interval" ? intervalMinutes : undefined,
        minuteOfDay: cadence === "daily" ? hours * 60 + minutes : undefined,
        delayMinutes: cadence === "once" ? 1 : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-b border-line bg-raised px-3 py-2.5">
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Name, e.g. Morning digest"
        className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
      />
      <textarea
        rows={2}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="What should the agent do when this fires?"
        className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={cadence}
          onChange={(event) => setCadence(event.target.value as Cadence)}
          className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink-soft outline-none"
        >
          <option value="once">Once, in a minute</option>
          <option value="interval">Every N minutes</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
        </select>

        {cadence === "interval" ? (
          <input
            type="number"
            min={5}
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(Number(event.target.value))}
            className="w-20 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink outline-none"
          />
        ) : null}

        {cadence === "daily" ? (
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink outline-none"
          />
        ) : null}
      </div>

      {cadence === "daily" ? (
        <p className="text-[11px] text-ink-faint">Times are UTC.</p>
      ) : null}

      {cadence !== "once" ? (
        <p className="rounded-md border border-caution/30 bg-caution/10 px-2 py-1.5 text-[11px] leading-relaxed text-caution">
          A recurring agent spends tokens every time it fires, whether or not you
          are watching. It stops after {"20"} runs.
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!prompt.trim() || saving}
        >
          {saving ? "Scheduling…" : "Schedule"}
        </Button>
      </div>
    </div>
  );
}

function describeCadence(schedule: Schedule): string {
  switch (schedule.cadence) {
    case "once":
      return "Once";
    case "hourly":
      return "Every hour";
    case "interval":
      return `Every ${schedule.intervalMinutes} min`;
    case "daily": {
      const minutes = schedule.minuteOfDay ?? 0;
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      return `Daily at ${hh}:${mm} UTC`;
    }
  }
}
