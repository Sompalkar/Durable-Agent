/**
 * Session tokens.
 *
 * A signed JWT in an httpOnly cookie. Two services read it — this API and the
 * Worker — and neither needs a shared database to do so, because a signature is
 * self-verifying. That is the whole reason for a JWT here rather than an opaque
 * session id.
 *
 * `jose` is used on both sides: it runs on Node and in the Workers runtime, so
 * the signing and verifying code is genuinely the same.
 */

import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

const ALGORITHM = 'HS256';
const ISSUER = 'durable-agent-api';
const AUDIENCE = 'durable-agent';

/** Claims carried in the token. Keep it small — it travels on every request. */
export interface SessionClaims {
	/** The user id. Also the Durable Object namespace. */
	sub: string;
	email: string;
	name: string;
}

const secret = new TextEncoder().encode(env.AUTH_JWT_SECRET);

export async function signSessionToken(claims: SessionClaims): Promise<string> {
	return new SignJWT({ email: claims.email, name: claims.name })
		.setProtectedHeader({ alg: ALGORITHM })
		.setSubject(claims.sub)
		.setIssuer(ISSUER)
		.setAudience(AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(`${env.AUTH_TOKEN_TTL_DAYS}d`)
		.sign(secret);
}

/** Returns the claims, or null for anything invalid, expired, or tampered with. */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
	try {
		const { payload } = await jwtVerify(token, secret, {
			issuer: ISSUER,
			audience: AUDIENCE,
			algorithms: [ALGORITHM],
		});

		if (typeof payload.sub !== 'string') return null;
		return {
			sub: payload.sub,
			email: typeof payload.email === 'string' ? payload.email : '',
			name: typeof payload.name === 'string' ? payload.name : '',
		};
	} catch {
		return null;
	}
}

/** Name of the cookie holding the token. Shared with the Worker. */
export const SESSION_COOKIE = 'da_session';

export const cookieMaxAgeSeconds = env.AUTH_TOKEN_TTL_DAYS * 24 * 60 * 60;
