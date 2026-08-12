/**
 * Shell strings assembled from model-supplied input.
 *
 * Most of these are injection tests. The rest guard the two parsers that read
 * command output back — a wrong split there silently loses a match or a line
 * number rather than throwing.
 */

import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { test } from 'node:test';
import { rerootLeadingCd } from '../src/agent/tool-runtime';

// --- cd rerooting ----------------------------------------------------------

const WORKSPACE = ['/frontend/src/app.tsx', '/backend/src/index.ts', '/README.md'];

test('an absolute workspace path is rerooted', () => {
	assert.equal(rerootLeadingCd('cd /frontend && npm run build', WORKSPACE), 'cd frontend && npm run build');
	assert.equal(rerootLeadingCd('cd /backend/src && ls', WORKSPACE), 'cd backend/src && ls');
	assert.equal(rerootLeadingCd('cd /frontend; npm test', WORKSPACE), 'cd frontend; npm test');
});

test('real container paths are left alone', () => {
	for (const command of ['cd /tmp && ls', 'cd /usr/bin && ls', 'cd /nope && ls', 'cd / && ls']) {
		assert.equal(rerootLeadingCd(command, WORKSPACE), command);
	}
});

test('a top-level file is not treated as a directory', () => {
	assert.equal(rerootLeadingCd('cd /README.md', WORKSPACE), 'cd /README.md');
});

test('only a leading cd is rewritten', () => {
	assert.equal(rerootLeadingCd('ls && cd /frontend', WORKSPACE), 'ls && cd /frontend');
	assert.equal(rerootLeadingCd('npm run build', WORKSPACE), 'npm run build');
});

// --- shell quoting ---------------------------------------------------------

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

test('a quoted path reaches the shell as one literal argument', () => {
	const nasty = "a'; rm -rf /; echo '";
	const seen = execSync(`printf '%s' ${quote(nasty)}`, { shell: '/bin/sh' }).toString();
	assert.equal(seen, nasty);
});

// --- grep output parsing ---------------------------------------------------

function parseGrep(output: string) {
	const matches: Array<{ path: string; line: number; text: string }> = [];
	for (const line of output.split('\n')) {
		if (!line) continue;
		const first = line.indexOf(':');
		const second = line.indexOf(':', first + 1);
		if (first === -1 || second === -1) continue;
		matches.push({
			path: `/${line.slice(0, first).replace(/^\.\//, '')}`,
			line: Number(line.slice(first + 1, second)) || 0,
			text: line.slice(second + 1),
		});
	}
	return matches;
}

test('colons inside the matched text survive', () => {
	assert.deepEqual(parseGrep("./src/a.ts:3:const url = 'http://x:8080';"), [
		{ path: '/src/a.ts', line: 3, text: "const url = 'http://x:8080';" },
	]);
});

test('malformed grep lines are skipped, not thrown on', () => {
	assert.deepEqual(parseGrep('garbage-with-no-colons'), []);
	assert.deepEqual(parseGrep(''), []);
});

// --- screenshot output parsing ---------------------------------------------

function parseShot(stdout: string) {
	let image: string | null = null;
	let consoleErrors: string[] = [];
	for (const line of stdout.split('\n')) {
		if (line.startsWith('__IMAGE__')) image = line.slice('__IMAGE__'.length).trim();
		else if (line.startsWith('__CONSOLE__')) {
			try {
				const parsed: unknown = JSON.parse(line.slice('__CONSOLE__'.length));
				if (Array.isArray(parsed)) consoleErrors = parsed.map(String);
			} catch {
				/* a malformed console line must not lose the image */
			}
		}
	}
	return { image, consoleErrors };
}

test('the image survives surrounding npm noise', () => {
	const noisy = [
		'npm warn deprecated foo@1.0.0',
		'added 3 packages in 2s',
		'__IMAGE__aGVsbG8=',
		'__CONSOLE__["TypeError: x is not a function"]',
	].join('\n');
	const parsed = parseShot(noisy);
	assert.equal(parsed.image, 'aGVsbG8=');
	assert.deepEqual(parsed.consoleErrors, ['TypeError: x is not a function']);
});

test('malformed console JSON does not lose the image', () => {
	const parsed = parseShot('__IMAGE__abc\n__CONSOLE__{bad');
	assert.equal(parsed.image, 'abc');
	assert.deepEqual(parsed.consoleErrors, []);
});

// --- base64 sizing ---------------------------------------------------------

function decodedSize(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.floor((base64.length * 3) / 4) - padding;
}

test('decoded size is exact at every padding length', () => {
	// The naive length*3/4 overshoots by up to two bytes, which at the boundary
	// rejects an image that would have fit.
	assert.equal(decodedSize(Buffer.from('hello world').toString('base64')), 11);
	assert.equal(decodedSize(Buffer.from('hello worl').toString('base64')), 10);
	assert.equal(decodedSize(Buffer.from('hello w').toString('base64')), 7);
});

test('a max-size image still fits a workspace file once encoded', () => {
	const MAX_IMAGE_BYTES = 300 * 1024;
	const MAX_FILE_BYTES = 512 * 1024;
	assert.ok(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) < MAX_FILE_BYTES);
});
