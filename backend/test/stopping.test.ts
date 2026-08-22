/**
 * Stopping a turn.
 *
 * The interesting part is not that the loop exits — it is the state it leaves
 * behind. A stopped turn still has to produce a transcript the next turn can
 * be appended to, which means no dangling tool_use block and no two user
 * messages in a row. Both of those are a 400 from the API on the *following*
 * turn, so they would surface far from the code that caused them.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn } from '../src/agent/runner';
import type { ToolContext } from '../src/agent/tool-runtime';

/** A model reply, described by what the fake stream should produce. */
interface Reply {
	text?: string;
	toolName?: string;
}

/**
 * Stands in for `client.messages.stream`, one scripted reply per call.
 *
 * It honours the abort signal the same way the SDK does — by rejecting the
 * iteration — because the runner's handling of that rejection is exactly what
 * is under test.
 */
function fakeClient(
	replies: Reply[],
	hooks: { onCall?: (index: number) => void; onFinal?: (index: number) => void } = {},
) {
	let call = 0;

	return {
		messages: {
			stream(_params: unknown, options?: { signal?: AbortSignal }) {
				const index = call++;
				const reply = replies[index] ?? { text: 'done' };
				hooks.onCall?.(index);

				const content: Anthropic.ContentBlock[] = [];
				if (reply.text) content.push({ type: 'text', text: reply.text, citations: null });
				if (reply.toolName) {
					content.push({
						type: 'tool_use',
						id: `tool_${index}`,
						name: reply.toolName,
						input: {},
					} as Anthropic.ToolUseBlock);
				}

				const usage = {
					input_tokens: 10,
					output_tokens: 5,
					cache_read_input_tokens: 0,
				} as Anthropic.Usage;

				async function* iterate() {
					yield { type: 'message_start', message: { usage } };
					// One delta per word, so a stop can land mid-sentence.
					for (const word of (reply.text ?? '').split(' ').filter(Boolean)) {
						if (options?.signal?.aborted) throw new Error('Request was aborted.');
						yield {
							type: 'content_block_delta',
							delta: { type: 'text_delta', text: `${word} ` },
						};
					}
					yield { type: 'message_delta', usage: { output_tokens: 5 } };
				}

				return Object.assign(iterate(), {
					finalMessage: async () => ({
						...(hooks.onFinal?.(index), {}),
						content,
						stop_reason: reply.toolName ? 'tool_use' : 'end_turn',
						usage,
					}),
				});
			},
		},
	} as unknown as Anthropic;
}

function context(): ToolContext {
	return {
		sessionId: 'test',
		userId: 'user',
		plan: [],
		emit: () => {},
		workspace: {} as ToolContext['workspace'],
		filesLiveInSandbox: false,
		brain: {} as ToolContext['brain'],
		repoBrain: null,
		scheduler: {} as ToolContext['scheduler'],
		sandbox: null,
		proposals: [],
		syncedVersions: new Map(),
		repo: null,
		changedPaths: new Set(),
		commands: [],
	};
}

function run(options: {
	client: Anthropic;
	shouldStop: () => boolean;
	messages?: Anthropic.MessageParam[];
}) {
	return runAgentTurn({
		client: options.client,
		model: 'claude-sonnet-4-5',
		effort: 'medium',
		context: context(),
		memories: [],
		repoMemories: [],
		skills: [],
		messages: options.messages ?? [{ role: 'user', content: 'go' }],
		emit: () => {},
		shouldStop: options.shouldStop,
	});
}

test('a stop before the first call ends the turn without spending anything', async () => {
	let called = false;
	const client = fakeClient([{ text: 'hello there' }], {
		onCall: () => {
			called = true;
		},
	});

	const result = await run({ client, shouldStop: () => true });

	assert.equal(called, false, 'the model must not be called at all');
	assert.equal(result.stopReason, 'stopped');
	assert.equal(result.usage.outputTokens, 0);
});

test('a stop mid-stream keeps the words already streamed', async () => {
	// Stops once the first delta has been seen, so the abort lands inside the
	// stream rather than between iterations.
	let deltas = 0;
	const client = fakeClient([{ text: 'one two three four' }]);
	const result = await run({
		client,
		shouldStop: () => deltas++ > 1,
	});

	assert.equal(result.stopReason, 'stopped');
	assert.match(result.text, /one/);
	assert.match(result.text, /Stopped\./, 'the turn says why it ended');
	// Billed for what was generated before the abort, not zero.
	assert.ok(result.usage.inputTokens > 0);
});

test('a partial reply is stored as a complete assistant message', async () => {
	let deltas = 0;
	const client = fakeClient([{ text: 'one two three four' }]);
	const result = await run({ client, shouldStop: () => deltas++ > 1 });

	// No tool_use block may survive: it was never executed, so a matching
	// tool_result will never exist, and the next turn would be rejected.
	for (const message of result.newMessages) {
		const blocks = Array.isArray(message.content) ? message.content : [];
		for (const block of blocks) {
			assert.notEqual((block as { type?: string }).type, 'tool_use');
		}
	}
});

test('a stop after a tool result still ends on an assistant message', async () => {
	// The model calls a tool, the result comes back, and the stop lands before
	// the model can reply to it. Left alone, that ends the conversation on a
	// user message and the next turn is rejected for two users in a row.
	let firstCallDone = false;
	const client = fakeClient([{ text: 'working', toolName: 'update_plan' }, { text: 'done' }], {
		// At the *end* of the first call, so the stop lands between iterations
		// rather than inside the stream that is still producing text.
		onFinal: () => {
			firstCallDone = true;
		},
	});

	const result = await run({ client, shouldStop: () => firstCallDone });

	assert.equal(result.stopReason, 'stopped');
	const roles = result.newMessages.map((message) => message.role);
	assert.deepEqual(roles, ['assistant', 'user', 'assistant']);
	assert.equal(result.tools.length, 1, 'the tool that already ran is kept');
});
