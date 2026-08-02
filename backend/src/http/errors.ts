/**
 * A single error vocabulary for the API.
 *
 * Routes throw `ApiError`; the global handler in `index.ts` renders it. Anything
 * else that escapes is a bug and becomes a 500 with a generic message.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

export class ApiError extends HTTPException {
	constructor(status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500, message: string) {
		super(status, { message });
	}

	static badRequest(message: string): ApiError {
		return new ApiError(400, message);
	}

	static unauthorized(message = 'You need to sign in.'): ApiError {
		return new ApiError(401, message);
	}

	static notFound(message: string): ApiError {
		return new ApiError(404, message);
	}

	static conflict(message: string): ApiError {
		return new ApiError(409, message);
	}
}

/** Maps thrown values onto a consistent `{ error }` JSON body. */
export function renderError(error: unknown, c: Context): Response {
	if (error instanceof HTTPException) {
		return c.json({ error: error.message }, error.status);
	}

	const raw = error instanceof Error ? error.message : String(error);
	console.error('Unhandled error:', raw);

	// Errors thrown inside a Durable Object cross the RPC boundary as plain
	// Errors whose message is prefixed with the original class name, e.g.
	// "FileNotFoundError: No such file: /x.ts". Recover the intent from that
	// prefix so callers get a useful status instead of a blanket 500.
	const match = /^(\w*Error): ([\s\S]+)$/.exec(raw);
	if (match) {
		const [, name, message] = match;
		const status = DOMAIN_ERROR_STATUS[name];
		if (status) return c.json({ error: message }, status);
	}

	return c.json({ error: 'Internal server error' }, 500);
}

/** Domain errors from the workspace layer, mapped to the status they deserve. */
const DOMAIN_ERROR_STATUS: Record<string, 400 | 404 | 409 | 413> = {
	FileNotFoundError: 404,
	InvalidPathError: 400,
	FileTooLargeError: 413,
	EditError: 409,
};
