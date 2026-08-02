/**
 * The workspace filesystem.
 *
 * This is the piece that replaces the sandbox. Instead of a container with a
 * disk, a file is a row in the Durable Object's SQLite database, and every
 * write also appends a revision so the workspace carries its own history.
 *
 * The class only knows about SQL. Path normalization happens in `paths.ts` and
 * tool-level policy happens in `agent/`, which keeps this layer easy to reason
 * about and easy to test.
 */

import type { FileRecord, FileRevision, FileWithContent, GrepMatch, WorkspaceStats } from '../types';
import { matchesGlob } from './glob';
import { normalizeDirectory, normalizePath, parentDirectory } from './paths';

/** Hard ceiling on a single file, keeping one row comfortably inside SQLite limits. */
export const MAX_FILE_BYTES = 512 * 1024;

/** Revisions retained per file before the oldest are pruned. */
const MAX_REVISIONS_PER_FILE = 20;

export class FileNotFoundError extends Error {
	constructor(path: string) {
		super(`No such file: ${path}`);
		this.name = 'FileNotFoundError';
	}
}

export class FileTooLargeError extends Error {
	constructor(path: string, size: number) {
		super(`File ${path} is ${size} bytes, which exceeds the ${MAX_FILE_BYTES} byte limit`);
		this.name = 'FileTooLargeError';
	}
}

interface FileRow extends Record<string, SqlStorageValue> {
	path: string;
	content: string;
	size: number;
	created_at: number;
	updated_at: number;
	version: number;
}

export class WorkspaceFileSystem {
	constructor(private readonly sql: SqlStorage) {
		this.migrate();
	}

	private migrate(): void {
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS files (
				path       TEXT PRIMARY KEY,
				content    TEXT    NOT NULL,
				size       INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				version    INTEGER NOT NULL DEFAULT 1
			);
		`);
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS revisions (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				path       TEXT    NOT NULL,
				version    INTEGER NOT NULL,
				content    TEXT    NOT NULL,
				size       INTEGER NOT NULL,
				summary    TEXT    NOT NULL,
				created_at INTEGER NOT NULL
			);
		`);
		this.sql.exec(`CREATE INDEX IF NOT EXISTS revisions_path_idx ON revisions (path, version DESC);`);
	}

	// ---------------------------------------------------------------- reads

	/** List files, optionally scoped to a directory prefix. */
	list(directory?: string): FileRecord[] {
		const prefix = normalizeDirectory(directory);
		const rows =
			prefix === '/'
				? this.sql.exec<FileRow>('SELECT * FROM files ORDER BY path').toArray()
				: this.sql
						.exec<FileRow>('SELECT * FROM files WHERE path LIKE ?1 ORDER BY path', `${prefix}%`)
						.toArray();
		return rows.map(toRecord);
	}

	/** Read one file, or throw if it does not exist. */
	read(path: string): FileWithContent {
		const normalized = normalizePath(path);
		const row = this.findRow(normalized);
		if (!row) throw new FileNotFoundError(normalized);
		return { ...toRecord(row), content: row.content };
	}

	exists(path: string): boolean {
		return this.findRow(normalizePath(path)) !== null;
	}

	/** Paths matching a glob pattern, e.g. `src/**\/*.ts`. */
	glob(pattern: string): FileRecord[] {
		return this.list().filter((file) => matchesGlob(file.path, pattern));
	}

	/**
	 * Search file contents with a regular expression.
	 * `pathPattern` optionally narrows the search to matching paths.
	 */
	grep(pattern: string, options: { pathPattern?: string; limit?: number } = {}): GrepMatch[] {
		const limit = options.limit ?? 100;
		const regex = new RegExp(pattern);
		const matches: GrepMatch[] = [];

		for (const file of this.list()) {
			if (options.pathPattern && !matchesGlob(file.path, options.pathPattern)) continue;

			const { content } = this.read(file.path);
			const lines = content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				if (!regex.test(lines[i])) continue;
				matches.push({ path: file.path, line: i + 1, text: lines[i].slice(0, 400) });
				if (matches.length >= limit) return matches;
			}
		}
		return matches;
	}

	/** Revision history for one file, newest first. */
	history(path: string, limit = 20): FileRevision[] {
		const normalized = normalizePath(path);
		return this.sql
			.exec<{ version: number; size: number; created_at: number; summary: string }>(
				'SELECT version, size, created_at, summary FROM revisions WHERE path = ?1 ORDER BY version DESC LIMIT ?2',
				normalized,
				limit,
			)
			.toArray()
			.map((row) => ({
				version: row.version,
				size: row.size,
				createdAt: row.created_at,
				summary: row.summary,
			}));
	}

	/** One historical revision, with its contents — the raw material for a diff. */
	revision(path: string, version: number): FileRevision & { content: string } {
		const normalized = normalizePath(path);
		const [row] = this.sql
			.exec<{ version: number; size: number; created_at: number; summary: string; content: string }>(
				'SELECT version, size, created_at, summary, content FROM revisions WHERE path = ?1 AND version = ?2',
				normalized,
				version,
			)
			.toArray();
		if (!row) throw new FileNotFoundError(`${normalized}@v${version}`);
		return {
			version: row.version,
			size: row.size,
			createdAt: row.created_at,
			summary: row.summary,
			content: row.content,
		};
	}

	stats(): WorkspaceStats {
		const [files] = this.sql
			.exec<{ count: number; bytes: number | null }>(
				'SELECT COUNT(*) AS count, SUM(size) AS bytes FROM files',
			)
			.toArray();
		const [revisions] = this.sql
			.exec<{ count: number }>('SELECT COUNT(*) AS count FROM revisions')
			.toArray();

		return {
			fileCount: files?.count ?? 0,
			totalBytes: files?.bytes ?? 0,
			revisionCount: revisions?.count ?? 0,
		};
	}

	/** Directory paths implied by the files that exist, for rendering a tree. */
	directories(): string[] {
		const seen = new Set<string>();
		for (const file of this.list()) {
			let dir = parentDirectory(file.path);
			while (dir !== '/') {
				seen.add(dir);
				dir = parentDirectory(dir.slice(0, -1));
			}
		}
		return [...seen].sort();
	}

	// --------------------------------------------------------------- writes

	/** Create or overwrite a file, recording a revision. */
	write(path: string, content: string, summary = 'write'): FileRecord {
		const normalized = normalizePath(path);
		const size = byteLength(content);
		if (size > MAX_FILE_BYTES) throw new FileTooLargeError(normalized, size);

		const now = Date.now();
		const existing = this.findRow(normalized);
		const version = (existing?.version ?? 0) + 1;

		if (existing) {
			this.sql.exec(
				'UPDATE files SET content = ?1, size = ?2, updated_at = ?3, version = ?4 WHERE path = ?5',
				content,
				size,
				now,
				version,
				normalized,
			);
		} else {
			this.sql.exec(
				'INSERT INTO files (path, content, size, created_at, updated_at, version) VALUES (?1, ?2, ?3, ?4, ?4, ?5)',
				normalized,
				content,
				size,
				now,
				version,
			);
		}

		this.recordRevision(normalized, version, content, size, summary, now);
		return {
			path: normalized,
			size,
			createdAt: existing?.created_at ?? now,
			updatedAt: now,
			version,
		};
	}

	/**
	 * Replace the single occurrence of `oldText` with `newText`.
	 * Rejecting ambiguous edits (zero or many matches) is what makes this safe
	 * to hand to a model — a wrong guess fails loudly instead of corrupting a file.
	 */
	edit(path: string, oldText: string, newText: string): { record: FileRecord; occurrence: number } {
		const file = this.read(path);
		const first = file.content.indexOf(oldText);

		if (first === -1) {
			throw new EditError(`No occurrence of the target text was found in ${file.path}`);
		}
		if (file.content.indexOf(oldText, first + oldText.length) !== -1) {
			throw new EditError(
				`The target text appears more than once in ${file.path}. Include surrounding context to make it unique.`,
			);
		}

		const updated = file.content.slice(0, first) + newText + file.content.slice(first + oldText.length);
		const record = this.write(file.path, updated, 'edit');
		return { record, occurrence: first };
	}

	/** Delete a file. Returns false when it was already absent. */
	delete(path: string): boolean {
		const normalized = normalizePath(path);
		if (!this.findRow(normalized)) return false;
		this.sql.exec('DELETE FROM files WHERE path = ?1', normalized);
		this.sql.exec('DELETE FROM revisions WHERE path = ?1', normalized);
		return true;
	}

	/** Move or rename a file, preserving its contents but starting fresh history. */
	move(from: string, to: string): FileRecord {
		const source = this.read(from);
		const target = normalizePath(to);
		if (this.findRow(target)) {
			throw new EditError(`Cannot move to ${target}: a file already exists there`);
		}
		const record = this.write(target, source.content, `moved from ${source.path}`);
		this.delete(source.path);
		return record;
	}

	/** Restore a file to an earlier revision. */
	restore(path: string, version: number): FileRecord {
		const normalized = normalizePath(path);
		const [row] = this.sql
			.exec<{ content: string }>(
				'SELECT content FROM revisions WHERE path = ?1 AND version = ?2',
				normalized,
				version,
			)
			.toArray();
		if (!row) throw new FileNotFoundError(`${normalized}@v${version}`);
		return this.write(normalized, row.content, `restored v${version}`);
	}

	// -------------------------------------------------------------- private

	private findRow(path: string): FileRow | null {
		const [row] = this.sql.exec<FileRow>('SELECT * FROM files WHERE path = ?1', path).toArray();
		return row ?? null;
	}

	private recordRevision(
		path: string,
		version: number,
		content: string,
		size: number,
		summary: string,
		now: number,
	): void {
		this.sql.exec(
			'INSERT INTO revisions (path, version, content, size, summary, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
			path,
			version,
			content,
			size,
			summary,
			now,
		);
		this.sql.exec(
			`DELETE FROM revisions
			 WHERE path = ?1
			   AND version <= (SELECT MAX(version) FROM revisions WHERE path = ?1) - ?2`,
			path,
			MAX_REVISIONS_PER_FILE,
		);
	}
}

export class EditError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EditError';
	}
}

function toRecord(row: FileRow): FileRecord {
	return {
		path: row.path,
		size: row.size,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		version: row.version,
	};
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}
