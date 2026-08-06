/**
 * Profile and settings.
 *
 * Settings live on the user rather than in the browser so they follow the
 * account across devices — the same reason the agent's memory lives in a
 * Durable Object rather than in local storage.
 */

import { Router } from 'express';
import { z } from 'zod';
import { collections } from '../../db/mongo.js';
import { ApiError } from '../../lib/errors.js';
import {
	hashPassword,
	verifyPassword,
} from '../../lib/password.js';
import { requireUser } from '../../middleware/auth.js';
import { route } from '../../middleware/error.js';
import { toPublicUser } from '../../models/user.js';

export const profileRoutes = Router();

profileRoutes.use(requireUser);

const profileUpdate = z.object({
	name: z.string().trim().min(1, 'Name cannot be empty.').max(80).optional(),
	settings: z
		.object({
			theme: z.enum(['dark', 'light']).optional(),
			defaultModel: z.string().min(1).optional(),
			defaultEffort: z.string().min(1).optional(),
		})
		.optional(),
});

/** PATCH /api/profile — name and settings. */
profileRoutes.patch(
	'/',
	route(async (req, res) => {
		const patch = profileUpdate.parse(req.body);

		// Build a $set of only the provided fields, so a partial update never
		// blanks something the client did not mention.
		const update: Record<string, unknown> = { updatedAt: new Date() };
		if (patch.name !== undefined) update.name = patch.name;
		if (patch.settings) {
			for (const [key, value] of Object.entries(patch.settings)) {
				if (value !== undefined) update[`settings.${key}`] = value;
			}
		}

		const user = await collections
			.users()
			.findOneAndUpdate(
				{ id: req.user!.id },
				{ $set: update },
				{ returnDocument: 'after' },
			);

		if (!user) throw ApiError.notFound('Account not found.');
		res.json({ user: toPublicUser(user) });
	}),
);

const passwordChange = z.object({
	currentPassword: z.string().min(1, 'Enter your current password.'),
	newPassword: z.string().min(8, 'Use at least 8 characters.').max(200),
});

/** POST /api/profile/password */
profileRoutes.post(
	'/password',
	route(async (req, res) => {
		const { currentPassword, newPassword } = passwordChange.parse(req.body);

		const user = await collections.users().findOne({ id: req.user!.id });
		if (!user) throw ApiError.notFound('Account not found.');

		if (!(await verifyPassword(currentPassword, user.passwordHash))) {
			throw ApiError.badRequest('Your current password is incorrect.', 'wrong_password');
		}

		await collections.users().updateOne(
			{ id: user.id },
			{ $set: { passwordHash: await hashPassword(newPassword), updatedAt: new Date() } },
		);

		res.status(204).end();
	}),
);

/**
 * GET /api/profile/usage — spend across every session.
 *
 * Aggregated in Mongo rather than by summing session documents, so it stays
 * correct once turns are the source of truth for billing.
 */
profileRoutes.get(
	'/usage',
	route(async (req, res) => {
		const [totals] = await collections
			.turns()
			.aggregate<{
				turns: number;
				inputTokens: number;
				outputTokens: number;
				cacheReadTokens: number;
				estimatedCostUsd: number;
			}>([
				{ $match: { userId: req.user!.id } },
				{
					$group: {
						_id: null,
						turns: { $sum: 1 },
						inputTokens: { $sum: '$usage.inputTokens' },
						outputTokens: { $sum: '$usage.outputTokens' },
						cacheReadTokens: { $sum: '$usage.cacheReadTokens' },
						estimatedCostUsd: { $sum: '$usage.estimatedCostUsd' },
					},
				},
				{ $project: { _id: 0 } },
			])
			.toArray();

		res.json({
			usage: totals ?? {
				turns: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				estimatedCostUsd: 0,
			},
		});
	}),
);
