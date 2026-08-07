/**
 * Schedule routes — background agents.
 *
 * Creating a schedule arms a Durable Object alarm. Nothing runs between
 * firings, so an agent that checks something every morning costs exactly as
 * much as the mornings it actually runs.
 */

import { Hono } from 'hono';
import { authenticate, type AuthEnv } from '../auth/middleware';
import type { Cadence, ScheduleKind } from '../durable-objects/scheduler-do';
import { ApiError } from '../http/errors';
import { schedulerStub } from '../http/stubs';

const CADENCES: Cadence[] = ['once', 'hourly', 'daily', 'interval'];

export const scheduleRoutes = new Hono<AuthEnv>();

scheduleRoutes.use('*', authenticate);

/** GET /api/schedules?sessionId= — all schedules, or one session's. */
scheduleRoutes.get('/', async (c) => {
	const sessionId = c.req.query('sessionId');
	return c.json({ schedules: await schedulerStub(c.env, c.get('user').id).list(sessionId) });
});

/** GET /api/schedules/activity — is a background run happening right now? */
scheduleRoutes.get('/activity', async (c) => {
	return c.json(await schedulerStub(c.env, c.get('user').id).activity());
});

/** POST /api/schedules/pause-all — the kill switch. */
scheduleRoutes.post('/pause-all', async (c) => {
	const paused = await schedulerStub(c.env, c.get('user').id).pauseAll();
	return c.json({ paused });
});

/** POST /api/schedules — create one. */
scheduleRoutes.post('/', async (c) => {
	const body = await readJson<{
		sessionId?: string;
		label?: string;
		prompt?: string;
		cadence?: string;
		kind?: string;
		intervalMinutes?: number;
		minuteOfDay?: number;
		delayMinutes?: number;
	}>(c.req.raw);

	if (typeof body.sessionId !== 'string' || !body.sessionId) {
		throw ApiError.badRequest('"sessionId" is required.');
	}

	const kind: ScheduleKind = body.kind === 'review' ? 'review' : 'prompt';

	// A review watcher has no prompt of its own — the reviewer writes it, every
	// time it fires. Requiring one here would mean inventing text nobody reads.
	if (kind === 'prompt' && (typeof body.prompt !== 'string' || !body.prompt.trim())) {
		throw ApiError.badRequest('"prompt" must be a non-empty string.');
	}
	if (!CADENCES.includes(body.cadence as Cadence)) {
		throw ApiError.badRequest(`"cadence" must be one of: ${CADENCES.join(', ')}.`);
	}

	const schedule = await schedulerStub(c.env, c.get('user').id).create({
		userId: c.get('user').id,
		sessionId: body.sessionId,
		label: body.label ?? 'Scheduled run',
		prompt: body.prompt ?? '',
		cadence: body.cadence as Cadence,
		kind,
		intervalMinutes: body.intervalMinutes,
		minuteOfDay: body.minuteOfDay,
		delayMinutes: body.delayMinutes,
	});
	return c.json({ schedule }, 201);
});

/** PATCH /api/schedules/:id — pause or resume. */
scheduleRoutes.patch('/:id', async (c) => {
	const body = await readJson<{ status?: string }>(c.req.raw);
	if (body.status !== 'active' && body.status !== 'paused') {
		throw ApiError.badRequest('"status" must be "active" or "paused".');
	}

	const schedule = await schedulerStub(c.env, c.get('user').id).setStatus(numericParam(c.req.param('id')), body.status);
	return c.json({ schedule });
});

scheduleRoutes.delete('/:id', async (c) => {
	await schedulerStub(c.env, c.get('user').id).remove(numericParam(c.req.param('id')));
	return c.body(null, 204);
});

/** GET /api/schedules/:id/runs — what happened on previous firings. */
scheduleRoutes.get('/:id/runs', async (c) => {
	const runs = await schedulerStub(c.env, c.get('user').id).runs(numericParam(c.req.param('id')));
	return c.json({ runs });
});

/**
 * POST /api/schedules/:id/run — fire it now.
 *
 * A schedule you have to wait an hour to see is a bad demo, so this runs the
 * same code path the alarm would.
 */
scheduleRoutes.post('/:id/run', async (c) => {
	const run = await schedulerStub(c.env, c.get('user').id).runNow(numericParam(c.req.param('id')));
	return c.json({ run });
});

function numericParam(value: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw ApiError.badRequest('Expected a numeric id.');
	return parsed;
}

async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		throw ApiError.badRequest('Request body must be valid JSON.');
	}
}
