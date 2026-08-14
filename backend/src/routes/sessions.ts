/**
 * Session routes.
 *
 * Thin plumbing: authenticate, pick the right Durable Object, hand off. The
 * streaming endpoint is the one exception — it forwards the request to the
 * session object and pipes the SSE response straight back to the browser.
 *
 * Sessions are addressed per user, so the id in the URL is only half an
 * address; the other half comes from the verified cookie and can never be
 * supplied by the caller.
 */

import { Hono } from 'hono';
import { AUTO_MODEL, EFFORT_LEVELS, MODELS } from '../agent/models';
import { fetchBudget, registerSession, updateSession } from '../auth/api-client';
import { authenticate, type AuthEnv } from '../auth/middleware';
import { ApiError } from '../http/errors';
import { registryStub, sessionStub, workspaceStub } from '../http/stubs';

export const sessionRoutes = new Hono<AuthEnv>();

/** GET /api/sessions/models — what the picker offers, with prices. */
sessionRoutes.get('/models', (c) =>
	c.json({
		models: MODELS,
		efforts: EFFORT_LEVELS,
		/** Not a model — a strategy. Offered alongside them in the picker. */
		auto: {
			id: AUTO_MODEL,
			label: 'Auto',
			blurb: 'Starts cheap and moves up only when a step actually fails.',
		},
	}),
);

// Everything below this line needs a signed-in user.
sessionRoutes.use('*', authenticate);

/** POST /api/sessions — create a session and its workspace. */
sessionRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await readJson<{ title?: string; model?: string; effort?: string }>(c.req.raw);
	const id = crypto.randomUUID();
	const title =
		typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled session';

	// The browser sends the account's saved defaults. The session object
	// validates them and ignores anything it does not recognise.
	const summary = await sessionStub(c.env, user.id, id).init({
		sessionId: id,
		title,
		userId: user.id,
		model: typeof body.model === 'string' ? body.model : undefined,
		effort: typeof body.effort === 'string' ? body.effort : undefined,
	});

	// Mirror it into MongoDB so it appears in the sidebar before it has any
	// turns. Off the response path: the session already exists either way.
	c.executionCtx.waitUntil(registerSession(c.env, { id, userId: user.id, title }));

	return c.json({ session: summary }, 201);
});

/** GET /api/sessions/:id — metadata plus the full transcript. */
sessionRoutes.get('/:id', async (c) => {
	const id = c.req.param('id');
	const stub = sessionStub(c.env, c.get('user').id, id);
	const [session, messages] = await Promise.all([stub.summary(), stub.transcript()]);

	if (!session.id) throw ApiError.notFound(`Session ${id} does not exist.`);
	return c.json({ session, messages });
});

/** PATCH /api/sessions/:id — rename, or switch model/effort. */
sessionRoutes.patch('/:id', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const body = await readJson<{
		title?: string;
		model?: string;
		effort?: string;
		runtime?: string;
	}>(c.req.raw);
	const stub = sessionStub(c.env, user.id, id);

	if (body.model !== undefined || body.effort !== undefined || body.runtime !== undefined) {
		const summary = await stub.configure({
			model: body.model,
			effort: body.effort,
			runtime: body.runtime,
		});
		return c.json({ session: summary });
	}

	if (typeof body.title !== 'string' || !body.title.trim()) {
		throw ApiError.badRequest(
			'"title" must be a non-empty string, or send "model", "effort" or "runtime".',
		);
	}

	const summary = await stub.rename(body.title.trim());
	c.executionCtx.waitUntil(updateSession(c.env, id, { userId: user.id, title: summary.title }));
	return c.json({ session: summary });
});

/** DELETE /api/sessions/:id — drop the conversation and its files. */
sessionRoutes.delete('/:id', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');

	await Promise.all([
		sessionStub(c.env, user.id, id).clearHistory(),
		workspaceStub(c.env, user.id, id).clear(),
	]);

	// Archived rather than deleted in Mongo: the usage record outlives the
	// conversation, which is what makes per-account billing possible later.
	c.executionCtx.waitUntil(updateSession(c.env, id, { userId: user.id, archived: true }));
	return c.body(null, 204);
});

/**
 * POST /api/sessions/:id/messages — send a message, stream the turn back.
 *
 * The response is `text/event-stream`. Each frame is one `AgentEvent`.
 */
sessionRoutes.post('/:id/messages', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const body = await readJson<{ message?: string }>(c.req.raw);
	if (typeof body.message !== 'string' || !body.message.trim()) {
		throw ApiError.badRequest('"message" must be a non-empty string.');
	}

	const stub = sessionStub(c.env, user.id, id);
	const summary = await stub.summary();
	if (!summary.id) throw ApiError.notFound(`Session ${id} does not exist.`);

	// Balance first, before anything is spent. The turn report arrives after the
	// money is gone, so this is the only point where a refusal is still useful.
	const budget = await fetchBudget(c.env, user.id);
	if (budget?.exhausted) {
		throw new ApiError(
			402,
			'This account has used all of its credits. Nothing further will run until it is topped up.',
		);
	}

	// Per-account cap, checked before the model is ever called. The per-session
	// cap lives in the session object; this one protects the key across all of
	// one user's sessions at once.
	const gate = await registryStub(c.env, user.id).consumeTurn(
		Number(c.env.DEMO_HOURLY_TURN_LIMIT ?? 0),
	);
	if (!gate.allowed) {
		throw new ApiError(
			429,
			`This demo is limited to ${gate.limit} turns per hour and has used them all. Try again in about ${Math.ceil(gate.retryAfterSeconds / 60)} minute(s).`,
		);
	}

	const response = await stub.fetch('http://session/run', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: body.message }),
	});

	if (!response.ok || !response.body) {
		const error = await response.text();
		throw new ApiError(response.status === 409 ? 409 : 500, error || 'Failed to start the turn.');
	}

	return new Response(response.body, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		},
	});
});

/** GET /api/sessions/:id/sandbox — is a container up, and what is it running? */
sessionRoutes.get('/:id/sandbox', async (c) => {
	const stub = sessionStub(c.env, c.get('user').id, c.req.param('id'));
	return c.json(await stub.sandboxStatus());
});

/** DELETE /api/sessions/:id/sandbox — destroy the container, keep the session. */
sessionRoutes.delete('/:id/sandbox', async (c) => {
	const stub = sessionStub(c.env, c.get('user').id, c.req.param('id'));
	return c.json(await stub.stopSandbox());
});

/** DELETE /api/sessions/:id/sandbox/processes/:name — stop one dev server. */
sessionRoutes.delete('/:id/sandbox/processes/:name', async (c) => {
	const stub = sessionStub(c.env, c.get('user').id, c.req.param('id'));
	return c.json(await stub.stopSandboxProcess(c.req.param('name')));
});

/** POST /api/sessions/:id/sandbox/preview — a fresh link for one port. */
sessionRoutes.post('/:id/sandbox/preview', async (c) => {
	const body = await readJson<{ port?: number }>(c.req.raw);
	const port = Number(body.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw ApiError.badRequest('"port" must be a valid port number.');
	}

	const stub = sessionStub(c.env, c.get('user').id, c.req.param('id'));
	const preview = await stub.sandboxPreview(port);
	if (!preview) {
		throw new ApiError(409, 'No container is running, or it cannot expose a port.');
	}
	return c.json({ preview });
});

/**
 * POST /api/sessions/:id/shell — run one command, stream its output back.
 *
 * The session object decides whether a shell is available at all (it depends on
 * the runtime), so this route only checks the session exists and pipes the
 * stream. Errors come back as JSON with a `code` the UI can act on rather than
 * only a sentence it has to show verbatim.
 */
sessionRoutes.post('/:id/shell', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const body = await readJson<{ command?: string }>(c.req.raw);
	if (typeof body.command !== 'string' || !body.command.trim()) {
		throw ApiError.badRequest('"command" must be a non-empty string.');
	}

	const stub = sessionStub(c.env, user.id, id);
	const summary = await stub.summary();
	if (!summary.id) throw ApiError.notFound(`Session ${id} does not exist.`);

	const response = await stub.fetch('http://session/shell', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ command: body.command }),
	});

	// A refusal (wrong runtime, turn in flight) arrives as JSON, not a stream.
	if (!response.ok || !response.body) {
		return new Response(await response.text(), {
			status: response.status,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	return new Response(response.body, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		},
	});
});

/** DELETE /api/sessions/:id/messages — clear the conversation, keep the files. */
sessionRoutes.delete('/:id/messages', async (c) => {
	await sessionStub(c.env, c.get('user').id, c.req.param('id')).clearHistory();
	return c.body(null, 204);
});

async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		throw ApiError.badRequest('Request body must be valid JSON.');
	}
}
