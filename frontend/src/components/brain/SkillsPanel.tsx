"use client";

/**
 * Skills the agent has saved.
 *
 * Only the name and description are ever loaded into a turn; the body is
 * fetched on demand. That is why a long list here costs almost nothing — and
 * why the description is the part worth writing carefully.
 */

import { useState } from "react";
import { classNames, formatRelativeTime } from "@/lib/format";
import type { BrainState } from "@/lib/useBrain";
import type { Skill } from "@/lib/types";
import { IconButton } from "@/components/ui/Button";
import { Badge, EmptyState } from "@/components/ui/Feedback";
import { BookmarkIcon, ChevronIcon, TrashIcon } from "@/components/ui/icons";

export function SkillsPanel({ brain }: { brain: BrainState }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line px-3 py-2.5">
        <p className="text-[13px] font-semibold tracking-tight">Skills</p>
        <p className="truncate text-[12px] text-ink-faint">
          {brain.skills.length} saved workflow
          {brain.skills.length === 1 ? "" : "s"} · descriptions always loaded,
          bodies on demand
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {brain.loading ? (
          <p className="px-3 py-6 text-center text-[13px] text-ink-faint">Loading skills…</p>
        ) : brain.skills.length === 0 ? (
          <EmptyState
            icon={<BookmarkIcon className="h-6 w-6" />}
            title="No skills yet"
            description="Walk the agent through a multi-step task, then ask it to save the approach as a skill. It will reuse it next time instead of working it out again."
          />
        ) : (
          <ul className="divide-y divide-line">
            {brain.skills.map((skill) => (
              <SkillRow key={skill.id} skill={skill} brain={brain} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SkillRow({ skill, brain }: { skill: Skill; brain: BrainState }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="group">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-1.5">
            <ChevronIcon
              className={classNames(
                "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
                expanded && "rotate-90",
              )}
            />
            <code className="truncate font-mono text-[13px] text-ink">{skill.name}</code>
            <Badge>{skill.uses}×</Badge>
          </div>
          <p className="mt-1 pl-5 text-[12px] leading-relaxed text-ink-faint">
            {skill.description}
          </p>
          <p className="mt-0.5 pl-5 text-[11px] text-ink-faint">
            updated {formatRelativeTime(skill.updatedAt)}
          </p>
        </button>

        <IconButton
          label={`Delete ${skill.name}`}
          variant="danger"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => void brain.deleteSkill(skill.name)}
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {expanded ? (
        <pre className="mx-3 mb-3 max-h-64 overflow-auto rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-soft">
          {skill.body}
        </pre>
      ) : null}
    </li>
  );
}
