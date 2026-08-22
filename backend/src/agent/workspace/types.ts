/**
 * Where the file tools read and write.
 *
 * One interface, two backings: the Durable Object's SQLite, or the container's
 * filesystem when the session runs on the sandbox runtime. The shape is the one
 * the Durable Object already exposes, so it satisfies this unchanged.
 */

import type { FileRecord, FileRevision, FileWithContent, GrepMatch } from '../../types';

export interface AgentWorkspace {
	list(directory?: string): Promise<FileRecord[]>;
	read(path: string): Promise<FileWithContent>;
	glob(pattern: string): Promise<FileRecord[]>;
	grep(pattern: string, options?: { pathPattern?: string; limit?: number }): Promise<GrepMatch[]>;
	write(path: string, content: string, summary?: string): Promise<FileRecord>;
	/**
	 * Write many files in a bounded number of round trips. A command that touched
	 * forty files would otherwise spend forty of the invocation's fifty
	 * subrequests writing them back one at a time.
	 */
	writeMany(
		files: Array<{ path: string; content: string }>,
		summary?: string,
	): Promise<{ written: number; skipped: string[] }>;
	edit(path: string, oldText: string, newText: string): Promise<FileRecord>;
	remove(path: string): Promise<boolean>;
	move(from: string, to: string): Promise<FileRecord>;

	/**
	 * A filesystem has no revisions, so an implementation over a container keeps
	 * the log somewhere that outlives it — otherwise diffs and pull requests
	 * would break the moment a user switched runtime.
	 */
	history(path: string, limit?: number): Promise<FileRevision[]>;
	restore(path: string, version: number): Promise<FileRecord>;
}
