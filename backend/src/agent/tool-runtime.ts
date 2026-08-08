/**
 * Tool execution.
 *
 * Maps a tool call from the model onto whichever Durable Object owns that
 * capability, and turns the result into two things: text for the model, and a
 * one-line summary for the UI timeline.
 *
 * Every handler may throw; `executeTool` converts the throw into an error
 * tool_result so the model can adjust rather than stall.
 */

import type { BrainDO, MemoryCategory } from '../durable-objects/brain-do';
import type { Cadence, SchedulerDO } from '../durable-objects/scheduler-do';
import type { WorkspaceDO } from '../durable-objects/workspace-do';
import type { AgentEvent, PlanStatus, PlanStep, Proposal, ToolOutcome } from '../types';
import { GitHubClient } from '../github/client';
import type { RepoCheckout, SandboxProvider } from './sandbox';

/** Everything a tool might need, assembled once per turn. */
export interface ToolContext {
	sessionId: string;
	/** The account this turn runs on behalf of. Scopes every object it touches. */
	userId: string;
	workspace: DurableObjectStub<WorkspaceDO>;
	brain: DurableObjectStub<BrainDO>;
	/**
	 * Memory scoped to the attached repository, when there is one.
	 *
	 * The same Durable Object class as `brain`, addressed by a different name.
	 * That is the whole implementation: two independent, permanent stores for the
	 * price of one class, with isolation guaranteed by the addressing rather than
	 * by a column anyone could forget to filter on.
	 */
	repoBrain: DurableObjectStub<BrainDO> | null;
	scheduler: DurableObjectStub<SchedulerDO>;
	sandbox: SandboxProvider | null;
	/** Filled in by `propose_next_steps`; read by the caller after the turn. */
	proposals: Proposal[];
	/** Rewritten by `update_plan`; streamed to the UI as it changes. */
	plan: PlanStep[];
	/** Lets a tool push an event mid-turn, so the plan updates live. */
	emit: (event: AgentEvent) => void;
	/**
	 * Workspace file versions already mirrored into the sandbox, so repeated
	 * commands in one session only upload what actually changed.
	 */
	syncedVersions: Map<string, number>;
	/**
	 * The repository this session is working on, when there is one.
	 *
	 * Its presence is what switches `run_command` into repo mode: a checkout
	 * becomes the baseline, and only the agent's own edits are layered on top.
	 */
	repo: RepoContext | null;
	/**
	 * Workspace paths the agent has changed relative to the checkout.
	 *
	 * In repo mode this is the diff — the set of files that go into a commit —
	 * and it is the reason the container can be destroyed after every turn
	 * without losing the work.
	 */
	changedPaths: Set<string>;
	/** Commands run this turn, cited as evidence in the pull request body. */
	commands: CommandRecord[];
}

/** Where the session's code came from, and how to rebuild it. */
export interface RepoContext {
	/** `owner/name`, for display and for the GitHub API. */
	fullName: string;
	checkout: RepoCheckout;
	/** Detected from the repo's manifest at import time, e.g. `npm ci`. */
	installCommand: string;
	/**
	 * The user's GitHub token.
	 *
	 * Held separately rather than parsed back out of the clone URL — a tool that
	 * has to reverse-engineer a credential from a string is a tool one refactor
	 * away from leaking it into a log.
	 */
	token: string;
}

export interface CommandRecord {
	command: string;
	exitCode: number;
	durationMs: number;
}

type ToolHandler = (
	input: any,
	context: ToolContext,
	/** Present for interactive turns, so a tool can stream against its own call. */
	toolUseId?: string,
) => Promise<ToolOutcome>;

/**
 * Caps on how much text a tool may return to the model.
 *
 * These are cost controls, not safety limits. Every character a tool returns is
 * re-sent on the next loop iteration, so a 40k-character `npm install` log is
 * paid for again and again. Shell output gets the tightest cap because it is
 * both the largest and the least worth re-reading — the exit code and the last
 * few lines carry almost all the signal.
 */
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const MAX_SHELL_OUTPUT_CHARS = 4_000;

/**
 * How much live output is streamed to the browser.
 *
 * Far larger than what the model is sent, because watching is free and context
 * is not — but still bounded, so `yes` cannot saturate the connection.
 */
const MAX_STREAMED_CHARS = 200_000;

/**
 * Ceiling on command output stored with the turn. Generous enough for a stack
 * trace or a failing test run, small enough that a noisy install does not bloat
 * every future read of the transcript.
 */
const MAX_PERSISTED_OUTPUT_CHARS = 8_000;

const HANDLERS: Record<string, ToolHandler> = {
	// ----------------------------------------------------------------- files

	async list_files(input, { workspace }) {
		const files = await workspace.list(input.directory);
		if (files.length === 0) return ok('The workspace is empty.', 'no files');
		return ok(
			files.map((file) => `${file.path}  (${file.size} bytes, v${file.version})`).join('\n'),
			`${files.length} file${files.length === 1 ? '' : 's'}`,
		);
	},

	async read_file(input, { workspace }) {
		const file = await workspace.read(requireString(input.path, 'path'));
		const numbered = file.content
			.split('\n')
			.map((line, index) => `${String(index + 1).padStart(4)} | ${line}`)
			.join('\n');
		return ok(numbered, `read ${file.path} (${file.size} bytes)`);
	},

	async write_file(input, { workspace, changedPaths }) {
		const record = await workspace.write(
			requireString(input.path, 'path'),
			requireString(input.content, 'content'),
		);
		// Recorded so repo mode knows this file is part of the diff. Imported
		// files are not in this set; only ones the agent actually changed.
		changedPaths.add(record.path);
		return ok(
			`Wrote ${record.path} (${record.size} bytes, now at v${record.version}).`,
			`wrote ${record.path}`,
		);
	},

	async edit_file(input, { workspace, changedPaths }) {
		const record = await workspace.edit(
			requireString(input.path, 'path'),
			requireString(input.old_text, 'old_text'),
			requireString(input.new_text, 'new_text'),
		);
		changedPaths.add(record.path);
		return ok(
			`Edited ${record.path} (${record.size} bytes, now at v${record.version}).`,
			`edited ${record.path}`,
		);
	},

	async delete_file(input, { workspace, changedPaths }) {
		const path = requireString(input.path, 'path');
		const removed = await workspace.remove(path);
		if (removed) changedPaths.add(path);
		return removed
			? ok(`Deleted ${path}.`, `deleted ${path}`)
			: ok(`${path} did not exist, nothing to delete.`, `${path} not found`);
	},

	async move_file(input, { workspace, changedPaths }) {
		const record = await workspace.move(
			requireString(input.from, 'from'),
			requireString(input.to, 'to'),
		);
		// Both sides of a move are part of the diff: one deleted, one added.
		changedPaths.add(requireString(input.from, 'from'));
		changedPaths.add(record.path);
		return ok(`Moved ${input.from} to ${record.path}.`, `moved to ${record.path}`);
	},

	async glob_files(input, { workspace }) {
		const files = await workspace.glob(requireString(input.pattern, 'pattern'));
		if (files.length === 0) return ok(`No files match ${input.pattern}.`, 'no matches');
		return ok(files.map((file) => file.path).join('\n'), `${files.length} match(es)`);
	},

	async grep_files(input, { workspace }) {
		const matches = await workspace.grep(requireString(input.pattern, 'pattern'), {
			pathPattern: typeof input.path_pattern === 'string' ? input.path_pattern : undefined,
			limit: typeof input.limit === 'number' ? input.limit : undefined,
		});
		if (matches.length === 0) return ok(`No matches for /${input.pattern}/.`, 'no matches');
		return ok(
			matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n'),
			`${matches.length} match(es)`,
		);
	},

	async file_history(input, { workspace }) {
		const path = requireString(input.path, 'path');
		const revisions = await workspace.history(path);
		if (revisions.length === 0) return ok(`No recorded history for ${path}.`, 'no history');
		return ok(
			revisions
				.map((r) => `v${r.version}  ${new Date(r.createdAt).toISOString()}  ${r.size} bytes  ${r.summary}`)
				.join('\n'),
			`${revisions.length} revision(s)`,
		);
	},

	async restore_file(input, { workspace, changedPaths }) {
		const record = await workspace.restore(
			requireString(input.path, 'path'),
			requireNumber(input.version, 'version'),
		);
		changedPaths.add(record.path);
		return ok(
			`Restored ${record.path} to v${input.version} (now v${record.version}).`,
			`restored ${record.path}`,
		);
	},

	async fetch_url(input) {
		const url = new URL(requireString(input.url, 'url'));
		if (url.protocol !== 'https:') throw new Error('Only https:// URLs may be fetched.');

		const response = await fetch(url, {
			method: 'GET',
			headers: { 'User-Agent': 'agent-durable-object/1.0' },
			redirect: 'follow',
		});
		if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);

		return ok(stripMarkup(await response.text()), `fetched ${url.hostname} (${response.status})`);
	},

	// ---------------------------------------------------------------- memory

	async remember(input, { brain, sessionId }) {
		const memory = await brain.remember(
			requireString(input.content, 'content'),
			(input.category ?? 'fact') as MemoryCategory,
			sessionId,
		);
		return ok(`Remembered (id ${memory.id}): ${memory.content}`, `remembered #${memory.id}`);
	},

	async recall(input, { brain }) {
		const memories = await brain.searchMemories(requireString(input.query, 'query'));
		if (memories.length === 0) return ok(`Nothing in memory matches "${input.query}".`, 'no matches');
		return ok(
			memories.map((m) => `[${m.id}] (${m.category}) ${m.content}`).join('\n'),
			`${memories.length} memory match(es)`,
		);
	},

	async remember_about_repo(input, { repoBrain, sessionId }) {
		if (!repoBrain) {
			throw new Error(
				'No repository is attached to this session, so there is nothing to remember about one.',
			);
		}

		const memory = await repoBrain.remember(
			requireString(input.content, 'content'),
			'project',
			sessionId,
		);
		return ok(
			`Recorded about this repository (id ${memory.id}): ${memory.content}`,
			`learned #${memory.id}`,
		);
	},

	async correct_memory(input, { brain }) {
		const memory = await brain.correct(
			requireNumber(input.id, 'id'),
			requireString(input.content, 'content'),
		);
		return ok(`Corrected memory ${memory.id}: ${memory.content}`, `corrected #${memory.id}`);
	},

	async forget(input, { brain }) {
		const id = requireNumber(input.id, 'id');
		const removed = await brain.forget(id);
		return removed
			? ok(`Forgot memory ${id}.`, `forgot #${id}`)
			: ok(`No memory with id ${id}.`, 'not found');
	},

	// ---------------------------------------------------------------- skills

	async save_skill(input, { brain }) {
		const skill = await brain.saveSkill(
			requireString(input.name, 'name'),
			requireString(input.description, 'description'),
			requireString(input.body, 'body'),
		);
		return ok(`Saved skill "${skill.name}".`, `saved skill ${skill.name}`);
	},

	async load_skill(input, { brain }) {
		const skill = await brain.loadSkill(requireString(input.name, 'name'));
		return ok(`# Skill: ${skill.name}\n${skill.description}\n\n${skill.body}`, `loaded ${skill.name}`);
	},

	// ---------------------------------------------------------------- github

	async github_create_issue(input, { repo }) {
		if (!repo) {
			throw new Error('No repository is attached, so there is nowhere to file an issue.');
		}

		const [owner, name] = repo.fullName.split('/') as [string, string];
		const client = new GitHubClient(repo.token, owner, name);

		const issue = await client.createIssue(
			requireString(input.title, 'title'),
			requireString(input.body, 'body'),
		);

		return ok(
			`Opened issue #${issue.number} on ${repo.fullName}: ${issue.url}`,
			`opened #${issue.number}`,
		);
	},

	// -------------------------------------------------------------- schedule

	async schedule_task(input, { scheduler, sessionId, userId }) {
		const schedule = await scheduler.create({
			userId,
			sessionId,
			label: requireString(input.label, 'label'),
			prompt: requireString(input.prompt, 'prompt'),
			cadence: requireString(input.cadence, 'cadence') as Cadence,
			intervalMinutes: typeof input.interval_minutes === 'number' ? input.interval_minutes : undefined,
			minuteOfDay: typeof input.minute_of_day === 'number' ? input.minute_of_day : undefined,
			delayMinutes: typeof input.delay_minutes === 'number' ? input.delay_minutes : undefined,
			requestedByAgent: true,
		});

		const when = new Date(schedule.nextRunAt).toISOString();
		if (schedule.needsApproval) {
			return ok(
				`Created "${schedule.label}" (${schedule.cadence}), but it is PAUSED and will not run ` +
					`until the user approves it in the Agents panel. Tell them it is waiting.`,
				`${schedule.label} — awaiting approval`,
			);
		}
		return ok(
			`Scheduled "${schedule.label}" (${schedule.cadence}). First run at ${when}.`,
			`scheduled ${schedule.label}`,
		);
	},

	// ------------------------------------------------------------------ plan

	async update_plan(input, context) {
		const raw = Array.isArray(input.steps) ? input.steps : [];
		const steps: PlanStep[] = raw
			.filter(
				(item: unknown): item is PlanStep =>
					typeof item === 'object' &&
					item !== null &&
					typeof (item as PlanStep).step === 'string' &&
					isPlanStatus((item as PlanStep).status),
			)
			.slice(0, 12)
			.map((item: PlanStep) => ({ step: item.step.trim(), status: item.status }));

		// Replaced wholesale, matching the tool's contract.
		context.plan.splice(0, context.plan.length, ...steps);

		// Emitted immediately rather than at the end of the turn. The point of a
		// plan is watching it advance while the agent works; delivering it after
		// the work finishes would defeat the feature.
		context.emit({ type: 'plan', plan: [...steps] });

		const done = steps.filter((step) => step.status === 'done').length;
		const active = steps.find((step) => step.status === 'active');

		return ok(
			steps.length === 0
				? 'Plan cleared.'
				: `Plan updated: ${done}/${steps.length} done.` +
						(active ? ` Now working on: ${active.step}` : ''),
			steps.length === 0 ? 'plan cleared' : `${done}/${steps.length} steps`,
		);
	},

	// ------------------------------------------------------------- proposals

	async propose_next_steps(input, context) {
		const raw = Array.isArray(input.proposals) ? input.proposals : [];
		const proposals: Proposal[] = raw
			.filter((item: unknown): item is Proposal =>
				typeof item === 'object' &&
				item !== null &&
				typeof (item as Proposal).title === 'string' &&
				typeof (item as Proposal).prompt === 'string',
			)
			.slice(0, 3)
			.map((item: Proposal) => ({ title: item.title.trim(), prompt: item.prompt.trim() }));

		context.proposals.splice(0, context.proposals.length, ...proposals);
		return ok(
			proposals.length === 0
				? 'No follow-up steps offered.'
				: `Offered ${proposals.length} next step(s) to the user.`,
			proposals.length === 0 ? 'no proposals' : `${proposals.length} proposal(s)`,
		);
	},

	// --------------------------------------------------------------- sandbox

	async run_command(input, context, toolUseId) {
		const { sandbox, workspace, repo } = context;
		if (!sandbox) throw new Error('No sandbox is configured, so shell commands are unavailable.');

		const requested = requireString(input.command, 'command');
		const timeout = Math.min(300, Math.max(5, Number(input.timeout_seconds) || 120));

		// Two modes, and the difference is what counts as the baseline.
		//
		//   repo mode       a checkout is the baseline. Only the files the agent
		//                   has changed are pushed on top of it.
		//   workspace mode  the Durable Object is everything. The whole workspace
		//                   is mirrored in.
		//
		// Either way the Durable Object stays the source of truth: the container
		// is destroyed at the end of the turn, and the record of what changed is
		// what survives.
		const files = await workspace.list();

		// Workspace paths are absolute ("/frontend/..."), but the shell starts in
		// the repository root, where the matching path is relative. A leading
		// `cd /frontend` therefore points at the container root and fails with a
		// bare "exit 2", costing a step and telling the model nothing. The intent
		// is unambiguous when the first segment names a real workspace directory,
		// so it is corrected rather than failed.
		const command = rerootLeadingCd(requested, files.map((file) => file.path));

		const candidates = repo
			? files.filter((file) => context.changedPaths.has(file.path))
			: files;

		// Only files whose version moved since the last command are uploaded. The
		// first command in a session sends everything it needs; the rest usually
		// send one file or none, which is what makes a multi-command turn
		// affordable.
		const changed = candidates.filter(
			(file) => context.syncedVersions.get(file.path) !== file.version,
		);
		const contents = await Promise.all(changed.map((file) => workspace.read(file.path)));
		for (const file of changed) context.syncedVersions.set(file.path, file.version);

		// Streamed only when there is somebody watching. A scheduled run emits into
		// the void, and every poll is a round trip worth paying for only if it
		// reaches a screen.
		let streamed = 0;
		const result = await sandbox.run({
			command,
			files: contents.map((file) => ({ path: file.path, content: file.content })),
			timeoutSeconds: timeout,
			onOutput: toolUseId
				? (chunk) => {
						// Capped so a runaway command cannot flood the connection. The
						// full output still reaches the model through the tool result.
						if (streamed >= MAX_STREAMED_CHARS) return;
						streamed += chunk.length;
						context.emit({ type: 'command_output', id: toolUseId, chunk });
					}
				: undefined,
			repo: repo?.checkout,
			// Installed only when the command needs it. This is the slow part of a
			// turn, so it is opt-in per command rather than paid on every one.
			setup: repo && input.install === true ? repo.installCommand : undefined,
		});

		for (const file of result.changedFiles.filter((file) => isAgentAuthored(file.path))) {
			const record = await workspace.write(
				file.path,
				file.content,
				`written by \`${command.slice(0, 40)}\``,
			);
			// The container already has this content, so do not send it back next time.
			context.syncedVersions.set(record.path, record.version);
			context.changedPaths.add(record.path);
		}

		const sections = [`$ ${command}`, `exit ${result.exitCode} · ${result.durationMs}ms`];
		// Keep the *end* of the output: build logs put the failure last.
		if (result.stdout.trim()) sections.push(`--- stdout ---\n${tail(result.stdout)}`);
		if (result.stderr.trim()) sections.push(`--- stderr ---\n${tail(result.stderr)}`);
		if (result.changedFiles.length > 0) {
			sections.push(
				`--- files written back ---\n${result.changedFiles.map((f) => f.path).join('\n')}`,
			);
		}

		// Recorded as evidence: the pull request body cites the commands that were
		// actually run and what they exited with, so a reviewer does not have to
		// take the agent's word for it.
		context.commands.push({
			command,
			exitCode: result.exitCode,
			durationMs: result.durationMs,
		});

		// Kept on the record as well as streamed. The live view comes from SSE and
		// is gone on reload; without this a failed build shows its arguments and
		// no reason, which is exactly when the reason matters most.
		const log = [result.stdout, result.stderr].filter((part) => part.trim()).join('\n');

		return {
			ok: result.exitCode === 0,
			content: sections.join('\n\n'),
			summary: `exit ${result.exitCode}${
				result.changedFiles.length ? `, ${result.changedFiles.length} file(s) changed` : ''
			}`,
			output: log.trim() ? keepTail(log, MAX_PERSISTED_OUTPUT_CHARS) : `exit ${result.exitCode} · no output`,
		};
	},
};

/**
 * Directory names that only ever contain generated output.
 *
 * The sandbox already prunes these, so this is a second line of defence: a
 * provider whose change detection is slightly wrong must not be able to write a
 * build directory into the diff, because that diff becomes a pull request.
 */
const GENERATED_DIRECTORIES = new Set([
	'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
	'.turbo', '.cache', 'coverage', 'target', '__pycache__', '.venv', 'vendor',
]);

/** True when a path looks like something a person would want to review. */
function isAgentAuthored(path: string): boolean {
	if (/\.(tsbuildinfo|log|map)$/.test(path)) return false;
	return !path.split('/').some((segment) => GENERATED_DIRECTORIES.has(segment));
}

/**
 * Run one tool call. Never throws — failures come back as `ok: false` so the
 * model sees an error tool_result and can adjust.
 */
export async function executeTool(
	name: string,
	input: unknown,
	context: ToolContext,
	toolUseId?: string,
): Promise<ToolOutcome> {
	const handler = HANDLERS[name];
	if (!handler) return { ok: false, content: `Unknown tool: ${name}`, summary: 'unknown tool' };

	try {
		const outcome = await handler(input ?? {}, context, toolUseId);
		return { ...outcome, content: truncate(outcome.content) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, content: `Error: ${message}`, summary: message.slice(0, 120) };
	}
}

// ------------------------------------------------------------------ helpers

function ok(content: string, summary: string): ToolOutcome {
	return { ok: true, content, summary };
}

function isPlanStatus(value: unknown): value is PlanStatus {
	return value === 'pending' || value === 'active' || value === 'done';
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string') throw new Error(`"${field}" is required and must be a string.`);
	return value;
}

function requireNumber(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`"${field}" is required and must be a number.`);
	}
	return value;
}

function truncate(content: string): string {
	if (content.length <= MAX_TOOL_OUTPUT_CHARS) return content;
	return `${content.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n\n… output truncated at ${MAX_TOOL_OUTPUT_CHARS} characters.`;
}

/** Keep the last N characters — where compiler and test failures live. */
/**
 * Rewrite a leading `cd /foo` to `cd foo` when `/foo` is a top-level workspace
 * directory.
 *
 * Deliberately narrow: only the first command in the string, only an absolute
 * path, and only when the first segment is a directory the workspace actually
 * has. Anything else is left exactly as written — `cd /tmp` and `cd /usr/bin`
 * mean what they say, and silently rewriting them would be worse than failing.
 */
export function rerootLeadingCd(command: string, paths: string[]): string {
	const match = /^(\s*cd\s+)(\/[^\s;&|]+)/.exec(command);
	if (!match) return command;

	const target = match[2];
	const head = target.split('/')[1];
	if (!head) return command;

	const isWorkspaceDirectory = paths.some((path) => path.startsWith(`/${head}/`));
	if (!isWorkspaceDirectory) return command;

	return command.slice(0, match[1].length) + target.slice(1) + command.slice(match[0].length);
}

/** Keep the end of a long log — a build puts its failure last. */
function keepTail(content: string, limit: number): string {
	if (content.length <= limit) return content;
	return `… ${content.length - limit} earlier characters omitted …\n${content.slice(-limit)}`;
}

function tail(content: string): string {
	if (content.length <= MAX_SHELL_OUTPUT_CHARS) return content;
	return `… ${content.length - MAX_SHELL_OUTPUT_CHARS} earlier characters omitted …\n${content.slice(-MAX_SHELL_OUTPUT_CHARS)}`;
}

/** Crude HTML-to-text so fetched pages do not flood the context window with markup. */
function stripMarkup(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
