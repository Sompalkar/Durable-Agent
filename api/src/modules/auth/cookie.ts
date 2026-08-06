/**
 * Session cookie handling.
 *
 * The one subtle bit: cookies are scoped by *hostname*, not port. So a cookie
 * set on `localhost` by this API on :4000 is also sent to the Worker on :8787
 * and to Next on :3000 — which is exactly what makes one login work across all
 * three in development. Using `127.0.0.1` anywhere would break that, because
 * the browser treats it as a different host.
 */

import type { Response } from 'express';
import { env, isProduction } from '../../config/env.js';
import { cookieMaxAgeSeconds, SESSION_COOKIE } from '../../lib/jwt.js';

export function setSessionCookie(res: Response, token: string): void {
	res.cookie(SESSION_COOKIE, token, {
		httpOnly: true, // JavaScript cannot read it, so XSS cannot steal it.
		sameSite: 'lax', // Sent on top-level navigation, not on cross-site posts.
		secure: isProduction, // HTTPS only in production; plain http locally.
		path: '/',
		maxAge: cookieMaxAgeSeconds * 1000,
		...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
	});
}

export function clearSessionCookie(res: Response): void {
	res.clearCookie(SESSION_COOKIE, {
		httpOnly: true,
		sameSite: 'lax',
		secure: isProduction,
		path: '/',
		...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
	});
}
