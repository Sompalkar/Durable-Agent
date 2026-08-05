/** Small presentation helpers shared across components. */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Compact relative time, in either direction — "just now", "4m ago", "in 3h".
 *
 * Scheduled runs are in the future, so a past-only formatter would render every
 * upcoming firing as "just now".
 */
export function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.floor((Date.now() - timestamp) / 1000);
  const past = deltaSeconds >= 0;
  const seconds = Math.abs(deltaSeconds);

  if (seconds < 45) return "just now";

  const magnitude = describeDuration(seconds);
  return past ? `${magnitude} ago` : `in ${magnitude}`;
}

/** Bare duration, without a direction — "4m", "3h", "2d". */
export function describeDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Language hint for a file path, used to label the viewer. */
export function languageForPath(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    json: "JSON",
    md: "Markdown",
    css: "CSS",
    html: "HTML",
    py: "Python",
    sql: "SQL",
    yml: "YAML",
    yaml: "YAML",
    sh: "Shell",
    txt: "Text",
  };
  return map[extension] ?? "Plain text";
}

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
