/**
 * Letting the agent look at what it built.
 *
 * Chromium is downloaded on first use and cached — ~150MB, painful on a
 * container destroyed every turn and nearly free on a warm one, which is why
 * this suits the sandbox runtime. It works on either.
 */

import type { SandboxProvider } from './sandbox';

/** Written once Chromium is present, so the download happens at most once. */
const BROWSER_MARKER = '/tmp/.agent-browser-ready';

/** Pinned so a container warmed yesterday behaves like one warmed today. */
const PLAYWRIGHT_VERSION = '1.49.1';

const DEFAULT_VIEWPORT = '1280,800';

/** Sized back from the 512KB file limit: base64 adds a third, so this fits. */
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
 * Console errors come back with the image on purpose: a blank page is the usual
 * result when something is wrong, and the image alone says nothing actionable.
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
		// The first run downloads a browser; later runs take seconds.
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
 * A script rather than the Playwright CLI, which can screenshot but cannot also
 * report console errors. `--no-sandbox` is needed because the container is not
 * privileged — that disables Chromium's sandbox, not ours.
 */
function buildCaptureScript(request: ScreenshotRequest): string {
	// Each step reports its own failure. Collapsing them into one `||` chain is
	// what made a resolution problem look like an install problem.
	const setup = [
		`if [ ! -f ${BROWSER_MARKER} ]; then`,
		`  npm i -g playwright@${PLAYWRIGHT_VERSION} >/dev/null 2>&1 || { echo __FAILED__playwright-install; exit 1; }`,
		`  npx --yes playwright@${PLAYWRIGHT_VERSION} install chromium >/dev/null 2>&1 || { echo __FAILED__chromium-download; exit 1; }`,
		`  touch ${BROWSER_MARKER};`,
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
  // Delimited: the caller reads these out of a stream containing npm noise.
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
		// NODE_PATH is the whole trick: a script outside the global tree cannot
		// `require` a globally installed package without it, so the install
		// succeeds and the require fails, which reads as a failed install.
		`NODE_PATH="$(npm root -g)" node /tmp/.agent-shot.cjs`,
	].join('\n');
}

/**
 * Exact, not `length * 3 / 4` — that counts the padding, overshooting by up to
 * two bytes and rejecting a boundary-sized image that would have fit.
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

	if (/__FAILED__playwright-install/.test(combined)) {
		return 'Playwright could not be installed in this sandbox, so screenshots are unavailable here.';
	}
	if (/__FAILED__chromium-download/.test(combined)) {
		// Confirmed against Daytona: npm reaches the registry, but the browser CDN
		// resets the connection. Nothing runtime-side fixes that, so say what does.
		return (
			'Playwright installed, but Chromium could not be downloaded — this sandbox cannot ' +
			'reach the browser CDN. Screenshots need a sandbox image with Chromium already in it ' +
			'(set DAYTONA_SNAPSHOT to one). Everything else in the sandbox works.'
		);
	}
	if (/Cannot find module 'playwright'/i.test(combined)) {
		return 'Playwright is installed but Node could not load it — NODE_PATH is not resolving the global module directory.';
	}
	if (/Host system is missing dependencies|error while loading shared libraries/i.test(combined)) {
		return (
			'Chromium is missing system libraries in this sandbox image and cannot be installed ' +
			'without root. Screenshots need an image with the browser dependencies preinstalled.'
		);
	}
	return `The screenshot command failed: ${combined.trim().slice(-400) || 'no output'}`;
}
