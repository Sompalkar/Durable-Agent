/**
 * Deciding what of a repository the agent actually gets.
 *
 * A real repo is mostly things the agent must not read: dependencies, build
 * output, lockfiles, images. Importing all of it would be slow (one API call per
 * blob), would blow the workspace's per-file limits on binaries, and would fill
 * the agent's context with noise it has to wade through.
 *
 * So the filter is an allow-list, not a deny-list. A deny-list fails open: an
 * extension nobody thought of gets imported, and a binary read as UTF-8 becomes
 * mojibake that silently corrupts the file if it is ever written back. An
 * allow-list fails closed — an unrecognised file is simply skipped, and the
 * agent is told how many were.
 */

import type { TreeEntry } from './client';

/** Extensions worth reading. Text the agent can meaningfully edit. */
const SOURCE_EXTENSIONS = new Set([
	// Web and JS
	'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'astro',
	'html', 'css', 'scss', 'sass', 'less',
	// Other languages
	'py', 'go', 'rs', 'rb', 'java', 'kt', 'kts', 'swift', 'scala', 'clj',
	'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'ex', 'exs', 'erl', 'hs', 'lua',
	// Config and data
	'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env', 'properties',
	'sql', 'graphql', 'gql', 'prisma', 'proto',
	// Shell and docs
	'sh', 'bash', 'zsh', 'fish', 'ps1', 'md', 'mdx', 'txt', 'rst',
]);

/** Meaningful files that have no extension at all. */
const EXTENSIONLESS = new Set([
	'Dockerfile', 'Makefile', 'Rakefile', 'Gemfile', 'Procfile',
	'LICENSE', 'README', 'CHANGELOG', 'CODEOWNERS', '.gitignore',
	'.env.example', '.nvmrc', '.editorconfig',
]);

/** Directories that are never source, wherever they appear in the tree. */
const SKIP_DIRECTORIES = [
	'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.turbo',
	'dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__',
	'.venv', 'venv', '.terraform', '.gradle', 'Pods', '.cache',
];

/**
 * Lockfiles. Enormous, machine-generated, and never worth an agent's attention —
 * but their *existence* matters, so the summary reports them.
 */
const LOCKFILES = new Set([
	'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
	'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'composer.lock', 'go.sum',
]);

/** Matches the workspace's own per-file limit, so an import cannot be rejected on write. */
const MAX_FILE_BYTES = 512 * 1024;

export interface ImportPlan {
	include: TreeEntry[];
	/** Counts by reason, so the agent can be told what it is not seeing. */
	skipped: {
		directories: number;
		binaries: number;
		lockfiles: number;
		tooLarge: number;
		overBudget: number;
	};
	totalBytes: number;
}

export interface ImportLimits {
	maxFiles: number;
	maxTotalBytes: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
	// Each file is one API call and one row. Two hundred is a real codebase's
	// worth of source without turning an import into a minutes-long operation.
	maxFiles: 200,
	maxTotalBytes: 1_500_000,
};

/**
 * Choose what to import, largest-value first.
 *
 * Files are taken in tree order rather than by size: repository layout carries
 * meaning, and truncating alphabetically keeps whole directories together
 * instead of scattering a half-imported `src/`.
 */
export function planImport(
	tree: TreeEntry[],
	limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
): ImportPlan {
	const plan: ImportPlan = {
		include: [],
		skipped: { directories: 0, binaries: 0, lockfiles: 0, tooLarge: 0, overBudget: 0 },
		totalBytes: 0,
	};

	for (const entry of tree) {
		if (inSkippedDirectory(entry.path)) {
			plan.skipped.directories += 1;
			continue;
		}

		const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);

		if (LOCKFILES.has(name)) {
			plan.skipped.lockfiles += 1;
			continue;
		}
		if (!isTextFile(name)) {
			plan.skipped.binaries += 1;
			continue;
		}
		if (entry.size > MAX_FILE_BYTES) {
			plan.skipped.tooLarge += 1;
			continue;
		}
		if (
			plan.include.length >= limits.maxFiles ||
			plan.totalBytes + entry.size > limits.maxTotalBytes
		) {
			plan.skipped.overBudget += 1;
			continue;
		}

		plan.include.push(entry);
		plan.totalBytes += entry.size;
	}

	return plan;
}

/** A sentence for the agent, so it knows the workspace is a subset and not the repo. */
export function describeImport(plan: ImportPlan, repo: string): string {
	const skipped = Object.values(plan.skipped).reduce((sum, count) => sum + count, 0);
	if (skipped === 0) {
		return `Imported all ${plan.include.length} source files from ${repo}.`;
	}

	const reasons: string[] = [];
	if (plan.skipped.directories > 0) reasons.push(`${plan.skipped.directories} in build or dependency directories`);
	if (plan.skipped.binaries > 0) reasons.push(`${plan.skipped.binaries} non-text`);
	if (plan.skipped.lockfiles > 0) reasons.push(`${plan.skipped.lockfiles} lockfiles`);
	if (plan.skipped.tooLarge > 0) reasons.push(`${plan.skipped.tooLarge} over the size limit`);
	if (plan.skipped.overBudget > 0) reasons.push(`${plan.skipped.overBudget} beyond the import budget`);

	return (
		`Imported ${plan.include.length} source file${plan.include.length === 1 ? '' : 's'} from ${repo}. ` +
		`${skipped} ${skipped === 1 ? 'was' : 'were'} skipped (${reasons.join(', ')}). ` +
		`This workspace is a subset of the repository — if you expect a file that is not here, say so rather than assuming it does not exist.`
	);
}

function inSkippedDirectory(path: string): boolean {
	const segments = path.split('/');
	// The last segment is the filename, so stop before it.
	return segments.slice(0, -1).some((segment) => SKIP_DIRECTORIES.includes(segment));
}

function isTextFile(name: string): boolean {
	if (EXTENSIONLESS.has(name)) return true;

	const dot = name.lastIndexOf('.');
	// A leading dot is a dotfile (".gitignore"), not an extension.
	if (dot <= 0) return false;

	return SOURCE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
