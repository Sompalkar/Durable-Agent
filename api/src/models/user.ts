/**
 * The user document.
 *
 * `passwordHash` and the GitHub token never leave this module's boundary —
 * every route returns a `PublicUser` instead. Keeping the redaction in one
 * function means it cannot be forgotten at a call site.
 */

export interface UserDoc {
	/** Stable public id. Used as the Durable Object namespace, so it must not change. */
	id: string;
	/** Always lowercased on write, so lookups are exact. */
	email: string;
	passwordHash: string;
	name: string;
	createdAt: Date;
	updatedAt: Date;
	lastLoginAt: Date | null;
	settings: UserSettings;
	/** Present once the user has connected GitHub. */
	github?: GitHubConnection;
	/**
	 * Remaining spend, in USD.
	 *
	 * Decremented by the estimated cost of every turn. This is the only thing
	 * standing between a public signup link and someone else's Anthropic bill,
	 * so it is enforced before a turn starts, not after it finishes.
	 */
	creditsUsd: number;
	/** Reserved for the billing work: plan tiers and Stripe ids land here. */
	plan: 'free';
}

/**
 * A connected GitHub account.
 *
 * The token is a personal access token the user pasted in themselves, stored so
 * the Worker can act on their behalf. It is deliberately never sent back to a
 * browser — `toPublicUser` reports only that a connection exists and who it
 * belongs to.
 *
 * Worth being straight about the limitation: this is a long-lived bearer
 * credential sitting in the database. The production answer is a GitHub App
 * issuing short-lived installation tokens, which also gives per-repo scoping and
 * revocation. A PAT is the demo-grade version of that, and the reason `scopes`
 * is recorded is so the UI can warn when the token is broader than it needs.
 */
export interface GitHubConnection {
	token: string;
	/** GitHub username, confirmed against the API at connect time. */
	login: string;
	scopes: string[];
	connectedAt: Date;
}

export interface UserSettings {
	/** Matches the app's theme toggle. */
	theme: 'dark' | 'light';
	/** Model a new session starts on. Overridable per session. */
	defaultModel: string;
	defaultEffort: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
	theme: 'dark',
	defaultModel: 'claude-haiku-4-5',
	defaultEffort: 'low',
};

/** What the API is allowed to send to a browser. */
export interface PublicUser {
	id: string;
	email: string;
	name: string;
	createdAt: string;
	plan: string;
	creditsUsd: number;
	settings: UserSettings;
	/** Enough for the UI to show connection state. Never the token itself. */
	github: { login: string; scopes: string[]; connectedAt: string } | null;
}

export function toPublicUser(user: UserDoc): PublicUser {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		createdAt: user.createdAt.toISOString(),
		plan: user.plan,
		// Rounded for display: fractions of a cent are noise, and the exact
		// figure is a float that should not be shown raw.
		creditsUsd: Math.max(0, Math.round(user.creditsUsd * 10_000) / 10_000),
		settings: user.settings,
		github: user.github
			? {
					login: user.github.login,
					scopes: user.github.scopes,
					connectedAt: user.github.connectedAt.toISOString(),
				}
			: null,
	};
}

/** Normalize an email for both storage and lookup. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}
