"use client";

/**
 * The before-and-after for one file about to go into a pull request.
 *
 * The "before" is not stored separately anywhere — it is simply an older
 * revision of the same row. Every write to the workspace appends one, so the
 * baseline for a repository file is whichever revision was written by the
 * import, and the diff is free.
 *
 * A file the agent created has no import revision, so its baseline is empty and
 * the whole thing renders as an addition. That is the truth, not a special case.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FileDiff } from "@/components/workspace/FileDiff";
import { ErrorBanner, LoadingDots } from "@/components/ui/Feedback";

/** Written by the import, and therefore the baseline for a repository file. */
const IMPORT_SUMMARY = "imported from GitHub";

export function ChangedFileDiff({
  sessionId,
  path,
  against = "import",
}: {
  sessionId: string;
  path: string;
  /**
   * Which revision counts as "before".
   *
   * `import` compares against what GitHub gave us, which is what a pull request
   * reviewer sees. `previous` compares against the revision immediately before
   * the current one — the right baseline for "what did this one edit change",
   * where the import is several edits ago and not the question being asked.
   */
  against?: "import" | "previous";
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; before: string; after: string }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [{ file }, { revisions }] = await Promise.all([
          api.readFile(sessionId, path),
          api.fileHistory(sessionId, path),
        ]);

        const baseline =
          against === "import"
            ? revisions.find((entry) => entry.summary === IMPORT_SUMMARY)
            : // Highest version below the current one. A brand-new file has none,
              // which correctly renders as an addition.
              revisions
                .filter((entry) => entry.version < file.version)
                .sort((a, b) => b.version - a.version)[0];

        const before = baseline
          ? (await api.fileRevision(sessionId, path, baseline.version)).revision.content
          : "";

        if (!cancelled) setState({ status: "ready", before, after: file.content });
      } catch (cause) {
        if (!cancelled) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Could not load the diff.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, path, against]);

  if (state.status === "loading") {
    return (
      <div className="flex justify-center py-3 text-ink-faint">
        <LoadingDots />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="py-2">
        <ErrorBanner message={state.message} />
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-canvas">
      {state.before === "" ? (
        <p className="border-b border-line px-3 py-1.5 text-[11px] text-positive">
          New file
        </p>
      ) : null}
      <FileDiff before={state.before} after={state.after} />
    </div>
  );
}
