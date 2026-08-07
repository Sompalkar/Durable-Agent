/**
 * Reading the signed-in user from a request.
 *
 * The Worker never issues tokens — the main API does that, against MongoDB.
 * Here we only verify: same secret, same issuer, same audience. `jose` runs on
 * both Node and workerd, so the verification code is identical on both sides.
 */

import { jwtVerify } from 'jose';
import { ApiError } from '../http/errors';

const ALGORITHM = 'HS256';
const ISSUER = 'durable-agent-api';
const AUDIENCE = 'durable-agent';

export const SESSION_COOKIE = 'da_session';

export interface AuthenticatedUser {
	id: string;
	email: string;
	name: string;
}

/**
 * Verify the session cookie, or throw 401.
 *
 * Everything downstream keys Durable Objects off the id this returns, so a
 * forged or expired token must never get past this function.
 */
export async function requireUser(request: Request, env: Env): Promise<AuthenticatedUser> {
	const token = readToken(request);
	if (!token) throw new ApiError(401, 'You need to sign in.');

	if (!env.AUTH_JWT_SECRET) {
		// Fail closed. A missing secret must not silently turn into "everyone is
		// authenticated" — that is how a demo becomes an incident.
		throw new ApiError(500, 'AUTH_JWT_SECRET is not configured on the Worker.');
	}

	try {
		const { payload } = await jwtVerify(token, new TextEncoder().encode(env.AUTH_JWT_SECRET), {
			algorithms: [ALGORITHM],
			issuer: ISSUER,
			audience: AUDIENCE,
		});

		if (typeof payload.sub !== 'string' || !payload.sub) {
			throw new ApiError(401, 'Your session is invalid. Please sign in again.');
		}

		return {
			id: payload.sub,
			email: typeof payload.email === 'string' ? payload.email : '',
			name: typeof payload.name === 'string' ? payload.name : '',
		};
	} catch (error) {
		if (error instanceof ApiError) throw error;
		throw new ApiError(401, 'Your session has expired. Please sign in again.');
	}
}

/**
 * The session token, from wherever the browser could send it.
 *
 * The cookie is preferred — httpOnly, so a script cannot read it. But a cookie
 * only travels to the site that set it, and when the frontend and this Worker
 * are on unrelated hosts there is no such site. The bearer header is what makes
 * a split deployment work at all.
 */
function readToken(request: Request): string | null {
	const cookie = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
	if (cookie) return cookie;

	const header = request.headers.get('authorization') ?? '';
	return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/**
 * Pull one cookie out of a Cookie header.
 *
 * Values are split on the first `=` only, because a JWT is base64url and can
 * legitimately end in `=` padding.
 */
function readCookie(header: string | null, name: string): string | null {
	if (!header) return null;

	for (const part of header.split(';')) {
		const separator = part.indexOf('=');
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== name) continue;
		return decodeURIComponent(part.slice(separator + 1).trim()) || null;
	}
	return null;
}
