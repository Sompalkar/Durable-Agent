# Deploying

Three services on three free tiers. No custom domain required — the session
token travels as a bearer header when the hosts differ, which is what makes a
split deployment work at all.

```
Vercel        frontend
Render        main API (accounts, history, credits)
Cloudflare    the Worker and every Durable Object
Atlas M0      MongoDB
```

Do them in this order: each step needs a URL from the one before it.

---

## 1. MongoDB Atlas

Create a free **M0** cluster, then a database user.

Under **Network Access**, allow `0.0.0.0/0`. Render's free plan has no static
egress IP, so there is nothing narrower to allow-list. The database user's
password is the real boundary — make it long.

Copy the connection string. It looks like:

```
mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

## 2. Generate the two shared secrets

```bash
openssl rand -base64 48   # AUTH_JWT_SECRET
openssl rand -hex 24      # SERVICE_TOKEN
```

Keep both. They must be **byte-identical** on Render and on Cloudflare — they
are the only thing making the two services trust each other.

## 3. Render — the API

New → Blueprint → point at this repo. `render.yaml` does the rest.

Set the four secrets marked `sync: false` in the dashboard:

| | |
|---|---|
| `MONGODB_URI` | from step 1 |
| `AUTH_JWT_SECRET` | from step 2 |
| `SERVICE_TOKEN` | from step 2 |
| `CORS_ORIGINS` | leave blank for now — filled in at step 5 |

Note the URL, e.g. `https://durable-agent-api.onrender.com`.

Check it: `curl https://YOUR-API/health` → `{"ok":true,…}`

## 4. Cloudflare — the Worker

```bash
cd backend
npx wrangler login
```

Point the Worker at the API and lock down CORS. In `wrangler.jsonc`:

```jsonc
"MAIN_API_URL": "https://durable-agent-api.onrender.com",
"ALLOWED_ORIGIN": "https://YOUR-APP.vercel.app",   // step 5; deploy again after
```

Then the secrets — these never go in the file:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AUTH_JWT_SECRET     # same value as Render
npx wrangler secret put SERVICE_TOKEN       # same value as Render
npx wrangler secret put DAYTONA_API_KEY     # optional; no shell without it
npx wrangler deploy
```

Note the URL, e.g. `https://durable-agent.YOUR-SUBDOMAIN.workers.dev`.

Check it: `curl https://YOUR-WORKER/api/health`

## 5. Vercel — the frontend

```bash
npm i -g vercel      # the CLI is not bundled with npm
vercel login
cd frontend
vercel
```

Set two environment variables in the Vercel dashboard:

| | |
|---|---|
| `NEXT_PUBLIC_API_URL` | the Worker URL from step 4 |
| `NEXT_PUBLIC_MAIN_API_URL` | the Render URL from step 3 |

Then `vercel --prod`.

## 6. Close the loop

Two values were placeholders because the URL did not exist yet:

- **Render** → `CORS_ORIGINS` = your Vercel URL
- **`wrangler.jsonc`** → `ALLOWED_ORIGIN` = your Vercel URL, then `wrangler deploy`

---

## Checks

```bash
curl https://YOUR-API/health           # {"ok":true,...}
curl https://YOUR-WORKER/api/health    # apiKeyConfigured: true
```

Then register on the site, send one message, and confirm the credit balance in
Settings has dropped.

## Things that will bite

**The two secrets must match.** Different values on Render and Cloudflare means
login appears to work and every agent request returns 401.

**`ALLOWED_ORIGIN` cannot be `*`.** A browser will not send credentials to a
wildcard origin.

**Deploying creates empty Durable Objects.** Nothing from local development
comes with you — no sessions, no memories, no skills. Do not demo something you
only built on your laptop.

**Cold starts.** The Worker's cron pings `/health` every ten minutes, which
keeps Render's free instance awake. If you remove the cron, expect the first
login after a quiet period to take about a minute.

**Credits.** New accounts get `SIGNUP_CREDITS_USD` (default $2). Anyone with the
link can register, so that ceiling is the only thing between a public URL and
your Anthropic bill.
