/**
 * Letting the agent look at what it built.
 *
 * An agent that writes a React component and never sees it rendered is working
 * blind: it can tell you the tests pass, not that the button is off the screen.
 * A screenshot closes that loop, and it is the one capability that genuinely
 * needs a container — there is no way to fake a browser in a database.
 *
 * Chromium is downloaded on first use and cached. That download is slow enough
 * (~150MB) to be painful on a container that is destroyed after every turn, and
 * nearly free on one that is kept warm, which is why this reads much better on
 * the sandbox runtime. It works on either.
 */

import type { SandboxProvider } from './sandbox';

/** Written once Chromium is present, so the download happens at most once. */
const BROWSER_MARKER = '/tmp/.agent-browser-ready';

/** Pinned so a container warmed yesterday and one warmed today behave the same. */
const PLAYWRIGHT_VERSION = '1.49.1';

const DEFAULT_VIEWPORT = '1280,800';

/**
 * Ceiling on the returned image.
 *
 * Sized backwards from the 512KB workspace file limit: the PNG is stored as
 * base64, which is a third larger again, so 300KB of image is about 400KB of
 * stored text and leaves headroom.
 */
const MAX_IMAGE_BYTES = 300 * 1024;

export interface ScreenshotRequest {
	url: string;
	fullPage: boolean;
	/** Milliseconds to wait after load, for pages that animate or fetch on mount. */
	settleMs: number;
}

export interface ScreenshotResult {
	/** Base64 PNG, ready to hand to the model as an image block. */
	base64: string;
	bytes: number;
	/** Anything the browser printed to the console, which is often the real answer. */
	consoleErrors: string[];
}

export class ScreenshotError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ScreenshotError';
	}
}

/**
 * Take one screenshot inside the container.
 *
 * Console errors come back alongside the image on purpose. A blank page is the
 * most common result when something is wrong, and a blank screenshot on its own
 * tells the agent nothing it can act on — the stack trace behind it does.
 */
export async function captureScreenshot(
	sandbox: SandboxProvider,
	request: ScreenshotRequest,
	repo: { cloneUrl: string; branch: string; commitSha: string } | null,
): Promise<ScreenshotResult> {
	const script = buildCaptureScript(request);

	const result = await sandbox.run({
		command: script,
		files: [],
		// Generous: the first run downloads a browser. Later runs are seconds.
		timeoutSeconds: 240,
		...(repo ? { repo } : {}),
	});

	if (result.exitCode !== 0) {
		throw new ScreenshotError(describeFailure(result.stdout, result.stderr));
	}

	const { image, consoleErrors } = parseOutput(result.stdout);
	if (!image) {
		throw new ScreenshotError(
			'The browser ran but produced no image. ' +
				(consoleErrors.length > 0
					? `The page reported: ${consoleErrors.slice(0, 3).join(' | ')}`
					: 'Check that the URL is being served from inside the sandbox.'),
		);
	}

	const bytes = decodedSize(image);
	if (bytes > MAX_IMAGE_BYTES) {
		throw new ScreenshotError(
			`The screenshot is ${Math.round(bytes / 1024)}KB, over the ${MAX_IMAGE_BYTES / 1024}KB limit. ` +
				'Capture a smaller viewport, or turn off full_page.',
		);
	}

	return { base64: image, bytes, consoleErrors };
}

/**
 * The shell script that does the work.
 *
 * Written as a here-doc rather than a chain of flags so the browser can be
 * driven properly — the Playwright CLI can take a screenshot, but it cannot
 * also report the console errors, and those are half the value.
 *
 * `--no-sandbox` is required because the container is not privileged. That is a
 * Chromium sandbox, not ours; the container is still the isolation boundary.
 */
function buildCaptureScript(request: ScreenshotRequest): string {
	const setup = [
		`if [ ! -f ${BROWSER_MARKER} ]; then`,
		`  npm i -g playwright@${PLAYWRIGHT_VERSION} >/dev/null 2>&1 || npm i playwright@${PLAYWRIGHT_VERSION} >/dev/null 2>&1;`,
		`  npx --yes playwright@${PLAYWRIGHT_VERSION} install chromium >/dev/null 2>&1 && touch ${BROWSER_MARKER};`,
		`fi`,
	].join('\n');

	// JSON-encoded so a URL containing quotes cannot break out of the script.
	const options = JSON.stringify({
		url: request.url,
		fullPage: request.fullPage,
		settleMs: request.settleMs,
		viewport: DEFAULT_VIEWPORT,
	});

	const runner = `
const { chromium } = require('playwright');
const options = ${options};
(async () => {
  const [width, height] = options.viewport.split(',').map(Number);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error && error.message ? error.message : error)));
  try {
    await page.goto(options.url, { waitUntil: 'load', timeout: 30000 });
  } catch (error) {
    errors.push('navigation: ' + String(error && error.message ? error.message : error));
  }
  await page.waitForTimeout(options.settleMs);
  const shot = await page.screenshot({ fullPage: options.fullPage });
  await browser.close();
  // Delimited rather than pretty-printed: the caller has to find these in a
  // stream that also contains npm noise it cannot fully silence.
  console.log('__IMAGE__' + shot.toString('base64'));
  console.log('__CONSOLE__' + JSON.stringify(errors));
})().catch((error) => {
  console.error('__FAILED__' + String(error && error.message ? error.message : error));
  process.exit(1);
});
`.trim();

	return [
		setup,
		`cat > /tmp/.agent-shot.cjs <<'AGENT_EOF'`,
		runner,
		`AGENT_EOF`,
		`node /tmp/.agent-shot.cjs`,
	].join('\n');
}

/**
 * Exact decoded size of a base64 string.
 *
 * The naive `length * 3 / 4` overshoots by up to two bytes because it counts
 * the padding, which is enough to make a reported size wrong and, at the
 * boundary, to reject an image that would actually have fit.
 */
function decodedSize(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.floor((base64.length * 3) / 4) - padding;
}

function parseOutput(stdout: string): { image: string | null; consoleErrors: string[] } {
	let image: string | null = null;
	let consoleErrors: string[] = [];

	for (const line of stdout.split('\n')) {
		if (line.startsWith('__IMAGE__')) image = line.slice('__IMAGE__'.length).trim();
		else if (line.startsWith('__CONSOLE__')) {
			try {
				const parsed: unknown = JSON.parse(line.slice('__CONSOLE__'.length));
				if (Array.isArray(parsed)) consoleErrors = parsed.map(String);
			} catch {
				// A malformed console line must not lose the screenshot.
			}
		}
	}
	return { image, consoleErrors };
}

/** Turn a failed run into something the agent can act on. */
function describeFailure(stdout: string, stderr: string): string {
	const combined = `${stdout}\n${stderr}`;
	const reported = combined
		.split('\n')
		.find((line) => line.startsWith('__FAILED__'))
		?.slice('__FAILED__'.length);

	if (reported) {
		if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(reported)) {
			return (
				'Nothing is serving that URL inside the sandbox. Start the dev server first, ' +
				'and remember the container cannot reach your laptop — use localhost, not an external address.'
			);
		}
		return `The browser failed: ${reported}`;
	}

	if (/Cannot find module 'playwright'|playwright: not found/i.test(combined)) {
		return 'Playwright could not be installed in this sandbox, so screenshots are unavailable here.';
	}
	if (/Host system is missing dependencies|error while loading shared libraries/i.test(combined)) {
		return (
			'Chromium is missing system libraries in this sandbox image and cannot be installed ' +
			'without root. Screenshots need an image with the browser dependencies preinstalled.'
		);
	}
	return `The screenshot command failed: ${combined.trim().slice(-400) || 'no output'}`;
}
