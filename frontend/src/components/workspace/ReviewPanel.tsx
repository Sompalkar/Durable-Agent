"use client";

/**
 * Everything this session has changed, as a diff.
 *
 * The same view a reviewer gets: each file against what it looked like before
 * the agent touched it, not against the previous edit. That baseline is what
 * makes this answer "should this be merged" rather than "what did the last
 * step do" — and it is free, because every write appends a revision.
 *
 * The list is the session's own record of what it changed, so it survives the
 * container being destroyed and is still right days later.
 */

import { useState } from "react";
import { classNames } from "@/lib/format";
import type { RepoState } from "@/lib/useRepo";
import { ChangedFileDiff } from "@/components/github/ChangedFileDiff";
import { EmptyState } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { ChevronIcon, GitBranchIcon } from "@/components/ui/icons";

export function ReviewPanel({
  sessionId,
  repo,
  onOpenPullRequest,
}: {
  sessionId: string;
  repo: RepoState;
  /** Opens the pull-request dialog. Only meaningful with a repo attached. */
  onOpenPullRequest?: () => void;
}) {
  // Open the first file by default: a review panel where everything starts
  // collapsed makes you click once before it tells you anything.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(repo.changedPaths.slice(0, 1)),
  );

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (repo.changedPaths.length === 0) {
    return (
      <EmptyState
        icon={<GitBranchIcon className="h-6 w-6" />}
        title="Nothing changed yet"
        description="Files the agent writes show up here as a diff against how they started, ready to review before they become a pull request."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/12 text-accent">
          <GitBranchIcon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold tracking-tight">Review</h2>
          <p className="truncate text-[12px] text-ink-faint">
            {repo.changedPaths.length} file
            {repo.changedPaths.length === 1 ? "" : "s"} changed
            {repo.repo ? ` · ${repo.repo.fullName}` : ""}
          </p>
        </div>
        {repo.repo && onOpenPullRequest ? (
          <Button variant="primary" size="sm" onClick={onOpenPullRequest}>
            {repo.pullRequest ? "Update PR" : "Open PR"}
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y divide-line">
          {repo.changedPaths.map((path) => {
            const open = expanded.has(path);
            return (
              <li key={path}>
                <button
                  onClick={() => toggle(path)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-hover"
                >
                  <ChevronIcon
                    className={classNames(
                      "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                    {path}
                  </span>
                </button>

                {open ? (
                  <div className="border-t border-line bg-canvas p-2">
                    <ChangedFileDiff
                      sessionId={sessionId}
                      path={path}
                      against="import"
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
