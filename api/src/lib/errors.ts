/**
 * One error vocabulary for the API.
 *
 * Routes throw `ApiError`; the handler in `middleware/error.ts` renders it.
 * Anything else that escapes is a bug and becomes a generic 500 — an unexpected
 * error should never leak a stack trace or a database message to a client.
 */

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		/** Stable machine-readable code, so the frontend can branch without string matching. */
		readonly code: string = 'error',
	) {
		super(message);
		this.name = 'ApiError';
	}

	static badRequest(message: string, code = 'bad_request'): ApiError {
		return new ApiError(400, message, code);
	}

	static unauthorized(message = 'You need to sign in.', code = 'unauthorized'): ApiError {
		return new ApiError(401, message, code);
	}

	static forbidden(message = 'You do not have access to that.', code = 'forbidden'): ApiError {
		return new ApiError(403, message, code);
	}

	static notFound(message = 'Not found.', code = 'not_found'): ApiError {
		return new ApiError(404, message, code);
	}

	static conflict(message: string, code = 'conflict'): ApiError {
		return new ApiError(409, message, code);
	}
}
