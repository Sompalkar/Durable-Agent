/**
 * The pull request body.
 *
 * A reviewer's real question is not "what changed" — the diff answers that. It
 * is "how do I know this works, and how much should I trust it?" So the body
 * answers that instead: what the agent set out to do, what it ran, and what
 * those commands exited with.
 *
 * The honesty matters more than the polish. A command that failed is reported
 * as failed. A pull request with no verification says so at the top, because a
 * reviewer who assumes it was tested is worse off than one who knows it was not.
 */

import type { CommandRecord } from '../agent/tool-runtime';
import type { PlanStep, SessionUsage, StoredRepo } from '../types';

export interface ReportInput {
	repo: StoredRepo;
	plan: PlanStep[];
	changedPaths: string[];
	commands: CommandRecord[];
	usage: SessionUsage;
	model: string;
}

export function buildPullRequestBody(input: ReportInput): string {
	const sections: string[] = [];

	sections.push(verdict(input.commands));

	if (input.repo.issueNumber) {
		sections.push(`Closes #${input.repo.issueNumber}`);
	}

	if (input.plan.length > 0) {
		sections.push(
			['### Plan', ...input.plan.map((step) => `- ${mark(step.status)} ${step.step}`)].join('\n'),
		);
	}

	sections.push(
		[
			`### Files changed (${input.changedPaths.length})`,
			...input.changedPaths.map((path) => `- \`${path.replace(/^\//, '')}\``),
		].join('\n'),
	);

	const proof = redToGreen(input.commands);
	if (proof) sections.push(proof);

	sections.push(commandTable(input.commands));

	sections.push(
		[
			'<details>',
			'<summary>Run details</summary>',
			'',
			`- Model: \`${input.model}\``,
			`- Base: \`${input.repo.branch}\` at \`${input.repo.commitSha.slice(0, 7)}\``,
			`- Tokens: ${input.usage.inputTokens.toLocaleString()} in, ${input.usage.outputTokens.toLocaleString()} out`,
			`- Estimated cost: $${input.usage.estimatedCostUsd.toFixed(4)}`,
			'',
			'</details>',
		].join('\n'),
	);

	sections.push(
		'<sub>Opened by an agent whose workspace is a Cloudflare Durable Object. ' +
			'Every file above is versioned in SQLite, so each change has a full revision history.</sub>',
	);

	return sections.join('\n\n');
}

/**
 * The last run of each distinct command.
 *
 * An agent that runs the suite, sees it fail, fixes the cause and runs it again
 * has a green branch — but a naive count of every command ever run reports it as
 * failing. What matters is where each command *ended up*, so earlier attempts
 * are superseded rather than counted against the result.
 */
function finalRuns(commands: CommandRecord[]): CommandRecord[] {
	const latest = new Map<string, CommandRecord>();
	for (const entry of commands) latest.set(entry.command, entry);
	return [...latest.values()];
}

/**
 * The line a reviewer reads first.
 *
 * Stated in terms of what was actually observed, never "this works" — the agent
 * does not get to certify its own output.
 */
function verdict(commands: CommandRecord[]): string {
	if (commands.length === 0) {
		return '> **Not verified.** No commands were run against this change. Review and test it yourself before merging.';
	}

	const final = finalRuns(commands);
	const failed = final.filter((entry) => entry.exitCode !== 0);
	const retried = commands.length - final.length;

	if (failed.length > 0) {
		return (
			`> **${failed.length} of ${final.length} commands are still failing.** ` +
			'This branch is not green.'
		);
	}

	const base = `> **${final.length} command${final.length === 1 ? '' : 's'} ran, all exited 0.**`;
	// Named rather than hidden: a reviewer should know the agent had to iterate,
	// because that is a signal about how well it understood the problem.
	return retried > 0
		? `${base} ${retried} earlier attempt${retried === 1 ? '' : 's'} failed and ${retried === 1 ? 'was' : 'were'} fixed — see below.`
		: base;
}

/**
 * A command that failed and then passed.
 *
 * This is the strongest evidence a pull request can carry, and it is the whole
 * point of reproducing a bug before fixing it: the same command, unchanged,
 * failing before and passing after. It rules out the two things a reviewer
 * silently worries about — that the bug was never real, and that the test was
 * written to pass rather than to catch it.
 */
function redToGreen(commands: CommandRecord[]): string | null {
	const proven = new Map<string, { failedAt: number; passedAt: number }>();

	commands.forEach((entry, index) => {
		const seen = proven.get(entry.command);
		if (entry.exitCode !== 0 && !seen) {
			proven.set(entry.command, { failedAt: index, passedAt: -1 });
		} else if (entry.exitCode === 0 && seen && seen.passedAt === -1) {
			seen.passedAt = index;
		}
	});

	const transitions = [...proven.entries()].filter(([, run]) => run.passedAt !== -1);
	if (transitions.length === 0) return null;

	return [
		'### Reproduced, then fixed',
		'',
		'The same command, before and after the change:',
		'',
		...transitions.map(
			([command]) => `- \`${escapePipes(command)}\` — failed before the fix, passes after.`,
		),
	].join('\n');
}

function commandTable(commands: CommandRecord[]): string {
	if (commands.length === 0) {
		return '### Verification\n\nNothing was executed.';
	}

	// Every run is listed in order, but only the last of each command counts
	// towards the verdict. Superseded rows are marked so the table cannot be
	// misread as "the suite is failing".
	const final = new Set(finalRuns(commands));

	return [
		'### Verification',
		'',
		'| Command | Exit | Time | |',
		'| --- | --- | --- | --- |',
		...commands.map((entry) => {
			const superseded = !final.has(entry);
			const status = entry.exitCode === 0 ? '✅ 0' : `❌ ${entry.exitCode}`;
			return (
				`| \`${escapePipes(entry.command)}\` | ${status} | ${formatDuration(entry.durationMs)} | ` +
				`${superseded ? '_superseded_' : ''} |`
			);
		}),
	].join('\n');
}

function mark(status: PlanStep['status']): string {
	if (status === 'done') return '[x]';
	if (status === 'active') return '[ ] *(in progress)*';
	return '[ ]';
}

/** A pipe inside a command would break the markdown table it sits in. */
function escapePipes(value: string): string {
	const trimmed = value.length > 90 ? `${value.slice(0, 89)}…` : value;
	return trimmed.replace(/\|/g, '\\|');
}

function formatDuration(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
