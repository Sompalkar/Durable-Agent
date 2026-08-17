/**
 * The sandbox contract.
 *
 * Files, search, and history live in the Durable Object, where they are cheap
 * and permanent. A real shell is the one thing that genuinely needs Linux, so
 * it is rented for the seconds it takes to run and nothing more.
 *
 * Providers implement this interface; the agent never knows which one it got.
 * When none is configured the `run_command` tool is simply not offered, and the
 * agent is told it has no shell rather than being allowed to fail at one.
 */

/** A file pushed into the sandbox before a command runs. */
export interface SandboxFile {
	/** Absolute workspace path, e.g. `/src/index.ts`. */
	path: string;
	content: string;
}

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	/** Files the command created or modified, to write back into the workspace. */
	changedFiles: SandboxFile[];
	/** Wall-clock duration of the command itself. */
	durationMs: number;
}

/**
 * A repository to check out before the command runs.
 *
 * Pinned to a commit rather than just a branch, so every turn of a task sees the
 * same starting point even if someone pushes to the branch in between.
 */
export interface RepoCheckout {
	/** HTTPS clone URL, with credentials already embedded by the caller. */
	cloneUrl: string;
	branch: string;
	commitSha: string;
}

export interface RunOptions {
	command: string;
	/**
	 * Files to write into the sandbox before running.
	 *
	 * In repo mode these are not the whole workspace — they are only the files
	 * the agent has changed, applied on top of a fresh checkout.
	 */
	files: SandboxFile[];
	timeoutSeconds: number;
	/**
	 * Checked out before the change-detection clock starts, so the thousands of
	 * files a clone writes are never mistaken for the agent's work.
	 */
	repo?: RepoCheckout;
	/**
	 * Run once after checkout, before the command — dependency installation,
	 * typically. Only supplied when the command actually needs it, because this
	 * is the slow part of every turn.
	 */
	setup?: string;
	/**
	 * Called with each new chunk of output while the command is still running.
	 *
	 * Optional because not every caller wants to stream — a background run has
	 * nobody watching, and paying for extra round trips to nobody is waste.
	 */
	onOutput?: (chunk: string) => void;
	/**
	 * Output budget in characters. The default keeps a runaway command from
	 * filling a turn; raise it when the output is read by code rather than by
	 * the model — a screenshot clipped mid-base64 is not shorter, it is broken.
	 */
	maxOutputChars?: number;
}

export interface SandboxProvider {
	/** Shown in the UI and in tool output so the user knows where code ran. */
	readonly name: string;

	/**
	 * Prepare the sandbox, run a command, and report back anything the command
	 * changed on disk.
	 */
	run(options: RunOptions): Promise<CommandResult>;

	/**
	 * A public URL for something listening on `port` inside the sandbox.
	 *
	 * Optional: not every provider can expose a port. Returns null when this one
	 * cannot, or when no sandbox is running yet.
	 */
	previewUrl?(port: number, expiresInSeconds: number): Promise<string | null>;

	/** Tear the sandbox down. Best-effort; never throws. */
	dispose(): Promise<void>;
}

export class SandboxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SandboxError';
	}
}
