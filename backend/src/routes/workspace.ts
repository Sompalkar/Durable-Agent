/**
 * Workspace routes.
 *
 * Read-only from the browser's perspective plus a couple of explicit editing
 * actions, all of which land on the same `WorkspaceDO` the agent's tools use.
 * The file explorer and the agent are looking at exactly the same database.
 */

import { Hono } from 'hono';
import { authenticate, type AuthEnv } from '../auth/middleware';
import { ApiError } from '../http/errors';
import { workspaceStub } from '../http/stubs';

export const workspaceRoutes = new Hono<AuthEnv>();

workspaceRoutes.use('*', authenticate);

/** GET /api/sessions/:id/workspace — directories, files, and totals in one call. */
workspaceRoutes.get('/:id/workspace', async (c) => {
	const tree = await workspaceStub(c.env, c.get('user').id, c.req.param('id')).tree();
	return c.json(tree);
});

/** GET /api/sessions/:id/workspace/file?path=/src/index.ts */
workspaceRoutes.get('/:id/workspace/file', async (c) => {
	const path = c.req.query('path');
	if (!path) throw ApiError.badRequest('A "path" query parameter is required.');

	const file = await workspaceStub(c.env, c.get('user').id, c.req.param('id')).read(path);
	return c.json({ file });
});

/** GET /api/sessions/:id/workspace/history?path=/src/index.ts */
workspaceRoutes.get('/:id/workspace/history', async (c) => {
	const path = c.req.query('path');
	if (!path) throw ApiError.badRequest('A "path" query parameter is required.');

	const revisions = await workspaceStub(c.env, c.get('user').id, c.req.param('id')).history(path);
	return c.json({ revisions });
});

/** GET /api/sessions/:id/workspace/revision?path=&version= — one old revision. */
workspaceRoutes.get('/:id/workspace/revision', async (c) => {
	const path = c.req.query('path');
	const version = Number(c.req.query('version'));
	if (!path) throw ApiError.badRequest('A "path" query parameter is required.');
	if (!Number.isFinite(version)) throw ApiError.badRequest('A numeric "version" is required.');

	const revision = await workspaceStub(c.env, c.get('user').id, c.req.param('id')).revision(path, version);
	return c.json({ revision });
});

/** PUT /api/sessions/:id/workspace/file — let the user edit a file directly. */
workspaceRoutes.put('/:id/workspace/file', async (c) => {
	const body = await c.req.json<{ path?: string; content?: string }>().catch(() => ({}) as never);
	if (typeof body.path !== 'string' || typeof body.content !== 'string') {
		throw ApiError.badRequest('"path" and "content" are both required strings.');
	}

	const file = await workspaceStub(c.env, c.get('user').id, c.req.param('id')).write(
		body.path,
		body.content,
		'edited by user',
	);
	return c.json({ file });
});

/** DELETE /api/sessions/:id/workspace/file?path=/src/index.ts */
workspaceRoutes.delete('/:id/workspace/file', async (c) => {
	const path = c.req.query('path');
	if (!path) throw ApiError.badRequest('A "path" query parameter is required.');

	const removed = await workspaceStub(c.env, c.get('user').id, c.req.param('id')).remove(path);
	if (!removed) throw ApiError.notFound(`No such file: ${path}`);
	return c.body(null, 204);
});
