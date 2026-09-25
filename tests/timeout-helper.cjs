// Tests for bin/claude2all-timeout.cjs. Run with: node tests/timeout-helper.cjs
// The last case waits for a real 1-minute limit, so the suite takes about 90 seconds.
'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const helper = path.resolve(__dirname, '../bin/claude2all-timeout.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude2all-timeout-test-'));

// The suite may itself run under a launcher; start from an environment without
// the guard or a session-wide limit, then apply each case's own values.
const baseEnv = { ...process.env };
delete baseEnv.CLAUDE2ALL_TIMEOUT_ACTIVE;
delete baseEnv.CLAUDE2_MAX_MINUTES;

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [helper, '--', ...args], {
      env: { ...baseEnv, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, elapsedMs: Date.now() - startedAt, stdout, stderr }));
  });
}

function write(name, lines, mode) {
  const file = path.join(root, name);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  if (mode) fs.chmodSync(file, mode);
  return file;
}

async function main() {
  // Exit codes pass through; the child receives the re-entry guard.
  const echoEnv = 'process.stdout.write(String(process.env.CLAUDE2ALL_TIMEOUT_ACTIVE)); process.exit(Number(process.argv[1] || 0));';
  const normal = await run([process.execPath, '-e', echoEnv, '0']);
  assert.equal(normal.code, 0, normal.stderr);
  assert.equal(normal.stdout, '1', 'the child must see CLAUDE2ALL_TIMEOUT_ACTIVE=1');
  const failing = await run([process.execPath, '-e', echoEnv, '7']);
  assert.equal(failing.code, 7);
  console.log('PASS exit code pass-through and re-entry guard');

  // Script children are used wherever -p/--print appear: node -e would parse those itself.
  const exit0 = write('exit0.sh', ['#!/usr/bin/env bash', 'exit 0'], 0o755);
  const argsScript = write('args.sh', ['#!/usr/bin/env bash', 'for a in "$@"; do printf "%s\\n" "$a"; done'], 0o755);

  // A nested helper (guard already set) runs the command without a limit and without error.
  const nested = await run([exit0, '-p', 'x'], { CLAUDE2ALL_TIMEOUT_ACTIVE: '1', CLAUDE2_MAX_MINUTES: 'zero' });
  assert.equal(nested.code, 0, nested.stderr);
  console.log('PASS nested helper does not re-validate or re-arm');

  // Parser errors exit 2 before anything starts.
  for (const [args, env, message] of [
    [[exit0, '--max-minutes', 'zero'], {}, /invalid max minutes/],
    [[exit0, '--max-minutes'], {}, /requires a positive whole number/],
    [[exit0, '--max-minutes', '99999999'], {}, /invalid max minutes/],
    [[exit0, '-p', 'x'], { CLAUDE2_MAX_MINUTES: '0' }, /invalid max minutes/],
  ]) {
    const result = await run(args, env);
    assert.equal(result.code, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, message);
  }
  console.log('PASS parser errors exit 2');

  // Arguments reach the child untouched apart from the MCP default below: no marker,
  // `--print` recognised, `--` respected.
  const lines = (result) => result.stdout.trim().split(/\r?\n/);
  const passthrough = await run([argsScript, '--print', '--output-format', 'json', 'hola', '--', '--max-minutes', '5']);
  assert.equal(passthrough.code, 0, passthrough.stderr);
  assert.deepEqual(lines(passthrough), ['--strict-mcp-config', '--print', '--output-format', 'json', 'hola', '--', '--max-minutes', '5']);
  console.log('PASS arguments pass through untouched, including everything after --');

  // Flags right after -p stay flags. The 14-sep marker build appended its run id to whatever
  // followed -p, so `-p --max-turns 2 x` reached Claude Code as an unknown option.
  const flagsAfterP = await run([argsScript, '-p', '--max-turns', '2', 'x']);
  assert.equal(flagsAfterP.code, 0, flagsAfterP.stderr);
  assert.deepEqual(lines(flagsAfterP), ['--strict-mcp-config', '-p', '--max-turns', '2', 'x']);
  console.log('PASS flags after -p reach Claude Code as flags');

  // Headless runs load no MCP servers unless the caller asks for them.
  for (const [args, env, expected, why] of [
    [[argsScript, '--mcp-config', 'cfg.json', '-p', 'x'], {}, ['--mcp-config', 'cfg.json', '-p', 'x'], 'an explicit --mcp-config'],
    [[argsScript, '--mcp-config=cfg.json', '-p', 'x'], {}, ['--mcp-config=cfg.json', '-p', 'x'], 'an explicit --mcp-config=...'],
    [[argsScript, '--strict-mcp-config', '-p', 'x'], {}, ['--strict-mcp-config', '-p', 'x'], 'an explicit --strict-mcp-config (not doubled)'],
    [[argsScript, '-p', 'x'], { CLAUDE2ALL_MCP: 'all' }, ['-p', 'x'], 'CLAUDE2ALL_MCP=all'],
    [[argsScript, 'hola'], {}, ['hola'], 'an interactive run'],
    [[argsScript, 'run', '-p', 'x'], {}, ['run', '--strict-mcp-config', '-p', 'x'], 'a launcher subcommand before -p'],
  ]) {
    const result = await run(args, env);
    assert.equal(result.code, 0, `${why}: ${result.stderr}`);
    assert.deepEqual(lines(result), expected, why);
  }
  console.log('PASS headless runs get --strict-mcp-config unless MCP is asked for; interactive runs are untouched');

  if (process.platform === 'win32') {
    // Batch files run through cmd.exe, shell scripts through Git Bash, executables directly.
    const cmd = write('echo.cmd', ['@echo off\r', 'echo CMD %~1\r']); // %~1 strips the quotes cmd keeps on %1
    const viaCmd = await run([cmd, 'ok']);
    assert.equal(viaCmd.code, 0, viaCmd.stderr);
    assert.match(viaCmd.stdout, /CMD ok/);
    const sh = write('echo.sh', ['#!/usr/bin/env bash', 'echo "SH $1 guard=$CLAUDE2ALL_TIMEOUT_ACTIVE"'], 0o755);
    const viaBash = await run([sh, 'ok']);
    assert.equal(viaBash.code, 0, viaBash.stderr);
    assert.match(viaBash.stdout, /SH ok guard=1/);
    const viaExe = await run(['cmd.exe', '/d', '/c', 'echo EXE ok']);
    assert.equal(viaExe.code, 0, viaExe.stderr);
    assert.match(viaExe.stdout, /EXE ok/);
    console.log('PASS command classification: .cmd via cmd.exe, #! via Git Bash, .exe directly');
  }

  if (process.platform === 'win32') {
    // The tree query returns exactly the run's descendants: a bash -> sleep pair, and
    // nothing for a leaf; an unrelated process (this test) is never included.
    const { descendants } = require('../bin/claude2all-timeout.cjs');
    const pair = spawn('C:\\Program Files\\Git\\bin\\bash.exe', ['-c', 'sleep 30'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const tree = await descendants(pair.pid);
    assert.ok(tree.length >= 1, `expected at least the sleep process, got ${JSON.stringify(tree)}`);
    assert.ok(tree.some((p) => /sleep/i.test(p.name) || /sleep 30/.test(p.commandLine)), `sleep not found in ${JSON.stringify(tree)}`);
    assert.ok(!tree.some((p) => p.pid === process.pid || p.pid === pair.pid), 'the query must not include the caller or the root itself');
    const leaf = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const startedAt = Date.now();
    assert.deepEqual(await descendants(leaf.pid), [], 'a leaf has no descendants');
    assert.ok(Date.now() - startedAt < 15_000, 'a leaf query must return promptly');
    assert.deepEqual(await descendants(0), []);
    // A command line with line breaks and a bare number must not fabricate a record.
    const tricky = spawn('C:\\Program Files\\Git\\bin\\bash.exe', ['-c', 'x=1\n99999999\nsleep 30'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const trickyTree = await descendants(tricky.pid);
    assert.ok(trickyTree.length >= 1, 'the tricky tree must still be found');
    assert.ok(!trickyTree.some((p) => p.pid === 99999999), 'a number inside a command line is not a pid');
    assert.ok(trickyTree.every((p) => Number.isInteger(p.pid) && typeof p.name === 'string'), 'records are well formed');
    spawnSync('taskkill.exe', ['/F', '/T', '/PID', String(pair.pid)], { stdio: 'ignore' });
    spawnSync('taskkill.exe', ['/F', '/T', '/PID', String(tricky.pid)], { stdio: 'ignore' });
    leaf.kill();
    console.log('PASS tree query: bash -> sleep found, leaf empty, caller excluded, multi-line command lines safe');
  }

  // The run log must never break the termination sequence.
  const { appendTimeoutLog } = require('../bin/claude2all-timeout.cjs');
  assert.equal(await appendTimeoutLog('x', { CLAUDE2ALL_RUN_LOG: root }), false, 'a directory is not a log file');
  assert.equal(await appendTimeoutLog('x', { CLAUDE2ALL_RUN_LOG: path.join(root, 'missing.log') }), false, 'a missing file is skipped');
  assert.equal(await appendTimeoutLog('x', {}), false, 'unset means no log');
  const logFile = write('run.log', ['start']);
  assert.equal(await appendTimeoutLog('cut', { CLAUDE2ALL_RUN_LOG: logFile }), true);
  assert.match(fs.readFileSync(logFile, 'utf8'), /cut\n$/);
  console.log('PASS run log: appended when it is a file, ignored otherwise, never throws');

  // A closed stderr must not abort the supervisor: the child still runs to completion.
  const quiet = await new Promise((resolve) => {
    const child = spawn(process.execPath, [helper, '--', exit0, '-p', 'x', '--max-minutes', '1'], { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.destroy(); // reader goes away immediately
    child.once('close', (code) => resolve(code));
  });
  assert.equal(quiet, 0, 'the helper must survive a closed stderr');
  console.log('PASS a closed stderr does not abort the helper');

  // The limit ends a run whose Claude Code never started: the child tree itself is stopped.
  // The script name carries the fixture's random suffix, so a concurrent run of this
  // suite (another session) cannot be mistaken for a survivor of this one.
  const sleeper = write(`sleeper-${path.basename(root)}.sh`, ['#!/usr/bin/env bash', 'while true; do sleep 1; done'], 0o755);
  const timeout = await run([sleeper, '-p', 'never answers', '--max-minutes', '1']);
  assert.equal(timeout.code, 124, timeout.stderr);
  assert.match(timeout.stderr, /TIEMPO AGOTADO: 1 min, corrida cortada/);
  assert.ok(timeout.elapsedMs >= 60_000, `timeout fired too early: ${timeout.elapsedMs}ms`);
  assert.ok(timeout.elapsedMs < 100_000, `timeout did not end promptly: ${timeout.elapsedMs}ms`);
  if (process.platform === 'win32') {
    const left = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      // The querying PowerShell itself carries the pattern in its command line; exclude it.
      `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${path.basename(sleeper)}*' }).Count`], { encoding: 'utf8' });
    assert.equal(left.stdout.trim(), '0', 'no sleeper process may survive the limit');
  }
  console.log(`PASS clock limit: exit 124 after ${Math.round(timeout.elapsedMs / 1000)} s, run tree stopped`);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('timeout helper tests passed');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\nfixtures kept at ${root}\n`);
  process.exit(1);
});
