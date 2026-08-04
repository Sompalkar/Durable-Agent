/**
 * Context pruning — the single biggest cost lever in an agentic loop.
 *
 * The API is stateless, so every iteration resends the whole conversation. In a
 * turn that runs eight tool calls, the output of call one is re-sent eight
 * times. When one of those calls was `npm install`, that is tens of thousands of
 * tokens paid for repeatedly to tell the model something it already acted on.
 *
 * Two halves of the conversation get big, and they need different treatment:
 *
 *   tool_result   what a tool returned. Old ones are replaced wholesale.
 *   tool_use      what the agent called, and with what arguments. These live on
 *                 assistant messages, and `write_file` puts an entire file in
 *                 its `content` argument. Collapsing the whole block would lose
 *                 the record of what the agent did, so instead the *arguments*
 *                 are collapsed field by field: short ones like `path` survive,
 *                 long ones like `content` become a marker.
 *
 * Either way the call itself is never removed. The model must still see what it
 * did and in what order, or it repeats work. And the API requires every
 * tool_use to keep its matching tool_result, so blocks are edited, never dropped.
 *
 * This is the same idea as the API's context-editing feature, done locally so it
 * works on any model and we control exactly what survives.
 */

import type Anthropic from '@anthropic-ai/sdk';

export interface PruneOptions {
	/** How many of the most recent tool results keep their full output. */
	keepRecentResults: number;
	/**
	 * How many of the most recent tool calls keep their full arguments.
	 *
	 * Deliberately tighter than the result window. Recent tool *output* is the
	 * working set the model is reasoning about. A file's *contents*, by
	 * contrast, are already in the workspace and one `read_file` away — keeping
	 * them in context is pure duplication, so only the call in flight and the
	 * one before it are worth holding onto.
	 */
	keepRecentCallArgs: number;
	/** Text shorter than this is never pruned — the savings are not worth it. */
	minLengthToPrune: number;
}

export const DEFAULT_PRUNE: PruneOptions = {
	keepRecentResults: 6,
	keepRecentCallArgs: 2,
	minLengthToPrune: 500,
};

const RESULT_PLACEHOLDER =
	'[Earlier tool output removed to save context. Re-run the tool if you need it again.]';

/** Marks a collapsed argument, naming the field so the model knows what is missing. */
function argumentPlaceholder(field: string, length: number): string {
	return `[${field} omitted to save context: ${length} characters. Read the file if you need it.]`;
}

export interface PruneResult {
	messages: Anthropic.MessageParam[];
	/** Roughly how many characters were dropped, for logging and the UI. */
	charactersSaved: number;
}

/**
 * Return a copy of `messages` with old tool traffic collapsed.
 *
 * The input is never mutated — the stored transcript stays complete, so the
 * user can still read the full history even though the model no longer does.
 */
export function pruneContext(
	messages: Anthropic.MessageParam[],
	options: PruneOptions = DEFAULT_PRUNE,
): PruneResult {
	// Walk backwards so "recent" is counted from the end of the conversation.
	// Calls and results are counted separately: they live on different messages
	// and, more importantly, decay in usefulness at different rates.
	let seenResults = 0;
	let seenCalls = 0;
	let charactersSaved = 0;

	const pruned = [...messages].reverse().map((message) => {
		if (!Array.isArray(message.content)) return message;

		const content = message.content.map((block) => {
			if (typeof block === 'string') return block;

			if (block.type === 'tool_result') {
				seenResults += 1;
				if (seenResults <= options.keepRecentResults) return block;

				const text = renderToolResult(block);
				if (text.length < options.minLengthToPrune) return block;

				charactersSaved += text.length - RESULT_PLACEHOLDER.length;
				return { ...block, content: RESULT_PLACEHOLDER };
			}

			if (block.type === 'tool_use') {
				seenCalls += 1;
				if (seenCalls <= options.keepRecentCallArgs) return block;

				const { input, saved } = pruneToolInput(block.input, options.minLengthToPrune);
				if (saved === 0) return block;

				charactersSaved += saved;
				return { ...block, input };
			}

			return block;
		});

		return { ...message, content } as Anthropic.MessageParam;
	});

	return { messages: pruned.reverse(), charactersSaved };
}

/**
 * Replace long string arguments with a marker, keeping short ones.
 *
 * Field-agnostic on purpose: it collapses whatever is large rather than
 * hard-coding `write_file.content`, so a tool added later is covered without
 * anyone remembering to update this.
 */
function pruneToolInput(
	input: unknown,
	minLength: number,
): { input: unknown; saved: number } {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { input, saved: 0 };
	}

	let saved = 0;
	const next: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (typeof value === 'string' && value.length >= minLength) {
			const placeholder = argumentPlaceholder(key, value.length);
			saved += value.length - placeholder.length;
			next[key] = placeholder;
		} else {
			next[key] = value;
		}
	}

	return { input: next, saved };
}

/** Flatten a tool_result's content to text so its size can be measured. */
function renderToolResult(block: Anthropic.ToolResultBlockParam): string {
	if (typeof block.content === 'string') return block.content;
	if (!Array.isArray(block.content)) return '';

	return block.content
		.map((part) => (part.type === 'text' ? part.text : ''))
		.join('');
}

/** Crude token estimate for logging. Four characters per token is close enough. */
export function estimateTokens(characters: number): number {
	return Math.round(characters / 4);
}
