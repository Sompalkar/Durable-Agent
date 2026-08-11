/**
 * Where a session's work actually happens.
 *
 * Two runtimes, and the difference is what the container is for.
 *
 *   durable  The Durable Object owns the files. A container is rented for the
 *            seconds a command takes and destroyed at the end of the turn.
 *            Nothing idles, so nothing is billed between messages.
 *
 *   sandbox  The container is the working environment and stays alive between
 *            turns, so a dev server keeps serving and installed dependencies
 *            survive. Faster and more capable, and it costs money while idle.
 *
 * The Durable Object remains the source of truth in both. What changes is
 * whether the container is disposable.
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
