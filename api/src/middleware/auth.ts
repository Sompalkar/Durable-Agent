/**
 * Authentication middleware.
 *
 * Two kinds of caller reach this API:
 *
 *   a browser  — carries the session cookie, and is a person
 *   the Worker — carries the service token, and is a machine reporting turns
 *
 * They are deliberately separate. A browser must never be able to call the
 * internal endpoints, and the Worker has no cookie to present.
 */

import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { SESSION_COOKIE, verifySessionToken } from '../lib/jwt.js';

/** The authenticated user, attached to the request by `requireUser`. */
export interface AuthenticatedUser {
	id: string;
	email: string;
	name: string;
}

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			user?: AuthenticatedUser;
		}
	}
}

/**
 * The session token, from wherever the client could send it.
 *
 * The cookie is preferred: it is httpOnly, so a cross-site script cannot read
 * it. But a cookie is only sent to the site that set it, and when the frontend,
 * the API and the Worker live on three unrelated hosts there is no such site.
 * The bearer header is the fallback that makes a split deployment possible at
 * all — less safe against XSS, which is why it is second and not first.
 */
function readToken(req: Request): string | null {
	const cookie = req.cookies?.[SESSION_COOKIE];
	if (typeof cookie === 'string' && cookie) return cookie;

	const header = req.get('authorization') ?? '';
	return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/** Reject anything without a valid session token. */
export async function requireUser(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	const token = readToken(req);
	if (!token) {
		next(ApiError.unauthorized());
		return;
	}

	const claims = await verifySessionToken(token);
	if (!claims) {
		next(ApiError.unauthorized('Your session has expired. Please sign in again.', 'expired'));
		return;
	}

	req.user = { id: claims.sub, email: claims.email, name: claims.name };
	next();
}

/**
 * Machine-to-machine guard for `/internal/*`.
 *
 * Compared in constant time so the token cannot be recovered a byte at a time
 * by measuring response latency.
 */
export function requireService(req: Request, _res: Response, next: NextFunction): void {
	const header = req.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

	if (!presented || !timingSafeEqual(presented, env.SERVICE_TOKEN)) {
		next(ApiError.unauthorized('Invalid service token.', 'invalid_service_token'));
		return;
	}
	next();
}

/** Reads the user when present, but never rejects. */
export async function optionalUser(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	const token = readToken(req);
	if (token) {
		const claims = await verifySessionToken(token);
		if (claims) req.user = { id: claims.sub, email: claims.email, name: claims.name };
	}
	next();
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return mismatch === 0;
}
