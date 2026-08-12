/**
 * The agent's tool surface.
 *
 * There is no bash by default. Every capability is an explicit method backed by
 * a Durable Object, which is what removes the need for a machine to sit running
 * between turns. The one exception is `run_command`: a shell genuinely needs
 * Linux, so it is offered only when a sandbox provider is configured, and it
 * rents a container for the seconds the command takes.
 */

import type Anthropic from '@anthropic-ai/sdk';

const FILE_TOOLS: Anthropic.Tool[] = [
	{
		name: 'list_files',
		description:
			'List files in the workspace. Optionally scope to a directory prefix. ' +
			'Start here when you need to understand what already exists.',
		input_schema: {
			type: 'object',
			properties: {
				directory: {
					type: 'string',
					description: 'Directory prefix to list, e.g. "/src". Omit to list everything.',
				},
			},
			required: [],
		},
	},
	{
		name: 'read_file',
		description:
			'Read the full contents of a file. Always read a file before editing it so your ' +
			'edit targets text that actually exists.',
		input_schema: {
			type: 'object',
			properties: { path: { type: 'string', description: 'Absolute path, e.g. "/src/index.ts".' } },
			required: ['path'],
		},
	},
	{
		name: 'write_file',
		description:
			'Create a file or replace its contents entirely. Use edit_file instead when ' +
			'changing part of an existing file — it is cheaper and safer.',
		input_schema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Absolute path to write.' },
				content: { type: 'string', description: 'Complete file contents.' },
			},
			required: ['path', 'content'],
		},
	},
	{
		name: 'edit_file',
		description:
			'Replace an exact snippet inside a file. The snippet must appear exactly once — ' +
			'include surrounding lines if needed to make it unique.',
		input_schema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Absolute path to edit.' },
				old_text: { type: 'string', description: 'Exact text to replace, including indentation.' },
				new_text: { type: 'string', description: 'Replacement text.' },
			},
			required: ['path', 'old_text', 'new_text'],
		},
	},
	{
		name: 'delete_file',
		description: 'Delete a file and its revision history from the workspace.',
		input_schema: {
			type: 'object',
			properties: { path: { type: 'string', description: 'Absolute path to delete.' } },
			required: ['path'],
		},
	},
	{
		name: 'move_file',
		description: 'Move or rename a file. Fails if something already exists at the destination.',
		input_schema: {
			type: 'object',
			properties: {
				from: { type: 'string', description: 'Current absolute path.' },
				to: { type: 'string', description: 'Destination absolute path.' },
			},
			required: ['from', 'to'],
		},
	},
	{
		name: 'glob_files',
		description:
			'Find files by path pattern. Supports **, *, ? and {a,b}. Example: "src/**/*.test.ts".',
		input_schema: {
			type: 'object',
			properties: {
				pattern: { type: 'string', description: 'Glob pattern to match against file paths.' },
			},
			required: ['pattern'],
		},
	},
	{
		name: 'grep_files',
		description:
			'Search file contents with a regular expression. Returns matching lines with their ' +
			'path and line number. Call this when you need to locate code you have not read yet.',
		input_schema: {
			type: 'object',
			properties: {
				pattern: { type: 'string', description: 'JavaScript regular expression source.' },
				path_pattern: { type: 'string', description: 'Optional glob limiting which files are searched.' },
				limit: { type: 'integer', description: 'Maximum matches to return. Defaults to 100.' },
			},
			required: ['pattern'],
		},
	},
	{
		name: 'file_history',
		description:
			'List previous revisions of a file. Every write is versioned, so you can inspect ' +
			'what changed and when.',
		input_schema: {
			type: 'object',
			properties: { path: { type: 'string', description: 'Absolute path.' } },
			required: ['path'],
		},
	},
	{
		name: 'restore_file',
		description: 'Restore a file to an earlier revision, recorded as a new version.',
		input_schema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Absolute path.' },
				version: { type: 'integer', description: 'Version number from file_history.' },
			},
			required: ['path', 'version'],
		},
	},
	{
		name: 'fetch_url',
		description:
			'Fetch a public HTTPS URL and return its text content. Unauthenticated GET only — ' +
			'no credentials are ever available to this tool.',
		input_schema: {
			type: 'object',
			properties: { url: { type: 'string', description: 'Absolute https:// URL.' } },
			required: ['url'],
		},
	},
];

/**
 * Memory. These write to a store that outlives the session, so the bar is
 * "would this still be true and useful next week", not "did it just happen".
 */
const MEMORY_TOOLS: Anthropic.Tool[] = [
	{
		name: 'remember',
		description:
			'Save a durable fact worth carrying into future sessions: a preference, a project ' +
			'constraint, a decision and its reason. Do not save things the workspace already ' +
			'records, or details that only matter to the current conversation.',
		input_schema: {
			type: 'object',
			properties: {
				content: {
					type: 'string',
					description: 'One self-contained fact. Include why it matters if that is not obvious.',
				},
				category: {
					type: 'string',
					enum: ['preference', 'project', 'fact'],
					description: 'preference = how the user likes to work; project = about their work; fact = anything else.',
				},
			},
			required: ['content', 'category'],
		},
	},
	{
		name: 'recall',
		description:
			'Search your long-term memory. Your most-used memories are already loaded for you — ' +
			'use this when you need something specific that is not in front of you.',
		input_schema: {
			type: 'object',
			properties: { query: { type: 'string', description: 'Text to search for.' } },
			required: ['query'],
		},
	},
	{
		name: 'remember_about_repo',
		description:
			'Record something about the attached repository so the next task here starts knowing it: ' +
			'the command that runs the tests, where a layer lives, a convention, a gotcha that cost ' +
			'you a failed run. This is the store that makes the second task in a codebase cheaper ' +
			'than the first. ' +
			'Record what you had to work out, not what any reader could see in ten seconds, and ' +
			'nothing specific to the issue you happen to be fixing. Use remember for facts about the ' +
			'user instead.',
		input_schema: {
			type: 'object',
			properties: {
				content: {
					type: 'string',
					description:
						'One fact about the codebase, stated so it is still useful months from now.',
				},
			},
			required: ['content'],
		},
	},
	{
		name: 'correct_memory',
		description:
			'Replace a memory that turned out to be wrong. Prefer this over saving a second, ' +
			'contradicting memory — a store that disagrees with itself is worse than an empty one.',
		input_schema: {
			type: 'object',
			properties: {
				id: { type: 'integer', description: 'Memory id, from the loaded memories or recall.' },
				content: { type: 'string', description: 'The corrected fact.' },
			},
			required: ['id', 'content'],
		},
	},
	{
		name: 'forget',
		description: 'Delete a memory that is no longer true or no longer useful.',
		input_schema: {
			type: 'object',
			properties: { id: { type: 'integer', description: 'Memory id.' } },
			required: ['id'],
		},
	},
];

/**
 * Skills. A skill is a procedure worth repeating; the catalogue is always in
 * context but bodies are loaded on demand, so having many costs almost nothing.
 */
const SKILL_TOOLS: Anthropic.Tool[] = [
	{
		name: 'save_skill',
		description:
			'Save a repeatable workflow you just worked out, so the next run starts with it ' +
			'instead of rediscovering it. Write the body as steps you would follow again.',
		input_schema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Short kebab-case name, e.g. "add-api-route".' },
				description: {
					type: 'string',
					description: 'One line describing when to use this. This is all you will see when deciding to load it.',
				},
				body: { type: 'string', description: 'The full procedure, in Markdown.' },
			},
			required: ['name', 'description', 'body'],
		},
	},
	{
		name: 'load_skill',
		description:
			'Load a skill body from the catalogue before doing the kind of work it covers.',
		input_schema: {
			type: 'object',
			properties: { name: { type: 'string', description: 'Skill name from the catalogue.' } },
			required: ['name'],
		},
	},
];

/** Scheduling — the agent can arrange to wake itself up later. */
const SCHEDULE_TOOLS: Anthropic.Tool[] = [
	{
		name: 'schedule_task',
		description:
			'Propose a scheduled run of yourself, in this session. Anything you create here is ' +
			'PAUSED and does nothing until the user approves it — a background agent spends money ' +
			'unattended, so it is their call, not yours. Ask before using this at all, and prefer ' +
			'"once" over recurring. Tell the user it is waiting for approval.',
		input_schema: {
			type: 'object',
			properties: {
				label: { type: 'string', description: 'Short name shown in the schedule list.' },
				prompt: {
					type: 'string',
					description: 'The instruction to send yourself when this fires. Write it to stand alone.',
				},
				cadence: {
					type: 'string',
					enum: ['once', 'hourly', 'daily', 'interval'],
					description: 'How often to run.',
				},
				interval_minutes: { type: 'integer', description: 'For "interval". Minimum 5.' },
				minute_of_day: { type: 'integer', description: 'For "daily". Minutes past midnight UTC, e.g. 540 for 09:00.' },
				delay_minutes: { type: 'integer', description: 'For "once". How long from now.' },
			},
			required: ['label', 'prompt', 'cadence'],
		},
	},
];

/** The proactive half: what the agent thinks should happen next. */
const PROPOSAL_TOOLS: Anthropic.Tool[] = [
	{
		name: 'update_plan',
		description:
			'Track a multi-step task as a short checklist the user can watch. Call this once ' +
			'when you start work that needs three or more distinct steps, then again each time ' +
			'a step finishes — marking the one you just completed "done" and the next one ' +
			'"active". Skip it entirely for anything you can finish in one or two steps; a ' +
			'checklist for trivial work is noise. Send the whole list every time, not a diff.',
		input_schema: {
			type: 'object',
			properties: {
				steps: {
					type: 'array',
					maxItems: 12,
					items: {
						type: 'object',
						properties: {
							step: {
								type: 'string',
								description: 'What this step accomplishes, in a few words. Imperative.',
							},
							status: {
								type: 'string',
								enum: ['pending', 'active', 'done'],
								description: 'Exactly one step should be "active" at a time.',
							},
						},
						required: ['step', 'status'],
					},
				},
			},
			required: ['steps'],
		},
	},
	{
		name: 'propose_next_steps',
		description:
			'Before you finish, offer up to three things worth doing next. Each becomes a button ' +
			'the user can click to run it. Propose real follow-on work you would actually do — ' +
			'not restatements of what you just did, and not filler. Offer none if nothing obvious ' +
			'remains.',
		input_schema: {
			type: 'object',
			properties: {
				proposals: {
					type: 'array',
					maxItems: 3,
					items: {
						type: 'object',
						properties: {
							title: { type: 'string', description: 'Short button label, a few words.' },
							prompt: {
								type: 'string',
								description: 'The full instruction to run if the user picks this. Must stand alone.',
							},
						},
						required: ['title', 'prompt'],
					},
				},
			},
			required: ['proposals'],
		},
	},
];

const SANDBOX_TOOLS: Anthropic.Tool[] = [
	{
		name: 'run_command',
		description:
			'Run a shell command in a Linux sandbox. Your files are copied in first and any file ' +
			'the command changes is copied back, so you can install packages, run tests, and ' +
			'execute code. Use the file tools for plain reads and edits — they are far faster ' +
			'than booting a container. ' +
			'When a repository is attached, the sandbox already contains a fresh checkout with ' +
			'your changes applied on top, so paths are the repo\'s own. ' +
			'IMPORTANT: the command starts in the repository root. Workspace paths are absolute ' +
			'("/frontend/src/app.ts") but the matching shell path is relative to where you already ' +
			'are ("frontend/src/app.ts"). Write "cd frontend && npm run build", never ' +
			'"cd /frontend && npm run build" — a leading slash points at the container root, ' +
			'where nothing of yours exists.',
		input_schema: {
			type: 'object',
			properties: {
				command: { type: 'string', description: 'Shell command, run from the workspace root.' },
				timeout_seconds: { type: 'integer', description: 'Defaults to 120, maximum 300.' },
				install: {
					type: 'boolean',
					description:
						'Install the project\'s dependencies before running. Only for commands that ' +
						'genuinely need them — tests, builds, typechecks. It is the slowest part of a ' +
						'turn, so leave it off for anything else.',
				},
			},
			required: ['command'],
		},
	},
];

/** Offered only when a repository is attached — otherwise there is no repo to file against. */
/**
 * Read-only git against the checkout in the sandbox, so `git diff` is literally
 * what the pull request will contain rather than inferred from rows.
 *
 * Nothing writes: committing inside a container thrown away each turn would put
 * the two sources of truth into disagreement, and the object has to win.
 */
/**
 * Processes that keep running after the tool call returns. Separate from
 * run_command, which waits for an end a dev server is never going to reach.
 */
const PROCESS_TOOLS: Anthropic.Tool[] = [
	{
		name: 'start_process',
		description:
			'Start a long-running process in the sandbox and return immediately, leaving it running. ' +
			'Use this for anything that does not exit on its own — a dev server, a watcher, a queue worker. ' +
			'Use run_command instead for anything that finishes, like a build or a test run. ' +
			'Give it a short name so you can read its output or stop it later. ' +
			'The process keeps running between turns only on the always-on runtime; on the on-demand ' +
			'runtime the container is destroyed at the end of the turn and takes the process with it, ' +
			'so start it and use it in the same turn. ' +
			'Early output is returned so you can see straight away if it failed to bind a port.',
		input_schema: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Short label, e.g. "dev" or "api". Used to read or stop it later.',
				},
				command: {
					type: 'string',
					description: 'The command to run, e.g. "npm run dev". Runs in the repository root.',
				},
				wait_ms: {
					type: 'number',
					description:
						'How long to wait before reporting back, so a fast failure is caught. Defaults to 3000.',
				},
			},
			required: ['name', 'command'],
		},
	},
	{
		name: 'list_processes',
		description:
			'List processes started in this sandbox, whether each is still alive, and the port it ' +
			'appears to be listening on. Check here before starting something that may already be running.',
		input_schema: { type: 'object', properties: {} },
	},
	{
		name: 'read_process_output',
		description:
			'Read recent output from a running process. This is where a dev server reports the port it ' +
			'bound, the compile errors it hit, and the requests it served — check it before assuming ' +
			'a server is healthy.',
		input_schema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'The name given to start_process.' },
				lines: { type: 'number', description: 'How many trailing lines to return. Defaults to 40.' },
			},
			required: ['name'],
		},
	},
	{
		name: 'stop_process',
		description:
			'Stop a process started with start_process. Stop a dev server when you are done with it ' +
			'rather than leaving it holding a port.',
		input_schema: {
			type: 'object',
			properties: { name: { type: 'string', description: 'The name given to start_process.' } },
			required: ['name'],
		},
	},
];

const BROWSER_TOOLS: Anthropic.Tool[] = [
	{
		name: 'screenshot',
		description:
			'Open a URL in a real browser inside the sandbox and look at it. Returns the image ' +
			'plus any errors the page logged to its console. ' +
			'Use this after changing anything visual — you cannot tell whether a layout is right ' +
			'by reading the code, and a passing test does not mean the page renders. ' +
			'The URL must be served from inside the sandbox, so start the dev server with ' +
			'run_command first and point at localhost. The container cannot reach the outside ' +
			'internet or the user\'s machine. ' +
			'The first call downloads a browser and takes a minute; later calls are quick.',
		input_schema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: 'Page to open, e.g. "http://localhost:3000/login".',
				},
				full_page: {
					type: 'boolean',
					description:
						'Capture the whole scrollable page rather than just the viewport. Off by default.',
				},
				wait_ms: {
					type: 'number',
					description:
						'Milliseconds to wait after load, for a page that animates in or fetches on mount. Defaults to 1000.',
				},
			},
			required: ['url'],
		},
	},
];

const GIT_TOOLS: Anthropic.Tool[] = [
	{
		name: 'git',
		description:
			'Run a read-only git command against the repository checkout in the sandbox. ' +
			'Use "status" to see which files you have changed, "diff" for the exact lines, ' +
			'and "diff_stat" for a per-file summary before opening a pull request. ' +
			'"show" prints a file as it exists in the base commit, which is how you check what ' +
			'you started from without undoing your own work, and "base" reports the commit you ' +
			'are working from. ' +
			'This reflects the real repository, so it is the most reliable answer to ' +
			'"what have I actually changed". It cannot commit, push, or check out — ' +
			'the workspace is the source of truth and the container is discarded each turn. ' +
			'Note the clone is shallow, so history is one commit deep.',
		input_schema: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					enum: ['status', 'diff', 'diff_stat', 'show', 'base'],
					description: 'Which read-only git command to run.',
				},
				path: {
					type: 'string',
					description:
						'Optional file to scope to, e.g. "frontend/src/app.tsx". Required for "show". ' +
						'Relative to the repository root, with no leading slash.',
				},
			},
			required: ['command'],
		},
	},
];

const GITHUB_TOOLS: Anthropic.Tool[] = [
	{
		name: 'github_create_issue',
		description:
			'File a new ISSUE on the repository — a bug report or feature request. ' +
			'This is NOT how you open a pull request. You cannot open a pull request yourself; ' +
			'that is a button the user clicks. If the user asks you to open, create, or raise a ' +
			'pull request, do not call this — finish your changes and tell them to press ' +
			'"Open pull request". ' +
			'Use this only when the user explicitly asks for an issue to be filed, since it is ' +
			'visible to everyone watching the repo.',
		input_schema: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'One line. What is wrong or what is wanted.' },
				body: {
					type: 'string',
					description:
						'Markdown. Enough for someone else to act on it without asking you questions.',
				},
			},
			required: ['title', 'body'],
		},
	},
];

/**
 * Assemble the tool list for a turn.
 *
 * `run_command` appears only when a sandbox exists, and the GitHub tools only
 * when a repository is attached. The agent is never shown a tool this
 * deployment cannot back — being told plainly that it has no shell is far
 * better than letting it discover that by failing.
 */
export function buildToolDefinitions(options: {
	sandbox: boolean;
	repo: boolean;
}): Anthropic.Tool[] {
	return [
		...FILE_TOOLS,
		...MEMORY_TOOLS,
		...SKILL_TOOLS,
		...SCHEDULE_TOOLS,
		...PROPOSAL_TOOLS,
		...(options.sandbox ? SANDBOX_TOOLS : []),
		// Both need a container: nothing to keep running, and nothing to render on.
		...(options.sandbox ? PROCESS_TOOLS : []),
		...(options.sandbox ? BROWSER_TOOLS : []),
		// Needs both: a checkout to inspect, and a container to inspect it in.
		...(options.sandbox && options.repo ? GIT_TOOLS : []),
		...(options.repo ? GITHUB_TOOLS : []),
	];
}

/** Tools that change workspace state, so the UI knows when to refresh. */
export const MUTATING_TOOLS = new Set([
	'write_file',
	'edit_file',
	'delete_file',
	'move_file',
	'restore_file',
	'run_command',
]);

/** Tools that change the brain, so the memory and skills panels refresh. */
export const BRAIN_TOOLS = new Set([
	'remember_about_repo',
	'remember',
	'correct_memory',
	'forget',
	'save_skill',
]);
