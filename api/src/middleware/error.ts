/**
 * Error handling and async plumbing.
 *
 * Express does not catch rejections from async handlers, so an unawaited throw
 * becomes a silently hung request. `route` wraps a handler so every rejection
 * reaches the error middleware.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors.js';
import { isProduction } from '../config/env.js';

/** Wrap an async handler so thrown errors reach `errorHandler`. */
export function route(
	handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
	return (req, res, next) => {
		handler(req, res, next).catch(next);
	};
}

export function notFoundHandler(_req: Request, res: Response): void {
	res.status(404).json({ error: 'Not found', code: 'not_found' });
}

export function errorHandler(
	error: unknown,
	_req: Request,
	res: Response,
	_next: NextFunction,
): void {
	if (error instanceof ApiError) {
		res.status(error.status).json({ error: error.message, code: error.code });
		return;
	}

	// Validation failures are the client's fault, so report which field.
	if (error instanceof ZodError) {
		const first = error.issues[0];
		res.status(400).json({
			error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request.',
			code: 'invalid_request',
		});
		return;
	}

	// A duplicate key means a unique index caught a race the handler did not.
	if (isMongoDuplicateKey(error)) {
		res.status(409).json({ error: 'That already exists.', code: 'conflict' });
		return;
	}

	console.error('Unhandled error:', error);
	res.status(500).json({
		error: isProduction ? 'Something went wrong.' : String(error),
		code: 'internal_error',
	});
}

function isMongoDuplicateKey(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === 11000
	);
}
