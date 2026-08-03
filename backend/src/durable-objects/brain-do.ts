/**
 * BrainDO — what the agent knows, across every session.
 *
 * A session's conversation and files are scoped to that session. This object is
 * deliberately not: it is a single Durable Object holding two things that
 * should outlive any one run.
 *
 *   Memories — durable facts about the user and their projects. Written when
 *              something is learned, corrected the moment a later run proves
 *              them wrong.
 *   Skills   — workflows the agent has figured out once and can replay. Only
 *              the name and description are ever loaded up front; the body is
 *              fetched on demand, so a hundred skills cost almost no context.
 *
 * Agents that run in ephemeral sandboxes have to version this into a repo
 * somewhere, because their workspace is destroyed after every run. A Durable
 * Object just keeps it.
 */

import { DurableObject } from 'cloudflare:workers';

export interface Memory {
	id: number;
	content: string;
	/** Coarse bucket, used to group the UI and to bias recall. */
	category: MemoryCategory;
	createdAt: number;
	updatedAt: number;
	/** How many turns have loaded this memory — a cheap relevance signal. */
	recalls: number;
	/** Session that wrote it, for provenance. */
	sourceSessionId: string | null;
}

export type MemoryCategory = 'preference' | 'project' | 'fact' | 'correction';

export interface Skill {
	id: number;
	name: string;
	/** One line. This is what the model sees when deciding whether to load it. */
	description: string;
	/** The full procedure. Loaded only when the skill is actually used. */
	body: string;
	createdAt: number;
	updatedAt: number;
	uses: number;
}

interface MemoryRow extends Record<string, SqlStorageValue> {
	id: number;
	content: string;
	category: string;
	created_at: number;
	updated_at: number;
	recalls: number;
	source_session_id: string | null;
}

interface SkillRow extends Record<string, SqlStorageValue> {
	id: number;
	name: string;
	description: string;
	body: string;
	created_at: number;
	updated_at: number;
	uses: number;
}

/** How many memories are injected into a turn's system context. */
const RECALL_LIMIT = 40;

const MAX_MEMORY_CHARS = 2_000;
const MAX_SKILL_BODY_CHARS = 20_000;

export class BrainDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = ctx.storage.sql;

		sql.exec(`
			CREATE TABLE IF NOT EXISTS memories (
				id                INTEGER PRIMARY KEY AUTOINCREMENT,
				content           TEXT    NOT NULL,
				category          TEXT    NOT NULL DEFAULT 'fact',
				created_at        INTEGER NOT NULL,
				updated_at        INTEGER NOT NULL,
				recalls           INTEGER NOT NULL DEFAULT 0,
				source_session_id TEXT
			);
		`);
		sql.exec(`
			CREATE TABLE IF NOT EXISTS skills (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				name        TEXT    NOT NULL UNIQUE,
				description TEXT    NOT NULL,
				body        TEXT    NOT NULL,
				created_at  INTEGER NOT NULL,
				updated_at  INTEGER NOT NULL,
				uses        INTEGER NOT NULL DEFAULT 0
			);
		`);
	}

	// -------------------------------------------------------------- memories

	async listMemories(): Promise<Memory[]> {
		return this.ctx.storage.sql
			.exec<MemoryRow>('SELECT * FROM memories ORDER BY updated_at DESC')
			.toArray()
			.map(toMemory);
	}

	/**
	 * Memories to load into a turn. Ordered by how often they have proved
	 * useful, then by recency — so the things that keep mattering stay on top.
	 */
	async recall(limit = RECALL_LIMIT): Promise<Memory[]> {
		const rows = this.ctx.storage.sql
			.exec<MemoryRow>(
				'SELECT * FROM memories ORDER BY recalls DESC, updated_at DESC LIMIT ?1',
				limit,
			)
			.toArray();

		if (rows.length > 0) {
			this.ctx.storage.sql.exec(
				`UPDATE memories SET recalls = recalls + 1 WHERE id IN (${rows.map(() => '?').join(',')})`,
				...rows.map((row) => row.id),
			);
		}
		return rows.map(toMemory);
	}

	/** Free-text search, for when the agent goes looking for something specific. */
	async searchMemories(query: string, limit = 20): Promise<Memory[]> {
		return this.ctx.storage.sql
			.exec<MemoryRow>(
				'SELECT * FROM memories WHERE content LIKE ?1 ORDER BY updated_at DESC LIMIT ?2',
				`%${query}%`,
				limit,
			)
			.toArray()
			.map(toMemory);
	}

	async remember(
		content: string,
		category: MemoryCategory,
		sourceSessionId: string | null,
	): Promise<Memory> {
		const trimmed = content.trim();
		if (!trimmed) throw new Error('A memory cannot be empty.');
		if (trimmed.length > MAX_MEMORY_CHARS) {
			throw new Error(`A memory must be under ${MAX_MEMORY_CHARS} characters.`);
		}

		const now = Date.now();
		const [row] = this.ctx.storage.sql
			.exec<MemoryRow>(
				`INSERT INTO memories (content, category, created_at, updated_at, source_session_id)
				 VALUES (?1, ?2, ?3, ?3, ?4) RETURNING *`,
				trimmed,
				category,
				now,
				sourceSessionId,
			)
			.toArray();
		return toMemory(row);
	}

	/**
	 * Replace a memory that turned out to be wrong.
	 *
	 * Correcting rather than appending is the whole point: a memory store that
	 * only grows eventually contradicts itself, and the model has no way to tell
	 * which version is current.
	 */
	async correct(id: number, content: string): Promise<Memory> {
		const [row] = this.ctx.storage.sql
			.exec<MemoryRow>(
				`UPDATE memories SET content = ?1, category = 'correction', updated_at = ?2
				 WHERE id = ?3 RETURNING *`,
				content.trim(),
				Date.now(),
				id,
			)
			.toArray();
		if (!row) throw new Error(`No memory with id ${id}.`);
		return toMemory(row);
	}

	async forget(id: number): Promise<boolean> {
		const before = this.count('memories');
		this.ctx.storage.sql.exec('DELETE FROM memories WHERE id = ?1', id);
		return this.count('memories') < before;
	}

	// ---------------------------------------------------------------- skills

	/** Full skill records, for the UI. */
	async listSkills(): Promise<Skill[]> {
		return this.ctx.storage.sql
			.exec<SkillRow>('SELECT * FROM skills ORDER BY uses DESC, name')
			.toArray()
			.map(toSkill);
	}

	/**
	 * Name and description only — the catalogue that goes into every turn's
	 * context. Keeping bodies out of this is what makes skills scale.
	 */
	async skillCatalogue(): Promise<Array<{ name: string; description: string }>> {
		return this.ctx.storage.sql
			.exec<{ name: string; description: string }>(
				'SELECT name, description FROM skills ORDER BY uses DESC, name',
			)
			.toArray();
	}

	/** Load one skill's body and count the use. */
	async loadSkill(name: string): Promise<Skill> {
		const [row] = this.ctx.storage.sql
			.exec<SkillRow>('SELECT * FROM skills WHERE name = ?1', name)
			.toArray();
		if (!row) throw new Error(`No skill named "${name}".`);

		this.ctx.storage.sql.exec('UPDATE skills SET uses = uses + 1 WHERE id = ?1', row.id);
		return toSkill({ ...row, uses: row.uses + 1 });
	}

	/** Create or replace a skill by name. */
	async saveSkill(name: string, description: string, body: string): Promise<Skill> {
		const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
		if (!slug) throw new Error('A skill needs a name.');
		if (body.length > MAX_SKILL_BODY_CHARS) {
			throw new Error(`A skill body must be under ${MAX_SKILL_BODY_CHARS} characters.`);
		}

		const now = Date.now();
		const [row] = this.ctx.storage.sql
			.exec<SkillRow>(
				`INSERT INTO skills (name, description, body, created_at, updated_at)
				 VALUES (?1, ?2, ?3, ?4, ?4)
				 ON CONFLICT(name) DO UPDATE SET
				   description = ?2, body = ?3, updated_at = ?4
				 RETURNING *`,
				slug,
				description.trim(),
				body,
				now,
			)
			.toArray();
		return toSkill(row);
	}

	async deleteSkill(name: string): Promise<boolean> {
		const before = this.count('skills');
		this.ctx.storage.sql.exec('DELETE FROM skills WHERE name = ?1', name);
		return this.count('skills') < before;
	}

	/** Everything the brain panel needs in one round trip. */
	async snapshot(): Promise<{ memories: Memory[]; skills: Skill[] }> {
		return {
			memories: await this.listMemories(),
			skills: await this.listSkills(),
		};
	}

	async clear(): Promise<void> {
		this.ctx.storage.sql.exec('DELETE FROM memories');
		this.ctx.storage.sql.exec('DELETE FROM skills');
	}

	private count(table: 'memories' | 'skills'): number {
		const [row] = this.ctx.storage.sql
			.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
			.toArray();
		return row?.count ?? 0;
	}
}

function toMemory(row: MemoryRow): Memory {
	return {
		id: row.id,
		content: row.content,
		category: row.category as MemoryCategory,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		recalls: row.recalls,
		sourceSessionId: row.source_session_id,
	};
}

function toSkill(row: SkillRow): Skill {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		body: row.body,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		uses: row.uses,
	};
}
