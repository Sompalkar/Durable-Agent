/**
 * One recorded turn.
 *
 * Written by the Worker after every turn, interactive or scheduled. Two jobs:
 * searchable history that outlives a Durable Object, and the usage record that
 * billing will be built on — which is why cost is stored per turn rather than
 * only as a session total.
 */

export interface TurnDoc {
	sessionId: string;
	userId: string;
	createdAt: Date;
	/** What the user typed, or the schedule's prompt. */
	prompt: string;
	/** The assistant's reply text. */
	reply: string;
	/** Names of the tools used, enough to render a timeline without the payloads. */
	tools: string[];
	model: string;
	usage: TurnUsage;
	/** Set when a background schedule started the turn rather than a person. */
	trigger: string | null;
}

export interface TurnUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	estimatedCostUsd: number;
}

export interface PublicTurn {
	sessionId: string;
	createdAt: string;
	prompt: string;
	reply: string;
	tools: string[];
	model: string;
	usage: TurnUsage;
	trigger: string | null;
}

export function toPublicTurn(turn: TurnDoc): PublicTurn {
	return {
		sessionId: turn.sessionId,
		createdAt: turn.createdAt.toISOString(),
		prompt: turn.prompt,
		reply: turn.reply,
		tools: turn.tools,
		model: turn.model,
		usage: turn.usage,
		trigger: turn.trigger,
	};
}
