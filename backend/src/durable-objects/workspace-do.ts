/**
 * WorkspaceDO — one Durable Object per workspace.
 *
 * The object owns a SQLite database; `WorkspaceFileSystem` is the only thing
 * that touches it. Everything here is a thin RPC surface so callers (the HTTP
 * routes and the agent's tool runtime) can talk to a workspace as if it were a
 * local object, without knowing it lives on the edge.
 */

import { DurableObject } from 'cloudflare:workers';
import type {
	FileRecord,
	FileRevision,
	FileWithContent,
	GrepMatch,
	WorkspaceStats,
} from '../types';
import { WorkspaceFileSystem } from '../workspace/filesystem';

export interface WorkspaceTree {
	directories: string[];
	files: FileRecord[];
	stats: WorkspaceStats;
}

export class WorkspaceDO extends DurableObject<Env> {
	private readonly fs: WorkspaceFileSystem;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.fs = new WorkspaceFileSystem(ctx.storage.sql);
	}

	// ---------------------------------------------------------------- reads

	async list(directory?: string): Promise<FileRecord[]> {
		return this.fs.list(directory);
	}

	async read(path: string): Promise<FileWithContent> {
		return this.fs.read(path);
	}

	async glob(pattern: string): Promise<FileRecord[]> {
		return this.fs.glob(pattern);
	}

	async grep(
		pattern: string,
		options: { pathPattern?: string; limit?: number } = {},
	): Promise<GrepMatch[]> {
		return this.fs.grep(pattern, options);
	}

	async history(path: string, limit?: number): Promise<FileRevision[]> {
		return this.fs.history(path, limit);
	}

	async revision(path: string, version: number): Promise<FileRevision & { content: string }> {
		return this.fs.revision(path, version);
	}

	async stats(): Promise<WorkspaceStats> {
		return this.fs.stats();
	}

	/** Everything the file explorer needs in one round trip. */
	async tree(): Promise<WorkspaceTree> {
		return {
			directories: this.fs.directories(),
			files: this.fs.list(),
			stats: this.fs.stats(),
		};
	}

	// --------------------------------------------------------------- writes

	async write(path: string, content: string, summary?: string): Promise<FileRecord> {
		return this.fs.write(path, content, summary);
	}

	/**
	 * Write many files in one call.
	 *
	 * Not a convenience. Every call into a Durable Object counts against the
	 * Worker's subrequest budget — 50 per invocation on the free plan — so
	 * importing a repository file by file exhausts it long before the repository
	 * is imported. One call writes all of them.
	 *
	 * Files too large for the workspace are skipped rather than failing the whole
	 * import; their names come back so the caller can say what was left out.
	 */
	async writeMany(
		files: Array<{ path: string; content: string }>,
		summary?: string,
	): Promise<{ written: number; skipped: string[] }> {
		const skipped: string[] = [];
		let written = 0;

		for (const file of files) {
			try {
				this.fs.write(file.path, file.content, summary);
				written += 1;
			} catch {
				skipped.push(file.path);
			}
		}

		return { written, skipped };
	}

	async edit(path: string, oldText: string, newText: string): Promise<FileRecord> {
		return this.fs.edit(path, oldText, newText).record;
	}

	async remove(path: string): Promise<boolean> {
		return this.fs.delete(path);
	}

	async move(from: string, to: string): Promise<FileRecord> {
		return this.fs.move(from, to);
	}

	async restore(path: string, version: number): Promise<FileRecord> {
		return this.fs.restore(path, version);
	}

	/** Drop every file and revision. Used by the "reset workspace" action. */
	async clear(): Promise<void> {
		this.ctx.storage.sql.exec('DELETE FROM files');
		this.ctx.storage.sql.exec('DELETE FROM revisions');
	}
}
