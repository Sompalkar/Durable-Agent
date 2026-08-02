# Durable Agent

An AI agent that has **no machine**. Its files, its memory, its skills, and its
schedule are all rows in Cloudflare Durable Object SQLite.

Most coding agents run in a VM or a container: something has to boot before the
first token, and something has to keep running — or keep being paid for —
between turns. This one has neither. Each session is a Durable Object on
Cloudflare's edge that wakes on request, does the work, and goes back to costing
nothing, with all of its state still there tomorrow.

The tradeoff is deliberate: **the agent can only do what we have built a method
for.** Adding a capability means adding a tool, not handing over a shell.

---

## What it does

| | |
|---|---|
| **Persistent memory** | Facts the agent learns follow it into every future session. It corrects them when a later run proves them wrong, rather than stacking contradictions. |
| **Reusable skills** | Workflows it works out once are saved and replayed. Only names and descriptions sit in context; bodies load on demand, so a hundred skills cost almost nothing. |
| **Background agents** | Schedule a task and the agent wakes *itself* up — on a Durable Object alarm — runs the turn with nobody watching, and sleeps again. It can also schedule its own follow-ups. |
| **Proactive proposals** | It doesn't wait for your next prompt. Every turn ends with up to three concrete next steps, one click each. |
| **Versioned workspace** | Every write is a new revision. Review-ready diffs between any two versions, with no git repository behind them. |
| **Real shell (optional)** | A pluggable Linux sandbox for `run_command` — install packages, run tests, execute code. Rented for the seconds a command takes. Off by default; the agent is told it has no shell rather than being allowed to fail at one. |
| **Cost visible** | Tokens and estimated spend per session, in the header. Optional per-session and per-hour caps for a publicly shared link. |

### Why this architecture earns those features

Memory and cron are usually *infrastructure*. Here they fall out of the storage model:

- An agent in an ephemeral sandbox has to version its memory into a repo, because
  its workspace is destroyed after every run. A Durable Object simply keeps it.
- Scheduling normally needs a cron service and a worker pool. A Durable Object can
  set an alarm on itself: `ctx.storage.setAlarm(when)`. Between firings there is no
  process at all. **An always-on VM cannot do this cheaply — that is the point.**

---

## Architecture

Three services, split by what kind of state they hold.

```
  Browser (Next.js :3000)
      │
      ├──────────────► Main API (Express :4000) ──► MongoDB
      │                accounts · sessions index · history · usage
      │                        │
      │                        │ issues the JWT cookie
      │                        │ ◄── Worker archives finished turns
      │                        ▼
      └──────────────► Worker (Hono :8787) ── verifies the JWT
                                │
    ┌───────────┬───────────────┼──────────────┬──────────────┐
    ▼           ▼               ▼              ▼              ▼
 Limiter    AgentSession    Workspace        Brain        Scheduler
 ────────   ────────────    ─────────        ─────        ─────────
 turns/hr   conversation    files +          memory +     alarms +
 per user   + agent loop    revisions        skills       run history
                 │               ▲               ▲             │
                 └── tool calls ─┴───────────────┘             │
                 ▲                                             │
                 └──────── headless turns, on alarm ───────────┘
                                │
                                ▼ (only when a shell is needed)
                        Linux sandbox — boots, runs, tears down
```

**Why two backends.** They answer different kinds of question. "Which sessions
belong to this user, newest first" is a *query* — it needs an index and a sort,
which is a database's job. "What did we say next in session X" is a single
consistent *object*, which is a Durable Object's job. Trying to make either one
do the other's work is where this design would go wrong: a Durable Object cannot
enumerate its siblings, and a database cannot give you a serialised, always-warm
place to run an agent loop.

The split, concretely:

| MongoDB owns | Durable Objects own |
|---|---|
| Accounts, passwords, settings | The live message array |
| The session list and titles | Workspace files and every revision |
| Archived transcripts | Memories and skills |
| Usage and cost per turn | Schedules and their alarms |

**Multi-tenancy is structural.** Every Durable Object name begins with the user
id from the verified JWT — `session:{userId}:{sessionId}`, `brain:{userId}`.
Two users asking for the same session id derive two different objects, so there
is no code path, forgotten check, or typo that can cross accounts. The id never
comes from the request body; it comes from the cookie.

Five Durable Objects, each owning one thing:

| Object | Scope | Holds |
|---|---|---|
| `AgentSessionDO` | per user, per session | Conversation, the agent loop, SSE streaming, usage |
| `WorkspaceDO` | per user, per session | Files and revision history in SQLite |
| `BrainDO` | per user | Memories and skills — shared across all your sessions |
| `SchedulerDO` | per user | Schedules, alarms, and background run history |
| `SessionRegistryDO` | per user | The hourly turn limit |

Session reads go over Durable Object **RPC** — the stub is called like a local
object. The streaming turn uses `fetch`, because a Server-Sent Events response is
a `Response`, not a serializable value.

### Credits

Every account has a USD balance, seeded at signup. The Worker checks it
**before** a turn starts and refuses with `402` at zero; the API decrements it by
the estimated cost the Worker already reports for each turn.

The check has to be up front. A turn report arrives *after* the money is spent,
so refusing then would be too late — and a public signup link with no balance is
an open tap on whoever's API key is configured.

Balances are allowed to go slightly negative rather than being clamped. The turn
happened and the provider already charged for it; hiding the overrun would make
the books wrong.

**Background runs are checked too, and separately.** A scheduled turn has no
route and no request behind it — the alarm calls the session object directly — so
the gate in the Worker route never sees it. `runHeadless` therefore re-checks the
balance and the per-session turn cap itself. That is the run you least want going
unmetered, because nobody is watching it.

### Two-tier storage, visible in the UI

The **Archive** tab in the right rail reads MongoDB rather than a Durable
Object. It shows every finished turn — typed and background alike — with what
each one cost.

It is also the demonstration of the split. Clear the conversation and the
Durable Object's transcript is empty; the archive still has every turn, because
the two stores are genuinely separate:

```bash
DELETE /api/sessions/:id/messages   # Durable Object → 0 messages
GET    /api/sessions/:id/turns      # MongoDB        → still every turn
```

### Working on a GitHub repository

Connect a token in Settings, attach a repo and an issue to a session, and the
agent works the issue and opens a pull request.

The division of labour is the point:

| | Holds | Lifetime |
|---|---|---|
| **Sandbox** | A real shallow checkout, with dependencies installed on demand | Destroyed at the end of every turn |
| **Workspace DO** | A readable slice of the source, plus every file the agent changed — versioned | Permanent |
| **Session DO** | Which files changed, and every command run with its exit code | Permanent |

Because the container dies after each turn, the next turn re-clones and re-applies
only the files the Durable Object records as changed. The agent resumes exactly
where it left off without the machine having survived — which is the whole thesis
in one flow.

Two details worth knowing:

- **The clone happens before the change-detection clock starts.** A checkout
  writes thousands of files; if it were inside the window, `find -newermt` would
  report the entire repository as the agent's work.
- **No credential is ever stored in a Durable Object.** The session persists
  `owner/name` and a commit sha; the token is fetched from MongoDB per turn and
  injected into the clone URL, then scrubbed out of `git remote` immediately.
  Revoking the token on GitHub takes effect on the very next turn.

The pull request is opened through the **Git Data API** — blobs, tree, commit,
ref — so there is no `git` binary, no working copy, and no token on disk in a
third-party container. Every change lands as one atomic commit.

Its body is the evidence: the plan the agent followed, the files it touched, and
a table of every command with its exit code. When nothing was run, it says so at
the top, because a reviewer who assumes the change was tested is worse off than
one who knows it was not.

Opening the PR is an explicit user action with a preview. An agent that can push
to someone's repository unattended is not a feature.

### Authentication

Email and password, hashed with bcrypt, exchanged for a JWT in an httpOnly
cookie. The main API signs it; the Worker verifies it with the same secret.
`jose` runs on both Node and workerd, so that is literally the same code twice.

The one thing worth knowing: **a cookie is scoped by hostname, not by port.**
A cookie set by the API on `localhost:4000` is therefore also sent to the Worker
on `localhost:8787` and to Next on `localhost:3000` — one login covers all
three. This only works if every URL spells the host the same way; `127.0.0.1`
is a different host to the browser, and half the app would silently arrive
signed out.

### The filesystem is a database

`backend/src/workspace/filesystem.ts` is the heart of it. A file is a row:

```sql
files     (path PRIMARY KEY, content, size, created_at, updated_at, version)
revisions (id, path, version, content, size, summary, created_at)
```

Every write bumps `version` and appends a revision, so the workspace carries its
own history — no git server, no attached disk. Paths are normalized at the
boundary, so `/a/b.txt`, `a/b.txt`, and `/a/./x/../b.txt` all resolve to one row.

### The tools

There is no bash by default. Every capability is an explicit method:

| Group | Tools |
|---|---|
| Files | `list_files` `read_file` `write_file` `edit_file` `delete_file` `move_file` `glob_files` `grep_files` `file_history` `restore_file` |
| Memory | `remember` `recall` `correct_memory` `forget` |
| Skills | `save_skill` `load_skill` |
| Autonomy | `update_plan` `schedule_task` `propose_next_steps` |
| Web | `fetch_url` |
| Shell *(only when a sandbox is configured)* | `run_command` |

`edit_file` rejects a snippet that appears zero or many times. That refusal is
what makes it safe to hand to a model: a wrong guess fails loudly instead of
silently corrupting a file.

`update_plan` is how work longer than a couple of steps stays on the rails. The
agent rewrites the whole checklist each time — no ids to keep in sync — and the
event is streamed the moment the tool runs rather than at the end of the turn,
because the point is watching it advance while the agent works. It shows up as a
strip above the composer, which opens itself during a turn and closes when the
work is done.

### Context pruning

The API is stateless, so every loop iteration resends the whole conversation.
Two things get big, and they decay in usefulness at different rates:

| | Kept | Why |
|---|---|---|
| `tool_result` output | last **6** verbatim | Recent output is the working set the model is reasoning about. |
| `tool_use` arguments | last **2** verbatim | A file's contents are already in the workspace and one `read_file` away. Keeping them is pure duplication — and `write_file` puts an entire file in its `content` argument. |

Arguments are collapsed *field by field*, so `path` survives and `content` does
not. The call itself is never removed: the model must still see what it did and
in what order, or it repeats work.

Measured on a session that writes eight 4 KB files: **39,145 → 14,599
characters**. Pruning only the results — which is where this started — saved
2.6%.

### Prompt caching

The system prompt is byte-stable and carries the cache breakpoint. Memories, the
skill catalogue, and shell availability change between turns, so they are
rendered into a **second** block *after* the breakpoint — otherwise remembering
one new fact would invalidate the cache for the entire conversation. The header's
`cached` counter is that working.

---

## Getting started

**Prerequisites:** Node.js 20+, Docker (for MongoDB), and an Anthropic API key.

Three terminals. Start them in this order — the Worker and the frontend both
expect the API to be there.

**1. Main API + MongoDB**

```bash
cd api
npm install
npm run db:up                      # MongoDB in Docker on :27017
cp .env.example .env               # then fill in the two secrets it names
npm run dev                        # http://localhost:4000
```

Generate the secrets it asks for:

```bash
openssl rand -base64 48   # AUTH_JWT_SECRET
openssl rand -hex 24      # SERVICE_TOKEN
```

**2. Worker**

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars     # ANTHROPIC_API_KEY, plus the two secrets above
npm run dev                        # http://localhost:8787
```

`AUTH_JWT_SECRET` and `SERVICE_TOKEN` must be **identical** in `api/.env` and
`backend/.dev.vars`. The first is how the Worker trusts a login it did not
issue; the second is how the API trusts a turn report it did not ask for.

**3. Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev                        # http://localhost:3000
```

Open http://localhost:3000, create an account, and start a session.

Using MongoDB Atlas instead of Docker? Put the connection string in
`MONGODB_URI` and skip `npm run db:up`. Nothing else changes.

### A two-minute demo path

1. *"Remember that I prefer TypeScript with strict mode."*
2. **Start a brand new session** and ask *"what do you know about me?"* — the
   memory crossed sessions, because it lives in a different Durable Object.
3. *"Build a small queue module with tests, then save your approach as a skill."*
   Open the **Skills** tab.
4. *"Schedule yourself to summarise this workspace every hour."* Open **Agents**
   and press **Run now** — the same code path the alarm fires.
5. Open a file, hit the history icon, click a revision to see the diff.

---

## Configuration

| Where | Setting | Purpose |
|---|---|---|
| `backend/.dev.vars` | `ANTHROPIC_API_KEY` | **Required.** Never committed. |
| `backend/.dev.vars` | `DAYTONA_API_KEY` | Only if you enable the sandbox. |
| `wrangler.jsonc` | `AGENT_MODEL` | Defaults to `claude-opus-5`. |
| `wrangler.jsonc` | `AGENT_EFFORT` | `low` … `max`. Defaults to `high`. |
| `wrangler.jsonc` | `ALLOWED_ORIGIN` | Comma-separated CORS allowlist. Must name real origins now that requests carry a cookie — a browser will not send credentials to `*`. |
| `wrangler.jsonc` | `DEMO_TURN_LIMIT` | Turns per session. `0` = unlimited. |
| `wrangler.jsonc` | `DEMO_HOURLY_TURN_LIMIT` | Turns per hour per account. `0` = unlimited. |
| `wrangler.jsonc` | `SANDBOX_PROVIDER` | Empty = no shell. `daytona` = enable `run_command`. |
| `frontend/.env.local` | `NEXT_PUBLIC_API_URL` | Where the Worker is running. Use `localhost`, never `127.0.0.1` — see Authentication. |
| `frontend/.env.local` | `NEXT_PUBLIC_MAIN_API_URL` | Where the main API is running. |
| `api/.env` | `MONGODB_URI` | Local Docker Mongo, or an Atlas connection string. |
| `api/.env` | `AUTH_JWT_SECRET` | **Required.** Signs the session cookie. Must match `backend/.dev.vars`. |
| `api/.env` | `SERVICE_TOKEN` | **Required.** Lets the Worker report turns. Must match `backend/.dev.vars`. |
| `api/.env` | `CORS_ORIGINS` | Browser origins allowed to send the cookie. |
| `api/.env` | `SIGNUP_CREDITS_USD` | Starting balance for a new account. Defaults to `2`. |
| `wrangler.jsonc` | `MAIN_API_URL` | Where to archive turns. Empty = run the agent with no accounts or history. |

### Enabling the shell

A Durable Object runs in a V8 isolate: no kernel, no processes, no `fork`. You
cannot run bash *inside* one. What you can do is give the object a container to
drive — and that is exactly what the Cloudflare option below is.

Two providers, one interface (`src/agent/sandbox/types.ts`). Both are off by
default, and both **fail closed**: if the provider is named but not fully
configured, `run_command` is not offered and the agent is told it has no shell.

**Option A — Daytona.** Easiest path to a working shell. Set
`SANDBOX_PROVIDER: "daytona"` and supply `DAYTONA_API_KEY`. No Docker, no paid
plan. The adapter leans on one documented endpoint,
`POST /toolbox/{id}/process/execute`, and moves files through it as base64, so
the surface it depends on is a single route.

**Option B — Cloudflare Sandbox.** Everything stays on Cloudflare.
`Sandbox` from `@cloudflare/sandbox` *is a Durable Object with a Linux container
attached*, so this is the honest answer to "can a Durable Object have a shell".
Requires the **Workers Paid plan** and **Docker running locally**. To turn on:

1. Uncomment the `containers` block and the `Sandbox` binding in `wrangler.jsonc`
2. Add the `v3` migration (`new_sqlite_classes: ["Sandbox"]`)
3. Uncomment `export { Sandbox }` in `src/index.ts`
4. Set `SANDBOX_PROVIDER: "cloudflare"`

Either way the Durable Object stays the source of truth: the workspace is copied
into the container, the command runs, and changed files are copied back. The
container is scratch space rented for the seconds the command takes.

> **Neither provider has been run against a live account yet** — no keys were
> available while building. Daytona's create-sandbox body is the least
> documented part and may need a field adjusted for your region. Adding an E2B
> or Modal provider means implementing one interface.

---

## Deploying

```bash
cd backend
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Then set `ALLOWED_ORIGIN` to your real frontend origin and point
`NEXT_PUBLIC_API_URL` at the deployed Worker.

**Before sharing a public link, set the demo caps.** Without them, anyone who
opens the URL is spending your API budget. `DEMO_TURN_LIMIT: "12"` and
`DEMO_HOURLY_TURN_LIMIT: "60"` are sane starting points.

---

## API

All routes are under `/api`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Status, model, whether a shell exists, active limits |
| `GET` `POST` | `/sessions` | List / create |
| `GET` `PATCH` `DELETE` | `/sessions/:id` | Read (with transcript) / rename / delete |
| `POST` | `/sessions/:id/messages` | **Send a message; returns an SSE stream** |
| `DELETE` | `/sessions/:id/messages` | Clear the conversation, keep the files |
| `GET` | `/sessions/:id/workspace` | Directories, files, totals |
| `GET` `PUT` `DELETE` | `/sessions/:id/workspace/file` | Read / write / delete a file |
| `GET` | `/sessions/:id/workspace/history` | Revision list |
| `GET` | `/sessions/:id/workspace/revision` | One revision, with contents (diffs) |
| `GET` | `/brain` | Memories and skills |
| `POST` `PATCH` `DELETE` | `/brain/memories[/:id]` | Add / correct / forget |
| `PUT` `DELETE` | `/brain/skills[/:name]` | Save / delete a skill |
| `GET` `POST` | `/schedules` | List / create |
| `PATCH` `DELETE` | `/schedules/:id` | Pause or resume / delete |
| `GET` | `/schedules/:id/runs` | Past firings |
| `POST` | `/schedules/:id/run` | Fire now |

### Streaming a turn

`POST /api/sessions/:id/messages` responds with `text/event-stream`, one JSON
event per frame:

```
data: {"type":"tool_call","id":"toolu_…","name":"write_file","input":{…}}
data: {"type":"tool_result","id":"toolu_…","ok":true,"summary":"wrote /src/app.ts","durationMs":12}
data: {"type":"workspace_changed"}
data: {"type":"text_delta","text":"Created "}
data: {"type":"proposals","proposals":[{"title":"Add tests","prompt":"…"}]}
data: {"type":"turn_end","stopReason":"end_turn","usage":{…}}
```

Types: `turn_start` `thinking_delta` `text_delta` `tool_call` `tool_result`
`workspace_changed` `brain_changed` `schedule_changed` `proposals` `turn_end`
`error`. See `frontend/src/lib/useAgentStream.ts`.

---

## Project layout

```
api/                              Main backend (Express + MongoDB)
  docker-compose.yml              Local MongoDB
  src/
    index.ts                      Entry: connect, then listen
    app.ts                        Middleware and route mounting
    config/env.ts                 Validated at boot — a bad secret stops the process
    db/mongo.ts                   Client, typed collections, index creation
    models/                       user · session · turn
    lib/                          password (bcrypt) · jwt (jose) · errors · http
    middleware/                   auth (cookie + service token) · error
    modules/
      auth/                       register · login · logout · me
      profile/                    name, settings, password, usage totals
      sessions/                   the session index and archived transcripts
      internal/                   Worker → API: turn reports, session mirroring

backend/                          Cloudflare Worker (TypeScript + Hono)
  src/
    index.ts                      Entry: CORS, routing, DO exports, capability probe
    types.ts                      The contract shared with the frontend
    auth/                         session (JWT verify) · middleware · api-client
    routes/                       sessions · workspace · brain · schedules
    durable-objects/              agent-session · workspace · brain · scheduler · registry
    agent/
      runner.ts                   The agent loop
      tools.ts                    Tool schemas (shell added only when available)
      tool-runtime.ts             Tool execution across the objects
      system-prompt.ts            Stable prompt + volatile context block
      pricing.ts                  Token cost estimation
      errors.ts                   Readable failure messages
      sandbox/                    types (interface) · daytona · index (selection)
    workspace/                    filesystem · paths · glob
    http/                         errors · stubs

frontend/                         Next.js App Router + Tailwind
  src/
    app/sessions/[sessionId]/     Folder routing
    app/login/ app/register/      Auth pages
    app/settings/                 Profile, session defaults, usage, password
    components/
      auth/                       AuthForm · RequireAuth · AccountMenu
      SessionView.tsx             Owns transcript, live turn, and all four stores
      chat/                       Messages · composer · tools · reasoning · proposals · usage
      workspace/                  Tree · viewer/editor · diff
      brain/                      Memory · skills
      schedule/                   Background agents
      archive/                    The MongoDB-backed transcript
      RightRail.tsx               The five tabs
      layout/ ui/                 Shell, buttons, feedback, icons
      settings/                   SettingsView
    lib/                          api · types · format · useAuth · useThemeSync
                                  useAgentStream · useWorkspace · useBrain
                                  useSchedules · useArchive
```

---

## Design notes

- **The Worker is stateless.** Every piece of state is in a Durable Object.
- **One place to change the contract.** `backend/src/types.ts` and
  `frontend/src/lib/types.ts` mirror each other and are small enough to read in
  one sitting.
- **Capabilities are probed, not assumed.** `/api/health` reports whether a shell
  exists, and both the tool list and the system prompt follow it — the agent is
  never offered a tool the deployment cannot back.
- **Errors are a first-class path.** Workspace errors map to real HTTP statuses;
  SDK failures become sentences a human can act on. A background run's failure is
  recorded in its history, because nobody was watching it happen.

## Credit

The architecture follows the approach Miguel Salinas described in
[camelAI's writeup](https://github.com/qaml-ai/camelAI) on moving their agent off
virtual machines and into a Durable Object.
