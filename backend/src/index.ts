/**
 * Worker entry point.
 *
 * The Worker itself is stateless routing. All state — conversations, files,
 * revisions — lives in the Durable Objects exported at the bottom of this file.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sandboxConfigured } from './agent/sandbox';
import { renderError } from './http/errors';
import { brainRoutes } from './routes/brain';
import { githubRoutes } from './routes/github';
import { scheduleRoutes } from './routes/schedules';
import { sessionRoutes } from './routes/sessions';
import { workspaceRoutes } from './routes/workspace';

const app = new Hono<{ Bindings: Env }>();

app.use(
	'*',
	cors({
		// ALLOWED_ORIGIN is a comma-separated allowlist. Now that requests carry
		// a session cookie it must name real origins: the browser refuses to
		// send credentials to a wildcard, so "*" would silently sign everyone out.
		origin: (origin, c) => {
			const allowed = (c.env.ALLOWED_ORIGIN || '*')
				.split(',')
				.map((value: string) => value.trim())
				.filter(Boolean);
			if (allowed.includes('*')) return origin;
			return allowed.includes(origin) ? origin : null;
		},
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type'],
		// Lets the browser attach the session cookie to these requests.
		credentials: true,
		maxAge: 86_400,
	}),
);

app.onError(renderError);
app.notFound((c) => c.json({ error: 'Not found' }, 404));

/**
 * Also acts as the capability probe: the frontend reads this to know whether a
 * shell exists and whether demo limits are in force, so the UI never advertises
 * something the deployment cannot do.
 */
app.get('/api/health', (c) =>
	c.json({
		status: 'ok',
		model: c.env.AGENT_MODEL,
		apiKeyConfigured: Boolean(c.env.ANTHROPIC_API_KEY),
		sandboxEnabled: sandboxConfigured(c.env),
		sandboxProvider: c.env.SANDBOX_PROVIDER || null,
		limits: {
			perSessionTurns: Number(c.env.DEMO_TURN_LIMIT ?? 0) || null,
			perHourTurns: Number(c.env.DEMO_HOURLY_TURN_LIMIT ?? 0) || null,
		},
	}),
);

// Both routers mount under /api/sessions: one owns the conversation, the other
// owns the workspace that belongs to it.
app.route('/api/sessions', sessionRoutes);
app.route('/api/sessions', workspaceRoutes);
// Repository work: attach a repo to a session, and ship the result as a PR.
app.route('/api/sessions', githubRoutes);

// Memory, skills, and schedules are global — they outlive any one session.
app.route('/api/brain', brainRoutes);
app.route('/api/schedules', scheduleRoutes);

export default app;

export { AgentSessionDO } from './durable-objects/agent-session-do';
export { WorkspaceDO } from './durable-objects/workspace-do';
export { SessionRegistryDO } from './durable-objects/session-registry-do';
export { BrainDO } from './durable-objects/brain-do';
export { SchedulerDO } from './durable-objects/scheduler-do';

// The shell. `Sandbox` is a Durable Object with a Linux container attached, so
// enabling it means adding a binding, a migration, and a container image — see
// the commented block in wrangler.jsonc. Left off by default so `wrangler dev`
// works without Docker.
// export { Sandbox } from '@cloudflare/sandbox';
