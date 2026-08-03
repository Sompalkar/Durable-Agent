/**
 * Memory and skills routes.
 *
 * Global to an account, not to a session: what the agent learns follows it into
 * every conversation you start, and nobody else's. The UI uses these to show —
 * and edit — that store directly.
 */

import { Hono } from 'hono';
import { authenticate, type AuthEnv } from '../auth/middleware';
import { ApiError } from '../http/errors';
import { brainStub } from '../http/stubs';

export const brainRoutes = new Hono<AuthEnv>();

brainRoutes.use('*', authenticate);

/** GET /api/brain — memories and skills in one call. */
brainRoutes.get('/', async (c) => {
	return c.json(await brainStub(c.env, c.get('user').id).snapshot());
});

/** POST /api/brain/memories — add a memory by hand. */
brainRoutes.post('/memories', async (c) => {
	const body = await readJson<{ content?: string; category?: string }>(c.req.raw);
	if (typeof body.content !== 'string' || !body.content.trim()) {
		throw ApiError.badRequest('"content" must be a non-empty string.');
	}

	const category = body.category === 'preference' || body.category === 'project' ? body.category : 'fact';
	const memory = await brainStub(c.env, c.get('user').id).remember(body.content, category, null);
	return c.json({ memory }, 201);
});

/** PATCH /api/brain/memories/:id — correct one. */
brainRoutes.patch('/memories/:id', async (c) => {
	const body = await readJson<{ content?: string }>(c.req.raw);
	if (typeof body.content !== 'string' || !body.content.trim()) {
		throw ApiError.badRequest('"content" must be a non-empty string.');
	}

	const memory = await brainStub(c.env, c.get('user').id).correct(numericParam(c.req.param('id')), body.content);
	return c.json({ memory });
});

brainRoutes.delete('/memories/:id', async (c) => {
	const removed = await brainStub(c.env, c.get('user').id).forget(numericParam(c.req.param('id')));
	if (!removed) throw ApiError.notFound('No such memory.');
	return c.body(null, 204);
});
 
brainRoutes.put('/skills', async (c) => {
	const body = await readJson<{ name?: string; description?: string; body?: string }>(c.req.raw);
	if (
		typeof body.name !== 'string' ||
		typeof body.description !== 'string' ||
		typeof body.body !== 'string'
	) {
		throw ApiError.badRequest('"name", "description", and "body" are all required strings.');
	}

	const skill = await brainStub(c.env, c.get('user').id).saveSkill(body.name, body.description, body.body);
	return c.json({ skill });
});

brainRoutes.delete('/skills/:name', async (c) => {
	const removed = await brainStub(c.env, c.get('user').id).deleteSkill(c.req.param('name'));
	if (!removed) throw ApiError.notFound('No such skill.');
	return c.body(null, 204);
});

function numericParam(value: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw ApiError.badRequest('Expected a numeric id.');
	return parsed;
}

async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		throw ApiError.badRequest('Request body must be valid JSON.');
	}
}
