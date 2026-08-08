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
 *
 * The pitch is the split runtime: a real Linux sandbox for execution, Durable
 * Object SQLite for everything that has to outlive it. Leading with either half
 * alone misrepresents the product — the sandbox sounds ordinary without the
 * persistence, and the persistence sounds toy-like without the sandbox.
 * ------------------------------------------------------------------ */

export default function LandingPage() {
  return (
    <div className="min-h-full bg-canvas text-ink font-sans selection:bg-accent-dim">
      <Nav />
      <main>
        <Hero />
        <ProofBar />
        <TwoRuntimes />
        <Features />
        <CloudLoop />
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
          <a className="transition-colors hover:text-ink" href="#cloud">
            Cloud loop
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
            Runs in the cloud · real sandbox · state that outlives it
          </span>

          <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.5rem]">
            A cloud coding agent that{" "}
            <span className="bg-gradient-to-br from-accent to-caution bg-clip-text text-transparent">
              never loses its place.
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
            It runs on Cloudflare, boots a real Linux sandbox when there is
            something to execute, and keeps every file, memory, and skill in
            SQLite that outlives the container. Close the tab — the turn keeps
            going, and tomorrow it still knows you.
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
              See how it works
            </a>
          </div>

          <p className="mt-6 font-mono text-xs text-ink-faint">
            $0.014 / turn · ~2s sandbox boot · state survives the container
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
          <ToolRow name="edit_file" arg="/src/queue.ts · +6 −1" ms={8} />

          {/* The sandbox half, streaming. A reader assumes this is missing the
              moment the pitch mentions storing state in a database. */}
          <div className="mt-2 overflow-hidden rounded-lg border border-line bg-canvas">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 font-mono text-[12px]">
              <span className="text-accent">$</span>
              <span className="text-ink-soft">npm test</span>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-positive">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-positive" />
                live
              </span>
            </div>
            <pre className="px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-faint">
              {"PASS  src/queue.test.ts\nTests:  7 passed, 7 total"}
            </pre>
          </div>

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
    { value: "~2s", label: "sandbox boot", note: "real Linux, then disposed" },
    { value: "$0.014", label: "per turn", note: "after ~50× cost work" },
    { value: "$0", label: "between runs", note: "state costs nothing idle" },
    { value: "1", label: "click to a PR", note: "the agent opens it" },
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
 * The two runtimes
 * ================================================================== */

const PLANES = [
  {
    kicker: "Execution",
    name: "Linux sandbox",
    tag: "rented by the second",
    lead: "Where things actually run.",
    body: "A real container with a real shell. Install dependencies, run the test suite, read the exit code. It boots in about two seconds, streams its output to the browser line by line while it works, and is torn down when the turn ends.",
    points: [
      "npm install, pytest, tsc — whatever the repo needs",
      "Output streams live; no waiting for the command to finish",
      "Exit codes are recorded, so a pull request can prove it is green",
    ],
    icon: <TerminalIcon />,
    accent: false,
  },
  {
    kicker: "State",
    name: "Durable Object SQLite",
    tag: "outlives every container",
    lead: "Where things are remembered.",
    body: "Files, revisions, memory, skills and schedules are rows in SQLite that sits with the agent at the edge. The sandbox can be thrown away precisely because nothing important was ever kept inside it.",
    points: [
      "Every write is a new revision — diffs without a git server",
      "What it learns about you survives into an empty new workspace",
      "It can wake itself later; the state is already there",
    ],
    icon: <DatabaseIcon />,
    accent: true,
  },
];

function TwoRuntimes() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
      <div className="max-w-2xl">
        <SectionKicker>How it works</SectionKicker>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">
          Two runtimes, split along the line that matters.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">
          Most cloud agents put execution and state in the same box. It works
          until the box goes away — and the box always goes away. This one keeps
          the disposable part disposable and the durable part durable.
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        {PLANES.map((plane) => (
          <div
            key={plane.name}
            className={`relative overflow-hidden rounded-panel border bg-panel p-7 shadow-sm transition-colors ${
              plane.accent
                ? "border-accent/40"
                : "border-line hover:border-line-strong"
            }`}
          >
            {plane.accent ? (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(420px 200px at 100% 0%, color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 70%)",
                }}
              />
            ) : null}

            <div className="relative">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                    plane.accent
                      ? "bg-accent text-accent-ink"
                      : "bg-accent-dim text-accent"
                  }`}
                >
                  {plane.icon}
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                    {plane.kicker}
                  </div>
                  <div className="font-mono text-sm font-semibold text-ink">
                    {plane.name}
                  </div>
                </div>
                <span className="ml-auto rounded-md bg-raised px-2 py-1 text-[11px] text-ink-soft">
                  {plane.tag}
                </span>
              </div>

              <p className="mt-5 text-base font-medium text-ink">{plane.lead}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {plane.body}
              </p>

              <ul className="mt-5 space-y-2 border-t border-line pt-5">
                {plane.points.map((point) => (
                  <li
                    key={point}
                    className="flex gap-2.5 text-[13px] leading-relaxed text-ink-soft"
                  >
                    <CheckIcon />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {/* The consequence of the split, stated plainly — this is the part that is
          hard to retrofit, so it is worth naming rather than implying. */}
      <div className="mt-4 rounded-panel border border-line bg-panel/60 px-6 py-5">
        <p className="text-[15px] leading-relaxed text-ink-soft">
          <span className="text-ink">The consequence:</span> a container dying
          mid-run costs you a container, not the work. The next turn — minutes or
          days later, with you watching or not — starts from the same files,
          the same history, and the same notes it took about your codebase.
        </p>
      </div>
    </section>
  );
}

/* ================================================================== *
 * Features
 * ================================================================== */

const FEATURES = [
  {
    icon: <TerminalIcon />,
    title: "Real Linux sandbox",
    body: "Install packages, run the test suite, read the exit code. Rented for the seconds a command takes, then torn down.",
  },
  {
    icon: <StreamIcon />,
    title: "Live command output",
    body: "The sandbox has no streaming API, so commands run detached and their log is tailed. Output reaches you as it happens.",
  },
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
    body: "Wakes itself on a schedule, works with nobody watching, and goes back to sleep at zero cost.",
  },
  {
    icon: <BranchIcon />,
    title: "Issue to pull request",
    body: "Pick a GitHub issue and it works the whole way to an open PR — branch, commit, and a body citing every command it ran.",
  },
  {
    icon: <ReviewIcon />,
    title: "Review-thread loop",
    body: "After the PR is open it keeps checking review comments, addresses them, and pushes again without being asked.",
  },
  {
    icon: <DiffIcon />,
    title: "Versioned workspace",
    body: "Every write is a new revision, so a review-ready diff between any two versions is just two rows compared.",
  },
  {
    icon: <RouteIcon />,
    title: "Per-step model routing",
    body: "Cheap model for the easy steps, escalating to a stronger one the moment a tool call fails. Priced per model, per step.",
  },
];

function Features() {
  return (
    <section id="features" className="border-t border-line bg-panel/40">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <SectionKicker>What it does</SectionKicker>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight">
          Everything a cloud agent needs, and the state to back it.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">
          The first two come from the sandbox. The rest come from having somewhere
          durable to put things — which is why they were cheap to build instead of
          being a roadmap.
        </p>

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
 * The cloud loop
 * ================================================================== */

const LOOP = [
  {
    step: "01",
    title: "Attach a repository",
    body: "Pulled as a single tarball and unpacked into SQLite — one request, not one per file. Pick an open issue and it becomes the task.",
  },
  {
    step: "02",
    title: "It works, you watch",
    body: "Reads, plans, edits. Every tool call and every line of command output streams to the browser in the order it happened.",
  },
  {
    step: "03",
    title: "It proves the work",
    body: "A sandbox boots, the suite runs, exit codes are recorded. Only the last run of each command counts, so a fixed failure reads as fixed.",
  },
  {
    step: "04",
    title: "You press one button",
    body: "Branch, commit, pull request — with a body carrying the plan, the changed files, and every command with its exit code. The agent cannot open it alone.",
  },
  {
    step: "05",
    title: "It keeps reviewing",
    body: "An alarm wakes it to poll the review threads on its own PR. New comments get addressed and pushed, with the tab closed.",
  },
];

function CloudLoop() {
  return (
    <section id="cloud" className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
      <div className="max-w-2xl">
        <SectionKicker>The cloud loop</SectionKicker>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">
          From an open issue to a pull request that proves itself.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">
          The whole loop runs server-side. Nothing is installed, nothing runs on
          your laptop, and no step needs you present except the one that should.
        </p>
      </div>

      <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {LOOP.map((item) => (
          <li
            key={item.step}
            className="group rounded-panel border border-line bg-panel p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg hover:shadow-black/10"
          >
            <div className="font-mono text-xs font-semibold text-accent">
              {item.step}
            </div>
            <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {item.body}
            </p>
          </li>
        ))}

        {/* The last cell carries the deliberate limit rather than hiding it —
            an agent that can merge its own work is a liability, not a feature. */}
        <li className="rounded-panel border border-dashed border-line bg-panel/40 p-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-raised text-ink-soft">
            <LockIcon />
          </div>
          <h3 className="mt-3 text-base font-semibold">
            Where it deliberately stops
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            It can write, test, commit and push. Opening the pull request is a
            button you press. Nothing reaches someone else&apos;s repository
            without a person deciding it should.
          </p>
        </li>
      </ol>
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
            A stateless Worker, five stateful objects, and a sandbox on demand.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-soft">
            Each object owns exactly one thing, and each is addressed by name, so
            a session belongs to one user by arithmetic rather than by a check.
            The filesystem is a table:{" "}
            <span className="font-mono text-sm text-accent">
              files(path, content, version)
            </span>
            . Every write bumps the version and appends a revision — the
            workspace carries its own history, with no git server behind it.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
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

          {/* Dashed, because it is the one box that is not durable. */}
          <div className="rounded-panel border border-dashed border-line bg-panel/40 p-4">
            <div className="font-mono text-sm font-semibold text-ink">Sandbox</div>
            <div className="mt-2 inline-block rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
              per command
            </div>
            <div className="mt-2.5 text-xs leading-relaxed text-ink-soft">
              real shell, then gone
            </div>
          </div>
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
            Point it at a repository and close the tab.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">
            Attach a repo, hand it an issue, and watch the sandbox run your tests
            live. Then open a new session and see it already remember — no tool
            calls, it just knew.
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
              href="https://github.com/Sompalkar/Durable-Agent"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center rounded-lg border border-line bg-panel px-6 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-hover"
            >
              View the source
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
          sandbox for the work · SQLite for everything that has to outlive it
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
function DiffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M12 3v6M9 6h6M6 21h12M9 15h6" />
    </svg>
  );
}
function DatabaseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <ellipse cx="12" cy="5.5" rx="8" ry="2.8" />
      <path d="M4 5.5v13c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-13" />
      <path d="M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8" />
    </svg>
  );
}
function StreamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M4 7h10M4 12h16M4 17h7" />
      <circle cx="18" cy="7" r="1.6" />
    </svg>
  );
}
function BranchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="7" cy="5" r="2.2" />
      <circle cx="7" cy="19" r="2.2" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M7 7.2v9.6M17 11.2c0 3-4 2.6-6 4.4" />
    </svg>
  );
}
function ReviewIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
      <path d="M9 10.5l2 2 4-4" />
    </svg>
  );
}
function RouteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h6a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h0" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
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
