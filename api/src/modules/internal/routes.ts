/**
 * Internal routes — the Worker calling back into this API.
 *
 * Guarded by the shared service token, never by a cookie. A browser cannot
 * reach these, which matters because `userId` arrives in the body: the Worker
 * has already verified the JWT before it calls, so this API trusts the caller,
 * not the request.
 */

import { Router } from 'express';
import { z } from 'zod';
import { collections } from '../../db/mongo.js';
import { pathParam } from '../../lib/http.js';
import { requireService } from '../../middleware/auth.js';
import { route } from '../../middleware/error.js';
import { EMPTY_USAGE, type SessionDoc } from '../../models/session.js';
import { recordTurn } from '../sessions/service.js';

export const internalRoutes = Router();

internalRoutes.use(requireService);

const usage = z.object({
	inputTokens: z.number().nonnegative().default(0),
	outputTokens: z.number().nonnegative().default(0),
	cacheReadTokens: z.number().nonnegative().default(0),
	estimatedCostUsd: z.number().nonnegative().default(0),
});

const turnReport = z.object({
	sessionId: z.string().min(1),
	userId: z.string().min(1),
	// Long prompts and replies are truncated by the Worker; the cap here is a
	// backstop so one runaway turn cannot bloat the collection.
	prompt: z.string().max(20_000),
	reply: z.string().max(20_000),
	tools: z.array(z.string()).max(100).default([]),
	model: z.string().min(1),
	usage: usage.default({
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		estimatedCostUsd: 0,
	}),
	/** The schedule name when a background agent ran this, else null. */
	trigger: z.string().max(200).nullable().default(null),
	messageCount: z.number().int().nonnegative().default(0),
});

/**
 * POST /internal/turns
 *
 * Fire-and-forget from the Worker's point of view: history must never be the
 * reason a turn fails, so the Worker does not await this on the hot path.
 */
internalRoutes.post(
	'/turns',
	route(async (req, res) => {
		const report = turnReport.parse(req.body);
		await recordTurn(report);
		res.status(202).json({ ok: true });
	}),
);

/**
 * GET /internal/users/:id/budget
 *
 * Asked by the Worker before it starts a turn. Kept as its own endpoint rather
 * than folded into the turn report, because the report arrives *after* the money
 * is spent — by then it is too late to refuse.
 */
internalRoutes.get(
	'/users/:id/budget',
	route(async (req, res) => {
		const user = await collections.users().findOne({ id: pathParam(req, 'id') });
		if (!user) {
			res.status(404).json({ error: 'No such account.', code: 'user_not_found' });
			return;
		}

		res.json({
			creditsUsd: user.creditsUsd,
			exhausted: user.creditsUsd <= 0,
		});
	}),
);

/**
 * GET /internal/users/:id/github
 *
 * The Worker asking for a user's GitHub token so it can act on their behalf.
 * Service-token guarded, so this is machine-to-machine only — the token is
 * never reachable from a browser, including the browser of the user it belongs
 * to.
 */
internalRoutes.get(
	'/users/:id/github',
	route(async (req, res) => {
		const user = await collections.users().findOne({ id: pathParam(req, 'id') });
		if (!user?.github) {
			res.status(404).json({ error: 'No GitHub connection.', code: 'github_not_connected' });
			return;
		}

		res.json({
			token: user.github.token,
			login: user.github.login,
		});
	}),
);

const sessionRegistration = z.object({
	id: z.string().min(1),
	userId: z.string().min(1),
	title: z.string().max(120).default('New session'),
});

/**
 * PUT /internal/sessions
 *
 * The Worker mirrors a session here the moment its Durable Object is created,
 * so an empty session still appears in the sidebar. Idempotent: a retry after a
 * network blip must not duplicate the row or reset its usage.
 */
internalRoutes.put(
	'/sessions',
	route(async (req, res) => {
		const { id, userId, title } = sessionRegistration.parse(req.body);
		const now = new Date();

		const insert: SessionDoc = {
			id,
			userId,
			title,
			createdAt: now,
			updatedAt: now,
			messageCount: 0,
			usage: { ...EMPTY_USAGE },
			archivedAt: null,
		};

		await collections
			.sessions()
			.updateOne({ id, userId }, { $setOnInsert: insert }, { upsert: true });

		res.status(202).json({ ok: true });
	}),
);

const sessionPatch = z.object({
	userId: z.string().min(1),
	title: z.string().trim().min(1).max(120).optional(),
	messageCount: z.number().int().nonnegative().optional(),
	/** Set when the session was deleted in the Worker. */
	archived: z.boolean().optional(),
});

/** PATCH /internal/sessions/:id — mirror a rename or a deletion. */
internalRoutes.patch(
	'/sessions/:id',
	route(async (req, res) => {
		const { userId, title, messageCount, archived } = sessionPatch.parse(req.body);

		const update: Record<string, unknown> = { updatedAt: new Date() };
		if (title !== undefined) update.title = title;
		if (messageCount !== undefined) update.messageCount = messageCount;
		if (archived) update.archivedAt = new Date();

		await collections
			.sessions()
			.updateOne({ id: pathParam(req, 'id'), userId }, { $set: update });

		res.status(202).json({ ok: true });
	}),
);
