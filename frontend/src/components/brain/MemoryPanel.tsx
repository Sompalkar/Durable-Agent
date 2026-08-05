"use client";

/**
 * What the agent remembers.
 *
 * Deliberately editable. A memory store you cannot inspect is a black box that
 * silently shapes every answer; being able to read it — and delete the wrong
 * bits — is what makes it trustworthy.
 */

import { useState } from "react";
import { classNames, formatRelativeTime } from "@/lib/format";
import type { BrainState } from "@/lib/useBrain";
import type { Memory, MemoryCategory } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, EmptyState, ErrorBanner } from "@/components/ui/Feedback";
import { BrainIcon, CheckIcon, CloseIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";

const CATEGORY_TONE: Record<MemoryCategory, "neutral" | "accent" | "positive"> = {
  preference: "accent",
  project: "positive",
  fact: "neutral",
  correction: "accent",
};

export function MemoryPanel({ brain }: { brain: BrainState }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("fact");

  const submit = async () => {
    if (!draft.trim()) return;
    await brain.addMemory(draft.trim(), category);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold tracking-tight">Memory</p>
          <p className="truncate text-[12px] text-ink-faint">
            {brain.memories.length} fact
            {brain.memories.length === 1 ? "" : "s"} carried across every session
          </p>
        </div>
        <IconButton
          label={adding ? "Cancel" : "Add a memory"}
          onClick={() => setAdding((value) => !value)}
        >
          {adding ? <CloseIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
        </IconButton>
      </header>

      {adding ? (
        <div className="space-y-2 border-b border-line bg-raised px-3 py-2.5">
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Something worth knowing next session…"
            className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex items-center gap-2">
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as MemoryCategory)}
              className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink-soft outline-none"
            >
              <option value="fact">Fact</option>
              <option value="preference">Preference</option>
              <option value="project">Project</option>
            </select>
            <Button size="sm" variant="primary" onClick={submit} disabled={!draft.trim()}>
              <CheckIcon className="h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        </div>
      ) : null}

      {brain.error ? (
        <div className="px-3 py-2.5">
          <ErrorBanner message={brain.error} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {brain.loading ? (
          <p className="px-3 py-6 text-center text-[13px] text-ink-faint">Loading memory…</p>
        ) : brain.memories.length === 0 ? (
          <EmptyState
            icon={<BrainIcon className="h-6 w-6" />}
            title="Nothing remembered yet"
            description="Tell the agent something about how you work, then start a brand new session and ask it — the memory follows it across."
          />
        ) : (
          <ul className="divide-y divide-line">
            {brain.memories.map((memory) => (
              <MemoryRow key={memory.id} memory={memory} brain={brain} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MemoryRow({ memory, brain }: { memory: Memory; brain: BrainState }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);

  const save = async () => {
    await brain.correctMemory(memory.id, draft);
    setEditing(false);
  };

  return (
    <li className="group px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="w-full resize-none rounded-lg border border-line bg-canvas px-2 py-1.5 text-[13px] leading-relaxed text-ink outline-none"
            />
          ) : (
            <button
              onClick={() => {
                setDraft(memory.content);
                setEditing(true);
              }}
              className="w-full text-left text-[13px] leading-relaxed text-ink-soft transition-colors hover:text-ink"
            >
              {memory.content}
            </button>
          )}

          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge tone={CATEGORY_TONE[memory.category] ?? "neutral"}>
              {memory.category}
            </Badge>
            <span className="text-[11px] text-ink-faint">
              recalled {memory.recalls}× · {formatRelativeTime(memory.updatedAt)}
            </span>
          </div>
        </div>

        {editing ? (
          <div className="flex shrink-0 gap-1">
            <IconButton label="Save correction" onClick={save}>
              <CheckIcon className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Cancel" onClick={() => setEditing(false)}>
              <CloseIcon className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ) : (
          <IconButton
            label="Forget this"
            variant="danger"
            className={classNames(
              "shrink-0 opacity-0 transition-opacity",
              "group-hover:opacity-100 focus-visible:opacity-100",
            )}
            onClick={() => void brain.forgetMemory(memory.id)}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    </li>
  );
}
