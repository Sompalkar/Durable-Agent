/**
 * Cloudflare Sandbox provider.
 *
 * This is the interesting one architecturally. `Sandbox` from
 * `@cloudflare/sandbox` is itself a Durable Object with a Linux container
 * attached — so "a shell in a Durable Object" is real, just not the way you
 * might first imagine it.
 *
 * A Durable Object runs in a V8 isolate: there is no kernel, no processes, no
 * `fork`. You cannot run bash *inside* the isolate. What you can do is have the
 * object own a container and drive it. The object is the handle and the
 * lifecycle; the container is the muscle, and it sleeps when idle.
 *
 * Compared to the Daytona provider this one gets a proper file API, so there is
 * no base64-through-the-shell trick — just `writeFile` and `readFile`.
 */

import { getSandbox, type Sandbox } from '@cloudflare/sandbox';
import type {
	CommandResult,
	RepoCheckout,
	RunOptions,
	SandboxFile,
	SandboxProvider,
} from './types';
import { SandboxError } from './types';

/** Directory the workspace is mirrored into inside the container. */
const WORKDIR = '/workspace';

/** Marks the start of a command, in the container's own filesystem. */
const MARKER = '/tmp/.agent-run-marker';

/** Guard rails on how much we move in and out of the container. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_FILES_BACK = 50;
const MAX_OUTPUT_CHARS = 20_000;

export interface CloudflareSandboxConfig {
	namespace: DurableObjectNamespace<Sandbox>;
	/** One container per session, so state survives between commands. */
	sessionId: string;
}

export class CloudflareSandbox implements SandboxProvider {
	readonly name = 'Cloudflare Sandbox';
	/** Commit currently checked out, so a multi-command turn clones only once. */
	private checkedOut: string | undefined;

	constructor(private readonly config: CloudflareSandboxConfig) {}

	async run(options: RunOptions): Promise<CommandResult> {
		const sandbox = getSandbox(this.config.namespace, this.config.sessionId);

		try {
			// Checkout and setup both run before the change-detection clock starts,
			// so neither the clone nor node_modules is mistaken for the agent's work.
			if (options.repo) await this.ensureCheckout(sandbox, options.repo);
			if (options.setup) {
				const setup = await sandbox.exec(options.setup, { cwd: WORKDIR, timeout: 600_000 });
				if (setup.exitCode !== 0) {
					throw new SandboxError(`Setup failed: ${setup.stderr ?? setup.stdout ?? ''}`);
				}
			}

			await this.syncIn(sandbox, options.files);

			// Marked inside the container rather than compared against the Worker's
			// clock — see the note in daytona.ts. Cross-machine timestamp
			// comparison reports a whole checkout as the agent's work.
			await sandbox.exec(`touch ${MARKER}`, { timeout: 30_000 });

			const startedAt = Date.now();
			const result = await sandbox.exec(options.command, {
				cwd: WORKDIR,
				timeout: options.timeoutSeconds * 1000,
			});
			const durationMs = Date.now() - startedAt;

			return {
				exitCode: result.exitCode,
				stdout: truncate(result.stdout ?? ''),
				stderr: truncate(result.stderr ?? ''),
				changedFiles: await this.syncOut(sandbox),
				durationMs,
			};
		} catch (error) {
			throw new SandboxError(
				error instanceof Error ? error.message : 'The sandbox command failed.',
			);
		}
	}

	/** Shallow checkout of one commit, with the token scrubbed from the remote. */
	private async ensureCheckout(
		sandbox: ReturnType<typeof getSandbox>,
		repo: RepoCheckout,
	): Promise<void> {
		if (this.checkedOut === repo.commitSha) return;

		const script = [
			`rm -rf ${WORKDIR}`,
			`mkdir -p ${WORKDIR}`,
			`cd ${WORKDIR}`,
			`git init -q`,
			`git remote add origin '${repo.cloneUrl}'`,
			`git fetch -q --depth 1 origin '${repo.commitSha}'`,
			`git checkout -q FETCH_HEAD`,
			`git remote set-url origin '${repo.cloneUrl.replace(/\/\/[^@/]*@/, '//')}'`,
		].join(' && ');

		const result = await sandbox.exec(script, { timeout: 300_000 });
		if (result.exitCode !== 0) {
			throw new SandboxError(`Could not check out the repository: ${result.stderr ?? ''}`);
		}

		this.checkedOut = repo.commitSha;
	}

	async dispose(): Promise<void> {
		// The container sleeps on its own idle timer, and the session may well run
		// another command. Tearing it down here would only pay for a cold start.
	}

	/** Mirror the Durable Object workspace into the container. */
	private async syncIn(sandbox: SandboxHandle, files: SandboxFile[]): Promise<void> {
		let budget = MAX_UPLOAD_BYTES;

		for (const file of files) {
			const size = file.content.length;
			if (size > budget) break;
			budget -= size;

			// `writeFile` creates parent directories, so paths can be written flat.
			await sandbox.writeFile(`${WORKDIR}${file.path}`, file.content);
		}
	}

	/**
	 * Read back whatever the command touched.
	 *
	 * One `find` to name the changed files, then a read each. The Durable Object
	 * stays the source of truth; the container is scratch space.
	 */
	private async syncOut(sandbox: SandboxHandle): Promise<SandboxFile[]> {
		const listing = await sandbox.exec(
			`find . -type f -newer ${MARKER} ` +
				`! -path './node_modules/*' ! -path './.git/*' ! -path './dist/*' ! -path './.next/*' ` +
				`2>/dev/null | head -${MAX_FILES_BACK}`,
			{ cwd: WORKDIR, timeout: 30_000 },
		);

		const paths = (listing.stdout ?? '')
			.split('\n')
			.map((line) => line.trim().replace(/^\.\//, ''))
			.filter(Boolean);

		const changed: SandboxFile[] = [];
		for (const path of paths) {
			try {
				const file = await sandbox.readFile(`${WORKDIR}/${path}`);
				if (typeof file.content === 'string') {
					changed.push({ path: `/${path}`, content: file.content });
				}
			} catch {
				// Binary or unreadable — skip rather than corrupt the workspace.
			}
		}
		return changed;
	}
}

/** The subset of the SDK surface this provider actually uses. */
type SandboxHandle = ReturnType<typeof getSandbox>;

function truncate(value: string): string {
	return value.length <= MAX_OUTPUT_CHARS
		? value
		: `${value.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated.`;
}
