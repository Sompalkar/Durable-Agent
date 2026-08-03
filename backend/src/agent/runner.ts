/**
 * The agent loop.
 *
 * A manual loop rather than the SDK tool runner, because each iteration has to
 * do several things at once: stream deltas to the browser, execute tools across
 * three different Durable Objects, record what happened, and persist the
 * transcript so a reconnecting client can replay it.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent, PlanStep, Proposal, ToolRecord, TurnUsage } from '../types';
import type { Memory, Skill } from '../durable-objects/brain-do';
import { DEFAULT_PRUNE, estimateTokens, pruneContext } from './context';
import { findModel } from './models';
import { buildContextBlock, SYSTEM_PROMPT } from './system-prompt';
import { executeTool, type ToolContext } from './tool-runtime';
import { BRAIN_TOOLS, buildToolDefinitions, MUTATING_TOOLS } from './tools';

/**
 * Upper bound on tool round-trips in a single turn.
 *
 * Lowered from 24: every iteration is a full API call carrying the whole
 * conversation, so a runaway loop is the most expensive thing that can happen
 * here. Twelve is plenty for real work and caps the damage when it is not.
 */
const MAX_ITERATIONS = 12;

/**
 * Output ceiling per API call. This is a hard cap the model is not aware of —
 * it exists so one turn cannot produce an unbounded bill.
 */
const MAX_TOKENS = 16_000;

export interface RunOptions {
	client: Anthropic;
	model: string;
	effort: string;
	context: ToolContext;
	memories: Memory[];
	/** What earlier tasks learned about the attached repository. */
	repoMemories: Memory[];
	skills: Array<Pick<Skill, 'name' | 'description'>>;
	/** Full conversation so far, including the new user message. */
	messages: Anthropic.MessageParam[];
	emit: (event: AgentEvent) => void;
}

export interface RunResult {
	/** Messages produced by this turn, to append to the stored transcript. */
	newMessages: Anthropic.MessageParam[];
	/** Concatenated assistant text, used as the transcript's rendered reply. */
	text: string;
	tools: ToolRecord[];
	proposals: Proposal[];
	/** The checklist as it stood when the turn ended. */
	plan: PlanStep[];
	usage: TurnUsage;
	stopReason: string | null;
}

export async function runAgentTurn(options: RunOptions): Promise<RunResult> {
	const { client, model, effort, context, emit } = options;

	const messages = [...options.messages];
	const newMessages: Anthropic.MessageParam[] = [];
	const tools: ToolRecord[] = [];
	const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

	let assistantText = '';
	let stopReason: string | null = null;

	const toolDefinitions = buildToolDefinitions({ sandbox: context.sandbox !== null });
	const contextBlock = buildContextBlock({
		memories: options.memories,
		repoMemories: options.repoMemories,
		repoName: context.repo?.fullName,
		skills: options.skills,
		sandboxAvailable: context.sandbox !== null,
		sandboxName: context.sandbox?.name,
	});

	// Older models reject `thinking` and `effort`; newer ones want both. Build
	// the optional half of the request from what this model actually accepts.
	const capabilities = findModel(model);
	const thinkingParams = capabilities?.supportsAdaptiveThinking
		? ({ thinking: { type: 'adaptive', display: 'summarized' } } as const)
		: {};
	const effortParams = capabilities?.supportsEffort
		? ({ output_config: { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } } as const)
		: {};

	emit({ type: 'turn_start' });

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		// Collapse stale tool output before sending. The stored transcript keeps
		// everything; only what the model re-reads is trimmed.
		const { messages: sendable, charactersSaved } = pruneContext(messages, DEFAULT_PRUNE);
		if (charactersSaved > 0) {
			console.log(
				`context pruned: ~${estimateTokens(charactersSaved)} tokens saved on iteration ${iteration}`,
			);
		}

		const stream = client.messages.stream({
			model,
			max_tokens: MAX_TOKENS,
			...thinkingParams,
			...effortParams,
			system: [
				{
					type: 'text',
					text: SYSTEM_PROMPT,
					// Stable prefix — cached across every turn of every session.
					cache_control: { type: 'ephemeral' },
				},
				// Everything volatile goes after the breakpoint, so saving a memory
				// does not invalidate the cache for the whole conversation.
				{ type: 'text', text: contextBlock },
			],
			tools: toolDefinitions,
			messages: sendable,
		});

		for await (const event of stream) {
			if (event.type !== 'content_block_delta') continue;
			if (event.delta.type === 'text_delta') {
				assistantText += event.delta.text;
				emit({ type: 'text_delta', text: event.delta.text });
			} else if (event.delta.type === 'thinking_delta') {
				emit({ type: 'thinking_delta', text: event.delta.thinking });
			}
		}

		const message = await stream.finalMessage();
		stopReason = message.stop_reason;
		accumulateUsage(usage, message.usage);

		const assistantMessage: Anthropic.MessageParam = {
			role: 'assistant',
			content: message.content,
		};
		messages.push(assistantMessage);
		newMessages.push(assistantMessage);

		if (message.stop_reason === 'refusal') {
			emit({ type: 'error', message: 'The model declined this request.' });
			break;
		}

		const toolUses = message.content.filter(
			(block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
		);
		if (toolUses.length === 0) break;

		// Tool calls in one assistant message are independent, so run them
		// concurrently and return every result in a single user message.
		const outcomes = await Promise.all(
			toolUses.map(async (toolUse) => {
				emit({ type: 'tool_call', id: toolUse.id, name: toolUse.name, input: toolUse.input });
				const startedAt = Date.now();
				const outcome = await executeTool(toolUse.name, toolUse.input, context);
				return { toolUse, outcome, durationMs: Date.now() - startedAt };
			}),
		);

		const toolResults: Anthropic.ToolResultBlockParam[] = [];
		let workspaceChanged = false;
		let brainChanged = false;
		let scheduleChanged = false;

		for (const { toolUse, outcome, durationMs } of outcomes) {
			emit({
				type: 'tool_result',
				id: toolUse.id,
				name: toolUse.name,
				ok: outcome.ok,
				summary: outcome.summary,
				durationMs,
			});
			tools.push({
				id: toolUse.id,
				name: toolUse.name,
				input: toolUse.input,
				ok: outcome.ok,
				summary: outcome.summary,
				durationMs,
			});

			if (outcome.ok) {
				if (MUTATING_TOOLS.has(toolUse.name)) workspaceChanged = true;
				if (BRAIN_TOOLS.has(toolUse.name)) brainChanged = true;
				if (toolUse.name === 'schedule_task') scheduleChanged = true;
			}

			toolResults.push({
				type: 'tool_result',
				tool_use_id: toolUse.id,
				content: outcome.content,
				is_error: !outcome.ok,
			});
		}

		if (workspaceChanged) emit({ type: 'workspace_changed' });
		if (brainChanged) emit({ type: 'brain_changed' });
		if (scheduleChanged) emit({ type: 'schedule_changed' });

		const resultMessage: Anthropic.MessageParam = { role: 'user', content: toolResults };
		messages.push(resultMessage);
		newMessages.push(resultMessage);
	}

	const proposals = [...context.proposals];
	if (proposals.length > 0) emit({ type: 'proposals', proposals });

	emit({ type: 'turn_end', stopReason, usage });
	return {
		newMessages,
		text: assistantText.trim(),
		tools,
		proposals,
		plan: [...context.plan],
		usage,
		stopReason,
	};
}

function accumulateUsage(total: TurnUsage, usage: Anthropic.Usage): void {
	total.inputTokens += usage.input_tokens ?? 0;
	total.outputTokens += usage.output_tokens ?? 0;
	total.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
}
