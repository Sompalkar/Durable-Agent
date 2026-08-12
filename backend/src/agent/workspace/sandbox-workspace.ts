/**
 * A workspace whose files live in the container.
 *
 * The checkout on disk is what the agent reads and writes, so files a command
 * produced are visible immediately — in the Durable-Object runtime they stay
 * invisible until something copies them back.
 *
 * Writes go to both: the container because that is what runs, the object
 * because a filesystem has no revisions and dropping them would break diffs and
 * pull requests the moment somebody switched runtime.
 *
 * Every operation is a subrequest and an invocation has fifty, so operations
 * batch into single commands and none loops per file.
 */

import type { FileRecord, FileRevision, FileWithContent, GrepMatch } from '../../types';
import { matchesGlob } from '../../workspace/glob';
import { normalizePath } from '../../workspace/paths';
import {
	EditError,
	describeNearest,
	matchIgnoringIndentation,
	reindent,
} from '../../workspace/filesystem';
import type { SandboxProvider } from '../sandbox';
import type { AgentWorkspace } from './types';

/** Where the checkout lives inside the container. Matches the provider's. */
const WORKDIR = '/home/daytona/workspace';

/** A workspace listing that includes `node_modules` is unusable. */
const SKIP_DIRECTORIES = [
	'node_modules',
	'.git',
	'dist',
	'build',
	'out',
	'.next',
	'.nuxt',
	'.turbo',
	'.cache',
	'coverage',
	'target',
	'__pycache__',
	'.venv',
	'vendor',
];

/** So a large repository cannot fill the context window. */
const MAX_LISTED_FILES = 400;

/** Matches the Durable Object's limit, so behaviour is runtime-independent. */
const MAX_FILE_BYTES = 512 * 1024;

export class SandboxWorkspace implements AgentWorkspace {
	constructor(
		private readonly sandbox: SandboxProvider,
		/** Kept for what a filesystem cannot do: remember earlier versions. */
		private readonly durable: AgentWorkspace,
		/** Applied before the first command, so the checkout exists to read. */
		private readonly repo: { cloneUrl: string; branch: string; commitSha: string } | null,
	) {}

	// ---------------------------------------------------------------- reads

	async list(directory?: string): Promise<FileRecord[]> {
		const scope = directory ? relativeOf(directory) : '';
		const target = scope ? `./${scope}` : '.';

		// One `find` with size and mtime inline, so a listing is one round trip
		// rather than a stat per file. `-printf` is GNU-only; without the fallback
		// a non-GNU find would swallow its error and report an empty workspace.
		const prune = pruneExpression();
		const listing = await this.exec(
			`{ find ${quote(target)} ${prune} -type f -printf '%s\\t%T@\\t%P\\n' 2>/dev/null ` +
				`|| find ${quote(target)} ${prune} -type f -print 2>/dev/null | sed 's|^\\./||' | sed 's|^|0\\t0\\t|' ; } ` +
				`| head -${MAX_LISTED_FILES}`,
		);

		const records = listing
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const [size, mtime, name] = line.split('\t');
				const at = Math.round(Number(mtime) * 1000) || Date.now();
				return {
					path: normalizePath(scope ? `${scope}/${name}` : name),
					size: Number(size) || 0,
					createdAt: at,
					updatedAt: at,
					// Filled in below where the object knows better.
					version: 1,
				};
			});

		// One call, merged by path — per file would exhaust the subrequest budget.
		const known = new Map((await this.durable.list()).map((file) => [file.path, file.version]));
		for (const record of records) {
			const version = known.get(record.path);
			if (version !== undefined) record.version = version;
		}

		return records.sort((a, b) => a.path.localeCompare(b.path));
	}

	async read(path: string): Promise<FileWithContent> {
		const normalized = normalizePath(path);
		const relative = relativeOf(normalized);

		// Base64: file contents are arbitrary bytes, shell output is not binary-safe.
		const encoded = await this.exec(
			`if [ -f ${quote(relative)} ]; then base64 -w0 ${quote(relative)}; else echo __MISSING__; fi`,
		);
		if (encoded.trim() === '__MISSING__') {
			throw new Error(`No such file: ${normalized}`);
		}

		const content = decodeBase64(encoded.trim());
		const now = Date.now();
		const version = await this.versionOf(normalized);
		return {
			path: normalized,
			content,
			size: byteLength(content),
			createdAt: now,
			updatedAt: now,
			version,
		};
	}

	async glob(pattern: string): Promise<FileRecord[]> {
		// Matched here rather than translated to `find`, so both runtimes agree.
		return (await this.list()).filter((file) => matchesGlob(file.path, pattern));
	}

	async grep(
		pattern: string,
		options: { pathPattern?: string; limit?: number } = {},
	): Promise<GrepMatch[]> {
		const limit = options.limit ?? 100;
		const excludes = SKIP_DIRECTORIES.map((name) => `--exclude-dir=${quote(name)}`).join(' ');

		// `-E` matches the object's regex dialect; `-I` skips binary files.
		const output = await this.exec(
			`grep -rnIE ${excludes} -e ${quote(pattern)} . 2>/dev/null | head -${limit * 2}`,
			{ allowFailure: true },
		);

		const matches: GrepMatch[] = [];
		for (const line of output.split('\n')) {
			if (!line) continue;
			// Split on the first two colons only; matched text often contains more.
			const first = line.indexOf(':');
			const second = line.indexOf(':', first + 1);
			if (first === -1 || second === -1) continue;

			const path = normalizePath(line.slice(0, first).replace(/^\.\//, ''));
			if (options.pathPattern && !matchesGlob(path, options.pathPattern)) continue;

			matches.push({
				path,
				line: Number(line.slice(first + 1, second)) || 0,
				text: line.slice(second + 1).slice(0, 400),
			});
			if (matches.length >= limit) break;
		}
		return matches;
	}

	// --------------------------------------------------------------- writes

	async write(path: string, content: string, summary = 'write'): Promise<FileRecord> {
		const normalized = normalizePath(path);
		const size = byteLength(content);
		if (size > MAX_FILE_BYTES) {
			throw new Error(`File ${normalized} is ${size} bytes, over the ${MAX_FILE_BYTES} limit`);
		}

		const relative = relativeOf(normalized);
		const directory = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';

		await this.exec(
			[
				directory ? `mkdir -p ${quote(directory)}` : 'true',
				`printf '%s' ${quote(encodeBase64(content))} | base64 -d > ${quote(relative)}`,
			].join(' && '),
		);

		// The object owns the version number, so both runtimes agree on history.
		return this.durable.write(normalized, content, summary);
	}

	/** Two round trips regardless of file count: one shell command, one call. */
	async writeMany(
		files: Array<{ path: string; content: string }>,
		summary = 'write',
	): Promise<{ written: number; skipped: string[] }> {
		const skipped: string[] = [];
		const accepted: Array<{ path: string; content: string }> = [];
		const script: string[] = [];

		for (const file of files) {
			if (byteLength(file.content) > MAX_FILE_BYTES) {
				skipped.push(file.path);
				continue;
			}
			const relative = relativeOf(file.path);
			const directory = relative.includes('/')
				? relative.slice(0, relative.lastIndexOf('/'))
				: '';
			if (directory) script.push(`mkdir -p ${quote(directory)}`);
			script.push(`printf '%s' ${quote(encodeBase64(file.content))} | base64 -d > ${quote(relative)}`);
			accepted.push({ path: normalizePath(file.path), content: file.content });
		}

		if (script.length > 0) await this.exec(script.join(' && '));
		const recorded = await this.durable.writeMany(accepted, summary);
		return { written: recorded.written, skipped: [...skipped, ...recorded.skipped] };
	}

	async edit(path: string, oldText: string, newText: string): Promise<FileRecord> {
		const file = await this.read(path);
		const updated = applyEdit(file.content, oldText, newText, file.path);
		return this.write(file.path, updated, 'edit');
	}

	async remove(path: string): Promise<boolean> {
		const normalized = normalizePath(path);
		const existed = await this.exec(
			`if [ -e ${quote(relativeOf(normalized))} ]; then rm -rf ${quote(relativeOf(normalized))} && echo yes; else echo no; fi`,
		);
		await this.durable.remove(normalized).catch(() => false);
		return existed.trim() === 'yes';
	}

	async move(from: string, to: string): Promise<FileRecord> {
		const source = normalizePath(from);
		const target = normalizePath(to);
		const targetRelative = relativeOf(target);
		const directory = targetRelative.includes('/')
			? targetRelative.slice(0, targetRelative.lastIndexOf('/'))
			: '';

		await this.exec(
			[
				directory ? `mkdir -p ${quote(directory)}` : 'true',
				`mv ${quote(relativeOf(source))} ${quote(targetRelative)}`,
			].join(' && '),
		);
		return this.durable.move(source, target);
	}

	// -------------------------------------------------------------- history

	history(path: string, limit?: number): Promise<FileRevision[]> {
		return this.durable.history(path, limit);
	}

	/**
	 * The object holds the content, but the container is what runs — so restored
	 * text goes back to disk, or the next command sees the version just undone.
	 */
	async restore(path: string, version: number): Promise<FileRecord> {
		const record = await this.durable.restore(path, version);
		const restored = await this.durable.read(record.path);
		await this.write(record.path, restored.content, `restored v${version}`);
		return record;
	}

	// -------------------------------------------------------------- private

	/** Version according to the object, or 1 for a file only the container has. */
	private async versionOf(path: string): Promise<number> {
		const revisions = await this.durable.history(path, 1).catch(() => []);
		return revisions[0]?.version ?? 1;
	}

	private async exec(command: string, options: { allowFailure?: boolean } = {}): Promise<string> {
		const result = await this.sandbox.run({
			command: `cd ${WORKDIR} && ${command}`,
			files: [],
			timeoutSeconds: 60,
			...(this.repo ? { repo: this.repo } : {}),
		});

		if (result.exitCode !== 0 && !options.allowFailure) {
			throw new Error(
				`Workspace command failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(0, 400)}`,
			);
		}
		return result.stdout;
	}
}

/**
 * Same tolerance the Durable Object uses. An edit that succeeded in one runtime
 * and failed in the other would only show up once somebody switched.
 */
function applyEdit(content: string, oldText: string, newText: string, path: string): string {
	const first = content.indexOf(oldText);
	if (first !== -1) {
		if (content.indexOf(oldText, first + oldText.length) !== -1) {
			throw new EditError(
				`The target text appears more than once in ${path}. Include surrounding context to make it unique.`,
			);
		}
		return content.slice(0, first) + newText + content.slice(first + oldText.length);
	}

	const loose = matchIgnoringIndentation(content, oldText);
	if (loose === 'ambiguous') {
		throw new EditError(
			`The target text appears more than once in ${path} (ignoring indentation). Include surrounding context to make it unique.`,
		);
	}
	if (loose) {
		return (
			content.slice(0, loose.start) + reindent(newText, loose.indentDelta) + content.slice(loose.end)
		);
	}

	throw new EditError(
		`No occurrence of the target text was found in ${path}. ` +
			`Indentation and trailing whitespace were ignored, so the text itself does not match. ` +
			describeNearest(content, oldText),
	);
}

/** Skips generated directories entirely rather than filtering afterwards. */
function pruneExpression(): string {
	const names = SKIP_DIRECTORIES.map((name) => `-name ${quote(name)}`).join(' -o ');
	return `\\( ${names} \\) -prune -o`;
}

/** Workspace paths are absolute; the container's are relative to the checkout. */
function relativeOf(path: string): string {
	return normalizePath(path).replace(/^\/+/, '');
}

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function encodeBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function decodeBase64(value: string): string {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}
