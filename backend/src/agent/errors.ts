/**
 * Turns SDK and network failures into something worth showing a user.
 *
 * The raw errors are accurate but unhelpful ("401 {"type":"error"…}"), and the
 * most common one by far during setup is a missing API key — so say that.
 */

import Anthropic from '@anthropic-ai/sdk';

function messageOf(error: unknown): string {
	if (error instanceof Error) return `${error.message} ${String(error.cause ?? '')}`;
	return String(error);
}

export function describeAgentError(error: unknown): string {
	if (error instanceof Anthropic.AuthenticationError) {
		return 'The Anthropic API key was rejected. Set ANTHROPIC_API_KEY in backend/.dev.vars (or as a Worker secret) and restart.';
	}
	if (error instanceof Anthropic.PermissionDeniedError) {
		return 'This API key does not have access to the configured model. Check AGENT_MODEL in wrangler.jsonc.';
	}
	if (error instanceof Anthropic.NotFoundError) {
		return 'The configured model was not found. Check AGENT_MODEL in wrangler.jsonc.';
	}
	if (error instanceof Anthropic.RateLimitError) {
		return 'Rate limited by the Anthropic API. Wait a moment and try again.';
	}
	// A billing failure arrives as a generic 400, which reads like a bug in the
	// request. It is worth naming, because it is one of the two things that
	// actually goes wrong during setup.
	if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) {
		return 'The Anthropic account has no credit. Add credits under Plans & Billing at console.anthropic.com, then try again.';
	}
	// Context overflow also arrives as a plain 400. Pruning makes this unlikely,
	// but a long session with large files can still get there, and the raw
	// message ("prompt is too long: 214813 tokens > 200000") tells the user
	// nothing they can act on.
	if (
		error instanceof Anthropic.BadRequestError &&
		/prompt is too long|context.{0,10}(window|length)|maximum.{0,20}tokens/i.test(error.message)
	) {
		return 'This conversation has outgrown the model’s context window. Start a new session — your files, memory, and skills all carry over.';
	}
	// Cloudflare refuses further outbound calls once the invocation's subrequest
	// budget is spent, and the SDK reports that as a connection failure. Saying
	// "check your network" sends people to look in entirely the wrong place.
	if (/too many subrequests/i.test(messageOf(error))) {
		return (
			'This turn ran out of Cloudflare subrequests — too many shell commands ' +
			'or tool calls in one turn. Start a new turn to continue; the work so far is saved.'
		);
	}
	if (error instanceof Anthropic.APIConnectionError) {
		return 'Could not reach the Anthropic API. Check the Worker’s network access.';
	}
	if (error instanceof Anthropic.APIError) {
		return `The Anthropic API returned ${error.status ?? 'an error'}: ${error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}
