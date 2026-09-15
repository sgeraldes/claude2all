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

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [helper, '--', ...args], {
      env: { ...process.env, ...env },
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

  // Arguments reach the child untouched: no marker, `--print` recognised, `--` respected.
  const passthrough = await run([argsScript, '--print', '--output-format', 'json', 'hola', '--', '--max-minutes', '5']);
  assert.equal(passthrough.code, 0, passthrough.stderr);
  assert.deepEqual(passthrough.stdout.trim().split(/\r?\n/), ['--print', '--output-format', 'json', 'hola', '--', '--max-minutes', '5']);
  console.log('PASS arguments pass through untouched, including everything after --');

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

  // The limit ends a run whose Claude Code never started: the child tree itself is stopped.
  const sleeper = write('sleeper.sh', ['#!/usr/bin/env bash', 'while true; do sleep 1; done'], 0o755);
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
