import { classNames } from "@/lib/format";
import { AlertIcon } from "./icons";

/** Centred placeholder used when a panel has nothing to show yet. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-12 text-center sm:px-8">
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-dim text-accent">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-[13px] leading-relaxed text-ink-faint">
          {description}
        </p>
      ) : null}
      {/* Full width so an action can lay itself out in columns; the centred
          text above keeps its own narrower measure. */}
      {action ? <div className="w-full pt-1">{action}</div> : null}
    </div>
  );
}

/** Inline error banner. Dismissible when `onDismiss` is provided. */
export function ErrorBanner({
  message,
  onDismiss,
  className,
}: {
  message: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={classNames(
        "flex items-start gap-2.5 rounded-lg border border-negative/30 bg-negative/10 px-3 py-2.5",
        className,
      )}
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-negative" />
      <p className="flex-1 text-xs leading-relaxed text-negative">{message}</p>
      {onDismiss ? (
        <button
          onClick={onDismiss}
          className="text-xs font-medium text-negative/70 hover:text-negative"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

/** Three-dot loading indicator, used while a turn is starting. */
export function LoadingDots({ className }: { className?: string }) {
  return (
    <span className={classNames("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="pulse-dot h-1.5 w-1.5 rounded-full bg-current"
          style={{ animationDelay: `${index * 160}ms` }}
        />
      ))}
    </span>
  );
}

/** Small label for counts and statuses. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "positive" | "negative";
}) {
  const tones = {
    neutral: "bg-raised text-ink-soft border-line",
    accent: "bg-accent/10 text-accent border-accent/25",
    positive: "bg-positive/10 text-positive border-positive/25",
    negative: "bg-negative/10 text-negative border-negative/25",
  } as const;

  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] leading-none",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
