"use client";

/**
 * Line diff between two revisions of a file.
 *
 * Every write is versioned in SQLite, so a review-ready diff is just two rows
 * compared — there is no git repository behind this.
 *
 * The algorithm is a plain longest-common-subsequence, which is fine for the
 * file sizes this workspace holds and keeps the project dependency-free.
 */

import { classNames } from "@/lib/format";

type LineKind = "same" | "added" | "removed";

interface DiffLine {
  kind: LineKind;
  text: string;
  beforeNumber: number | null;
  afterNumber: number | null;
}

/** Guard against pathological inputs — LCS is O(n·m). */
const MAX_LINES = 1_500;

export function FileDiff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after);
  const changed = lines.filter((line) => line.kind !== "same").length;

  if (changed === 0) {
    return (
      <p className="px-3 py-4 text-center text-[12px] text-ink-faint">
        No differences between these revisions.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[12px] leading-relaxed">
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={index}
              className={classNames(
                line.kind === "added" && "bg-positive/10",
                line.kind === "removed" && "bg-negative/10",
              )}
            >
              <td className="w-10 select-none border-r border-line px-1.5 text-right text-ink-faint">
                {line.beforeNumber ?? ""}
              </td>
              <td className="w-10 select-none border-r border-line px-1.5 text-right text-ink-faint">
                {line.afterNumber ?? ""}
              </td>
              <td
                className={classNames(
                  "w-4 select-none px-1 text-center",
                  line.kind === "added" && "text-positive",
                  line.kind === "removed" && "text-negative",
                  line.kind === "same" && "text-ink-faint",
                )}
              >
                {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : ""}
              </td>
              <td className="whitespace-pre-wrap px-2 text-ink-soft">{line.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n").slice(0, MAX_LINES);
  const b = after.split("\n").slice(0, MAX_LINES);

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i], beforeNumber: i + 1, afterNumber: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: "removed", text: a[i], beforeNumber: i + 1, afterNumber: null });
      i++;
    } else {
      lines.push({ kind: "added", text: b[j], beforeNumber: null, afterNumber: j + 1 });
      j++;
    }
  }
  while (i < a.length) {
    lines.push({ kind: "removed", text: a[i], beforeNumber: i + 1, afterNumber: null });
    i++;
  }
  while (j < b.length) {
    lines.push({ kind: "added", text: b[j], beforeNumber: null, afterNumber: j + 1 });
    j++;
  }

  return lines;
}
