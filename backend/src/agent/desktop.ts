/**
 * A viewable Linux desktop inside the container.
 *
 * Xvfb draws to a virtual display, x11vnc exports it, and websockify serves
 * noVNC over HTTP on one port. The browser connects to that port, so mouse and
 * keyboard go over the VNC protocol — real input, not screenshots.
 *
 * Everything used here ships in the sandbox image already, so starting a
 * desktop is a few processes rather than an install.
 */

import type { SandboxProvider } from './sandbox';

export const DESKTOP_PORT = 6080;
const VNC_PORT = 5900;
const DISPLAY = ':1';
const GEOMETRY = '1280x800x24';
const NOVNC_ROOT = '/usr/share/novnc';
const CHROME_PROFILE = '/tmp/.desktop-chrome';

export interface DesktopStatus {
	running: boolean;
	/** True once noVNC answers, so the UI knows the frame will load. */
	ready: boolean;
	port: number;
}

export class DesktopError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DesktopError';
	}
}

export async function desktopStatus(sandbox: SandboxProvider): Promise<DesktopStatus> {
	const result = await sandbox.run({
		command: `curl -sf -o /dev/null http://localhost:${DESKTOP_PORT}/vnc.html && echo ready || echo down`,
		files: [],
		timeoutSeconds: 30,
	});

	const ready = result.stdout.includes('ready');
	return { running: ready, ready, port: DESKTOP_PORT };
}

/** Start the desktop if it is not already up. Safe to call repeatedly. */
export async function startDesktop(sandbox: SandboxProvider): Promise<DesktopStatus> {
	const result = await sandbox.run({
		command: startScript(),
		files: [],
		timeoutSeconds: 180,
	});

	if (!result.stdout.includes('__DESKTOP_READY__')) {
		throw new DesktopError(describeFailure(result.stdout, result.stderr));
	}
	return { running: true, ready: true, port: DESKTOP_PORT };
}

export async function stopDesktop(sandbox: SandboxProvider): Promise<void> {
	await sandbox
		.run({
			command: [
				'pkill -f "websockify" 2>/dev/null',
				'pkill -f "x11vnc" 2>/dev/null',
				`pkill -f "Xvfb ${DISPLAY}" 2>/dev/null`,
				`pkill -f "user-data-dir=${CHROME_PROFILE}" 2>/dev/null`,
				'echo stopped',
			].join('; '),
			files: [],
			timeoutSeconds: 30,
		})
		.catch(() => undefined);
}

/** Open a URL in the desktop's browser, starting it if needed. */
export async function openOnDesktop(sandbox: SandboxProvider, url: string): Promise<void> {
	const target = /^https?:\/\//.test(url) ? url : `https://${url}`;

	const result = await sandbox.run({
		command: [
			`export DISPLAY=${DISPLAY}`,
			// An already-running Chromium takes the URL as a new tab; otherwise
			// this call starts it.
			`if pgrep -f "user-data-dir=${CHROME_PROFILE}" >/dev/null 2>&1; then`,
			`  chromium --user-data-dir=${CHROME_PROFILE} ${shellQuote(target)} >/dev/null 2>&1 &`,
			`else`,
			`  ${chromeCommand(target)}`,
			`fi`,
			'sleep 2; echo __OPENED__',
		].join('\n'),
		files: [],
		timeoutSeconds: 60,
	});

	if (!result.stdout.includes('__OPENED__')) {
		throw new DesktopError('Could not open that page on the desktop.');
	}
}

function chromeCommand(url: string): string {
	return (
		`setsid nohup chromium --no-sandbox --disable-dev-shm-usage --disable-gpu ` +
		`--user-data-dir=${CHROME_PROFILE} --window-position=0,0 --window-size=1280,800 ` +
		`--no-first-run --no-default-browser-check ${shellQuote(url)} ` +
		`> /tmp/.desktop-chrome.log 2>&1 < /dev/null &`
	);
}

/**
 * Each step names itself on failure. A desktop that does not come up is
 * otherwise three processes deep and impossible to diagnose from a UI.
 */
function startScript(): string {
	return [
		`export DISPLAY=${DISPLAY}`,
		// Already serving? Nothing to do.
		`if curl -sf -o /dev/null http://localhost:${DESKTOP_PORT}/vnc.html; then echo __DESKTOP_READY__; exit 0; fi`,

		`command -v Xvfb >/dev/null 2>&1 || { echo __FAILED__no-xvfb; exit 1; }`,
		`command -v x11vnc >/dev/null 2>&1 || { echo __FAILED__no-x11vnc; exit 1; }`,
		`command -v websockify >/dev/null 2>&1 || { echo __FAILED__no-websockify; exit 1; }`,
		`[ -d ${NOVNC_ROOT} ] || { echo __FAILED__no-novnc; exit 1; }`,

		`if ! xdpyinfo >/dev/null 2>&1; then`,
		`  setsid nohup Xvfb ${DISPLAY} -screen 0 ${GEOMETRY} -nolisten tcp > /tmp/.desktop-xvfb.log 2>&1 < /dev/null &`,
		`  for _ in $(seq 1 20); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.5; done`,
		`  xdpyinfo >/dev/null 2>&1 || { echo __FAILED__xvfb-start; exit 1; }`,
		`fi`,

		`if ! pgrep -f "x11vnc.*${VNC_PORT}" >/dev/null 2>&1; then`,
		`  setsid nohup x11vnc -display ${DISPLAY} -forever -shared -nopw -rfbport ${VNC_PORT} -quiet > /tmp/.desktop-x11vnc.log 2>&1 < /dev/null &`,
		`  sleep 2`,
		`fi`,

		`if ! curl -sf -o /dev/null http://localhost:${DESKTOP_PORT}/vnc.html; then`,
		`  setsid nohup websockify --web=${NOVNC_ROOT} ${DESKTOP_PORT} localhost:${VNC_PORT} > /tmp/.desktop-ws.log 2>&1 < /dev/null &`,
		`  for _ in $(seq 1 30); do curl -sf -o /dev/null http://localhost:${DESKTOP_PORT}/vnc.html && break; sleep 0.5; done`,
		`fi`,

		`curl -sf -o /dev/null http://localhost:${DESKTOP_PORT}/vnc.html || { echo __FAILED__novnc-start; exit 1; }`,
		`echo __DESKTOP_READY__`,
	].join('\n');
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function describeFailure(stdout: string, stderr: string): string {
	const text = `${stdout}\n${stderr}`;
	if (text.includes('__FAILED__no-xvfb')) return 'Xvfb is not installed in this container.';
	if (text.includes('__FAILED__no-x11vnc')) return 'x11vnc is not installed in this container.';
	if (text.includes('__FAILED__no-websockify')) return 'websockify is not installed in this container.';
	if (text.includes('__FAILED__no-novnc')) return 'noVNC is not installed in this container.';
	if (text.includes('__FAILED__xvfb-start')) return 'The virtual display did not start.';
	if (text.includes('__FAILED__novnc-start')) return 'The desktop server did not start.';
	return 'The desktop failed to start.';
}
