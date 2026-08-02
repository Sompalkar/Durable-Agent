/**
 * Token cost estimation.
 *
 * Rough by design — it exists so the running cost of a session is visible in
 * the UI instead of being a surprise on a bill. Rates are USD per million
 * tokens; cached reads bill at roughly a tenth of the input rate.
 */

import type { SessionUsage, TurnUsage } from '../types';

interface Rate {
	input: number;
	output: number;
}

const RATES: Record<string, Rate> = {
	'claude-opus-5': { input: 5, output: 25 },
	'claude-opus-4-8': { input: 5, output: 25 },
	'claude-sonnet-5': { input: 3, output: 15 },
	'claude-sonnet-4-6': { input: 3, output: 15 },
	'claude-haiku-4-5': { input: 1, output: 5 },
};

const FALLBACK: Rate = { input: 5, output: 25 };
const CACHE_READ_DISCOUNT = 0.1;
const PER_MILLION = 1_000_000;

export function estimateCostUsd(model: string, usage: TurnUsage): number {
	const rate = RATES[model] ?? FALLBACK;
	return (
		(usage.inputTokens * rate.input +
			usage.outputTokens * rate.output +
			usage.cacheReadTokens * rate.input * CACHE_READ_DISCOUNT) /
		PER_MILLION
	);
}

/** Fold a turn's usage into a session running total. */
export function addUsage(total: SessionUsage, turn: TurnUsage, model: string): SessionUsage {
	return {
		inputTokens: total.inputTokens + turn.inputTokens,
		outputTokens: total.outputTokens + turn.outputTokens,
		cacheReadTokens: total.cacheReadTokens + turn.cacheReadTokens,
		estimatedCostUsd: total.estimatedCostUsd + estimateCostUsd(model, turn),
	};
}

export const EMPTY_USAGE: SessionUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	estimatedCostUsd: 0,
};
