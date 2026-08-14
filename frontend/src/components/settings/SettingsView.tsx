"use client";

/**
 * Account settings.
 *
 * Three things live here, in the order people need them: who you are, what a
 * new session starts as, and what all of this has cost. The defaults section is
 * the one that saves money — it decides which model every new session opens
 * with, and on an agentic loop that choice compounds.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { classNames } from "@/lib/format";
import type { AccountUsage, ModelOption } from "@/lib/types";
import { useAuth } from "@/lib/useAuth";
import { useLeftPanel } from "@/components/layout/AppShell";
import { Button, IconButton } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/Feedback";
import { PanelIcon } from "@/components/ui/icons";

export function SettingsView() {
  const { user, setUser } = useAuth();
  const { toggle } = useLeftPanel();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [efforts, setEfforts] = useState<string[]>([]);
  const [usage, setUsage] = useState<AccountUsage | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Both are read-only and independent, so one slow call does not hold up
      // the other. Failures leave the section empty rather than blocking the page.
      const [catalogue, totals] = await Promise.all([
        api.models().catch(() => null),
        api.usage().catch(() => null),
      ]);
      if (cancelled) return;
      if (catalogue) {
        setModels(catalogue.models);
        setEfforts(catalogue.efforts);
      }
      if (totals) setUsage(totals);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex h-13 shrink-0 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur sm:px-4">
        <IconButton label="Toggle sessions" onClick={toggle} className="lg:hidden">
          <PanelIcon className="h-4 w-4" />
        </IconButton>
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">
          Settings
        </h1>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
        <ProfileSection
          name={user.name}
          email={user.email}
          plan={user.plan}
          creditsUsd={user.creditsUsd}
          onSaved={setUser}
        />
        <DefaultsSection
          models={models}
          efforts={efforts}
          defaultModel={user.settings.defaultModel}
          defaultEffort={user.settings.defaultEffort}
          onSaved={setUser}
        />
        <GitHubSection onSaved={setUser} />
        <UsageSection usage={usage} />
        <PasswordSection />
      </div>
    </div>
  );
}

// --------------------------------------------------------------- profile

function ProfileSection({
  name: initialName,
  email,
  plan,
  creditsUsd,
  onSaved,
}: {
  name: string;
  email: string;
  plan: string;
  creditsUsd: number;
  onSaved: (user: Awaited<ReturnType<typeof api.updateProfile>>) => void;
}) {
  const [name, setName] = useState(initialName);
  const form = useSaveState();

  const save = async () => {
    await form.run(async () => onSaved(await api.updateProfile({ name })));
  };

  return (
    <Section
      title="Profile"
      description="How the agent addresses you, and where your account lives."
    >
      <Row label="Name">
        <TextInput value={name} onChange={setName} />
      </Row>
      <Row label="Email">
        <p className="text-[13px] text-ink-soft">{email}</p>
      </Row>
      <Row label="Plan">
        <span className="inline-flex items-center rounded-md border border-line bg-raised px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-soft">
          {plan}
        </span>
      </Row>
      <Row label="Credits">
        <div className="flex items-baseline gap-2">
          <span
            className={classNames(
              "font-mono text-[14px]",
              creditsUsd <= 0
                ? "text-negative"
                : creditsUsd < 0.25
                  ? "text-caution"
                  : "text-ink",
            )}
          >
            ${creditsUsd.toFixed(4)}
          </span>
          <span className="text-[11px] text-ink-faint">
            {creditsUsd <= 0
              ? "spent — turns are paused"
              : "remaining"}
          </span>
        </div>
      </Row>
      <SaveRow
        state={form}
        disabled={!name.trim() || name === initialName}
        onSave={save}
      />
    </Section>
  );
}

// -------------------------------------------------------------- defaults

function DefaultsSection({
  models,
  efforts,
  defaultModel,
  defaultEffort,
  onSaved,
}: {
  models: ModelOption[];
  efforts: string[];
  defaultModel: string;
  defaultEffort: string;
  onSaved: (user: Awaited<ReturnType<typeof api.updateProfile>>) => void;
}) {
  const [model, setModel] = useState(defaultModel);
  const [effort, setEffort] = useState(defaultEffort);
  const form = useSaveState();

  const save = async () => {
    await form.run(async () =>
      onSaved(
        await api.updateProfile({
          settings: { defaultModel: model, defaultEffort: effort },
        }),
      ),
    );
  };

  const selected = models.find((option) => option.id === model);

  return (
    <Section
      title="Session defaults"
      description="What every new session starts on. Existing sessions keep their own setting."
    >
      <Row label="Model">
        <Select
          value={model}
          onChange={setModel}
          options={models.map((option) => ({
            value: option.id,
            label: `${option.label} · ${option.tier}`,
          }))}
        />
      </Row>

      {selected ? (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          ${selected.inputPerMTok}/M in · ${selected.outputPerMTok}/M out.{" "}
          {selected.tier === "cheapest"
            ? "The right choice while you are still building."
            : "Worth it when the reasoning matters more than the bill."}
        </p>
      ) : null}

      <Row label="Effort">
        <Select
          value={effort}
          onChange={setEffort}
          options={efforts.map((value) => ({ value, label: value }))}
        />
      </Row>

      <SaveRow
        state={form}
        disabled={model === defaultModel && effort === defaultEffort}
        onSave={save}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- github

function GitHubSection({
  onSaved,
}: {
  onSaved: (user: Awaited<ReturnType<typeof api.updateProfile>>) => void;
}) {
  const { user } = useAuth();
  const [token, setToken] = useState("");
  const form = useSaveState();

  const connection = user?.github ?? null;

  const connect = async () => {
    await form.run(async () => {
      onSaved(await api.connectGitHub(token.trim()));
      setToken("");
    });
  };

  const disconnect = async () => {
    await form.run(async () => onSaved(await api.disconnectGitHub()));
  };

  if (connection) {
    return (
      <Section
        title="GitHub"
        description="Lets the agent check out a repository, work on an issue, and open a pull request."
      >
        <Row label="Account">
          <p className="font-mono text-[13px] text-ink">{connection.login}</p>
        </Row>
        <Row label="Scopes">
          <p className="font-mono text-[12px] text-ink-faint">
            {connection.scopes.length > 0
              ? connection.scopes.join(", ")
              : "fine-grained token"}
          </p>
        </Row>
        {form.error ? <ErrorBanner message={form.error} /> : null}
        <div className="pt-1">
          <Button
            variant="danger"
            size="sm"
            disabled={form.saving}
            onClick={() => void disconnect()}
          >
            {form.saving ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="GitHub"
      description="Lets the agent check out a repository, work on an issue, and open a pull request."
    >
      <Row label="Token">
        <TextInput
          type="password"
          autoComplete="off"
          value={token}
          onChange={setToken}
        />
      </Row>
      <p className="text-[12px] leading-relaxed text-ink-faint">
        A personal access token with <span className="font-mono">repo</span>{" "}
        access. Create one at{" "}
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent hover:text-accent-hover"
        >
          github.com/settings/tokens
        </a>
        . It is stored on your account so the agent can act as you, and is never
        sent back to this page.
      </p>
      <SaveRow
        state={form}
        label="Connect"
        savedLabel="Connected"
        disabled={token.trim().length < 20}
        onSave={connect}
      />
    </Section>
  );
}

// ----------------------------------------------------------------- usage

function UsageSection({ usage }: { usage: AccountUsage | null }) {
  return (
    <Section
      title="Usage"
      description="Everything this account has spent, across every session — including background runs."
    >
      {usage ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Turns" value={usage.turns.toLocaleString()} />
          <Stat label="Input" value={compact(usage.inputTokens)} />
          <Stat label="Output" value={compact(usage.outputTokens)} />
          <Stat
            label="Estimated"
            value={`$${usage.estimatedCostUsd.toFixed(4)}`}
            accent
          />
        </dl>
      ) : (
        <p className="text-[13px] text-ink-faint">No usage recorded yet.</p>
      )}
    </Section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-raised px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </dt>
      <dd
        className={classNames(
          "mt-1 font-mono text-[15px]",
          accent ? "text-accent" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// -------------------------------------------------------------- password

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const form = useSaveState();

  const save = async () => {
    await form.run(async () => {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
    });
  };

  return (
    <Section title="Password" description="Changing it does not sign you out.">
      <Row label="Current">
        <TextInput
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
      </Row>
      <Row label="New">
        <TextInput
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
        />
      </Row>
      <SaveRow
        state={form}
        label="Change password"
        savedLabel="Password changed"
        disabled={!currentPassword || newPassword.length < 8}
        onSave={save}
      />
    </Section>
  );
}

// ------------------------------------------------------------- primitives

/**
 * Shared save/error/confirmation state.
 *
 * Every section needs the same three things, and the confirmation clears itself
 * so a stale "Saved" never lingers next to unsaved edits.
 */
function useSaveState() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return { saving, saved, error, run };
}

function SaveRow({
  state,
  disabled,
  onSave,
  label = "Save",
  savedLabel = "Saved",
}: {
  state: ReturnType<typeof useSaveState>;
  disabled: boolean;
  onSave: () => void | Promise<void>;
  label?: string;
  savedLabel?: string;
}) {
  return (
    <>
      {state.error ? <ErrorBanner message={state.error} /> : null}
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="primary"
          size="sm"
          disabled={disabled || state.saving}
          onClick={() => void onSave()}
        >
          {state.saving ? "Saving…" : label}
        </Button>
        {state.saved ? (
          <span className="text-[12px] text-positive">{savedLabel}</span>
        ) : null}
      </div>
    </>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-panel p-5">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-24 shrink-0 text-[13px] text-ink-soft">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <input
      type={type}
      autoComplete={autoComplete}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={classNames(
        "block w-full rounded-lg border border-line bg-raised px-3 py-2",
        "text-[13px] text-ink placeholder:text-ink-faint outline-none transition-colors",
        "focus:border-accent focus:ring-2 focus:ring-accent/25",
      )}
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={classNames(
        "block w-full rounded-lg border border-line bg-raised px-3 py-2",
        "text-[13px] text-ink outline-none transition-colors",
        "focus:border-accent focus:ring-2 focus:ring-accent/25",
      )}
    >
      {options.length === 0 ? <option value={value}>{value}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** 1_240_000 → "1.24M". Token counts are unreadable in full. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
