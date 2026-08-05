"use client";

/**
 * File tree.
 *
 * Rows come back from the API as a flat list of absolute paths — the shape they
 * have in SQLite. This builds the nested view from those paths at render time,
 * so nothing hierarchical has to be stored.
 */

import { useMemo } from "react";
import { classNames, formatBytes } from "@/lib/format";
import type { FileRecord } from "@/lib/types";
import { FileIcon, FolderIcon } from "@/components/ui/icons";

interface TreeNode {
  name: string;
  path: string;
  depth: number;
  kind: "file" | "directory";
  file?: FileRecord;
}

export function FileTree({
  files,
  activePath,
  onSelect,
}: {
  files: FileRecord[];
  activePath?: string;
  onSelect: (path: string) => void;
}) {
  const nodes = useMemo(() => buildTree(files), [files]);

  return (
    <ul className="py-1">
      {nodes.map((node) =>
        node.kind === "directory" ? (
          <li
            key={node.path}
            className="flex items-center gap-1.5 px-2 py-1 text-ink-faint"
            style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
          >
            <FolderIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono text-[12px]">{node.name}</span>
          </li>
        ) : (
          <li key={node.path}>
            <button
              onClick={() => onSelect(node.path)}
              style={{ paddingLeft: `${node.depth * 12 + 8}px` }}
              className={classNames(
                "flex w-full items-center gap-1.5 py-1 pr-2 text-left transition-colors",
                node.path === activePath
                  ? "bg-raised text-ink"
                  : "text-ink-soft hover:bg-hover hover:text-ink",
              )}
            >
              <FileIcon className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {node.name}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                {formatBytes(node.file?.size ?? 0)}
              </span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

/** Flatten absolute paths into a depth-annotated, alphabetically ordered list. */
function buildTree(files: FileRecord[]): TreeNode[] {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const nodes: TreeNode[] = [];
  const seenDirectories = new Set<string>();

  for (const file of sorted) {
    const segments = file.path.split("/").filter(Boolean);

    // Emit any parent directories that have not been printed yet.
    for (let depth = 0; depth < segments.length - 1; depth++) {
      const directoryPath = `/${segments.slice(0, depth + 1).join("/")}`;
      if (seenDirectories.has(directoryPath)) continue;
      seenDirectories.add(directoryPath);
      nodes.push({
        name: segments[depth],
        path: directoryPath,
        depth,
        kind: "directory",
      });
    }

    nodes.push({
      name: segments[segments.length - 1],
      path: file.path,
      depth: segments.length - 1,
      kind: "file",
      file,
    });
  }

  return nodes;
}
