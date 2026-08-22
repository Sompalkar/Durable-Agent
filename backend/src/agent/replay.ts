/**
 * The replay buffer for a turn in flight.
 *
 * A browser that reloads mid-turn has to be handed everything that already
 * happened before it can follow along live. Keeping the raw event stream would
 * mean thousands of one-word deltas, so text is folded as it arrives and the
 * buffer stays roughly the size of the reply itself.
 */

import type { AgentEvent } from '../types';

/**
 * Ceiling on entries for one turn.
 *
 * Text folds into a single entry, so this counts tool calls and results — a
 * turn capped at twelve steps cannot come close. It is here so a bug cannot
 * turn a long turn into an unbounded buffer inside a single-threaded object.
 */
export const MAX_REPLAY_EVENTS = 2_000;

/**
 * Add one event to the buffer, in place.
 *
 * Thinking is dropped: it is the largest thing on the wire and the least worth
 * replaying, since the thought it summarises is over by the time anyone
 * reconnects.
 */
export function recordForReplay(buffer: AgentEvent[], event: AgentEvent): void {
	if (event.type === 'thinking_delta') return;

	const last = buffer[buffer.length - 1];
	if (event.type === 'text_delta' && last?.type === 'text_delta') {
		// Replaced rather than mutated. The very same object is sitting in the
		// live stream's write queue, and appending to it there would send the
		// text a second time.
		buffer[buffer.length - 1] = { type: 'text_delta', text: last.text + event.text };
		return;
	}

	if (buffer.length < MAX_REPLAY_EVENTS) buffer.push(event);
}
