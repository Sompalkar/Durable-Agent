/**
 * The replay buffer handed to a browser that rejoins a turn.
 *
 * The subtle one is aliasing: the same event object is queued for the live
 * stream at the moment it is buffered, so folding text by mutating it would
 * send that text twice to the connection that was already watching.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AgentEvent } from '../src/types';
import { MAX_REPLAY_EVENTS, recordForReplay } from '../src/agent/replay';

test('consecutive text is folded into one entry', () => {
	const buffer: AgentEvent[] = [];
	for (const word of ['one ', 'two ', 'three']) {
		recordForReplay(buffer, { type: 'text_delta', text: word });
	}

	assert.equal(buffer.length, 1);
	assert.deepEqual(buffer[0], { type: 'text_delta', text: 'one two three' });
});

test('folding does not touch the event that was handed to the live stream', () => {
	const buffer: AgentEvent[] = [];
	const first: AgentEvent = { type: 'text_delta', text: 'one ' };
	recordForReplay(buffer, first);
	recordForReplay(buffer, { type: 'text_delta', text: 'two' });

	// The live stream serialises asynchronously and may not have written `first`
	// yet. If folding mutated it, the watcher would receive "one two" here.
	assert.deepEqual(first, { type: 'text_delta', text: 'one ' });
});

test('a tool call breaks the run, so ordering survives', () => {
	const buffer: AgentEvent[] = [];
	recordForReplay(buffer, { type: 'text_delta', text: 'before' });
	recordForReplay(buffer, { type: 'tool_call', id: 't1', name: 'read_file', input: {} });
	recordForReplay(buffer, { type: 'text_delta', text: 'after' });

	assert.deepEqual(
		buffer.map((event) => event.type),
		['text_delta', 'tool_call', 'text_delta'],
	);
});

test('thinking is never buffered', () => {
	const buffer: AgentEvent[] = [];
	recordForReplay(buffer, { type: 'thinking_delta', text: 'hmm' });
	recordForReplay(buffer, { type: 'text_delta', text: 'hello' });
	recordForReplay(buffer, { type: 'thinking_delta', text: 'more' });

	assert.equal(buffer.length, 1);
	assert.equal(buffer[0].type, 'text_delta');
});

test('the cap bounds the buffer but never blocks folding', () => {
	const buffer: AgentEvent[] = [];
	for (let index = 0; index < MAX_REPLAY_EVENTS + 50; index++) {
		recordForReplay(buffer, { type: 'tool_call', id: `t${index}`, name: 'read_file', input: {} });
	}
	assert.equal(buffer.length, MAX_REPLAY_EVENTS);

	// Text still folds into the last entry only when that entry is text. Once
	// the cap is reached a new run of text is dropped rather than appended to
	// an unrelated tool call.
	recordForReplay(buffer, { type: 'text_delta', text: 'late' });
	assert.equal(buffer.length, MAX_REPLAY_EVENTS);
	assert.equal(buffer[buffer.length - 1].type, 'tool_call');
});
