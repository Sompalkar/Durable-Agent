/**
 * Daytona sandbox provider.
 *
 * Everything here goes through a single documented endpoint —
 * `POST /toolbox/{id}/process/execute`. File transfer is done by piping base64
 * through that same endpoint rather than using the multipart upload/download
 * routes, which keeps the surface we depend on to one call and avoids
 * multipart encoding from a Worker.
 *
 * The sandbox is created on first use and reused for the life of the session,
 * so only the first command in a session pays for boot.
 */

import type {
	CommandResult,
	RepoCheckout,
	RunOptions,
	SandboxFile,
	SandboxProvider,
} from './types';
import { SandboxError } from './types';

export interface DaytonaConfig {
	apiKey: string;
	/** Control plane. Defaults to Daytona Cloud. */
	apiUrl: string;
	/** Toolbox proxy, where per-sandbox commands are sent. */
	toolboxUrl: string;
	/** Region/target for new sandboxes. */
	target: string;
	/** Optional image or snapshot to boot from. */
	snapshot?: string;
	organizationId?: string;
	/** Idle minutes before Daytona stops the sandbox on its own. */
	autoStopMinutes: number;
	/** Reused across commands; created on first use if absent. */
	sandboxId?: string;
	/** Called when a sandbox is created, so the caller can persist the id. */
	onSandboxCreated?: (sandboxId: string) => void | Promise<void>;
}

/** Directory the workspace is mirrored into inside the sandbox. */
const WORKDIR = '/home/daytona/workspace';

/**
 * Marks the moment the command starts, in the container's own filesystem.
 *
 * Kept outside WORKDIR so it is never picked up as a changed file.
 */
const MARKER = '/tmp/.agent-run-marker';

/**
 * Records which commit the workspace holds, inside the container itself.
 *
 * A provider instance lives for one turn, so an in-memory flag cannot tell a
 * reused container that it is already checked out — and re-cloning wipes
 * `node_modules` along with everything else. Keeping the answer on the
 * container's own disk is the only place both turns can see it.
 */
const CHECKOUT_MARKER = '/tmp/.agent-checkout-sha';

/** Where a streamed command's output and exit code are collected. */
const LOG_FILE = '/tmp/.agent-run.log';
const EXIT_FILE = '/tmp/.agent-run.exit';

/**
 * How often to ask for new output.
 *
 * Every poll is a subrequest, and a Worker invocation gets 50 of them on the
 * free plan — shared with the model calls, the tool calls and the sandbox
 * setup. A fixed 1.2s interval means a two-minute command spends a hundred
 * subrequests on polling alone and dies partway through.
 *
 * So the interval backs off: responsive while somebody is still watching
 * closely, then progressively cheaper as a command turns out to be long. A
 * five-minute command costs about 25 polls instead of 250.
 */
const POLL_START_MS = 1_000;
const POLL_MAX_MS = 15_000;
const POLL_BACKOFF = 1.35;

/** Separates the log tail from the exit code in a single polling response. */
const POLL_DELIMITER = '\n<<<AGENT_EXIT>>>';

/** Guard rails on how much we are willing to move in and out of the sandbox. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_OUTPUT_CHARS = 20_000;

export class DaytonaSandbox implements SandboxProvider {
	readonly name = 'Daytona';
	private sandboxId: string | undefined;
	/** Commit currently checked out, so a multi-command turn clones only once. */
	private checkedOut: string | undefined;

	constructor(private readonly config: DaytonaConfig) {
		this.sandboxId = config.sandboxId;
	}

	/**
	 * Run a command, booting a replacement sandbox once if the stored one has
	 * been reclaimed. A user whose container was idled out should see their
	 * command run, not an error telling them to try again.
	 */
	async run(options: RunOptions): Promise<CommandResult> {
		try {
			return await this.runOnce(options);
		} catch (error) {
			if (!(error instanceof SandboxError) || !/reclaimed after being idle/.test(error.message)) {
				throw error;
			}
			// `exec` has already forgotten the dead id, so this boots a fresh one.
			return this.runOnce(options);
		}
	}

	private async runOnce(options: RunOptions): Promise<CommandResult> {
		const sandboxId = await this.ensureSandbox();

		// Checkout first, and crucially *before* the change-detection clock starts.
		// A clone writes thousands of files; if `since` were taken beforehand,
		// every one of them would be reported back as the agent's work and the
		// whole repository would be copied into the Durable Object.
		if (options.repo) {
			await this.ensureCheckout(sandboxId, options.repo);
		}

		// Dependency installation, when the caller judged it necessary. Also
		// outside the clock: node_modules is not a change the agent made.
		if (options.setup) {
			const setup = await this.exec(sandboxId, `cd ${WORKDIR} && ${options.setup}`, 600);
			if (setup.exitCode !== 0) {
				throw new SandboxError(
					`Setup failed (exit ${setup.exitCode}): ${tailOf(setup.stderr || setup.stdout)}`,
				);
			}
		}

		if (options.files.length > 0) {
			const upload = await this.exec(sandboxId, buildUploadScript(options.files), 120);
			if (upload.exitCode !== 0) {
				throw new SandboxError(`Failed to sync files into the sandbox: ${upload.stderr}`);
			}
		}

		// Everything the command did NOT do is now on disk, so mark the line here.
		//
		// This used to be a timestamp taken from `Date.now()` and compared with
		// `find -newermt`. That compares the Worker's clock against the
		// container's, and the two are not the same clock: a container running
		// even slightly ahead makes every file in a fresh checkout look newer
		// than the mark, and the entire repository gets reported back as the
		// agent's work. A marker file keeps the comparison inside one machine.
		await this.exec(sandboxId, `touch ${MARKER}`, 30);

		const startedAt = Date.now();
		const result = options.onOutput
			? await this.execStreaming(sandboxId, options.command, options.timeoutSeconds, options.onOutput)
			: await this.exec(
					sandboxId,
					`cd ${WORKDIR} 2>/dev/null || mkdir -p ${WORKDIR} && cd ${WORKDIR}; ${options.command}`,
					options.timeoutSeconds,
				);
		const durationMs = Date.now() - startedAt;

		return {
			exitCode: result.exitCode,
			stdout: truncate(result.stdout),
			stderr: truncate(result.stderr),
			changedFiles: await this.collectChanges(sandboxId),
			durationMs,
		};
	}

	/**
	 * Run a command and report its output as it arrives.
	 *
	 * Daytona's execute endpoint is request/response: it returns when the command
	 * finishes, so there is no stream to subscribe to. The way around that is to
	 * stop asking it to run the command in the foreground — launch it detached
	 * with its output redirected to a file, then poll that file.
	 *
	 * Each poll returns only the bytes written since the last one, so the cost is
	 * proportional to the output rather than to how long the command takes.
	 */
	private async execStreaming(
		sandboxId: string,
		command: string,
		timeoutSeconds: number,
		onOutput: (chunk: string) => void,
	): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		// The exit-code file is written last, so its existence is the signal that
		// the command finished — checking the pid would race a process that has
		// exited but not yet flushed its output.
		const launch = [
			`cd ${WORKDIR} 2>/dev/null || mkdir -p ${WORKDIR} && cd ${WORKDIR}`,
			`rm -f ${LOG_FILE} ${EXIT_FILE}`,
			`touch ${LOG_FILE}`,
			`nohup sh -c ${shellQuote(`{ ${command} ; } > ${LOG_FILE} 2>&1 ; echo $? > ${EXIT_FILE}`)} >/dev/null 2>&1 &`,
			'echo launched',
		].join(' ; ');

		const started = await this.exec(sandboxId, launch, 30);
		if (started.exitCode !== 0) {
			throw new SandboxError(`Could not start the command: ${tailOf(started.stderr)}`);
		}

		let offset = 0;
		let output = '';
		let interval = POLL_START_MS;
		const deadline = Date.now() + timeoutSeconds * 1000;

		while (Date.now() < deadline) {
			await sleep(interval);

			// One call gets both the new bytes and the finished-or-not answer. Two
			// calls would double the polling cost for no extra information.
			const poll = await this.exec(
				sandboxId,
				`tail -c +${offset + 1} ${LOG_FILE} 2>/dev/null; printf '${POLL_DELIMITER}'; cat ${EXIT_FILE} 2>/dev/null`,
				30,
			);

			const marker = poll.stdout.lastIndexOf(POLL_DELIMITER);
			const chunk = marker === -1 ? poll.stdout : poll.stdout.slice(0, marker);
			const exitText = marker === -1 ? '' : poll.stdout.slice(marker + POLL_DELIMITER.length).trim();

			// Output means something is happening, so stay responsive. Silence means
			// a long compile or install, where nobody is reading every line anyway.
			interval = chunk
				? POLL_START_MS
				: Math.min(POLL_MAX_MS, Math.round(interval * POLL_BACKOFF));

			if (chunk) {
				offset += byteLengthOf(chunk);
				// Truncation applies to what the model is sent, not to what the user
				// watches — the live view is free, the context is not.
				output += chunk;
				onOutput(chunk);
			}

			if (exitText !== '') {
				return { exitCode: Number(exitText) || 0, stdout: output, stderr: '' };
			}
		}

		// Timed out. Kill it rather than leaving it running in a container that is
		// about to be destroyed anyway — an orphan can still burn CPU until then.
		await this.exec(sandboxId, `pkill -f ${shellQuote(command)} || true`, 15).catch(() => {});
		return {
			exitCode: 124,
			stdout: output,
			stderr: `Command exceeded ${timeoutSeconds}s and was stopped.`,
		};
	}

	/**
	 * Check out the repository, once per sandbox.
	 *
	 * A shallow clone of one commit: the agent needs the tree, not the history,
	 * and full history on a large repo is the difference between two seconds and
	 * thirty. The credentials live in the URL and are scrubbed from the remote
	 * immediately afterwards, so a later `git remote -v` — or any command the
	 * agent chooses to run — cannot read the token back out.
	 */
	private async ensureCheckout(sandboxId: string, repo: RepoCheckout): Promise<void> {
		if (this.checkedOut === repo.commitSha) return;

		// A container carried over from a previous turn may already hold exactly
		// this commit, with dependencies installed on top. Asking it is one cheap
		// call; getting it wrong costs a re-clone and a re-install.
		const existing = await this.exec(sandboxId, `cat ${CHECKOUT_MARKER} 2>/dev/null || true`, 30);
		if (existing.stdout.trim() === repo.commitSha) {
			this.checkedOut = repo.commitSha;
			return;
		}

		const script = [
			`rm -rf ${WORKDIR}`,
			`mkdir -p ${WORKDIR}`,
			`cd ${WORKDIR}`,
			`git init -q`,
			`git remote add origin ${shellQuote(repo.cloneUrl)}`,
			`git fetch -q --depth 1 origin ${shellQuote(repo.commitSha)}`,
			`git checkout -q FETCH_HEAD`,
			// Token out of the remote as soon as it is no longer needed.
			`git remote set-url origin ${shellQuote(stripCredentials(repo.cloneUrl))}`,
			// Written last, so a checkout interrupted halfway is not mistaken for a
			// finished one by the next turn.
			`printf '%s' ${shellQuote(repo.commitSha)} > ${CHECKOUT_MARKER}`,
		].join(' && ');

		const result = await this.exec(sandboxId, script, 300);
		if (result.exitCode !== 0) {
			throw new SandboxError(
				`Could not check out the repository: ${tailOf(result.stderr || result.stdout)}`,
			);
		}

		this.checkedOut = repo.commitSha;
	}

	/**
	 * A signed URL, not the standard one.
	 *
	 * The standard preview URL needs an `x-daytona-preview-token` header, which a
	 * browser cannot attach to a link the user clicks. A signed URL carries its
	 * own authentication, so it works by being opened.
	 */
	async previewUrl(port: number, expiresInSeconds: number): Promise<string | null> {
		if (!this.sandboxId) return null;
		if (!Number.isInteger(port) || port < 1 || port > 65_535) {
			throw new SandboxError(`Port ${port} is not a valid port number.`);
		}

		const response = await fetch(
			`${this.config.apiUrl}/sandbox/${this.sandboxId}/ports/${port}/signed-preview-url` +
				`?expiresInSeconds=${Math.min(86_400, Math.max(60, expiresInSeconds))}`,
			{ headers: this.headers() },
		);

		if (!response.ok) {
			throw new SandboxError(
				`Could not get a preview URL for port ${port} (${response.status}). ` +
					'Check that something is listening on it.',
			);
		}

		const body = (await response.json()) as { url?: string; signedUrl?: string };
		return body.url ?? body.signedUrl ?? null;
	}

	async dispose(): Promise<void> {
		if (!this.sandboxId) return;
		try {
			await fetch(`${this.config.apiUrl}/sandbox/${this.sandboxId}`, {
				method: 'DELETE',
				headers: this.headers(),
			});
		} catch {
			// Best effort: an orphaned sandbox will hit its own idle timeout.
		}
		this.sandboxId = undefined;
	}

	// --------------------------------------------------------------- private

	/**
	 * True for the errors a stopped or deleted sandbox produces.
	 *
	 * A stored id outlives the container it names — the provider reaps an idle
	 * sandbox, and the next turn is still holding its id. Treating that as a
	 * fatal error strands the session permanently; the right answer is to notice
	 * and boot a replacement.
	 */
	private static readonly GONE = /failed to resolve container IP|not found|sandbox.*(stopped|destroyed|archived)/i;

	private async ensureSandbox(): Promise<string> {
		if (this.sandboxId) return this.sandboxId;

		const body: Record<string, unknown> = {
			target: this.config.target,
			// Idle timeout in minutes. This is the safety net, not the plan: the
			// session disposes the sandbox at the end of a turn. It only matters if
			// the Worker dies mid-turn and never gets to clean up.
			autoStopInterval: this.config.autoStopMinutes,
		};
		if (this.config.snapshot) body.snapshot = this.config.snapshot;

		const response = await fetch(`${this.config.apiUrl}/sandbox`, {
			method: 'POST',
			headers: { ...this.headers(), 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new SandboxError(
				`Could not create a Daytona sandbox (${response.status}): ${await response.text()}`,
			);
		}

		const payload = (await response.json()) as { id?: string; sandboxId?: string };
		const id = payload.id ?? payload.sandboxId;
		if (!id) throw new SandboxError('Daytona did not return a sandbox id.');

		this.sandboxId = id;
		await this.config.onSandboxCreated?.(id);
		return id;
	}

	/** The one endpoint everything else is built on. */
	private async exec(
		sandboxId: string,
		command: string,
		timeoutSeconds: number,
	): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		const response = await fetch(
			`${this.config.toolboxUrl}/toolbox/${sandboxId}/process/execute`,
			{
				method: 'POST',
				headers: { ...this.headers(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ command, timeout: timeoutSeconds }),
			},
		);

		if (!response.ok) {
			const detail = await response.text();
			if (DaytonaSandbox.GONE.test(detail)) {
				// Forget it so the next call boots a fresh one rather than retrying
				// against a container that no longer exists.
				this.sandboxId = undefined;
				this.checkedOut = undefined;
				throw new SandboxError(
					'The sandbox for this session was reclaimed after being idle. ' +
						'Run the command again and a fresh one will be started.',
				);
			}
			throw new SandboxError(`Sandbox command failed (${response.status}): ${detail}`);
		}

		// Field names have varied across Daytona versions, so accept the
		// documented shape and the obvious alternatives rather than guessing one.
		const payload = (await response.json()) as Record<string, unknown>;
		return {
			exitCode: Number(payload.exitCode ?? payload.exit_code ?? payload.code ?? 0),
			stdout: String(payload.result ?? payload.stdout ?? payload.output ?? ''),
			stderr: String(payload.stderr ?? payload.error ?? ''),
		};
	}

	/**
	 * Read back files the command touched.
	 *
	 * One `find` for anything newer than the marker dropped just before the
	 * command ran, then base64 each hit into a delimited stream we can split up
	 * here — a single round trip regardless of how many files changed.
	 *
	 * The exclusions use `-prune` on directory *names* rather than paths. The
	 * earlier version matched `./dist/*`, which only catches a build directory at
	 * the repository root — so in a monorepo `frontend/.next` and `backend/dist`
	 * sailed through, and one `npm run build` reported 49 generated files as the
	 * agent's own work. Pruning by name catches them at any depth, and skips
	 * descending into them at all.
	 */
	private async collectChanges(sandboxId: string): Promise<SandboxFile[]> {
		const script = `
cd ${WORKDIR} 2>/dev/null || exit 0
find . \\
  \\( -name node_modules -o -name .git -o -name dist -o -name build -o -name out \\
     -o -name .next -o -name .nuxt -o -name .turbo -o -name .cache -o -name coverage \\
     -o -name target -o -name __pycache__ -o -name .venv -o -name vendor \\) -prune -o \\
  -type f -newer ${MARKER} \\
  ! -name '*.tsbuildinfo' ! -name '*.log' ! -name '*.map' ! -name '*.lock' \\
  -size -${Math.floor(MAX_FILE_BYTES / 1024)}k -print 2>/dev/null | head -50 | while read -r f; do
  printf '<<<FILE:%s\\n' "\${f#./}"
  base64 -w0 "$f" 2>/dev/null || base64 "$f"
  printf '\\n'
done`.trim();

		try {
			const result = await this.exec(sandboxId, script, 60);
			return parseChangedFiles(result.stdout);
		} catch {
			// Losing the write-back is survivable; failing the command is not.
			return [];
		}
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.config.apiKey}`,
		};
		if (this.config.organizationId) {
			headers['X-Daytona-Organization-ID'] = this.config.organizationId;
		}
		return headers;
	}
}

// ------------------------------------------------------------------ helpers

/** Shell script that recreates the workspace inside the sandbox. */
function buildUploadScript(files: SandboxFile[]): string {
	const lines = [`mkdir -p ${WORKDIR}`, `cd ${WORKDIR}`];
	let budget = MAX_UPLOAD_BYTES;

	for (const file of files) {
		const encoded = base64Encode(file.content);
		if (encoded.length > budget) break;
		budget -= encoded.length;

		// Paths come from the workspace already normalized to `/a/b.txt`.
		const relative = file.path.replace(/^\//, '');
		const directory = relative.includes('/')
			? relative.slice(0, relative.lastIndexOf('/'))
			: '';

		if (directory) lines.push(`mkdir -p ${shellQuote(directory)}`);
		lines.push(`printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(relative)}`);
	}

	return lines.join('\n');
}

/** Split the delimited base64 stream produced by `collectChanges`. */
function parseChangedFiles(stdout: string): SandboxFile[] {
	const files: SandboxFile[] = [];
	const chunks = stdout.split('<<<FILE:');

	for (const chunk of chunks) {
		if (!chunk.trim()) continue;
		const newline = chunk.indexOf('\n');
		if (newline === -1) continue;

		const path = chunk.slice(0, newline).trim();
		const encoded = chunk.slice(newline + 1).replace(/\s/g, '');
		if (!path || !encoded) continue;

		try {
			files.push({ path: `/${path}`, content: base64Decode(encoded) });
		} catch {
			// Binary or truncated output — skip rather than corrupt the workspace.
		}
	}
	return files;
}

/** Single-quote a value for `sh`, escaping any embedded quotes. */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function base64Encode(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64Decode(value: string): string {
	const binary = atob(value);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/** Last few lines, which is where a failure explains itself. */
function tailOf(value: string): string {
	return value.trim().split('\n').slice(-8).join('\n') || 'no output';
}

/** Remove `user:token@` from a clone URL before it is left lying in git config. */
function stripCredentials(url: string): string {
	return url.replace(/\/\/[^@/]*@/, '//');
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Byte length, because `tail -c` counts bytes and JavaScript counts code units. */
function byteLengthOf(value: string): number {
	return new TextEncoder().encode(value).length;
}

function truncate(value: string): string {
	return value.length <= MAX_OUTPUT_CHARS
		? value
		: `${value.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated.`;
}
