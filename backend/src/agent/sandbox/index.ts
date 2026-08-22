/**
 * Sandbox selection.
 *
 * Two providers, one interface:
 *
 *   cloudflare — a Linux container attached to a Durable Object, via
 *                `@cloudflare/sandbox`. Everything stays on Cloudflare.
 *                Needs the container binding configured (and Docker locally).
 *   daytona    — a third-party sandbox over REST. Needs only an API key, so it
 *                is the quickest way to get a shell running locally.
 *
 * Returns a provider only when one is fully configured. A half-configured
 * sandbox is worse than none: the agent would be handed a shell that fails on
 * every call and would keep trying. No sandbox means no `run_command` tool and
 * a system prompt that says so plainly.
 */

import type { Sandbox } from '@cloudflare/sandbox';
import { CloudflareSandbox } from './cloudflare';
import { DaytonaSandbox } from './daytona';
import type { SandboxProvider } from './types';

export type {
	CommandResult,
	RepoCheckout,
	RunOptions,
	SandboxFile,
	SandboxProvider,
} from './types';
export { SandboxError } from './types';

export interface SandboxOptions {
	/** Which session the sandbox belongs to. One container per session. */
	sessionId?: string;
	/** Reuse an existing Daytona sandbox, if one was already created. */
	sandboxId?: string;
	/**
	 * Keep the container past the end of the turn.
	 *
	 * The provider reaps an idle sandbox on its own schedule, and the default is
	 * short enough that a container meant to survive between messages is gone
	 * before the next one arrives — which makes "always on" untrue.
	 */
	keepWarm?: boolean;
	onSandboxCreated?: (sandboxId: string) => void | Promise<void>;
}

/**
 * The `Sandbox` binding only exists when the container block in wrangler.jsonc
 * is enabled, so it is typed optionally rather than through generated Env.
 */
interface MaybeSandboxBinding {
	Sandbox?: DurableObjectNamespace<Sandbox>;
}

export function createSandbox(env: Env, options: SandboxOptions = {}): SandboxProvider | null {
	const provider = (env.SANDBOX_PROVIDER || '').trim().toLowerCase();

	if (provider === 'cloudflare') {
		const namespace = (env as unknown as MaybeSandboxBinding).Sandbox;
		if (!namespace) return null;
		return new CloudflareSandbox({
			namespace,
			sessionId: options.sessionId || 'default',
		});
	}

	if (provider === 'daytona') {
		if (!env.DAYTONA_API_KEY) return null;
		return new DaytonaSandbox({
			apiKey: env.DAYTONA_API_KEY,
			apiUrl: (env.DAYTONA_API_URL || 'https://app.daytona.io/api').replace(/\/$/, ''),
			toolboxUrl: (env.DAYTONA_TOOLBOX_URL || 'https://proxy.app.daytona.io').replace(/\/$/, ''),
			target: env.DAYTONA_TARGET || 'us',
			snapshot: env.DAYTONA_SNAPSHOT || undefined,
			organizationId: env.DAYTONA_ORG_ID || undefined,
			autoStopMinutes: options.keepWarm
				? Math.max(1, Number(env.SANDBOX_WARM_IDLE_MINUTES ?? 30) || 30)
				: Math.max(1, Number(env.SANDBOX_IDLE_MINUTES ?? 5) || 5),
			sandboxId: options.sandboxId,
			onSandboxCreated: options.onSandboxCreated,
		});
	}

	return null;
}

/** Whether a shell is available, without constructing a provider. */
export function sandboxConfigured(env: Env): boolean {
	return createSandbox(env) !== null;
}
