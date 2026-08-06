/**
 * The session index.
 *
 * This replaces the Durable Object registry. A Durable Object is excellent at
 * being one session and hopeless at answering "which sessions belong to this
 * user" — that is a query, and queries belong in a database.
 *
 * The session's *contents* still live in its Durable Object. This is the card
 * you see in the sidebar: who owns it, what it is called, when it last moved,
 * and what it has cost.
 */

export interface SessionDoc {
	/** Shared with the Durable Object name, so the two halves agree. */
	id: string;
	userId: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	messageCount: number;
	/** Running totals, accumulated from each reported turn. */
	usage: SessionUsage;
	archivedAt: Date | null;
}

export interface SessionUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	estimatedCostUsd: number;
	turns: number;
}

export const EMPTY_USAGE: SessionUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	estimatedCostUsd: 0,
	turns: 0,
};

export interface PublicSession {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	usage: SessionUsage;
}

export function toPublicSession(session: SessionDoc): PublicSession {
	return {
		id: session.id,
		title: session.title,
		createdAt: session.createdAt.toISOString(),
		updatedAt: session.updatedAt.toISOString(),
		messageCount: session.messageCount,
		usage: session.usage,
	};
}
