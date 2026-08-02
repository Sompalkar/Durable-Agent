/**
 * The model catalogue.
 *
 * One list, used for three things: what the picker offers, what a turn costs,
 * and which model a session actually runs. Prices are USD per million tokens.
 *
 * The default is deliberately the cheapest model. Testing an agent means many
 * turns, and an agentic loop multiplies every one of them — pick the expensive
 * model when you are demoing, not while you are debugging.
 */

export interface ModelOption {
	id: string;
	label: string;
	/** One line on when to reach for it. */
	blurb: string;
	inputPerMTok: number;
	outputPerMTok: number;
	/** Rough cost of a typical agentic turn here, for the picker. */
	tier: 'cheapest' | 'balanced' | 'most capable';
	/**
	 * Request-shape capabilities. Older models reject the newer parameters
	 * outright, so these are not preferences — sending `effort` to Haiku 4.5 is
	 * a 400, not a no-op.
	 */
	supportsAdaptiveThinking: boolean;
	supportsEffort: boolean;
}

export const MODELS: ModelOption[] = [
	{
		id: 'claude-haiku-4-5',
		label: 'Haiku 4.5',
		blurb: 'Fastest and cheapest. Use this for building and testing.',
		inputPerMTok: 1,
		outputPerMTok: 5,
		tier: 'cheapest',
		// Predates adaptive thinking and the effort parameter — both 400 here.
		// No thinking also means no thinking tokens, which suits the cheap tier.
		supportsAdaptiveThinking: false,
		supportsEffort: false,
	},
	{
		id: 'claude-sonnet-5',
		label: 'Sonnet 5',
		blurb: 'Near-Opus quality on coding and agentic work, at a third of the price.',
		inputPerMTok: 3,
		outputPerMTok: 15,
		tier: 'balanced',
		supportsAdaptiveThinking: true,
		supportsEffort: true,
	},
	{
		id: 'claude-opus-5',
		label: 'Opus 5',
		blurb: 'Strongest on long multi-step work. Save it for the demo.',
		inputPerMTok: 5,
		outputPerMTok: 25,
		tier: 'most capable',
		supportsAdaptiveThinking: true,
		supportsEffort: true,
	},
];

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/** Cheapest model, cheapest effort — what a fresh session starts on. */
export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const DEFAULT_EFFORT: Effort = 'low';

export function findModel(id: string): ModelOption | undefined {
	return MODELS.find((model) => model.id === id);
}

export function isValidModel(id: string): boolean {
	return MODELS.some((model) => model.id === id);
}

export function isValidEffort(value: string): value is Effort {
	return (EFFORT_LEVELS as readonly string[]).includes(value);
}
