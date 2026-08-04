"use client";

import { classNames } from "@/lib/format";
import { useTheme } from "@/lib/theme";

/**
 * Light/dark switch. Two variants: `icon` (a single square button, for tight
 * toolbars) and `segmented` (a labelled pill, for the sidebar footer).
 */
export function ThemeToggle({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "segmented";
  className?: string;
}) {
  const { theme, setTheme, toggle } = useTheme();

  if (variant === "segmented") {
    return (
      <div
        className={classNames(
          "flex rounded-lg border border-line bg-raised p-0.5",
          className,
        )}
      >
        {(
          [
            ["light", "Light", <SunIcon key="s" />],
            ["dark", "Dark", <MoonIcon key="m" />],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className={classNames(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              theme === value
                ? "bg-panel text-ink shadow-sm"
                : "text-ink-faint hover:text-ink-soft",
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className={classNames(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
