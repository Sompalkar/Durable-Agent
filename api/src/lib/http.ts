/**
 * Small request helpers.
 */

import type { Request } from 'express';
import { ApiError } from './errors.js';

/**
 * Read a path parameter as a single string.
 *
 * Express 5 types params as `string | string[]`, because a pattern can capture
 * repeats. Ours never do, so this narrows once here rather than at every call
 * site — and rejects the array case instead of coercing it into `"a,b"`.
 */
export function pathParam(req: Request, name: string): string {
	const value = req.params[name];
	if (typeof value !== 'string' || !value) {
		throw ApiError.badRequest(`Missing ${name} in the URL.`, 'missing_path_param');
	}
	return value;
}
