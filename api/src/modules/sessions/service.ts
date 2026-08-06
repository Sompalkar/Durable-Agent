/**
 * Session and turn persistence.
 *
 * Shared by the browser-facing routes and the Worker's internal callback, so
 * "record a turn" means exactly one thing regardless of who asked.
 */

import { randomUUID } from 'node:crypto';
import { collections } from '../../db/mongo.js';
import { ApiError } from '../../lib/errors.js';
import { EMPTY_USAGE, type SessionDoc } from '../../models/session.js';
import type { TurnDoc, TurnUsage } from '../../models/turn.js';

/** How many characters of the first prompt become the auto-title. */
const TITLE_LENGTH = 60;

/**
 * Names that mean "not titled yet".
 *
 * Two of them because the two creation paths disagree: the sidebar creates a
 * session here, the Worker creates one in its Durable Object. Both are replaced
 * by the first prompt.
 */
const PLACEHOLDER_TITLES = ['New session', 'Untitled session'];

export async function createSession(userId: string, title?: string): Promise<SessionDoc> {
	const now = new Date();
	const session: SessionDoc = {
		id: randomUUID(),
		userId,
		title: title?.trim() || 'New session',
		createdAt: now,
		updatedAt: now,
		messageCount: 0,
		usage: { ...EMPTY_USAGE },
		archivedAt: null,
	};

	await collections.sessions().insertOne(session);
	return session;
}

export async function listSessions(userId: string, limit: number): Promise<SessionDoc[]> {
	return collections
		.sessions()
		.find({ userId, archivedAt: null })
		.sort({ updatedAt: -1 })
		.limit(limit)
		.toArray();
}

/**
 * Fetch a session, or fail.
 *
 * Ownership is part of the query rather than a check afterwards, so there is no
 * path where a session is loaded and the check is forgotten. A session that
 * belongs to someone else reads as "not found" — no reason to confirm it exists.
 */
export async function requireOwnedSession(
	userId: string,
	sessionId: string,
): Promise<SessionDoc> {
	const session = await collections.sessions().findOne({ id: sessionId, userId });
	if (!session) throw ApiError.notFound('Session not found.');
	return session;
}

export async function renameSession(
	userId: string,
	sessionId: string,
	title: string,
): Promise<SessionDoc> {
	const session = await collections
		.sessions()
		.findOneAndUpdate(
			{ id: sessionId, userId },
			{ $set: { title: title.trim(), updatedAt: new Date() } },
			{ returnDocument: 'after' },
		);

	if (!session) throw ApiError.notFound('Session not found.');
	return session;
}

/**
 * Archive rather than delete.
 *
 * The Durable Object holding the live conversation is torn down separately by
 * the Worker; keeping the row means usage history survives the deletion, which
 * matters as soon as anyone is billed for it.
 */
export async function archiveSession(userId: string, sessionId: string): Promise<void> {
	const result = await collections
		.sessions()
		.updateOne({ id: sessionId, userId }, { $set: { archivedAt: new Date() } });

	if (result.matchedCount === 0) throw ApiError.notFound('Session not found.');
}

export async function listTurns(sessionId: string, limit: number): Promise<TurnDoc[]> {
	return collections
		.turns()
		.find({ sessionId })
		.sort({ createdAt: 1 })
		.limit(limit)
		.toArray();
}

export interface RecordTurnInput {
	sessionId: string;
	userId: string;
	prompt: string;
	reply: string;
	tools: string[];
	model: string;
	usage: TurnUsage;
	trigger: string | null;
	messageCount: number;
}

/**
 * Persist one completed turn and roll its cost into the session.
 *
 * The session is upserted because the Worker may have created the Durable
 * Object before the browser ever registered the session here — for a background
 * schedule, there is no browser at all.
 */
export async function recordTurn(input: RecordTurnInput): Promise<void> {
	const now = new Date();

	const turn: TurnDoc = {
		sessionId: input.sessionId,
		userId: input.userId,
		createdAt: now,
		prompt: input.prompt,
		reply: input.reply,
		tools: input.tools,
		model: input.model,
		usage: input.usage,
		trigger: input.trigger,
	};

	await collections.turns().insertOne(turn);

	// Charge the account. Deliberately allowed to go negative rather than
	// clamped at zero: the turn already happened and was already paid for at the
	// provider, so hiding the overrun would make the books wrong. The gate that
	// stops the *next* turn is a separate check.
	await collections
		.users()
		.updateOne({ id: input.userId }, { $inc: { creditsUsd: -input.usage.estimatedCostUsd } });

	await collections.sessions().updateOne(
		{ id: input.sessionId, userId: input.userId },
		{
			$set: { updatedAt: now, messageCount: input.messageCount },
			$inc: {
				'usage.inputTokens': input.usage.inputTokens,
				'usage.outputTokens': input.usage.outputTokens,
				'usage.cacheReadTokens': input.usage.cacheReadTokens,
				'usage.estimatedCostUsd': input.usage.estimatedCostUsd,
				'usage.turns': 1,
			},
			$setOnInsert: {
				id: input.sessionId,
				userId: input.userId,
				title: titleFromPrompt(input.prompt),
				createdAt: now,
				archivedAt: null,
			},
		},
		{ upsert: true },
	);

	// A new session carries a placeholder name. The first typed message is what
	// gives it a real one, so title it then and never again — a later rename by
	// the user, or by the agent, must stick.
	//
	// Matching on the placeholder rather than tracking "is this the first turn"
	// makes this idempotent: a retried report cannot overwrite a real title.
	if (input.trigger === null) {
		await collections.sessions().updateOne(
			{ id: input.sessionId, userId: input.userId, title: { $in: PLACEHOLDER_TITLES } },
			{ $set: { title: titleFromPrompt(input.prompt) } },
		);
	}
}

/** First line of the opening prompt, trimmed to something that fits a sidebar. */
export function titleFromPrompt(prompt: string): string {
	const firstLine = prompt.trim().split('\n')[0]?.trim() ?? '';
	if (!firstLine) return 'New session';
	return firstLine.length > TITLE_LENGTH
		? `${firstLine.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
		: firstLine;
}
