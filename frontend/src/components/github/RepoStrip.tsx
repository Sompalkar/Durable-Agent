"use client";

/**
 * The repository bar above the file tree.
 *
 * It sits in the Files panel rather than getting its own tab, because when a
 * repository is attached the workspace *is* the repository — a separate tab
 * would split one idea across two places.
 *
 * Three states: nothing attached, attached with no changes yet, and attached
 * with a diff ready to ship.
 */

import { useState } from "react";
import { classNames } from "@/lib/format";
import type { RepoState } from "@/lib/useRepo";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Feedback";
import { BrainIcon } from "@/components/ui/icons";
import { AttachRepoDialog } from "./AttachRepoDialog";
import { PullRequestDialog } from "./PullRequestDialog";

export function RepoStrip({
  sessionId,
  repo,
  onTaskReady,
}: {
  sessionId: string;
  repo: RepoState;
  /** Called with the opening prompt when a repo is attached from an issue. */
  onTaskReady: (task: string) => void;
}) {
  const [attaching, setAttaching] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);

  if (repo.loading) return null;

  if (!repo.repo) {
    return (
      <>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">
            Working from scratch
          </p>
          <Button size="sm" onClick={() => setAttaching(true)}>
            Attach a repo
          </Button>
        </div>
        {attaching ? (
          <AttachRepoDialog
            repo={repo}
            onClose={() => setAttaching(false)}
            onTaskReady={onTaskReady}
          />
        ) : null}
      </>
    );
  }

  const changed = repo.changedPaths.length;
  // Same rule as the pull request body: only the last run of each distinct
  // command counts, so a suite that failed and was then fixed reads as passing.
  const finalRuns = [
    ...new Map(repo.commands.map((entry) => [entry.command, entry])).values(),
  ];
  const failed = finalRuns.filter((entry) => entry.exitCode !== 0).length;

  return (
    <>
      <div className="space-y-1.5 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <GitHubMark />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
            {repo.repo.fullName}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-ink-faint">
            {repo.repo.branch}
          </span>
        </div>

        {repo.repo.issueNumber ? (
          <p className="truncate text-[12px] text-ink-soft">
            <span className="font-mono text-ink-faint">#{repo.repo.issueNumber}</span>{" "}
            {repo.repo.issueTitle}
          </p>
        ) : null}

        <div className="flex items-center gap-2 pt-0.5">
          <span
            className={classNames(
              "text-[11px]",
              changed > 0 ? "text-accent" : "text-ink-faint",
            )}
          >
            {changed === 0
              ? "No changes yet"
              : `${changed} file${changed === 1 ? "" : "s"} changed`}
          </span>

          {repo.commands.length > 0 ? (
            <span
              className={classNames(
                "text-[11px]",
                failed > 0 ? "text-negative" : "text-positive",
              )}
            >
              · {failed > 0 ? `${failed} failing` : "all commands passed"}
            </span>
          ) : null}

          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            disabled={changed === 0}
            onClick={() => setShipping(true)}
          >
            Open pull request
          </Button>
        </div>

        {/* What the agent has worked out about this codebase. Shown here rather
            than in the Memory tab because it belongs to the repository, not to
            the user — and because watching it grow is the point. */}
        <button
          onClick={() => setShowKnowledge((value) => !value)}
          aria-expanded={showKnowledge}
          className="flex w-full items-center gap-1.5 pt-0.5 text-left text-[11px] text-ink-faint transition-colors hover:text-ink-soft"
        >
          <BrainIcon className="h-3 w-3 shrink-0" />
          {repo.knowledge.length === 0
            ? "Nothing learned about this repo yet"
            : `Knows ${repo.knowledge.length} thing${repo.knowledge.length === 1 ? "" : "s"} about this repo`}
        </button>

        {showKnowledge && repo.knowledge.length > 0 ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-canvas px-2.5 py-2">
            {repo.knowledge.map((fact) => (
              <li key={fact.id} className="group flex items-start gap-1.5">
                <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-soft">
                  {fact.content}
                </span>
                <button
                  onClick={() => void repo.forget(fact.id)}
                  aria-label="Forget this"
                  title="Forget this"
                  className="shrink-0 text-[11px] text-ink-faint opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {repo.error ? (
        <div className="px-3 pt-2">
          <ErrorBanner message={repo.error} />
        </div>
      ) : null}

      {shipping ? (
        <PullRequestDialog
          sessionId={sessionId}
          repo={repo}
          onClose={() => setShipping(false)}
        />
      ) : null}
    </>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden>
      <path
        fill="currentColor"
        d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"
      />
    </svg>
  );
}
