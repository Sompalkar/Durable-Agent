/**
 * Authentication routes.
 *
 * Email and password, exchanged for a signed cookie. Deliberately boring: the
 * interesting part of this project is the agent, and auth is a place where
 * being clever is a liability.
 */

import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { collections } from '../../db/mongo.js';
import { ApiError } from '../../lib/errors.js';
import { signSessionToken } from '../../lib/jwt.js';
import {
	hashPassword,
	verifyPassword,
	verifyPasswordAgainstNothing,
} from '../../lib/password.js';
import { requireUser } from '../../middleware/auth.js';
import { route } from '../../middleware/error.js';
import {
	DEFAULT_SETTINGS,
	normalizeEmail,
	toPublicUser,
	type UserDoc,
} from '../../models/user.js';
import { clearSessionCookie, setSessionCookie } from './cookie.js';

export const authRoutes = Router();

const credentials = z.object({
	email: z.email('Enter a valid email address.'),
	password: z
		.string()
		.min(8, 'Use at least 8 characters.')
		.max(200, 'That password is too long.'),
});

const registration = credentials.extend({
	name: z.string().trim().min(1, 'Tell us your name.').max(80).optional(),
});

/** POST /api/auth/register */
authRoutes.post(
	'/register',
	route(async (req, res) => {
		const { email, password, name } = registration.parse(req.body);
		const normalized = normalizeEmail(email);

		const existing = await collections.users().findOne({ email: normalized });
		if (existing) {
			throw ApiError.conflict('An account with that email already exists.', 'email_taken');
		}

		const now = new Date();
		const user: UserDoc = {
			id: randomUUID(),
			email: normalized,
			passwordHash: await hashPassword(password),
			name: name?.trim() || normalized.split('@')[0] || 'there',
			createdAt: now,
			updatedAt: now,
			lastLoginAt: now,
			settings: { ...DEFAULT_SETTINGS },
			creditsUsd: env.SIGNUP_CREDITS_USD,
			plan: 'free',
		};

		await collections.users().insertOne(user);

		const token = await signSessionToken(tokenClaims(user));
		setSessionCookie(res, token);
		// Also returned in the body, for clients on a different site than this API
		// — see readToken in middleware/auth.ts.
		res.status(201).json({ user: toPublicUser(user), token });
	}),
);

/** POST /api/auth/login */
authRoutes.post(
	'/login',
	route(async (req, res) => {
		const { email, password } = credentials.parse(req.body);
		const user = await collections.users().findOne({ email: normalizeEmail(email) });

		// Spend the same time whether or not the account exists, so response
		// latency does not reveal which emails are registered.
		if (!user) {
			await verifyPasswordAgainstNothing(password);
			throw ApiError.unauthorized('Email or password is incorrect.', 'invalid_credentials');
		}

		if (!(await verifyPassword(password, user.passwordHash))) {
			throw ApiError.unauthorized('Email or password is incorrect.', 'invalid_credentials');
		}

		await collections
			.users()
			.updateOne({ id: user.id }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } });

		const token = await signSessionToken(tokenClaims(user));
		setSessionCookie(res, token);
		res.json({ user: toPublicUser(user), token });
	}),
);

/** POST /api/auth/logout */
authRoutes.post('/logout', (_req, res) => {
	clearSessionCookie(res);
	res.status(204).end();
});

/**
 * GET /api/auth/me
 *
 * Re-reads the user rather than trusting the token's claims, so a rename or a
 * settings change is reflected without forcing a new login.
 */
authRoutes.get(
	'/me',
	requireUser,
	route(async (req, res) => {
		const user = await collections.users().findOne({ id: req.user!.id });
		if (!user) throw ApiError.unauthorized('That account no longer exists.', 'user_gone');
		res.json({ user: toPublicUser(user) });
	}),
);

function tokenClaims(user: UserDoc) {
	return { sub: user.id, email: user.email, name: user.name };
}
