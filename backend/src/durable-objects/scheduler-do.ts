/**
 * SchedulerDO — background agents.
 *
 * A Durable Object can set an alarm on itself. When the alarm fires, Cloudflare
 * wakes the object up, runs `alarm()`, and lets it go back to sleep. Between
 * firings it costs nothing: there is no process sitting idle waiting for a cron
 * tick.
 *
 * That is the whole feature. An agent that runs every morning at 9 is a row in
 * a table plus one `setAlarm()` call — no scheduler service, no worker pool, no
 * always-on machine. Doing this on rented VMs means paying for uptime you are
 * not using.
 *
 * One alarm is set at a time, always for the earliest due schedule; after each
 * firing the next one is computed and armed.
 */

import { DurableObject } from 'cloudflare:workers';
import { describeAgentError } from '../agent/errors';
import type { AgentSessionDO } from './agent-session-do';

export type Cadence = 'once' | 'hourly' | 'daily' | 'interval';

export interface Schedule {
	id: number;
	/** The account that owns this schedule, and whose session it runs in. */
	userId: string;
	sessionId: string;
	label: string;
	/** The message sent to the agent when this fires. */
	prompt: string;
	cadence: Cadence;
	/** Minutes between runs, for `interval`. */
	intervalMinutes: number | null;
	/** Minutes past midnight UTC, for `daily`. */
	minuteOfDay: number | null;
	nextRunAt: number;
	lastRunAt: number | null;
	status: 'active' | 'paused' | 'done';
	createdAt: number;
	/** True when the agent created this and it is waiting for your approval. */
	needsApproval: boolean;
	/** How many times it has fired, against the hard ceiling. */
	runCount: number;
	maxRuns: number;
}

export interface ScheduledRun {
	id: number;
	scheduleId: number;
	startedAt: number;
	finishedAt: number;
	ok: boolean;
	summary: string;
}

interface ScheduleRow extends Record<string, SqlStorageValue> {
	id: number;
	user_id: string;
	session_id: string;
	label: string;
	prompt: string;
	cadence: string;
	interval_minutes: number | null;
	minute_of_day: number | null;
	next_run_at: number;
	last_run_at: number | null;
	status: string;
	created_at: number;
	needs_approval: number;
	run_count: number;
}

interface RunRow extends Record<string, SqlStorageValue> {
	id: number;
	schedule_id: number;
	started_at: number;
	finished_at: number;
	ok: number;
	summary: string;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Floor on interval schedules, so a demo cannot accidentally spam the API. */
const MIN_INTERVAL_MINUTES = 5;

export class SchedulerDO extends DurableObject<Env> {
	/** Label of the schedule currently executing, or null when idle. */
	private runningLabel: string | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		maxRuns = Math.max(1, Number(env.SCHEDULE_MAX_RUNS ?? 20) || 20);
		const sql = ctx.storage.sql;

		sql.exec(`
			CREATE TABLE IF NOT EXISTS schedules (
				id               INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id          TEXT    NOT NULL DEFAULT '',
				session_id       TEXT    NOT NULL,
				label            TEXT    NOT NULL,
				prompt           TEXT    NOT NULL,
				cadence          TEXT    NOT NULL,
				interval_minutes INTEGER,
				minute_of_day    INTEGER,
				next_run_at      INTEGER NOT NULL,
				last_run_at      INTEGER,
				status           TEXT    NOT NULL DEFAULT 'active',
				created_at       INTEGER NOT NULL,
				needs_approval   INTEGER NOT NULL DEFAULT 0,
				run_count        INTEGER NOT NULL DEFAULT 0
			);
		`);
		for (const column of [
			'needs_approval INTEGER NOT NULL DEFAULT 0',
			'run_count INTEGER NOT NULL DEFAULT 0',
			// The owner is stored on the row rather than on the object, because an
			// alarm fires with no request behind it — there is no cookie to read.
			"user_id TEXT NOT NULL DEFAULT ''",
		]) {
			try {
				sql.exec(`ALTER TABLE schedules ADD COLUMN ${column}`);
			} catch {
				// Already present — this is the migration path for existing objects.
			}
		}
		sql.exec(`
			CREATE TABLE IF NOT EXISTS runs (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				schedule_id INTEGER NOT NULL,
				started_at  INTEGER NOT NULL,
				finished_at INTEGER NOT NULL,
				ok          INTEGER NOT NULL,
				summary     TEXT    NOT NULL
			);
		`);
	}

	// ------------------------------------------------------------- schedules

	async list(sessionId?: string): Promise<Schedule[]> {
		const rows = sessionId
			? this.ctx.storage.sql
					.exec<ScheduleRow>(
						'SELECT * FROM schedules WHERE session_id = ?1 ORDER BY next_run_at',
						sessionId,
					)
					.toArray()
			: this.ctx.storage.sql
					.exec<ScheduleRow>('SELECT * FROM schedules ORDER BY next_run_at')
					.toArray();
		return rows.map(toSchedule);
	}

	async create(input: {
		userId: string;
		sessionId: string;
		label: string;
		prompt: string;
		cadence: Cadence;
		intervalMinutes?: number;
		minuteOfDay?: number;
		/** Delay before the first run, for `once`. Defaults to one minute. */
		delayMinutes?: number;
		/**
		 * True when the agent asked for this rather than the user. Those start
		 * paused and wait for approval — see AGENT_SCHEDULES_NEED_APPROVAL.
		 */
		requestedByAgent?: boolean;
	}): Promise<Schedule> {
		const now = Date.now();
		const intervalMinutes =
			input.cadence === 'interval'
				? Math.max(MIN_INTERVAL_MINUTES, Math.round(input.intervalMinutes ?? 60))
				: null;
		const minuteOfDay =
			input.cadence === 'daily'
				? clamp(Math.round(input.minuteOfDay ?? 9 * 60), 0, 24 * 60 - 1)
				: null;

		const nextRunAt = firstRunAt(now, input.cadence, {
			intervalMinutes,
			minuteOfDay,
			delayMinutes: input.delayMinutes,
		});

		// An agent that can arm its own recurring job unattended is the fastest
		// route to a surprise bill, so those land paused until a human says yes.
		const approvalRequired = String(this.env.AGENT_SCHEDULES_NEED_APPROVAL ?? 'true') !== 'false';
		const needsApproval = Boolean(input.requestedByAgent) && approvalRequired;

		const [row] = this.ctx.storage.sql
			.exec<ScheduleRow>(
				`INSERT INTO schedules
				   (user_id, session_id, label, prompt, cadence, interval_minutes, minute_of_day, next_run_at,
				    created_at, needs_approval, status)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING *`,
				input.userId,
				input.sessionId,
				input.label.trim() || 'Scheduled run',
				input.prompt.trim(),
				input.cadence,
				intervalMinutes,
				minuteOfDay,
				nextRunAt,
				now,
				needsApproval ? 1 : 0,
				needsApproval ? 'paused' : 'active',
			)
			.toArray();

		await this.armAlarm();
		return toSchedule(row);
	}

	/** Approving a schedule clears the flag and activates it in one step. */
	async setStatus(id: number, status: 'active' | 'paused'): Promise<Schedule> {
		const [row] = this.ctx.storage.sql
			.exec<ScheduleRow>(
				'UPDATE schedules SET status = ?1, needs_approval = 0 WHERE id = ?2 RETURNING *',
				status,
				id,
			)
			.toArray();
		if (!row) throw new Error(`No schedule with id ${id}.`);
		await this.armAlarm();
		return toSchedule(row);
	}

	/** Kill switch: pause every active schedule at once. */
	async pauseAll(): Promise<number> {
		const before = this.ctx.storage.sql
			.exec<{ count: number }>("SELECT COUNT(*) AS count FROM schedules WHERE status = 'active'")
			.toArray()[0]?.count ?? 0;
		this.ctx.storage.sql.exec("UPDATE schedules SET status = 'paused' WHERE status = 'active'");
		await this.armAlarm();
		return before;
	}

	/** Whether a background run is in flight, so the UI can say so. */
	async activity(): Promise<{ running: boolean; label: string | null; activeCount: number }> {
		const [row] = this.ctx.storage.sql
			.exec<{ count: number }>("SELECT COUNT(*) AS count FROM schedules WHERE status = 'active'")
			.toArray();
		return {
			running: this.runningLabel !== null,
			label: this.runningLabel,
			activeCount: row?.count ?? 0,
		};
	}

	async remove(id: number): Promise<void> {
		this.ctx.storage.sql.exec('DELETE FROM schedules WHERE id = ?1', id);
		this.ctx.storage.sql.exec('DELETE FROM runs WHERE schedule_id = ?1', id);
		await this.armAlarm();
	}

	async runs(scheduleId: number, limit = 20): Promise<ScheduledRun[]> {
		return this.ctx.storage.sql
			.exec<RunRow>(
				'SELECT * FROM runs WHERE schedule_id = ?1 ORDER BY id DESC LIMIT ?2',
				scheduleId,
				limit,
			)
			.toArray()
			.map(toRun);
	}

	/** Fire a schedule immediately, without waiting for its alarm. */
	async runNow(id: number): Promise<ScheduledRun> {
		const [row] = this.ctx.storage.sql
			.exec<ScheduleRow>('SELECT * FROM schedules WHERE id = ?1', id)
			.toArray();
		if (!row) throw new Error(`No schedule with id ${id}.`);
		return this.execute(toSchedule(row));
	}

	// ----------------------------------------------------------------- alarm

	/**
	 * Runs everything that is due, then arms the next alarm.
	 *
	 * Schedules run one at a time on purpose: a background agent that fans out
	 * across every due task at once is a good way to hit a rate limit while
	 * nobody is watching.
	 */
	override async alarm(): Promise<void> {
		const due = this.ctx.storage.sql
			.exec<ScheduleRow>(
				"SELECT * FROM schedules WHERE status = 'active' AND next_run_at <= ?1 ORDER BY next_run_at",
				Date.now(),
			)
			.toArray()
			.map(toSchedule);

		for (const schedule of due) {
			await this.execute(schedule);
		}

		await this.armAlarm();
	}

	/** Run one schedule against its session and record the outcome. */
	private async execute(schedule: Schedule): Promise<ScheduledRun> {
		const startedAt = Date.now();
		let ok = true;
		let summary: string;

		// A schedule that has hit its ceiling retires instead of firing again.
		if (schedule.runCount >= schedule.maxRuns) {
			this.ctx.storage.sql.exec(
				"UPDATE schedules SET status = 'done' WHERE id = ?1",
				schedule.id,
			);
			return this.recordRun(
				schedule,
				startedAt,
				false,
				`Retired: reached its ceiling of ${schedule.maxRuns} runs.`,
			);
		}

		this.runningLabel = schedule.label;
		this.ctx.storage.sql.exec(
			'UPDATE schedules SET run_count = run_count + 1 WHERE id = ?1',
			schedule.id,
		);

		try {
			const session = this.env.AGENT_SESSION.get(
				this.env.AGENT_SESSION.idFromName(`session:${schedule.userId}:${schedule.sessionId}`),
			) as DurableObjectStub<AgentSessionDO>;

			const result = await session.runHeadless(schedule.prompt, schedule.label);
			// A run the session declined — no credits left, turn cap reached, or
			// already busy — is not a success. Recording it as one would make the
			// run history quietly untrue, which is the last place you want that:
			// nobody watched this happen, so the record is all there is.
			ok = result.ok;
			summary = result.text.slice(0, 500) || 'Completed with no reply.';
		} catch (error) {
			ok = false;
			// A background run has nobody watching it, so the recorded summary is
			// the only account of what went wrong — make it readable.
			summary = describeAgentError(error);
		} finally {
			this.runningLabel = null;
		}

		const finishedAt = Date.now();
		const [row] = this.ctx.storage.sql
			.exec<RunRow>(
				`INSERT INTO runs (schedule_id, started_at, finished_at, ok, summary)
				 VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`,
				schedule.id,
				startedAt,
				finishedAt,
				ok ? 1 : 0,
				summary,
			)
			.toArray();

		this.advance(schedule, finishedAt);
		return toRun(row);
	}

	/** Write a run record without executing anything. */
	private recordRun(
		schedule: Schedule,
		startedAt: number,
		ok: boolean,
		summary: string,
	): ScheduledRun {
		const [row] = this.ctx.storage.sql
			.exec<RunRow>(
				`INSERT INTO runs (schedule_id, started_at, finished_at, ok, summary)
				 VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`,
				schedule.id,
				startedAt,
				Date.now(),
				ok ? 1 : 0,
				summary,
			)
			.toArray();
		return toRun(row);
	}

	/** Move a schedule to its next occurrence, or retire a one-shot. */
	private advance(schedule: Schedule, now: number): void {
		if (schedule.cadence === 'once') {
			this.ctx.storage.sql.exec(
				"UPDATE schedules SET status = 'done', last_run_at = ?1 WHERE id = ?2",
				now,
				schedule.id,
			);
			return;
		}

		const step =
			schedule.cadence === 'hourly'
				? 60 * MINUTE
				: schedule.cadence === 'interval'
					? (schedule.intervalMinutes ?? 60) * MINUTE
					: DAY;

		// Skip past any occurrences missed while the object was asleep, so a
		// schedule that was paused for a week does not fire seven times at once.
		let next = schedule.nextRunAt + step;
		while (next <= now) next += step;

		this.ctx.storage.sql.exec(
			'UPDATE schedules SET next_run_at = ?1, last_run_at = ?2 WHERE id = ?3',
			next,
			now,
			schedule.id,
		);
	}

	/** Point the alarm at the earliest active schedule, or clear it. */
	private async armAlarm(): Promise<void> {
		const [row] = this.ctx.storage.sql
			.exec<{ next: number | null }>(
				"SELECT MIN(next_run_at) AS next FROM schedules WHERE status = 'active'",
			)
			.toArray();

		if (row?.next == null) {
			await this.ctx.storage.deleteAlarm();
			return;
		}
		// Never arm in the past — that would busy-loop the alarm handler.
		await this.ctx.storage.setAlarm(Math.max(row.next, Date.now() + 1_000));
	}
}

// ------------------------------------------------------------------ helpers

function firstRunAt(
	now: number,
	cadence: Cadence,
	options: {
		intervalMinutes: number | null;
		minuteOfDay: number | null;
		delayMinutes?: number;
	},
): number {
	switch (cadence) {
		case 'once':
			return now + Math.max(1, options.delayMinutes ?? 1) * MINUTE;
		case 'hourly':
			return now + 60 * MINUTE;
		case 'interval':
			return now + (options.intervalMinutes ?? 60) * MINUTE;
		case 'daily': {
			const start = new Date(now);
			const target = Date.UTC(
				start.getUTCFullYear(),
				start.getUTCMonth(),
				start.getUTCDate(),
				0,
				options.minuteOfDay ?? 9 * 60,
			);
			return target > now ? target : target + DAY;
		}
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Set once from config so the row mapper can report the ceiling. */
let maxRuns = 20;

function toSchedule(row: ScheduleRow): Schedule {
	return {
		id: row.id,
		userId: row.user_id ?? '',
		sessionId: row.session_id,
		label: row.label,
		prompt: row.prompt,
		cadence: row.cadence as Cadence,
		intervalMinutes: row.interval_minutes,
		minuteOfDay: row.minute_of_day,
		nextRunAt: row.next_run_at,
		lastRunAt: row.last_run_at,
		status: row.status as Schedule['status'],
		createdAt: row.created_at,
		needsApproval: row.needs_approval === 1,
		runCount: row.run_count ?? 0,
		maxRuns: maxRuns,
	};
}

function toRun(row: RunRow): ScheduledRun {
	return {
		id: row.id,
		scheduleId: row.schedule_id,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		ok: row.ok === 1,
		summary: row.summary,
	};
}
