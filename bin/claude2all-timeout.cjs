#!/usr/bin/env node
'use strict';

// Clock limit for headless launcher runs.
//   node claude2all-timeout.cjs -- <command> [args...]
// The launchers re-enter themselves through this helper; the child receives
// CLAUDE2ALL_TIMEOUT_ACTIVE=1 so it skips the wrapper on the second pass and
// consumes the variable before starting Claude Code or a proxy.
//
// At the deadline the helper arms the force deadline first, then records the
// run's process tree and ends the Claude Code processes in it (or the run
// itself if Claude Code has not started yet). When the child closes, or when
// the grace period ends, every recorded process still alive is force-ended,
// the child included. Nothing is inserted into the prompt or the output; a
// proxy server started earlier by another session is not in this tree and is
// left alone.

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');

const TIMEOUT_EXIT_CODE = 124;
const GRACE_MS = 20_000;
const QUERY_TIMEOUT_MS = 15_000;
const MAX_MINUTES = Math.floor(2_147_483_647 / 60_000); // setTimeout accepts at most 2^31 - 1 ms

const startedAt = Date.now();
function trace(message) {
  if (process.env.CLAUDE2ALL_DEBUG) process.stderr.write(`[claude2all +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`claude2all: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv, env = process.env) {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) {
    fail('usage: claude2all-timeout.cjs -- <command> [args...]');
  }

  const wrapperArgs = argv.slice(0, separator);
  if (wrapperArgs.length > 0) {
    fail(`unknown helper option: ${wrapperArgs[0]}`);
  }

  const commandArgs = argv.slice(separator + 1);
  let requestedMinutes = env.CLAUDE2_MAX_MINUTES;
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

  if (env.CLAUDE2ALL_TIMEOUT_ACTIVE === '1') {
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
    const t0 = Date.now();
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: QUERY_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      trace(`${file} ${args.slice(0, 3).join(' ')} -> ${error ? `error ${error.code ?? ''}${error.killed ? ' (killed by cap)' : ''}` : 'ok'} in ${Date.now() - t0} ms`);
      resolve(error ? '' : stdout);
    });
  });
}

// Windows: every process below rootPid, found by walking parent links. The pid
// is embedded in the script (arguments after -Command are not bound to $args);
// missing keys, null entries and revisits are skipped so a leaf yields nothing.
async function descendants(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  const script = [
    `$root = ${rootPid}`,
    '$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine)',
    '$byParent = @{}',
    'foreach ($p in $all) { if ($null -eq $p.ProcessId) { continue }; $k = [string]$p.ParentProcessId; if (-not $byParent.ContainsKey($k)) { $byParent[$k] = New-Object System.Collections.ArrayList }; [void]$byParent[$k].Add($p) }',
    '$seen = @{}',
    '$queue = New-Object System.Collections.Queue',
    '$queue.Enqueue($root)',
    'while ($queue.Count -gt 0) {',
    '  $parent = [int]$queue.Dequeue()',
    '  $k = [string]$parent',
    '  if (-not $byParent.ContainsKey($k)) { continue }',
    '  foreach ($c in $byParent[$k]) {',
    '    if ($null -eq $c -or $null -eq $c.ProcessId) { continue }',
    '    $pid2 = [int]$c.ProcessId',
    '    if ($pid2 -le 0 -or $pid2 -eq $root -or $seen.ContainsKey($pid2)) { continue }',
    '    $seen[$pid2] = $true',
    '    "{0}`t{1}`t{2}" -f $pid2, $c.Name, $c.CommandLine',
    '    $queue.Enqueue($pid2)',
    '  }',
    '}',
  ].join('; ');
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [pid, name = '', commandLine = ''] = line.split('\t');
    return { pid: Number(pid), name, commandLine };
  }).filter((p) => Number.isInteger(p.pid) && p.pid > 0 && p.pid !== rootPid);
}

function isClaude(p) {
  return /^claude(\.exe)?$/i.test(p.name) || /@anthropic-ai[\\/]claude-code/i.test(p.commandLine);
}

async function taskkill(pids, force) {
  const flags = force ? ['/F', '/T'] : ['/T'];
  await Promise.all([...new Set(pids)].map((pid) => run('taskkill.exe', [...flags, '/PID', String(pid)])));
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const untilClosed = new Promise((resolve) => child.once('close', resolve));

  // Windows termination. The force deadline is armed before any query, so a slow
  // PowerShell or taskkill can only make the graceful step late, never the force.
  async function stopWindows() {
    trace('stop: querying tree');
    const treePromise = descendants(child.pid).then((tree) => { trace(`tree: ${tree.map((p) => `${p.pid}:${p.name}`).join(' ') || '(empty)'}`); return tree; });
    const graceful = treePromise.then((tree) => {
      const claude = tree.filter(isClaude).map((p) => p.pid);
      return taskkill(claude.length > 0 ? claude : [child.pid], false);
    });
    await Promise.race([untilClosed, delay(GRACE_MS)]);
    trace(`grace over or child closed (closed=${closed}); forcing`);
    // Force whatever we know about right now; the child itself always included.
    const known = await Promise.race([treePromise, Promise.resolve(null)]);
    await taskkill([child.pid, ...(known || []).map((p) => p.pid)], true);
    // If the tree query was still pending, finish it (capped) and sweep once more.
    const tree = await treePromise;
    await graceful.catch(() => {});
    await taskkill(tree.map((p) => p.pid), true);
    trace('stop: done');
  }

  async function stopPosix() {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    await Promise.race([untilClosed, delay(GRACE_MS)]);
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

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`claude2all: unable to start child process: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { descendants, isClaude, parseArgs, spawnPlan };
