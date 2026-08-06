/**
 * SessionRegistryDO — one Durable Object per user, holding their turn budget.
 *
 * It used to hold the session index too. That moved to MongoDB, because "list
 * my sessions, newest first" is a query, and a Durable Object is a single
 * consistent *object*, not a queryable table. Keeping the index here meant
 * writing the same data twice and having it drift.
 *
 * What stays is the part a database is worse at: a counter that must be exactly
 * right under concurrency. Every request for one user lands on this one object,
 * executed one at a time, so counting turns needs no locks and no transaction —
 * a rate limiter is close to the perfect Durable Object.
 */

import { DurableObject } from 'cloudflare:workers';

const HOUR_MS = 60 * 60 * 1000;

export class SessionRegistryDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// One row per turn started, trimmed to a rolling hour on each check.
		ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS turn_log (at INTEGER NOT NULL);
		`);
		// Left over from when this object held the session index. Dropping it
		// reclaims the space in objects that already exist.
		ctx.storage.sql.exec('DROP TABLE IF EXISTS sessions');
	}

	/**
	 * Account-wide rate limit across every session.
	 *
	 * The per-session cap stops one conversation running away; this stops one
	 * account from draining the API budget in an afternoon. A `limitPerHour` of
	 * 0 or less disables it entirely.
	 */
	async consumeTurn(limitPerHour: number): Promise<{
		allowed: boolean;
		used: number;
		limit: number;
		retryAfterSeconds: number;
	}> {
		if (!Number.isFinite(limitPerHour) || limitPerHour <= 0) {
			return { allowed: true, used: 0, limit: 0, retryAfterSeconds: 0 };
		}

		const now = Date.now();
		this.ctx.storage.sql.exec('DELETE FROM turn_log WHERE at < ?1', now - HOUR_MS);

		const [row] = this.ctx.storage.sql
			.exec<{ count: number; oldest: number | null }>(
				'SELECT COUNT(*) AS count, MIN(at) AS oldest FROM turn_log',
			)
			.toArray();
		const used = row?.count ?? 0;

		if (used >= limitPerHour) {
			const oldest = row?.oldest ?? now;
			return {
				allowed: false,
				used,
				limit: limitPerHour,
				// When the oldest turn ages out, one slot frees up.
				retryAfterSeconds: Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000)),
			};
		}

		this.ctx.storage.sql.exec('INSERT INTO turn_log (at) VALUES (?1)', now);
		return { allowed: true, used: used + 1, limit: limitPerHour, retryAfterSeconds: 0 };
	}
}
