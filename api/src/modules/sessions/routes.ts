/**
 * Session history, for the browser.
 *
 * These routes describe sessions; they never touch the conversation itself.
 * Reading or continuing a conversation goes to the Worker, which owns the
 * Durable Object. This is the index, not the content.
 */

import { Router } from 'express';
import { z } from 'zod';
import { pathParam } from '../../lib/http.js';
import { requireUser } from '../../middleware/auth.js';
import { route } from '../../middleware/error.js';
import { toPublicSession } from '../../models/session.js';
import { toPublicTurn } from '../../models/turn.js';
import {
	archiveSession,
	createSession,
	listSessions,
	listTurns,
	renameSession,
	requireOwnedSession,
} from './service.js';

export const sessionRoutes = Router();

sessionRoutes.use(requireUser);

const listQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /api/sessions */
sessionRoutes.get(
	'/',
	route(async (req, res) => {
		const { limit } = listQuery.parse(req.query);
		const sessions = await listSessions(req.user!.id, limit);
		res.json({ sessions: sessions.map(toPublicSession) });
	}),
);

const createBody = z.object({
	title: z.string().trim().max(120).optional(),
});

/** POST /api/sessions — allocate an id before the Durable Object exists. */
sessionRoutes.post(
	'/',
	route(async (req, res) => {
		const { title } = createBody.parse(req.body ?? {});
		const session = await createSession(req.user!.id, title);
		res.status(201).json({ session: toPublicSession(session) });
	}),
);

/** GET /api/sessions/:id */
sessionRoutes.get(
	'/:id',
	route(async (req, res) => {
		const session = await requireOwnedSession(req.user!.id, pathParam(req, 'id'));
		res.json({ session: toPublicSession(session) });
	}),
);

const renameBody = z.object({
	title: z.string().trim().min(1, 'Title cannot be empty.').max(120),
});

/** PATCH /api/sessions/:id */
sessionRoutes.patch(
	'/:id',
	route(async (req, res) => {
		const { title } = renameBody.parse(req.body);
		const session = await renameSession(req.user!.id, pathParam(req, 'id'), title);
		res.json({ session: toPublicSession(session) });
	}),
);

/** DELETE /api/sessions/:id — archives; usage history is kept. */
sessionRoutes.delete(
	'/:id',
	route(async (req, res) => {
		await archiveSession(req.user!.id, pathParam(req, 'id'));
		res.status(204).end();
	}),
);

const turnsQuery = z.object({
	limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** GET /api/sessions/:id/turns — the durable transcript. */
sessionRoutes.get(
	'/:id/turns',
	route(async (req, res) => {
		// Ownership first: never read turns for a session the caller does not own.
		const session = await requireOwnedSession(req.user!.id, pathParam(req, 'id'));
		const { limit } = turnsQuery.parse(req.query);
		const turns = await listTurns(session.id, limit);
		res.json({ turns: turns.map(toPublicTurn) });
	}),
);
