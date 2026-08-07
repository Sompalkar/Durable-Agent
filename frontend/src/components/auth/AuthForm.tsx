"use client";

/**
 * The sign-in and sign-up form.
 *
 * One component for both, because they differ by exactly one field and one
 * label — two near-identical files would drift apart the first time either was
 * touched.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Feedback";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { classNames } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";

type Mode = "login" | "register";

const COPY = {
  login: {
    title: "Welcome back",
    subtitle: "Sign in to pick up where your agent left off.",
    submit: "Sign in",
    pending: "Signing in…",
    switchText: "New here?",
    switchLabel: "Create an account",
    switchHref: "/register",
  },
  register: {
    title: "Create your account",
    subtitle: "Your sessions, memory, and skills stay with you.",
    submit: "Create account",
    pending: "Creating account…",
    switchText: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/login",
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signUp } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Where to land afterwards. Set by the guard when it bounced you here, so
  // signing in returns you to the page you actually wanted.
  const next = searchParams.get("next") ?? "/sessions";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      if (mode === "login") {
        await signIn({ email, password });
      } else {
        await signUp({ email, password, name: name.trim() || undefined });
      }
      // `replace`, not `push`: the form should not be in the back history once
      // it has served its purpose.
      router.replace(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Something went wrong.",
      );
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-5 py-12">
      <div className="w-full max-w-[25rem]">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="text-[15px] font-semibold tracking-tight text-ink">
              Durable Agent
            </span>
          </Link>
          <ThemeToggle />
        </div>

        <div className="rounded-2xl border border-line bg-panel p-6 shadow-sm sm:p-7">
          <h1 className="text-[21px] font-semibold tracking-tight text-ink">
            {copy.title}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
            {copy.subtitle}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {mode === "register" ? (
              <Field
                label="Name"
                hint="Optional"
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={setName}
              />
            ) : null}

            <Field
              label="Email"
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={setEmail}
            />

            <Field
              label="Password"
              hint={mode === "register" ? "At least 8 characters" : undefined}
              id="password"
              type="password"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              placeholder="••••••••"
              required
              minLength={mode === "register" ? 8 : undefined}
              value={password}
              onChange={setPassword}
            />

            {error ? <ErrorBanner message={error} /> : null}

            <Button
              type="submit"
              variant="primary"
              disabled={pending}
              className="w-full"
            >
              {pending ? copy.pending : copy.submit}
            </Button>
          </form>

          <p className="mt-5 text-center text-[13px] text-ink-faint">
            {copy.switchText}{" "}
            <Link
              href={copy.switchHref}
              className="font-medium text-accent hover:text-accent-hover"
            >
              {copy.switchLabel}
            </Link>
          </p>
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-ink-faint">
          <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
          Your sessions run on Durable Objects. Nothing runs between messages.
        </p>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  id: string;
  type: string;
  autoComplete: string;
  placeholder: string;
  required?: boolean;
  minLength?: number;
  value: string;
  onChange: (value: string) => void;
}

function Field({ label, hint, id, value, onChange, ...input }: FieldProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">
          {label}
        </label>
        {hint ? (
          <span className="text-[11px] text-ink-faint">{hint}</span>
        ) : null}
      </div>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={classNames(
          "block w-full rounded-lg border border-line bg-canvas px-3 py-2.5",
          "text-[14px] text-ink placeholder:text-ink-faint",
          "transition-colors outline-none",
          "focus:border-accent focus:ring-2 focus:ring-accent/25",
        )}
        {...input}
      />
    </div>
  );
}

/** The logomark, matching the sidebar's. */
function Mark() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
        <rect x="2" y="3" width="12" height="2.4" rx="1.2" fill="currentColor" />
        <rect
          x="2"
          y="6.8"
          width="12"
          height="2.4"
          rx="1.2"
          fill="currentColor"
          opacity="0.65"
        />
        <rect
          x="2"
          y="10.6"
          width="12"
          height="2.4"
          rx="1.2"
          fill="currentColor"
          opacity="0.35"
        />
      </svg>
    </span>
  );
}
