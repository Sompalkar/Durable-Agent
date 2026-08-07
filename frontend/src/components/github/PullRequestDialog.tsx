"use client";

/**
 * Reviewing what is about to be pushed.
 *
 * Opening a pull request is an outward-facing action on someone else's
 * repository, so it is confirmed rather than done automatically. This screen
 * shows exactly what will be in it — including, honestly, when nothing was run
 * to verify the change.
 */

import { useState } from "react";
import { classNames } from "@/lib/format";
import type { RepoState } from "@/lib/useRepo";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorBanner } from "@/components/ui/Feedback";
import { ChangedFileDiff } from "./ChangedFileDiff";

export function PullRequestDialog({
  sessionId,
  repo,
  onClose,
}: {
  sessionId: string;
  repo: RepoState;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(
    repo.repo?.issueTitle ?? `Changes from the agent`,
  );
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ number: number; url: string } | null>(null);

  // Only the last run of each distinct command counts. An agent that ran the
  // suite, saw it fail, fixed it and re-ran has a green branch — counting every
  // attempt would call that failing, which is what the PR body used to do.
  const finalRuns = [
    ...new Map(repo.commands.map((entry) => [entry.command, entry])).values(),
  ];
  const failed = finalRuns.filter((entry) => entry.exitCode !== 0);
  const verified = finalRuns.length > 0 && failed.length === 0;
  const retried = repo.commands.length - finalRuns.length;

  const submit = async () => {
    setOpening(true);
    setError(null);
    try {
      const pull = await repo.openPullRequest(title.trim() || undefined);
      setOpened(pull);
      repo.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the pull request.");
      setOpening(false);
    }
  };

  if (opened) {
    return (
      <Dialog title="Pull request opened" onClose={onClose}>
        <p className="text-[13px] text-ink-soft">
          #{opened.number} is open on {repo.repo?.fullName}.
        </p>
        <a
          href={opened.url}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all font-mono text-[12px] text-accent hover:text-accent-hover"
        >
          {opened.url}
        </a>
        <div className="flex justify-end pt-1">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Open a pull request" onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}

      {/* The verification verdict comes first, because it is the thing most
          likely to change the decision to ship. */}
      <div
        className={classNames(
          "rounded-lg border px-3 py-2 text-[12px] leading-relaxed",
          verified
            ? "border-positive/30 bg-positive/10 text-positive"
            : failed.length > 0
              ? "border-negative/30 bg-negative/10 text-negative"
              : "border-caution/30 bg-caution/10 text-caution",
        )}
      >
        {verified
          ? `${finalRuns.length} command${finalRuns.length === 1 ? "" : "s"} ran and all passed.` +
            (retried > 0
              ? ` ${retried} earlier attempt${retried === 1 ? "" : "s"} failed and ${retried === 1 ? "was" : "were"} fixed.`
              : "")
          : failed.length > 0
            ? `${failed.length} of ${finalRuns.length} commands are still failing. This branch is not green.`
            : "Nothing was run against this change. It is unverified."}
      </div>

      <div>
        <label
          htmlFor="pr-title"
          className="mb-1.5 block text-[12px] font-medium text-ink-soft"
        >
          Title
        </label>
        <input
          id="pr-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={classNames(
            "block w-full rounded-lg border border-line bg-canvas px-3 py-2",
            "text-[13px] text-ink outline-none transition-colors",
            "focus:border-accent focus:ring-2 focus:ring-accent/25",
          )}
        />
      </div>

      <div>
        <p className="mb-1.5 text-[12px] font-medium text-ink-soft">
          {repo.changedPaths.length} file
          {repo.changedPaths.length === 1 ? "" : "s"} — click to see the diff
        </p>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-canvas p-1.5">
          {repo.changedPaths.map((path) => (
            <ChangedFile key={path} sessionId={sessionId} path={path} />
          ))}
        </ul>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-faint">
        One commit onto a new branch off{" "}
        <span className="font-mono">{repo.repo?.branch}</span>. The description
        carries the plan, the files, and every command with its exit code.
      </p>

      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose} disabled={opening}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={opening}>
          {opening ? "Opening…" : "Open pull request"}
        </Button>
      </div>
    </Dialog>
  );
}

/** One file in the list, expandable to its before-and-after. */
function ChangedFile({ sessionId, path }: { sessionId: string; path: string }) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={classNames(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors",
          open ? "bg-hover" : "hover:bg-hover",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className={classNames(
            "h-3 w-3 shrink-0 text-ink-faint transition-transform",
            open ? "rotate-90" : "",
          )}
          aria-hidden
        >
          <path
            d="M6 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-soft">
          {path.replace(/^\//, "")}
        </span>
      </button>

      {open ? (
        <div className="pb-1.5 pl-4 pr-1.5 pt-1">
          <ChangedFileDiff sessionId={sessionId} path={path} />
        </div>
      ) : null}
    </li>
  );
}
