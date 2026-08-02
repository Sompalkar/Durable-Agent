/**
 * Path handling for the virtual filesystem.
 *
 * Every path stored in SQLite is absolute, POSIX-style, and fully normalized —
 * so `/a/b.txt`, `a/b.txt`, and `/a/./x/../b.txt` all collapse to one key.
 * Normalizing at the boundary means the rest of the code never has to think
 * about traversal or duplicate representations of the same file.
 */

export class InvalidPathError extends Error {
	constructor(path: string, reason: string) {
		super(`Invalid path "${path}": ${reason}`);
		this.name = 'InvalidPathError';
	}
}

const MAX_PATH_LENGTH = 512;

/** Normalize an arbitrary user/model-supplied path to a canonical absolute path. */
export function normalizePath(input: string): string {
	if (typeof input !== 'string' || input.trim() === '') {
		throw new InvalidPathError(String(input), 'path must be a non-empty string');
	}
	if (input.includes('\0')) {
		throw new InvalidPathError(input, 'path must not contain null bytes');
	}

	const segments: string[] = [];
	for (const segment of input.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			// Resolving above the root is a no-op rather than an error: the
			// workspace root is the whole universe here, so there is nothing above it.
			segments.pop();
			continue;
		}
		segments.push(segment);
	}

	const normalized = '/' + segments.join('/');
	if (normalized.length > MAX_PATH_LENGTH) {
		throw new InvalidPathError(input, `path exceeds ${MAX_PATH_LENGTH} characters`);
	}
	if (normalized === '/') {
		throw new InvalidPathError(input, 'path must reference a file, not the root');
	}
	return normalized;
}

/** Normalize a directory prefix. Always returns a value ending in `/`. */
export function normalizeDirectory(input: string | undefined): string {
	if (!input || input === '/' || input.trim() === '') return '/';
	const segments: string[] = [];
	for (const segment of input.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
}

/** The immediate parent directory of a file path, ending in `/`. */
export function parentDirectory(path: string): string {
	const index = path.lastIndexOf('/');
	return index <= 0 ? '/' : path.slice(0, index + 1);
}

/** The final path segment. */
export function basename(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
