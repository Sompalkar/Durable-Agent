/**
 * What the file tools are allowed to assume about where files live.
 *
 * Until now the tools held a Durable Object stub directly, which made the
 * storage decision at every call site. This interface moves that decision to
 * one place, so a session can run its files out of SQLite or out of a real
 * container without the tools knowing which.
 *
 * The shape is deliberately the one the Durable Object already exposes: making
 * the existing implementation satisfy it without changes is what keeps the
 * refactor honest, and it is the container that has to do the adapting.
 */

import type { FileRecord, FileRevision, FileWithContent, GrepMatch } from '../../types';

export interface AgentWorkspace {
	list(directory?: string): Promise<FileRecord[]>;
	read(path: string): Promise<FileWithContent>;
	glob(pattern: string): Promise<FileRecord[]>;
	grep(pattern: string, options?: { pathPattern?: string; limit?: number }): Promise<GrepMatch[]>;
	write(path: string, content: string, summary?: string): Promise<FileRecord>;
	edit(path: string, oldText: string, newText: string): Promise<FileRecord>;
	remove(path: string): Promise<boolean>;
	move(from: string, to: string): Promise<FileRecord>;

	/**
	 * Version history for one file.
	 *
	 * Every backing store has to provide this, including one whose files live on
	 * a real disk. A filesystem has no revisions of its own, so an implementation
	 * over a container keeps the log somewhere that survives the container —
	 * otherwise diffs and pull requests stop working the moment a user switches
	 * runtime, which would make the choice a trap rather than a setting.
	 */
	history(path: string, limit?: number): Promise<FileRevision[]>;
	restore(path: string, version: number): Promise<FileRecord>;
}
