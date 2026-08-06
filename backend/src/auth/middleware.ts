/**
 * The authentication middleware.
 *
 * Mounted on every route that touches a Durable Object. Once it runs, `c.get
 * ('user')` is guaranteed present, which is what lets the stub helpers require
 * a user id rather than accepting an optional one.
 */

import type { MiddlewareHandler } from 'hono';
import { requireUser, type AuthenticatedUser } from './session';

export type AuthEnv = {
	Bindings: Env;
	Variables: { user: AuthenticatedUser };
};

export const authenticate: MiddlewareHandler<AuthEnv> = async (c, next) => {
	c.set('user', await requireUser(c.req.raw, c.env));
	await next();
};
