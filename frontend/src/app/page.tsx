"use client";

import Link from "next/link";

import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useAuth } from "@/lib/useAuth";

/* ------------------------------------------------------------------ *
 * Durable Agent — marketing landing page.
 *
 * The app itself lives at /sessions; this is the front door.
 *
 * Design rules, held deliberately:
 *   - Monochrome. The accent appears on a handful of marks per screen and
 *     nowhere structural. The primary action is maximum contrast, not colour.
 *   - Flat. No gradient text, no glows, no patterned backdrops. Depth comes
 *     from hairlines and surface steps.
 *   - The product is the artwork. No icon tiles, no decorative illustration.
 *   - Left-aligned. Centred headings with symmetric ornament read as a
 *     template; a measure that starts at the same x as everything else does
 *     not.
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
 * Shared bits
 * ================================================================== */

const NAV_LINKS = [
  ["#how", "How it works"],
  ["#features", "Features"],
  ["#cloud", "Cloud loop"],
  ["#architecture", "Architecture"],
] as const;

/** Primary action. Maximum contrast rather than an accent fill. */
function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center rounded-md bg-ink px-5 text-sm font-medium text-canvas transition-opacity hover:opacity-90"
    >
      {children}
    </Link>
  );
}

function SecondaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex h-10 items-center rounded-md border border-line-strong px-5 text-sm font-medium text-ink transition-colors hover:bg-hover"
    >
      {children}
    </a>
  );
}

/** Small mono label that opens a section. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
      {children}
    </div>
  );
}

/* ================================================================== *
 * Navigation
 * ================================================================== */

function Nav() {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-15 max-w-6xl items-center gap-8 px-5 py-3.5 sm:px-8">
        <a href="#top" className="flex shrink-0 items-center gap-2">
          <Logo />
          <span className="text-[15px] font-medium tracking-tight">
            Durable Agent
          </span>
        </a>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="text-[13px] text-ink-soft transition-colors hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {/* Signed out, the primary action is to sign up; signed in, it is to
              carry on. Sending everyone to /sessions would just bounce half of
              them through a redirect. */}
          {user ? null : (
            <Link
              href="/login"
              className="hidden text-[13px] text-ink-soft transition-colors hover:text-ink sm:block"
            >
              Sign in
            </Link>
          )}
          <Link
            href={user ? "/sessions" : "/register"}
            className="inline-flex h-9 items-center rounded-md bg-ink px-4 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90"
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
    <section id="top" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-20 sm:px-8 lg:pt-28">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
            Cloud agent · real sandbox · durable state
          </div>

          <h1 className="mt-7 text-[2.75rem] font-medium leading-[1.02] tracking-[-0.03em] sm:text-6xl lg:text-[4.25rem]">
            A cloud coding agent
            <br />
            that never loses its place.
          </h1>

          <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            It runs on Cloudflare, boots a real Linux sandbox when there is
            something to execute, and keeps every file, memory, and skill in
            SQLite that outlives the container. Close the tab — the turn keeps
            going, and tomorrow it still knows you.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <PrimaryLink href={user ? "/sessions" : "/register"}>
              Start a session
            </PrimaryLink>
            <SecondaryLink href="#how">See how it works</SecondaryLink>
          </div>
        </div>
      </div>

      {/* The product, flush to the section edges — a screenshot, not a floating
          card with a glow behind it. */}
      <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
        <ProductMock />
      </div>
    </section>
  );
}

/** A stylised snapshot of the running app. */
function ProductMock() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-faint">
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          queue-module · session
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px] text-ink-faint">
          <span className="hidden sm:inline">cached 1,024</span>
          <span className="text-ink">$0.0142</span>
        </div>
      </div>

      <div className="grid divide-y divide-line lg:grid-cols-[1.4fr_1fr] lg:divide-x lg:divide-y-0">
        <div className="space-y-1 p-4">
          <ToolRow name="remember" arg="prefers TypeScript, strict mode" ms={9} />
          <ToolRow name="write_file" arg="/src/queue.ts" ms={12} />
          <ToolRow name="edit_file" arg="/src/queue.ts · +6 −1" ms={8} />

          {/* The sandbox half, streaming. A reader assumes this is missing the
              moment the pitch mentions storing state in a database. */}
          <div className="!mt-3 overflow-hidden rounded-md border border-line bg-canvas">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 font-mono text-[12px]">
              <span className="text-ink-faint">$</span>
              <span className="text-ink-soft">npm test</span>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-faint">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-positive" />
                live
              </span>
            </div>
            <pre className="px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-faint">
              {"PASS  src/queue.test.ts\nTests:  7 passed, 7 total"}
            </pre>
          </div>

          <ToolRow name="save_skill" arg="build-tested-module" ms={5} />

          <div className="flex flex-wrap gap-1.5 !mt-3">
            {["Add benchmarks", "Wire up CI", "Schedule hourly review"].map(
              (p) => (
                <span
                  key={p}
                  className="rounded border border-line px-2 py-1 text-[11px] text-ink-soft"
                >
                  {p}
                </span>
              ),
            )}
          </div>
        </div>

        <div className="divide-y divide-line">
          <MockPanel label="Memory" meta="3 facts">
            <ul className="space-y-1.5 text-[13px] text-ink-soft">
              <li>Prefers TypeScript with strict mode</li>
              <li>Tests colocated beside source</li>
              <li>Deploys to Cloudflare Workers</li>
            </ul>
          </MockPanel>

          <MockPanel label="Revisions" meta="v4">
            <div className="space-y-1 font-mono text-[12px] text-ink-soft">
              <div>
                <span className="text-accent">●</span> queue.ts · v4
              </div>
              <div className="text-ink-faint">queue.ts · v3</div>
              <div className="text-ink-faint">queue.test.ts · v1</div>
            </div>
          </MockPanel>

          <MockPanel label="Scheduled" meta="15m">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              Poll review threads on the open pull request
            </p>
          </MockPanel>
        </div>
      </div>
    </div>
  );
}

function MockPanel({
  label,
  meta,
  children,
}: {
  label: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="mb-2.5 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        <span>{label}</span>
        <span>{meta}</span>
      </div>
      {children}
    </div>
  );
}

function ToolRow({ name, arg, ms }: { name: string; arg: string; ms: number }) {
  return (
    <div className="flex items-center gap-2.5 font-mono text-[12.5px]">
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
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-6xl grid-cols-2 sm:px-8 md:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`px-5 py-10 ${i % 2 === 1 ? "border-l border-line" : ""} ${
              i >= 2 ? "border-t border-line md:border-t-0" : ""
            } ${i > 0 ? "md:border-l" : "md:border-l-0"}`}
          >
            <div className="font-mono text-[2rem] font-medium tracking-tight text-ink">
              {s.value}
            </div>
            <div className="mt-2 text-[13px] text-ink">{s.label}</div>
            <div className="mt-0.5 text-[13px] text-ink-faint">{s.note}</div>
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
    kicker: "01 — Execution",
    name: "Linux sandbox",
    tag: "rented by the second",
    lead: "Where things actually run.",
    body: "A real container with a real shell. Install dependencies, run the test suite, read the exit code. It boots in about two seconds, streams its output to the browser line by line while it works, and is torn down when the turn ends.",
    points: [
      "npm install, pytest, tsc — whatever the repo needs",
      "Output streams live; no waiting for the command to finish",
      "Exit codes are recorded, so a pull request can prove it is green",
    ],
  },
  {
    kicker: "02 — State",
    name: "Durable Object SQLite",
    tag: "outlives every container",
    lead: "Where things are remembered.",
    body: "Files, revisions, memory, skills and schedules are rows in SQLite that sits with the agent at the edge. The sandbox can be thrown away precisely because nothing important was ever kept inside it.",
    points: [
      "Every write is a new revision — diffs without a git server",
      "What it learns about you survives into an empty new workspace",
      "It can wake itself later; the state is already there",
    ],
  },
];

function TwoRuntimes() {
  return (
    <section id="how" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-5 max-w-2xl text-[2rem] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[2.6rem]">
          Two runtimes, split along the line that matters.
        </h2>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
          Most cloud agents put execution and state in the same box. It works
          until the box goes away — and the box always goes away. This one keeps
          the disposable part disposable and the durable part durable.
        </p>

        <div className="mt-14 grid border-t border-line lg:grid-cols-2">
          {PLANES.map((plane, i) => (
            <div
              key={plane.name}
              className={`py-10 ${i === 1 ? "border-t border-line lg:border-l lg:border-t-0 lg:pl-10" : "lg:pr-10"}`}
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                {plane.kicker}
              </div>
              <h3 className="mt-4 font-mono text-[15px] text-accent">
                {plane.name}
              </h3>
              <p className="mt-4 text-xl font-medium tracking-tight">
                {plane.lead}
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                {plane.body}
              </p>

              <ul className="mt-7 space-y-3 border-t border-line pt-6">
                {plane.points.map((point) => (
                  <li
                    key={point}
                    className="flex gap-3 text-[13.5px] leading-relaxed text-ink-soft"
                  >
                    <span className="mt-[7px] h-px w-3 shrink-0 bg-line-strong" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 font-mono text-[11px] text-ink-faint">
                {plane.tag}
              </p>
            </div>
          ))}
        </div>

        {/* The consequence of the split, stated plainly — this is the part that
            is hard to retrofit, so it is worth naming rather than implying. */}
        <p className="mt-4 border-t border-line pt-8 text-[15px] leading-relaxed text-ink-soft">
          <span className="text-ink">The consequence:</span> a container dying
          mid-run costs you a container, not the work. The next turn — minutes or
          days later, with you watching or not — starts from the same files, the
          same history, and the same notes it took about your codebase.
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
    title: "Real Linux sandbox",
    body: "Install packages, run the test suite, read the exit code. Rented for the seconds a command takes, then torn down.",
  },
  {
    title: "Live command output",
    body: "The sandbox has no streaming API, so commands run detached and their log is tailed. Output reaches you as it happens.",
  },
  {
    title: "Persistent memory",
    body: "Learns your preferences, carries them into every future session, and corrects itself when proven wrong.",
  },
  {
    title: "Reusable skills",
    body: "Works a procedure out once, then replays it forever. A hundred skills cost almost nothing in context.",
  },
  {
    title: "Background agents",
    body: "Wakes itself on a schedule, works with nobody watching, and goes back to sleep at zero cost.",
  },
  {
    title: "Issue to pull request",
    body: "Pick a GitHub issue and it works the whole way to an open PR — branch, commit, and a body citing every command it ran.",
  },
  {
    title: "Review-thread loop",
    body: "After the PR is open it keeps checking review comments, addresses them, and pushes again without being asked.",
  },
  {
    title: "Versioned workspace",
    body: "Every write is a new revision, so a review-ready diff between any two versions is just two rows compared.",
  },
  {
    title: "Per-step model routing",
    body: "Cheap model for the easy steps, escalating to a stronger one the moment a tool call fails. Priced per model, per step.",
  },
];

function Features() {
  return (
    <section id="features" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <Eyebrow>What it does</Eyebrow>
        <h2 className="mt-5 max-w-2xl text-[2rem] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[2.6rem]">
          Everything a cloud agent needs, and the state to back it.
        </h2>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
          The first two come from the sandbox. The rest come from having
          somewhere durable to put things — which is why they were cheap to build
          instead of being a roadmap.
        </p>

        {/* A ruled grid, not a deck of cards. Hairlines do the separating. */}
        <div className="mt-14 grid border-t border-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={`border-b border-line py-8 sm:pr-8 ${
                i % 2 === 1 ? "sm:border-l sm:pl-8" : ""
              } lg:border-l lg:pl-8 ${i % 3 === 0 ? "lg:border-l-0 lg:pl-0" : ""} ${
                i % 2 === 0 ? "sm:border-l-0 sm:pl-0" : ""
              }`}
            >
              <h3 className="text-[15px] font-medium">{f.title}</h3>
              <p className="mt-2.5 text-[14px] leading-relaxed text-ink-soft">
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
    <section id="cloud" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div className="lg:sticky lg:top-32 lg:self-start">
            <Eyebrow>The cloud loop</Eyebrow>
            <h2 className="mt-5 text-[2rem] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[2.4rem]">
              From an open issue to a pull request that proves itself.
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-ink-soft">
              The whole loop runs server-side. Nothing is installed, nothing runs
              on your laptop, and no step needs you present except the one that
              should.
            </p>
          </div>

          <ol className="border-t border-line">
            {LOOP.map((item) => (
              <li
                key={item.step}
                className="flex gap-6 border-b border-line py-7"
              >
                <span className="shrink-0 font-mono text-[12px] text-ink-faint">
                  {item.step}
                </span>
                <div>
                  <h3 className="text-[15px] font-medium">{item.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}

            {/* The deliberate limit — an agent that can merge its own work is a
                liability, not a feature. */}
            <li className="flex gap-6 py-7">
              <span className="shrink-0 font-mono text-[12px] text-ink-faint">
                —
              </span>
              <div>
                <h3 className="text-[15px] font-medium">
                  Where it deliberately stops
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                  It can write, test, commit and push. Opening the pull request
                  is a button you press. Nothing reaches someone else&apos;s
                  repository without a person deciding it should.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== *
 * Architecture
 * ================================================================== */

const OBJECTS = [
  { name: "AgentSessionDO", scope: "per session", holds: "conversation + loop" },
  { name: "WorkspaceDO", scope: "per session", holds: "files + revisions" },
  { name: "BrainDO", scope: "global", holds: "memory + skills" },
  { name: "SchedulerDO", scope: "global", holds: "alarms + run history" },
  { name: "RegistryDO", scope: "global", holds: "session index" },
  { name: "Sandbox", scope: "per command", holds: "real shell, then gone" },
];

function Architecture() {
  return (
    <section id="architecture" className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <Eyebrow>Architecture</Eyebrow>
        <h2 className="mt-5 max-w-2xl text-[2rem] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[2.6rem]">
          A stateless Worker, five stateful objects, and a sandbox on demand.
        </h2>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
          Each object owns exactly one thing, and each is addressed by name, so a
          session belongs to one user by arithmetic rather than by a check.
        </p>

        {/* A table, because this is reference material and a table is how
            reference material is read. */}
        <div className="mt-14 border-t border-line">
          {OBJECTS.map((o) => (
            <div
              key={o.name}
              className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-line py-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,8rem)_1fr]"
            >
              <span className="font-mono text-[13.5px] text-ink">{o.name}</span>
              <span className="text-right font-mono text-[12px] text-ink-faint sm:text-left">
                {o.scope}
              </span>
              <span className="col-span-2 text-[13.5px] text-ink-soft sm:col-span-1">
                {o.holds}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-10 overflow-x-auto">
          <pre className="font-mono text-[12.5px] leading-relaxed text-ink-soft">
            <span className="text-ink-faint">
              -- every write bumps a version and appends a revision
            </span>
            {"\n"}
            <span className="text-accent">files</span>
            {"     (path PRIMARY KEY, content, size, version)\n"}
            <span className="text-accent">revisions</span>
            {" (id, path, version, content, summary, created_at)"}
          </pre>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== *
 * Final CTA
 * ================================================================== */

function FinalCta() {
  const { user } = useAuth();

  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8">
        <h2 className="max-w-2xl text-[2rem] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[3rem]">
          Point it at a repository and close the tab.
        </h2>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
          Attach a repo, hand it an issue, and watch the sandbox run your tests
          live. Then open a new session and see it already remember — no tool
          calls, it just knew.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <PrimaryLink href={user ? "/sessions" : "/register"}>
            {user ? "Open the app" : "Get started"}
          </PrimaryLink>
          <SecondaryLink href="https://github.com/Sompalkar/Durable-Agent">
            View the source
          </SecondaryLink>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <Logo />
              <span className="text-[15px] font-medium tracking-tight">
                Durable Agent
              </span>
            </div>
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-ink-soft">
              A sandbox for the work, SQLite for everything that has to outlive
              it.
            </p>
          </div>

          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              Product
            </div>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              {NAV_LINKS.map(([href, label]) => (
                <li key={href}>
                  <a
                    href={href}
                    className="text-ink-soft transition-colors hover:text-ink"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              Get started
            </div>
            <ul className="mt-4 space-y-2.5 text-[13.5px]">
              <li>
                <Link
                  href="/register"
                  className="text-ink-soft transition-colors hover:text-ink"
                >
                  Create an account
                </Link>
              </li>
              <li>
                <Link
                  href="/login"
                  className="text-ink-soft transition-colors hover:text-ink"
                >
                  Sign in
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/Sompalkar/Durable-Agent"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-soft transition-colors hover:text-ink"
                >
                  Source on GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 font-mono text-[11px] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Durable Agent</span>
          <span>files · memory · skills · schedule — rows in a database</span>
        </div>
      </div>
    </footer>
  );
}

/* ---- mark ---------------------------------------------------------- */

function Logo() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded bg-ink text-canvas">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="4" y="5" width="16" height="5" rx="1.5" fill="currentColor" />
        <rect
          x="4"
          y="14"
          width="16"
          height="5"
          rx="1.5"
          fill="currentColor"
          opacity="0.5"
        />
      </svg>
    </span>
  );
}
