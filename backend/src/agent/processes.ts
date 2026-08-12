/**
 * Long-running processes inside the container — dev servers, watchers.
 *
 * State lives in the container, not the Durable Object: a process list is only
 * true of the machine running it, and a copy in a database would confidently
 * describe processes that died with a container an hour ago.
 */

import type { SandboxProvider } from './sandbox';

/** One directory per process, holding its pid, log, and original command. */
const PROC_DIR = '/tmp/.agent-procs';

const DEFAULT_LOG_LINES = 40;

export interface BackgroundProcess {
	name: string;
	command: string;
	pid: number;
	running: boolean;
	/** The port it appears to be listening on, when one could be determined. */
	port: number | null;
}

export class ProcessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProcessError';
	}
}

type Repo = { cloneUrl: string; branch: string; commitSha: string } | null;

/**
 * Start a process and return once it is launched, not once it is finished.
 * Early output comes back too: a port clash or missing dependency shows up in
 * the first second, and reporting "started" for a dead process compounds.
 */
export async function startProcess(
	sandbox: SandboxProvider,
	options: { name: string; command: string; readyMs: number },
	repo: Repo,
): Promise<{ process: BackgroundProcess; earlyOutput: string }> {
	const name = safeName(options.name);
	const dir = `${PROC_DIR}/${name}`;

	const script = [
		`mkdir -p ${quote(dir)}`,
		// Refuse rather than replace: two servers under one name is unrecoverable.
		`if [ -f ${quote(`${dir}/pid`)} ] && kill -0 "$(cat ${quote(`${dir}/pid`)})" 2>/dev/null; then`,
		`  echo __ALREADY_RUNNING__; exit 0;`,
		`fi`,
		`printf '%s' ${quote(options.command)} > ${quote(`${dir}/cmd`)}`,
		`: > ${quote(`${dir}/log`)}`,
		// The child writes its own pid, then execs. `cmd & echo $!` would record
		// setsid's pid — setsid forks when backgrounded and exits immediately, so
		// the process would read as dead while still serving. A launcher file also
		// avoids nesting three levels of quoting around a model-written command.
		`cat > ${quote(`${dir}/run.sh`)} <<'AGENT_PROC_EOF'`,
		`#!/bin/sh`,
		`echo $$ > "$1/pid"`,
		`exec sh -c "$2"`,
		`AGENT_PROC_EOF`,
		`chmod +x ${quote(`${dir}/run.sh`)}`,
		// Own process group, so it outlives the exec session and can be signalled
		// as a group later. Not every image ships setsid.
		`if command -v setsid >/dev/null 2>&1; then`,
		`  setsid nohup ${quote(`${dir}/run.sh`)} ${quote(dir)} ${quote(options.command)} > ${quote(`${dir}/log`)} 2>&1 < /dev/null &`,
		`else`,
		`  nohup ${quote(`${dir}/run.sh`)} ${quote(dir)} ${quote(options.command)} > ${quote(`${dir}/log`)} 2>&1 < /dev/null &`,
		`fi`,
		// Also covers the launcher writing its pid before it is read back.
		`sleep ${Math.max(1, Math.round(options.readyMs / 1000))}`,
		`if kill -0 "$(cat ${quote(`${dir}/pid`)})" 2>/dev/null; then echo __ALIVE__; else echo __EXITED__; fi`,
		`echo __LOG__`,
		`tail -n 20 ${quote(`${dir}/log`)} 2>/dev/null || true`,
	].join('\n');

	const result = await sandbox.run({
		command: `cd /home/daytona/workspace 2>/dev/null || cd /tmp; ${script}`,
		files: [],
		timeoutSeconds: Math.max(30, Math.round(options.readyMs / 1000) + 25),
		...(repo ? { repo } : {}),
	});

	if (result.exitCode !== 0) {
		throw new ProcessError(`Could not start the process: ${tail(result.stderr || result.stdout)}`);
	}
	if (result.stdout.includes('__ALREADY_RUNNING__')) {
		throw new ProcessError(
			`A process named "${name}" is already running. Stop it first, or use a different name.`,
		);
	}

	const logIndex = result.stdout.indexOf('__LOG__');
	const earlyOutput = logIndex === -1 ? '' : result.stdout.slice(logIndex + '__LOG__'.length).trim();

	if (result.stdout.includes('__EXITED__')) {
		throw new ProcessError(
			`The process exited immediately. Its output was:\n${earlyOutput || '(nothing)'}`,
		);
	}

	const [process] = await listProcesses(sandbox, repo, name);
	if (!process) {
		throw new ProcessError('The process started but could not be read back.');
	}
	return { process, earlyOutput };
}

/**
 * Everything registered, with liveness checked against the kernel rather than
 * trusted from the registry — a crashed server leaves its pid file behind.
 */
export async function listProcesses(
	sandbox: SandboxProvider,
	repo: Repo,
	only?: string,
): Promise<BackgroundProcess[]> {
	const filter = only ? quote(`${PROC_DIR}/${safeName(only)}`) : `${quote(PROC_DIR)}/*`;

	const script = [
		`for d in ${filter}; do`,
		`  [ -d "$d" ] || continue;`,
		`  pid=$(cat "$d/pid" 2>/dev/null);`,
		`  cmd=$(cat "$d/cmd" 2>/dev/null);`,
		`  if kill -0 "$pid" 2>/dev/null; then alive=1; else alive=0; fi;`,
		// From the log, not `ss`/`lsof`: neither is guaranteed to be installed.
		`  port=$(grep -oE 'https?://[^ ]*:[0-9]+|:[0-9]{4,5}' "$d/log" 2>/dev/null | grep -oE '[0-9]{4,5}' | head -1);`,
		`  printf '%s\\t%s\\t%s\\t%s\\n' "$(basename "$d")" "$pid" "$alive" "$port";`,
		`  printf '__CMD__%s\\n' "$cmd";`,
		`done`,
	].join('\n');

	const result = await sandbox.run({
		command: script,
		files: [],
		timeoutSeconds: 30,
		...(repo ? { repo } : {}),
	});

	const processes: BackgroundProcess[] = [];
	const lines = result.stdout.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith('__CMD__')) continue;
		const [name, pid, alive, port] = lines[i].split('\t');
		if (!name || !pid) continue;
		const command = lines[i + 1]?.startsWith('__CMD__')
			? lines[i + 1].slice('__CMD__'.length)
			: '';
		processes.push({
			name,
			command,
			pid: Number(pid) || 0,
			running: alive === '1',
			port: port ? Number(port) : null,
		});
	}
	return processes;
}

/** Recent output from one process. */
export async function readProcessLog(
	sandbox: SandboxProvider,
	repo: Repo,
	name: string,
	lines = DEFAULT_LOG_LINES,
): Promise<string> {
	const path = `${PROC_DIR}/${safeName(name)}/log`;
	const result = await sandbox.run({
		command: `if [ -f ${quote(path)} ]; then tail -n ${Math.min(500, Math.max(1, lines))} ${quote(path)}; else echo __NO_SUCH_PROCESS__; fi`,
		files: [],
		timeoutSeconds: 30,
		...(repo ? { repo } : {}),
	});

	if (result.stdout.includes('__NO_SUCH_PROCESS__')) {
		throw new ProcessError(`No process named "${name}" has been started in this sandbox.`);
	}
	return result.stdout.trim();
}

/**
 * TERM first, then KILL. A server given TERM releases its port cleanly; one
 * given KILL can leave it bound long enough to break the next start.
 */
export async function stopProcess(
	sandbox: SandboxProvider,
	repo: Repo,
	name: string,
): Promise<boolean> {
	const dir = `${PROC_DIR}/${safeName(name)}`;
	const script = [
		`pid=$(cat ${quote(`${dir}/pid`)} 2>/dev/null);`,
		`if [ -z "$pid" ]; then echo __NOT_FOUND__; exit 0; fi;`,
		`if ! kill -0 "$pid" 2>/dev/null; then rm -rf ${quote(dir)}; echo __ALREADY_STOPPED__; exit 0; fi;`,
		// Negative pid signals the group, so forked workers go too.
		`kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null;`,
		`sleep 2;`,
		`if kill -0 "$pid" 2>/dev/null; then kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null; fi;`,
		`rm -rf ${quote(dir)};`,
		`echo __STOPPED__`,
	].join('\n');

	const result = await sandbox.run({
		command: script,
		files: [],
		timeoutSeconds: 40,
		...(repo ? { repo } : {}),
	});

	if (result.stdout.includes('__NOT_FOUND__')) {
		throw new ProcessError(`No process named "${name}" has been started in this sandbox.`);
	}
	return result.stdout.includes('__STOPPED__');
}

/**
 * Defence in depth — the name is shell-quoted anyway, but `..` would escape the
 * process directory even when perfectly quoted.
 */
function safeName(name: string): string {
	const clean = name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/\.+/g, '.')
		.replace(/^[.-]+|[.-]+$/g, '')
		.slice(0, 40);
	if (!clean) throw new ProcessError('A process name must contain a letter or a number.');
	return clean;
}

function quote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tail(value: string): string {
	return value.trim().slice(-400);
}
