"use client";

/**
 * Picking a repository and, optionally, an issue to work on.
 *
 * The repository list is filtered server-side to what the token can actually
 * push to, so the picker never offers something that would fail at the last
 * step — after the agent has already done the work.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { classNames } from "@/lib/format";
import type { GitHubIssueOption, GitHubRepoOption } from "@/lib/types";
import type { RepoState } from "@/lib/useRepo";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/Button";
import { ErrorBanner, LoadingDots } from "@/components/ui/Feedback";
import { Dialog } from "@/components/ui/Dialog";

export function AttachRepoDialog({
  repo,
  onClose,
  onTaskReady,
}: {
  repo: RepoState;
  onClose: () => void;
  onTaskReady: (task: string) => void;
}) {
  const { user } = useAuth();
  const [repos, setRepos] = useState<GitHubRepoOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [issues, setIssues] = useState<GitHubIssueOption[] | null>(null);
  const [issue, setIssue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  const connected = Boolean(user?.github);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    void (async () => {
      try {
        const { repos: list } = await api.githubRepos();
        if (!cancelled) setRepos(list);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not list repositories.");
          setRepos([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected]);

  // Issues are fetched per repository rather than up front — listing issues for
  // every repo a user can push to would be dozens of requests for one answer.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;

    void (async () => {
      // Cleared here rather than in the effect body so the previous repo's
      // issues do not linger under the new selection while this loads.
      setIssues(null);
      setIssue(null);
      try {
        const { issues: list } = await api.githubIssues(selected);
        if (!cancelled) setIssues(list);
      } catch {
        if (!cancelled) setIssues([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const attach = async () => {
    if (!selected) return;
    setAttaching(true);
    setError(null);

    try {
      const task = await repo.attach({
        repo: selected,
        ...(issue === null ? {} : { issue }),
      });
      onClose();
      if (task) onTaskReady(task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not attach the repository.");
      setAttaching(false);
    }
  };

  if (!connected) {
    return (
      <Dialog title="Connect GitHub first" onClose={onClose}>
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Add a GitHub personal access token in Settings, then come back here to
          pick a repository.
        </p>
        <div className="flex justify-end pt-1">
          <Button onClick={onClose}>Close</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Attach a repository" onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}

      <Field label="Repository">
        {repos === null ? (
          <div className="py-2 text-ink-faint">
            <LoadingDots />
          </div>
        ) : repos.length === 0 ? (
          <p className="text-[12px] text-ink-faint">
            No repositories you can push to. Check your token&apos;s scopes.
          </p>
        ) : (
          <Select
            value={selected ?? ""}
            onChange={setSelected}
            placeholder="Choose a repository…"
            options={repos.map((option) => ({
              value: option.fullName,
              label: `${option.fullName}${option.private ? " · private" : ""}`,
            }))}
          />
        )}
      </Field>

      {selected ? (
        <Field
          label="Issue"
          hint="Optional — the agent will use it as the task"
        >
          {issues === null ? (
            <div className="py-2 text-ink-faint">
              <LoadingDots />
            </div>
          ) : issues.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No open issues.</p>
          ) : (
            <Select
              value={issue === null ? "" : String(issue)}
              onChange={(value) => setIssue(value ? Number(value) : null)}
              placeholder="No issue — I'll describe the task myself"
              options={issues.map((option) => ({
                value: String(option.number),
                label: `#${option.number} · ${option.title}`,
              }))}
            />
          )}
        </Field>
      ) : null}

      <p className="text-[11px] leading-relaxed text-ink-faint">
        The repository is checked out fresh in the sandbox on every turn. Your
        edits live in the Durable Object, so nothing is lost when the container
        is torn down.
      </p>

      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose} disabled={attaching}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => void attach()}
          disabled={!selected || attaching}
        >
          {attaching ? "Importing…" : "Attach"}
        </Button>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-soft">{label}</span>
        {hint ? <span className="text-[11px] text-ink-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={classNames(
        "block w-full rounded-lg border border-line bg-canvas px-3 py-2",
        "text-[13px] text-ink outline-none transition-colors",
        "focus:border-accent focus:ring-2 focus:ring-accent/25",
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
