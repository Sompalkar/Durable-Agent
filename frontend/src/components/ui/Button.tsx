import { classNames } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  // Maximum contrast rather than the accent, matching the landing page. Colour
  // is spent on the agent's own marks and on live state; the primary action
  // earns its weight from contrast, which reads as more certain than a hue.
  primary:
    "bg-ink text-canvas hover:opacity-90 disabled:bg-raised disabled:text-ink-faint disabled:opacity-100",
  secondary:
    "bg-raised text-ink border border-line hover:bg-hover hover:border-line-strong",
  ghost: "text-ink-soft hover:text-ink hover:bg-hover",
  danger: "text-negative hover:bg-negative/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={classNames(
        "inline-flex items-center justify-center rounded-lg font-medium",
        "transition-colors duration-150 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
}

/** Square icon-only button. `label` is required so it always has an a11y name. */
export function IconButton({
  label,
  variant = "ghost",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={classNames(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
