/**
 * The edit matcher, which is the piece most likely to silently corrupt a file.
 *
 * Half of these assert what it must *refuse*. Tolerating indentation is only
 * safe while ambiguity still fails loudly.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchIgnoringIndentation, reindent } from '../src/workspace/filesystem';

/** Mirrors `WorkspaceFileSystem.edit`, minus the storage. */
function edit(content: string, oldText: string, newText: string): string {
	const first = content.indexOf(oldText);
	if (first !== -1) {
		if (content.indexOf(oldText, first + oldText.length) !== -1) return 'ERR:ambiguous-exact';
		return content.slice(0, first) + newText + content.slice(first + oldText.length);
	}
	const loose = matchIgnoringIndentation(content, oldText);
	if (loose === 'ambiguous') return 'ERR:ambiguous-loose';
	if (loose) {
		return (
			content.slice(0, loose.start) + reindent(newText, loose.indentDelta) + content.slice(loose.end)
		);
	}
	return 'ERR:not-found';
}

const FILE = [
	'function MessageBody() {',
	'  return (',
	'    <div>',
	'      <pre>{code}</pre>',
	'    </div>',
	'  );',
	'}',
].join('\n');

test('an under-indented target matches and is re-indented', () => {
	assert.equal(
		edit(FILE, '<pre>{code}</pre>', '<CodeBlock code={code} />'),
		FILE.replace('<pre>{code}</pre>', '<CodeBlock code={code} />'),
	);
});

test('a multi-line block keeps the file indentation', () => {
	assert.equal(
		edit(FILE, '<div>\n<pre>{code}</pre>\n</div>', '<div>\n<CodeBlock />\n</div>'),
		['function MessageBody() {', '  return (', '    <div>', '    <CodeBlock />', '    </div>', '  );', '}'].join(
			'\n',
		),
	);
});

test('an exact match is byte-for-byte, with no re-indenting', () => {
	assert.equal(
		edit(FILE, '      <pre>{code}</pre>', '      <span/>'),
		FILE.replace('      <pre>{code}</pre>', '      <span/>'),
	);
});

test('outdenting never eats code', () => {
	assert.equal(
		edit('a\nrunTheThing(arg);\nb', '        runTheThing(arg);', '        bar(arg);\n        baz(arg);'),
		'a\nbar(arg);\nbaz(arg);\nb',
	);
});

test('trailing whitespace blocking an exact match is tolerated', () => {
	assert.equal(
		edit(
			'x\n      call(a, b);   \n      done();\nz',
			'  call(a, b);\n  done();',
			'  call(a, c);\n  done();',
		),
		'x\n      call(a, c);\n      done();\nz',
	);
});

// --- what it must refuse ---------------------------------------------------

test('the same line at two indents is ambiguous, not a guess', () => {
	const file = 'if (a) {\n    doSomethingLonger();\n}\nif (b) {\n  doSomethingLonger();\n}';
	assert.equal(edit(file, '      doSomethingLonger();', 'other();'), 'ERR:ambiguous-loose');
});

test('a short single line does not loose-match', () => {
	// Otherwise "}" would hit the first closing brace in the file.
	assert.equal(edit(FILE, '  }', 'X'), 'ERR:not-found');
});

test('genuinely absent text still fails', () => {
	assert.equal(edit(FILE, 'nonexistent function call here', 'X'), 'ERR:not-found');
});
