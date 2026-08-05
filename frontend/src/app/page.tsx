"use client";

import Link from "next/link";

import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/lib/useAuth";

/* ------------------------------------------------------------------ *
 * Durable Agent — marketing landing page.
 *
 * The app itself lives at /sessions; this is the front door. It shares the
 * app's design tokens (espresso surfaces, coral/clay accent, mono for data)
 * and the global light/dark theme applied on <html>.
 * ------------------------------------------------------------------ */

export default function LandingPage() {
  return (
    <div className="min-h-full bg-canvas text-ink font-sans selection:bg-accent-dim">
      <Nav />
      <main>
        <Hero />
        <ProofBar />
        <ProblemInsight />
        <Features />
        <Tradeoff />
        <Architecture />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/* ================================================================== *
 * Navigation
 * ================================================================== */

function Nav() {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-canvas/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">
            Durable Agent
          </span>
        </a>

        <nav className="hidden items-center gap-8 text-sm text-ink-soft md:flex">
          <a className="transition-colors hover:text-ink" href="#features">
            Features
          </a>
          <a className="transition-colors hover:text-ink" href="#how">
            How it works
          </a>
          <a className="transition-colors hover:text-ink" href="#architecture">
            Architecture
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {/* Signed out, the primary action is to sign up; signed in, it is to
              carry on. Sending everyone to /sessions would just bounce half of
              them through a redirect. */}
          {user ? null : (
            <Link
              href="/login"
              className="hidden h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-hover hover:text-ink sm:inline-flex"
            >
              Sign in
            </Link>
          )}
          <Link
            href={user ? "/sessions" : "/register"}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink shadow-sm shadow-accent/20 transition-colors hover:bg-accent-hover"
          >
            {user ? "Open app" : "Get started"}
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ================================================================== *
 * Hero
 * ================================================================== */

function Hero() {
  const { user } = useAuth();

  return (
    <section id="top" className="relative overflow-hidden">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-[0.4] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      <div
        className="pointer-events-none absolute inset-x-0 -top-40 h-[560px]"
        style={{
          background:
            "radial-gradient(680px 320px at 50% 0, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 70%)",
        }}
      />

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:py-28">
        <div className="rise-in">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/70 px-3 py-1 text-xs text-ink-soft backdrop-blur">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-positive" />
            No VM · no idle bill · state persists
          </span>

          <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.5rem]">
            An AI coding agent with{" "}
            <span className="bg-gradient-to-br from-accent to-caution bg-clip-text text-transparent">
              no machine.
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
            Its files, memory, skills, and schedule are rows in a database. It
            wakes on your message, does the work, and goes back to costing
            nothing — with everything still there tomorrow.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={user ? "/sessions" : "/register"}
              className="group inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-accent-ink shadow-lg shadow-accent/20 transition-colors hover:bg-accent-hover"
            >
              Start a session
              <ArrowIcon className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how"
              className="inline-flex h-11 items-center rounded-lg border border-line bg-panel/60 px-5 text-sm font-medium text-ink backdrop-blur transition-colors hover:border-line-strong hover:bg-hover"
            >
              See the architecture
            </a>
          </div>

          <p className="mt-6 font-mono text-xs text-ink-faint">
            $0.014 / turn · ~2s sandbox boot · $0 between runs
          </p>
        </div>

        <div className="rise-in [animation-delay:120ms]">
          <ProductMock />
        </div>
      </div>
    </section>
  );
}

/** A stylised snapshot of the running app: tool timeline + cost meter. */
function ProductMock() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2rem] bg-accent/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-panel border border-line-strong bg-panel shadow-2xl shadow-black/30 ring-1 ring-white/5">
        {/* window chrome + cost meter */}
        <div className="flex items-center justify-between border-b border-line bg-raised px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-negative/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-caution/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-positive/70" />
            <span className="ml-3 font-mono text-xs text-ink-faint">
              queue-module · session
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="hidden text-ink-faint sm:inline">
              cached <span className="text-info">1,024</span>
            </span>
            <span className="rounded-md bg-accent-dim px-2 py-0.5 text-accent">
              $0.0142
            </span>
          </div>
        </div>

        {/* tool timeline */}
        <div className="space-y-1.5 p-4">
          <ToolRow name="remember" arg="prefers TypeScript, strict mode" ms={9} />
          <ToolRow name="write_file" arg="/src/queue.ts" ms={12} />
          <ToolRow name="write_file" arg="/src/queue.test.ts" ms={11} />
          <ToolRow name="edit_file" arg="/src/queue.ts · +6 −1" ms={8} />
          <ToolRow name="save_skill" arg="build-tested-module" ms={5} />

          {/* memory panel */}
          <div className="mt-4 rounded-lg border border-line bg-raised p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-ink-faint">
              <BrainIcon />
              <span className="uppercase tracking-wide">Memory</span>
              <span className="ml-auto font-mono">3 facts</span>
            </div>
            <ul className="space-y-1.5 text-[13px] text-ink-soft">
              <li className="flex gap-2">
                <span className="text-positive">•</span> Prefers TypeScript with
                strict mode
              </li>
              <li className="flex gap-2">
                <span className="text-positive">•</span> Tests colocated beside
                source
              </li>
              <li className="flex gap-2">
                <span className="text-positive">•</span> Deploys to Cloudflare
                Workers
              </li>
            </ul>
          </div>

          {/* proposals */}
          <div className="mt-3 flex flex-wrap gap-2">
            {["Add benchmarks", "Wire up CI", "Schedule hourly review"].map(
              (p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-ink-soft"
                >
                  <PlusIcon />
                  {p}
                </span>
              ),
            )}
          </div>
        </div>
      </div>

      {/* floating stat chip */}
      <div className="float-y absolute -bottom-5 -left-5 hidden rounded-xl border border-line-strong bg-panel px-4 py-3 shadow-xl shadow-black/30 sm:block">
        <div className="font-mono text-lg font-semibold text-positive">$0.00</div>
        <div className="text-xs text-ink-faint">between runs</div>
      </div>
    </div>
  );
}

function ToolRow({ name, arg, ms }: { name: string; arg: string; ms: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 font-mono text-[13px] hover:bg-hover">
      <CheckIcon />
      <span className="text-accent">{name}</span>
      <span className="truncate text-ink-soft">{arg}</span>
      <span className="ml-auto shrink-0 text-ink-faint">{ms}ms</span>
    </div>
  );
}

/* ================================================================== *
 * Proof bar
 * ================================================================== */

function ProofBar() {
  const stats = [
    { value: "$0.014", label: "per turn", note: "after ~50× cost work" },
    { value: "$0", label: "between runs", note: "nothing idles" },
    { value: "~2s", label: "sandbox boot", note: "then disposed" },
    { value: "0", label: "tool calls", note: "and it already knew you" },
  ];
  return (
    <section className="border-y border-line bg-panel/60">
      <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-line px-5 sm:px-8 md:grid-cols-4 md:divide-y-0 [&>*:nth-child(3)]:border-t [&>*:nth-child(3)]:border-line md:[&>*:nth-child(3)]:border-t-0 [&>*:nth-child(4)]:border-t [&>*:nth-child(4)]:border-line md:[&>*:nth-child(4)]:border-t-0">
        {stats.map((s) => (
          <div key={s.label} className="px-2 py-8 text-center md:py-10">
            <div className="font-mono text-3xl font-semibold text-ink md:text-4xl">
              {s.value}
            </div>
            <div className="mt-1 text-sm font-medium text-ink">{s.label}</div>
            <div className="mt-0.5 text-xs text-ink-faint">{s.note}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ================================================================== *
 * Problem → insight
 * ================================================================== */

function ProblemInsight() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionKicker>The problem</SectionKicker>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            Agent infrastructure is priced on uptime, not work.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-soft">
            Every other coding agent rents a Linux box. A VM per user costs money
            while the agent thinks, while you sleep, and while nobody is using
            it. Persistence means keeping a disk alive.
          </p>

          <SectionKicker className="mt-10">The insight</SectionKicker>
          <p className="mt-4 text-lg leading-relaxed text-ink-soft">
            Put the agent inside a{" "}
            <span className="text-ink">Cloudflare Durable Object</span> — a tiny
            stateful box on the edge with SQLite inside. A file becomes a row.
            Persistence stops being infrastructure and becomes{" "}
            <span className="text-accent">stored data.</span>
          </p>
        </div>

        <div className="rounded-panel border border-line bg-panel p-6 shadow-sm">
          <div className="mb-5 text-sm font-medium text-ink-soft">
            Three things come free that competitors have to build
          </div>
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-2 bg-raised text-xs font-medium uppercase tracking-wide text-ink-faint">
              <div className="px-4 py-2.5">Others must build</div>
              <div className="border-l border-line px-4 py-2.5 text-accent">
                We get from the model
              </div>
            </div>
            {[
              ["Memory", "The object never dies"],
              ["Scheduling", "setAlarm() — one line"],
              ["File history", "Every write is already a row"],
            ].map(([a, b], i) => (
              <div
                key={a}
                className={`grid grid-cols-2 text-sm ${
                  i > 0 ? "border-t border-line" : ""
                }`}
              >
                <div className="px-4 py-3.5 text-ink-soft">{a}</div>
                <div className="border-l border-line px-4 py-3.5 text-ink">
                  {b}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== *
 * Features
 * ================================================================== */

const FEATURES = [
  {
    icon: <BrainIcon />,
    title: "Persistent memory",
    body: "Learns your preferences, carries them into every future session, and corrects itself when proven wrong.",
  },
  {
    icon: <SkillIcon />,
    title: "Reusable skills",
    body: "Works a procedure out once, then replays it forever. A hundred skills cost almost nothing in context.",
  },
  {
    icon: <ClockIcon />,
    title: "Background agents",
    body: "Wakes itself on a schedule via a Durable Object alarm, works with nobody watching, and sleeps at zero cost.",
  },
  {
    icon: <SparkIcon />,
    title: "Proactive proposals",
    body: "Ends every turn with up to three concrete next steps — one click each. It doesn't wait for your next prompt.",
  },
  {
    icon: <DiffIcon />,
    title: "Versioned workspace",
    body: "Every write is a new revision. Review-ready diffs between any two versions, with no git repository behind them.",
  },
  {
    icon: <TerminalIcon />,
    title: "Optional real shell",
    body: "Rents Linux for the seconds a command takes — install packages, run tests — then tears it down. Off by default.",
  },
];

function Features() {
  return (
    <section id="features" className="border-t border-line bg-panel/40">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <SectionKicker>What it does</SectionKicker>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight">
          Six features that fall out of the storage model.
        </h2>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-panel border border-line bg-panel p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg hover:shadow-black/10"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-dim text-accent transition-colors group-hover:bg-accent group-hover:text-accent-ink">
                {f.icon}
              </div>
              <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================================================================== *
 * Honest tradeoff
 * ================================================================== */

function Tradeoff() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
      <div className="relative overflow-hidden rounded-panel border border-line bg-panel p-8 shadow-sm sm:p-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(520px 260px at 100% 0%, color-mix(in oklab, var(--color-accent) 16%, transparent), transparent 70%)",
          }}
        />
        <div className="relative max-w-2xl">
          <SectionKicker>The honest tradeoff</SectionKicker>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            No shell by default. The agent can only do what we built a method
            for.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink-soft">
            That sounds limiting. It means{" "}
            <span className="text-ink">nothing boots</span>,{" "}
            <span className="text-ink">nothing idles</span>, and the bill matches
            the work. Adding a capability means adding a tool, not handing over a
            shell — a wrong guess fails loudly instead of silently corrupting a
            file.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== *
 * Architecture
 * ================================================================== */

const OBJECTS = [
  { name: "AgentSession", scope: "per session", holds: "conversation + loop" },
  { name: "Workspace", scope: "per session", holds: "files + revisions" },
  { name: "Brain", scope: "global", holds: "memory + skills" },
  { name: "Scheduler", scope: "global", holds: "alarms + run history" },
  { name: "Registry", scope: "global", holds: "session index" },
];

function Architecture() {
  return (
    <section id="architecture" className="border-t border-line bg-panel/40">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <div className="max-w-2xl">
          <SectionKicker>Architecture</SectionKicker>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">
            A stateless Worker in front of five Durable Objects.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-soft">
            Each object owns exactly one thing. The filesystem is a table:{" "}
            <span className="font-mono text-sm text-accent">
              files(path, content, version)
            </span>
            . Every write bumps the version and appends a revision — the
            workspace carries its own history, no git server, no attached disk.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {OBJECTS.map((o) => (
            <div
              key={o.name}
              className="rounded-panel border border-line bg-panel p-4 transition-colors hover:border-line-strong"
            >
              <div className="font-mono text-sm font-semibold text-ink">
                {o.name}
                <span className="text-ink-faint">DO</span>
              </div>
              <div
                className={`mt-2 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                  o.scope === "global"
                    ? "bg-accent-dim text-accent"
                    : "bg-raised text-ink-soft"
                }`}
              >
                {o.scope}
              </div>
              <div className="mt-2.5 text-xs leading-relaxed text-ink-soft">
                {o.holds}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-panel border border-line bg-canvas p-5 font-mono text-xs leading-relaxed text-ink-soft shadow-inner">
          <div className="text-ink-faint"># the filesystem is a database</div>
          <div className="mt-2">
            <span className="text-info">files</span>
            {"     "}(path <span className="text-accent">PRIMARY KEY</span>,
            content, size, version)
          </div>
          <div>
            <span className="text-info">revisions</span> (id, path, version,
            content, summary, created_at)
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== *
 * Final CTA
 * ================================================================== */

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
      <div className="relative overflow-hidden rounded-panel border border-line-strong bg-raised p-10 text-center shadow-lg shadow-black/10 sm:p-16">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-[0.35]" />
        <div
          className="pointer-events-none absolute inset-x-0 -top-24 h-64"
          style={{
            background:
              "radial-gradient(500px 200px at 50% 0, color-mix(in oklab, var(--color-accent) 18%, transparent), transparent 70%)",
          }}
        />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Stop paying for an agent that&apos;s asleep.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">
            Open a session, teach it something, and watch it remember across an
            empty new workspace — zero tool calls, and it already knew.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/sessions"
              className="group inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-6 text-sm font-medium text-accent-ink shadow-lg shadow-accent/20 transition-colors hover:bg-accent-hover"
            >
              Open the app
              <ArrowIcon className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="https://github.com/qaml-ai/camelAI"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center rounded-lg border border-line bg-panel px-6 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-hover"
            >
              Read the writeup
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-ink-faint sm:flex-row sm:px-8">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span>Durable Agent</span>
        </div>
        <div className="font-mono text-xs">
          files · memory · skills · schedule — all rows in a database
        </div>
      </div>
    </footer>
  );
}

/* ================================================================== *
 * Bits
 * ================================================================== */

function SectionKicker({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent ${className}`}
    >
      <span className="h-px w-6 bg-accent/60" />
      {children}
    </div>
  );
}

/* ---- icons (inline, currentColor) -------------------------------- */

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-ink shadow-sm shadow-accent/30">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="4" width="18" height="6" rx="2" fill="currentColor" />
        <rect
          x="3"
          y="14"
          width="18"
          height="6"
          rx="2"
          fill="currentColor"
          opacity="0.55"
        />
      </svg>
    </span>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      {...stroke}
      className={className}
      aria-hidden
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      {...stroke}
      className="shrink-0 text-positive"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function BrainIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8V19a2 2 0 0 0 4 0V6a3 3 0 0 0-4-3z" />
      <path d="M15 3a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V16a3 3 0 0 1-4 2.8" />
    </svg>
  );
}
function SkillIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4z" />
    </svg>
  );
}
function DiffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M12 3v6M9 6h6M6 21h12M9 15h6" />
    </svg>
  );
}
function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  );
}
