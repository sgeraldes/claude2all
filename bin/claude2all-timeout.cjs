#!/usr/bin/env node
'use strict';

// Clock limit for headless launcher runs.
//   node claude2all-timeout.cjs -- <command> [args...]
// The launchers re-enter themselves through this helper; the child receives
// CLAUDE2ALL_TIMEOUT_ACTIVE=1 so it skips the wrapper on the second pass and
// consumes the variable before starting Claude Code or a proxy.
//
// At the deadline the helper records the run's process tree, ends the Claude
// Code processes in it (or the run itself if Claude Code has not started yet),
// and once the child has closed, or after the grace period, force-ends any
// process of that recorded tree that is still alive. Nothing is inserted into
// the prompt or the output; a proxy server started earlier by another session
// is not in this tree and is left alone.

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');

const TIMEOUT_EXIT_CODE = 124;
const GRACE_MS = 20_000;
const QUERY_TIMEOUT_MS = 15_000;
const MAX_MINUTES = Math.floor(2_147_483_647 / 60_000); // setTimeout accepts at most 2^31 - 1 ms

function fail(message) {
  process.stderr.write(`claude2all: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) {
    fail('usage: claude2all-timeout.cjs -- <command> [args...]');
  }

  const wrapperArgs = argv.slice(0, separator);
  if (wrapperArgs.length > 0) {
    fail(`unknown helper option: ${wrapperArgs[0]}`);
  }

  const commandArgs = argv.slice(separator + 1);
  let requestedMinutes = process.env.CLAUDE2_MAX_MINUTES;
  const filteredArgs = [];

  // `--max-minutes` is only recognised before a literal `--`; what follows it is Claude's.
  let passthrough = false;
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (!passthrough && arg === '--') passthrough = true;
    if (!passthrough && arg === '--max-minutes') {
      if (index + 1 >= commandArgs.length) {
        fail('--max-minutes requires a positive whole number');
      }
      requestedMinutes = commandArgs[index + 1];
      index += 1;
      continue;
    }
    filteredArgs.push(arg);
  }

  if (process.env.CLAUDE2ALL_TIMEOUT_ACTIVE === '1') {
    return { commandArgs: filteredArgs, timeoutMs: undefined, minutes: undefined };
  }

  const own = filteredArgs.indexOf('--') === -1 ? filteredArgs : filteredArgs.slice(0, filteredArgs.indexOf('--'));
  const headless = own.includes('-p') || own.includes('--print');
  if (requestedMinutes === undefined || requestedMinutes === '') {
    requestedMinutes = headless ? '90' : undefined;
  }

  if (requestedMinutes === undefined) {
    return { commandArgs: filteredArgs, timeoutMs: undefined, minutes: undefined };
  }

  if (!/^\d+$/.test(requestedMinutes) || Number(requestedMinutes) < 1 || Number(requestedMinutes) > MAX_MINUTES) {
    fail(`invalid max minutes '${requestedMinutes}' (expected a whole number from 1 to ${MAX_MINUTES})`);
  }

  return {
    commandArgs: filteredArgs,
    timeoutMs: Number(requestedMinutes) * 60_000,
    minutes: Number(requestedMinutes),
  };
}

// Run a helper command without blocking the event loop; resolve with its stdout,
// or '' on failure or after QUERY_TIMEOUT_MS.
function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: QUERY_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? '' : stdout);
    });
  });
}

// Windows: every process below rootPid, found by walking parent links.
async function descendants(rootPid) {
  const script = [
    '$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine)',
    '$byParent = @{}',
    'foreach ($p in $all) { $k = [string]$p.ParentProcessId; if (-not $byParent.ContainsKey($k)) { $byParent[$k] = New-Object System.Collections.ArrayList }; [void]$byParent[$k].Add($p) }',
    '$queue = New-Object System.Collections.Queue',
    '$queue.Enqueue([int]$args[0])',
    'while ($queue.Count -gt 0) {',
    '  $parent = $queue.Dequeue()',
    '  foreach ($c in @($byParent[[string]$parent])) {',
    '    "{0}`t{1}`t{2}" -f $c.ProcessId, $c.Name, $c.CommandLine',
    '    $queue.Enqueue([int]$c.ProcessId)',
    '  }',
    '}',
  ].join('; ');
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, String(rootPid)]);
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [pid, name = '', commandLine = ''] = line.split('\t');
    return { pid: Number(pid), name, commandLine };
  }).filter((p) => Number.isInteger(p.pid) && p.pid > 0);
}

function isClaude(p) {
  return /^claude(\.exe)?$/i.test(p.name) || /@anthropic-ai[\\/]claude-code/i.test(p.commandLine);
}

async function taskkill(pids, force) {
  const flags = force ? ['/F', '/T'] : ['/T'];
  await Promise.all(pids.map((pid) => run('taskkill.exe', [...flags, '/PID', String(pid)])));
}

function appendTimeoutLog(line) {
  const logPath = process.env.CLAUDE2ALL_RUN_LOG;
  if (!logPath || !fs.existsSync(logPath)) {
    return;
  }
  fs.appendFileSync(logPath, `${line}\n`);
}

function isShellScript(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(2);
      fs.readSync(fd, head, 0, 2, 0);
      return head.toString('latin1') === '#!';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

// How to start the command on Windows: batch files through cmd.exe, shell
// scripts (the launchers re-entering themselves) through Git Bash, anything
// else (claude, a proxy .exe) directly.
function spawnPlan(command, args) {
  if (process.platform !== 'win32') return { file: command, args };
  if (/\.(cmd|bat)$/i.test(command)) {
    // cmd /s strips the first and last quote of the command string, hence the outer pair.
    const line = [command, ...args].map((a) => `"${a}"`).join(' ');
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  }
  if (!/\.exe$/i.test(command) && fs.existsSync(command) && isShellScript(command)) {
    return { file: 'C:\\Program Files\\Git\\bin\\bash.exe', args: [command, ...args] };
  }
  return { file: command, args };
}

async function main() {
  const { commandArgs, timeoutMs, minutes } = parseArgs(process.argv.slice(2));
  const [command, ...args] = commandArgs;
  const plan = spawnPlan(command, args);
  // The re-entry guard: the launcher sees it, skips this wrapper, and unsets it
  // before starting Claude Code or a proxy, so nested launchers get their own limit.
  const env = { ...process.env, CLAUDE2ALL_TIMEOUT_ACTIVE: '1' };
  const child = spawn(plan.file, plan.args, {
    detached: process.platform !== 'win32',
    env,
    stdio: 'inherit',
    windowsHide: false,
    windowsVerbatimArguments: Boolean(plan.verbatim),
  });

  let timedOut = false;
  let closed = false;
  let stopping = null; // promise of the termination sequence, once started
  let timeoutTimer;

  // Windows termination: record the tree, end Claude Code (or the run itself),
  // then force-end whatever of the recorded tree is still alive.
  async function stopWindows() {
    const tree = await descendants(child.pid);
    const claude = tree.filter(isClaude).map((p) => p.pid);
    await taskkill(claude.length > 0 ? claude : [child.pid], false);
    await new Promise((resolve) => {
      if (closed) return resolve();
      const grace = setTimeout(resolve, GRACE_MS);
      child.once('close', () => { clearTimeout(grace); resolve(); });
    });
    await taskkill([child.pid, ...tree.map((p) => p.pid)], true);
  }

  async function stopPosix() {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    await new Promise((resolve) => {
      if (closed) return resolve();
      const grace = setTimeout(resolve, GRACE_MS);
      child.once('close', () => { clearTimeout(grace); resolve(); });
    });
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }

  function stop() {
    if (!stopping) stopping = (process.platform === 'win32' ? stopWindows() : stopPosix()).catch(() => {});
    return stopping;
  }

  if (timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      const line = `[claude2all] TIEMPO AGOTADO: ${minutes} min, corrida cortada`;
      process.stderr.write(`${line}\n`);
      appendTimeoutLog(line);
      stop();
    }, timeoutMs);
    timeoutTimer.unref();
  }

  // Ctrl-C or a TERM to the helper ends the run the same way.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { stop(); });
  }

  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  closed = true;
  clearTimeout(timeoutTimer);
  if (stopping) await stopping;

  if (timedOut) {
    return TIMEOUT_EXIT_CODE;
  }
  if (typeof code === 'number') {
    return code;
  }
  return signal ? 1 : 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`claude2all: unable to start child process: ${error.message}\n`);
  process.exitCode = 1;
});
