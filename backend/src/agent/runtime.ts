/**
 * Where a session's work happens.
 *
 * `durable` rents a container per command and destroys it at the end of the
 * turn. `sandbox` keeps one alive between turns, so a dev server keeps serving
 * and installed dependencies survive — at the cost of paying while it idles.
 * The Durable Object is the source of truth either way.
 */

export const RUNTIMES = ['durable', 'sandbox'] as const;

export type Runtime = (typeof RUNTIMES)[number];

export const DEFAULT_RUNTIME: Runtime = 'durable';

export function isRuntime(value: string): value is Runtime {
	return (RUNTIMES as readonly string[]).includes(value);
}

/** Whether the container should survive the end of a turn. */
export function keepsSandboxWarm(runtime: Runtime): boolean {
	return runtime === 'sandbox';
}
