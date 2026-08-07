# Durable Agent

An AI coding agent that has **no machine**. Its files, its memory, its skills and
its schedule are all rows in Cloudflare Durable Object SQLite.

Most coding agents run in a container: something has to boot before the first
token, and something has to keep being paid for between turns. This one has
neither. Each session is a Durable Object that wakes on request, does the work,
and goes back to costing nothing — with everything still there tomorrow.

It works GitHub issues end to end: reads the issue, edits code, runs the test
suite in a real Linux sandbox, opens a pull request with the evidence, then
watches the review thread and pushes fixes.

**[PR #2 on a real repo](https://github.com/Sompalkar/Cyber-UPS/pull/2)** was
opened by it.

---

## What it does

| | |
|---|---|
| **Works an issue → PR** | Reads a GitHub issue, edits code, verifies it, opens a pull request whose body is the proof. |
| **Answers its own reviews** | An alarm polls the PR. A new comment wakes the session, which rebuilds the diff and pushes a fix — days after the container that built it was destroyed. |
| **Repo memory** | What it learns about a codebase persists, so the second issue in a repo starts ahead of the first. |
| **Personal memory + skills** | Facts follow you between sessions. Procedures are saved once and replayed; only names sit in context, bodies load on demand. |
| **Background agents** | `ctx.storage.setAlarm()` — the agent wakes *itself*, runs a turn with nobody watching, and sleeps. No cron service, no worker pool. |
| **Versioned workspace** | Every write is a revision. Diff any two versions with no git repository behind it. |
| **Real shell** | A pluggable Linux sandbox, rented for the seconds a command takes. Output streams live. |
| **Model routing** | `Auto` starts on the cheap model and escalates only when a step actually fails. |
| **Metered** | Per-turn cost tracked; accounts have a credit balance, so a public link can't drain an API key. |

---

## Architecture

Three services, split by the kind of state they hold.

```
  Browser · Next.js
      │
      ├──────────► Main API · Express ──► MongoDB
      │            accounts · session index · history · usage
      │                    │  issues the JWT cookie
      │                    │  ◄── Worker archives each finished turn
      │                    ▼
      └──────────► Worker · Hono ── verifies the JWT
                          │
    ┌──────────┬──────────┼──────────┬──────────┐
    ▼          ▼          ▼          ▼          ▼
 Limiter  AgentSession Workspace   Brain    Scheduler
 turns/hr conversation files +     memory + alarms +
 per user + the loop   revisions   skills   run history
                │                                │
                └──── headless turns, on alarm ──┘
                          │
                          ▼  only when a shell is needed
                  Linux sandbox — boots, runs, dies
```

**Why two backends.** They answer structurally different questions. *"List my
sessions, newest first"* is a **query** — it needs an index, and a Durable Object
cannot enumerate its siblings. *"What comes next in this conversation"* is a
**single consistent object** — it needs serialised access, which a database only
gives you with locks.

| MongoDB owns | Durable Objects own |
|---|---|
| Accounts, settings, credits | The live message array |
| Session index, archived transcripts | Files and every revision |
| Usage and cost, per turn | Memory, skills, schedules |

**Isolation is structural.** Every object name begins with the user id from the
verified JWT — `session:{userId}:{sessionId}`, `repo:{userId}:{owner}/{name}`.
Two users asking for the same session id derive two different objects, so no
forgotten check can cross accounts. The id never comes from the request body.

---

## Getting started

**Prerequisites:** Node 20+, Docker, an Anthropic API key.

```bash
# 1. Main API + MongoDB
cd api && npm install && npm run db:up
cp .env.example .env          # fill in the two secrets it names
npm run dev                   # :4000

# 2. Worker
cd backend && npm install
cp .dev.vars.example .dev.vars
npm run dev                   # :8787

# 3. Frontend
cd frontend && npm install
cp .env.example .env.local
npm run dev                   # :3000
```

`AUTH_JWT_SECRET` and `SERVICE_TOKEN` must be **identical** in `api/.env` and
`backend/.dev.vars` — they are how the two services trust each other. Generate
with `openssl rand -base64 48` and `openssl rand -hex 24`.

Every setting is documented in the two `.example` files.

---

## Notable decisions

### The filesystem is a database

```sql
CREATE TABLE files     (path TEXT PRIMARY KEY, content TEXT, version INTEGER, …);
CREATE TABLE revisions (path TEXT, version INTEGER, content TEXT, summary TEXT, …);
```

Revisions store full snapshots, not diffs. Files cap at 512 KB and history at 20
entries, so the worst case is 10 MB per file against a 10 GB budget — cheap, and
it buys instant restore with no diff-application logic to get wrong.

### Context pruning — the biggest cost lever

The API is stateless, so every loop iteration resends the whole conversation. Two
things get big, and they decay differently:

| | Kept verbatim | Why |
|---|---|---|
| `tool_result` output | last **6** | The working set the model is reasoning about |
| `tool_use` arguments | last **2** | A file's contents are already in the workspace, one `read_file` away |

Arguments are collapsed field by field, so `path` survives and `content` does not
— `write_file` puts an entire file in its argument, and that used to live in
context forever. Measured on a session writing eight 4 KB files: **39,145 → 14,599
characters.** Pruning only results, which is where this started, saved 2.6%.

The calls themselves are never removed. The model must still see what it did and
in what order, or it repeats work.

### Prompt caching

The system prompt is two blocks. The first is byte-stable and carries the cache
breakpoint; memories, skills and shell availability go *after* it. Put them
before and saving one memory invalidates the cache for the entire conversation.

### The sandbox is a peripheral, not a home

The Durable Object is always the source of truth. Changed files mirror in, the
command runs, `find -newer` collects what it touched, and each file is written
back through the workspace so it gets a version.

Two details that were bugs first:

- **The checkout happens before change detection starts.** A clone writes
  thousands of files; inside the window, the entire repository is reported as the
  agent's work.
- **The marker is a file, not a timestamp.** Comparing the Worker's clock against
  the container's filesystem is comparing two different machines — a container
  running slightly ahead makes every file look new.

### Live command output

Daytona's execute endpoint returns only when the command finishes, so there is
nothing to subscribe to. The command is launched detached with its output
redirected to a file, and one poll fetches both the new bytes and whether it has
exited.

### Model routing

`Auto` starts on the cheap tier and escalates when a **tool call fails** — that
is evidence, where guessing difficulty from the prompt is not. Escalation is
monotonic within a turn. Usage is tracked per model and priced separately,
because a routed turn bills at more than one rate.

### The review loop

Opening a PR is not the end. A schedule polls it; a new comment wakes the
session, which rebuilds the diff from its own record of what changed, fixes the
comment, and pushes to the same branch.

Comments are marked read **before** the work. A turn that crashes halfway must
not answer the same review on every alarm — a missed comment is recoverable, an
infinite loop against a paid API is not.

### Credits

Checked before a turn starts, because the turn report arrives after the money is
gone. Background runs are checked separately: an alarm has no request behind it,
so the gate in the Worker route never sees it.

---

## Trade-offs

| Cost | What it buys |
|---|---|
| No POSIX filesystem — tools only | Persistence, versioning, zero boot latency |
| 512 KB per file, 10 GB per object | Fits inside SQLite's row limits with room to spare |
| One object is single-threaded | No locks, no races, no transactions anywhere |
| Sync in and out of the sandbox costs a round trip | A real shell without a permanent machine |
| Pruning can drop old tool output | ~50× cost reduction; it can re-run the tool |

**Where it breaks first under load:** not the architecture. Every user has their
own objects with no shared bottleneck. The limits are a single Node process (run
N — it's stateless), a single Mongo (Atlas), and — realistically first — the
Anthropic rate limit.

**Unfinished:** payments (schema is ready), Cloudflare Sandbox is written but
needs Workers Paid, and memory recall is a `LIKE` query rather than embeddings —
fine at this scale, would need vectors at 10,000 memories.

---

## Layout

```
api/        Express + MongoDB — accounts, history, usage, credits
backend/    Cloudflare Worker — the agent, five Durable Objects, GitHub, sandbox
frontend/   Next.js — chat, workspace, memory, schedules, PR review
```

---

The architecture follows the approach Miguel Salinas described in
[camelAI's writeup](https://github.com/qaml-ai/camelAI) on moving their agent off
virtual machines and into a Durable Object.
