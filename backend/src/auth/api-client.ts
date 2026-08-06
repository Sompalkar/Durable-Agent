/**
 * Reporting back to the main API.
 *
 * The Worker owns live state; MongoDB owns durable history. After a turn ends,
 * the Worker tells the API what happened so the session list, the transcript
 * archive, and the usage totals survive long after the Durable Object is gone.
 *
 * Every call here is best-effort and must be awaited inside `waitUntil`, never
 * on the request path. History is valuable; it is not worth failing a turn the
 * user already paid for because a database was briefly unreachable.
 */

const TIMEOUT_MS = 5_000;

export interface TurnReport {
	sessionId: string;
	userId: string;
	prompt: string;
	reply: string;
	tools: string[];
	model: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		estimatedCostUsd: number;
	};
	trigger: string | null;
	messageCount: number;
}

/** Trim to well under the API's cap, keeping the head — the readable part. */
const MAX_TEXT = 10_000;

export async function reportTurn(env: Env, report: TurnReport): Promise<void> {
	await post(env, '/internal/turns', {
		...report,
		prompt: truncate(report.prompt),
		reply: truncate(report.reply),
	});
}

export async function registerSession(
	env: Env,
	session: { id: string; userId: string; title: string },
): Promise<void> {
	await put(env, '/internal/sessions', session);
}

export async function updateSession(
	env: Env,
	sessionId: string,
	patch: { userId: string; title?: string; messageCount?: number; archived?: boolean },
): Promise<void> {
	await send(env, 'PATCH', `/internal/sessions/${encodeURIComponent(sessionId)}`, patch);
}

/**
 * The user's GitHub token, fetched from the main API.
 *
 * Unlike everything else in this module, this one is awaited on the request
 * path — there is no useful way to open a pull request without it, so a failure
 * here has to surface rather than be swallowed.
 */
export async function fetchGitHubToken(
	env: Env,
	userId: string,
): Promise<{ token: string; login: string } | null> {
	if (!env.MAIN_API_URL || !env.SERVICE_TOKEN) return null;

	const response = await fetch(
		`${env.MAIN_API_URL}/internal/users/${encodeURIComponent(userId)}/github`,
		{
			headers: { Authorization: `Bearer ${env.SERVICE_TOKEN}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	);

	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Could not read the GitHub connection (${response.status}).`);

	return (await response.json()) as { token: string; login: string };
}

/**
 * How much the account has left to spend.
 *
 * Returns `null` when the API is not configured — running the Worker standalone
 * means there is no billing to enforce, and refusing every turn would be worse
 * than not metering at all.
 */
export async function fetchBudget(
	env: Env,
	userId: string,
): Promise<{ creditsUsd: number; exhausted: boolean } | null> {
	if (!env.MAIN_API_URL || !env.SERVICE_TOKEN) return null;

	const response = await fetch(
		`${env.MAIN_API_URL}/internal/users/${encodeURIComponent(userId)}/budget`,
		{
			headers: { Authorization: `Bearer ${env.SERVICE_TOKEN}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	);

	if (!response.ok) return null;
	return (await response.json()) as { creditsUsd: number; exhausted: boolean };
}

function post(env: Env, path: string, body: unknown): Promise<void> {
	return send(env, 'POST', path, body);
}

function put(env: Env, path: string, body: unknown): Promise<void> {
	return send(env, 'PUT', path, body);
}

async function send(env: Env, method: string, path: string, body: unknown): Promise<void> {
	// Not configured means running the Worker standalone, without the main API.
	// That is a valid way to develop the agent, so stay quiet about it.
	if (!env.MAIN_API_URL || !env.SERVICE_TOKEN) return;

	try {
		const response = await fetch(`${env.MAIN_API_URL}${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${env.SERVICE_TOKEN}`,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});

		if (!response.ok) {
			console.error(`History sync failed: ${method} ${path} → ${response.status}`);
		}
	} catch (error) {
		console.error(`History sync failed: ${method} ${path}`, error);
	}
}

function truncate(text: string): string {
	return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[truncated]` : text;
}
