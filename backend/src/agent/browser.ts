/**
 * A browser in the container that both the agent and the user can drive.
 *
 * Chromium runs as one long-lived Playwright server; every action connects to
 * it, acts, and disconnects. That is what keeps cookies, history and the
 * current page alive between clicks — launching per action would reset the
 * session every time.
 */

import type { SandboxProvider } from './sandbox';

const PLAYWRIGHT_VERSION = '1.49.1';
const INSTALL_MARKER = '/tmp/.agent-browser-ready';
const SERVER_SCRIPT = '/tmp/.agent-browser-server.js';
const ENDPOINT_FILE = '/tmp/.agent-browser-ws';
const SERVER_LOG = '/tmp/.agent-browser.log';

export const BROWSER_VIEWPORT = { width: 1280, height: 800 };

export type BrowserAction =
	| { type: 'status' }
	| { type: 'navigate'; url: string }
	| { type: 'click'; x: number; y: number }
	| { type: 'type'; text: string }
	| { type: 'key'; key: string }
	| { type: 'scroll'; dy: number }
	| { type: 'back' }
	| { type: 'forward' }
	| { type: 'reload' };

export interface BrowserView {
	url: string;
	title: string;
	/** Base64 JPEG of the viewport. */
	image: string;
	consoleErrors: string[];
}

export class BrowserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BrowserError';
	}
}

export async function runBrowserAction(
	sandbox: SandboxProvider,
	action: BrowserAction,
): Promise<BrowserView> {
	const result = await sandbox.run({
		command: buildScript(action),
		files: [],
		// The first call may install Playwright and download Chromium.
		timeoutSeconds: 240,
	});

	const marker = result.stdout.lastIndexOf(RESULT_PREFIX);
	if (marker === -1) {
		throw new BrowserError(describeFailure(result.stdout, result.stderr));
	}

	const payload = result.stdout.slice(marker + RESULT_PREFIX.length).split('\n')[0];
	try {
		return JSON.parse(payload) as BrowserView;
	} catch {
		throw new BrowserError('The browser returned a response that could not be read.');
	}
}

const RESULT_PREFIX = '__BROWSER_RESULT__';

/** Install if needed, make sure the server is up, then run one action. */
function buildScript(action: BrowserAction): string {
	return [
		installStep(),
		serverStep(),
		actionStep(action),
	].join('\n');
}

function installStep(): string {
	return [
		`if [ ! -f ${INSTALL_MARKER} ]; then`,
		`  npm i -g playwright@${PLAYWRIGHT_VERSION} >/dev/null 2>&1 || { echo __FAILED__playwright-install; exit 1; }`,
		`  npx --yes playwright@${PLAYWRIGHT_VERSION} install chromium >/dev/null 2>&1 || { echo __FAILED__chromium-download; exit 1; }`,
		`  touch ${INSTALL_MARKER};`,
		`fi`,
	].join('\n');
}

/**
 * Start the Playwright server once and leave it running.
 *
 * The endpoint file is the liveness check: it is removed before launch and
 * written by the server itself, so its presence means the socket is accepting.
 */
function serverStep(): string {
	const server = `
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const server = await chromium.launchServer({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  fs.writeFileSync(${JSON.stringify(ENDPOINT_FILE)}, server.wsEndpoint());
})();
`.trim();

	return [
		`if [ -f ${ENDPOINT_FILE} ] && node -e "require('net').connect(${cdpPortExpr()}).on('error',()=>process.exit(1)).on('connect',()=>process.exit(0))" 2>/dev/null; then`,
		`  :;`,
		`else`,
		`  rm -f ${ENDPOINT_FILE};`,
		`  cat > ${SERVER_SCRIPT} <<'AGENT_BROWSER_EOF'`,
		server,
		`AGENT_BROWSER_EOF`,
		`  setsid nohup node ${SERVER_SCRIPT} > ${SERVER_LOG} 2>&1 < /dev/null &`,
		// Wait for the server to publish its endpoint.
		`  for _ in $(seq 1 60); do [ -s ${ENDPOINT_FILE} ] && break; sleep 0.5; done;`,
		`fi`,
		`[ -s ${ENDPOINT_FILE} ] || { echo __FAILED__browser-start; exit 1; }`,
	].join('\n');
}

/** Reads the port out of the ws endpoint so liveness can be probed cheaply. */
function cdpPortExpr(): string {
	return `Number(require('fs').readFileSync(${JSON.stringify(ENDPOINT_FILE)},'utf8').split(':')[2].split('/')[0])`;
}

function actionStep(action: BrowserAction): string {
	const runner = `
const { chromium } = require('playwright');
const fs = require('fs');
const action = ${JSON.stringify(action)};
const viewport = ${JSON.stringify(BROWSER_VIEWPORT)};

(async () => {
  const browser = await chromium.connect(fs.readFileSync(${JSON.stringify(ENDPOINT_FILE)}, 'utf8'));
  const context = browser.contexts()[0] || (await browser.newContext({ viewport }));
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize(viewport);

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));

  try {
    if (action.type === 'navigate') {
      const url = /^https?:\\/\\//.test(action.url) ? action.url : 'https://' + action.url;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else if (action.type === 'click') {
      await page.mouse.click(action.x, action.y);
      await page.waitForTimeout(400);
    } else if (action.type === 'type') {
      await page.keyboard.type(action.text, { delay: 10 });
    } else if (action.type === 'key') {
      await page.keyboard.press(action.key);
      await page.waitForTimeout(400);
    } else if (action.type === 'scroll') {
      await page.mouse.wheel(0, action.dy);
      await page.waitForTimeout(200);
    } else if (action.type === 'back') {
      await page.goBack({ timeout: 15000 }).catch(() => {});
    } else if (action.type === 'forward') {
      await page.goForward({ timeout: 15000 }).catch(() => {});
    } else if (action.type === 'reload') {
      await page.reload({ timeout: 30000 }).catch(() => {});
    }
  } catch (error) {
    errors.push(String(error && error.message ? error.message : error));
  }

  // JPEG, not PNG: this is a live view refreshed on every click, and the
  // image travels back as base64 through a shell.
  const shot = await page.screenshot({ type: 'jpeg', quality: 60 });
  const title = await page.title().catch(() => '');

  process.stdout.write(
    '\\n${RESULT_PREFIX}' +
      JSON.stringify({ url: page.url(), title, image: shot.toString('base64'), consoleErrors: errors.slice(0, 5) }) +
      '\\n',
  );
  await browser.close();
})().catch((error) => {
  console.log('__FAILED__' + String(error && error.message ? error.message : error));
  process.exit(1);
});
`.trim();

	return [`cat > /tmp/.agent-browser-action.js <<'AGENT_ACTION_EOF'`, runner, `AGENT_ACTION_EOF`, `node /tmp/.agent-browser-action.js`].join('\n');
}

function describeFailure(stdout: string, stderr: string): string {
	const text = `${stdout}\n${stderr}`;
	if (text.includes('__FAILED__playwright-install')) return 'Could not install Playwright in the container.';
	if (text.includes('__FAILED__chromium-download')) return 'Could not download Chromium in the container.';
	if (text.includes('__FAILED__browser-start')) return 'The browser did not start.';

	const failure = text.indexOf('__FAILED__');
	if (failure !== -1) return text.slice(failure + '__FAILED__'.length).split('\n')[0].trim();
	return 'The browser action failed.';
}
