/**
 * Minimal glob matching.
 *
 * Bash is not available to the agent, so `glob` is one of the explicit methods
 * we hand it instead. Supported syntax is deliberately small: `**` (any number
 * of path segments), `*` (any run of characters within one segment), `?` (a
 * single character), and `{a,b}` alternation.
 */

/** Compile a glob pattern into an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
	let source = '';

	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];

		if (char === '*') {
			if (pattern[i + 1] === '*') {
				// `**/` should also match zero directories, so consume a trailing slash.
				i++;
				if (pattern[i + 1] === '/') {
					i++;
					source += '(?:.*/)?';
				} else {
					source += '.*';
				}
			} else {
				source += '[^/]*';
			}
			continue;
		}

		if (char === '?') {
			source += '[^/]';
			continue;
		}

		if (char === '{') {
			const close = pattern.indexOf('}', i);
			if (close !== -1) {
				const alternatives = pattern.slice(i + 1, close).split(',');
				source += `(?:${alternatives.map(escapeRegExp).join('|')})`;
				i = close;
				continue;
			}
		}

		source += escapeRegExp(char);
	}

	return new RegExp(`^${source}$`);
}

/** Test a single path against a glob pattern. */
export function matchesGlob(path: string, pattern: string): boolean {
	const normalizedPattern = pattern.startsWith('/') ? pattern : `/**/${pattern}`;
	return globToRegExp(normalizedPattern).test(path);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
