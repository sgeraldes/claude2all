#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const fs = require('node:fs');

const TIMEOUT_EXIT_CODE = 124;
const GRACE_MS = 20_000;

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

  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === '--max-minutes') {
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

  const headless = filteredArgs.includes('-p');
  if (requestedMinutes === undefined || requestedMinutes === '') {
    requestedMinutes = headless ? '90' : undefined;
  }

  if (requestedMinutes === undefined) {
    return { commandArgs: filteredArgs, timeoutMs: undefined, minutes: undefined };
  }

  if (!/^\d+$/.test(requestedMinutes) || Number(requestedMinutes) < 1 || !Number.isSafeInteger(Number(requestedMinutes))) {
    fail(`invalid max minutes '${requestedMinutes}' (expected a positive whole number)`);
  }

  return {
    commandArgs: filteredArgs,
    timeoutMs: Number(requestedMinutes) * 60_000,
    minutes: Number(requestedMinutes),
  };
}

function terminateClaudeChildren(rootPid, force, marker) {
  if (process.platform === 'win32') {
    if (!marker) {
      const result = spawnSync('taskkill.exe', [force ? '/F' : '', '/PID', String(rootPid), '/T'].filter(Boolean), {
        encoding: 'utf8',
        windowsHide: true,
      });
      return result.status === 0;
    }

    const quotedMarker = JSON.stringify(marker);
    const command = [
      `$marker = ${quotedMarker}`,
      "$filter = \"Name = 'claude.exe' AND CommandLine LIKE '%$marker%'\"",
      "$items = Get-CimInstance -ClassName Win32_Process -Filter $filter",
      `foreach ($item in $items) { taskkill.exe ${force ? '/F ' : ''}/PID $item.ProcessId /T | Out-Null }`,
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.status === 0;
  }

  try {
    process.kill(-rootPid, force ? 'SIGKILL' : 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function markerStripper() {
  let buffer = '';
  return new Transform({
    transform(chunk, encoding, callback) {
      buffer += chunk.toString();
      const boundary = Math.max(0, buffer.length - 256);
      const output = buffer.slice(0, boundary).replace(/ \[claude2all-run:[0-9a-f-]+\]/g, '');
      buffer = buffer.slice(boundary);
      callback(null, output);
    },
    flush(callback) {
      callback(null, buffer.replace(/ \[claude2all-run:[0-9a-f-]+\]/g, ''));
    },
  });
}

function appendTimeoutLog(line) {
  const logPath = process.env.CLAUDE2ALL_RUN_LOG;
  if (!logPath || !fs.existsSync(logPath)) {
    return;
  }
  fs.appendFileSync(logPath, `${line}\n`);
}

async function main() {
  const { commandArgs, timeoutMs, minutes } = parseArgs(process.argv.slice(2));
  const [command, ...args] = commandArgs;
  const promptIndex = args.indexOf('-p');
  const runMarker = timeoutMs !== undefined && promptIndex !== -1
    ? `claude2all-run:${randomUUID()}`
    : undefined;
  if (runMarker) {
    args[promptIndex + 1] += ` [${runMarker}]`;
  }
  const executableExtension = /\.exe$/i.test(command);
  const isClaudeShellCommand = /(?:^|[\\/])claude$/i.test(command);
  const isUnixScriptPath = fs.existsSync(command) && !executableExtension;
  const useGitBash = process.platform === 'win32'
    && (/\.cmd$/i.test(command) || isClaudeShellCommand || isUnixScriptPath);
  const commandFile = useGitBash ? 'C:\\Program Files\\Git\\bin\\bash.exe' : command;
  const spawnArgs = useGitBash ? [command, ...args] : args;
  const child = spawn(commandFile, spawnArgs, {
    detached: process.platform !== 'win32',
    env: { ...process.env, CLAUDE2ALL_TIMEOUT_ACTIVE: '1' },
    stdio: runMarker ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    windowsHide: false,
  });
  if (runMarker) {
    child.stdout.pipe(markerStripper()).pipe(process.stdout);
    child.stderr.pipe(markerStripper()).pipe(process.stderr);
  }

  let timedOut = false;
  let forceTimer;
  let retryTimer;
  let timeoutTimer;

  if (timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      const line = `[claude2all] TIEMPO AGOTADO: ${minutes} min, corrida cortada`;
      process.stderr.write(`${line}\n`);
      appendTimeoutLog(line);

      terminateClaudeChildren(child.pid, false, runMarker);
      forceTimer = setTimeout(() => terminateClaudeChildren(child.pid, true, runMarker), GRACE_MS);
    }, timeoutMs);
    timeoutTimer.unref();
  }

  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  clearTimeout(timeoutTimer);
  clearTimeout(retryTimer);

  if (timedOut) {
    clearTimeout(forceTimer);
    return TIMEOUT_EXIT_CODE;
  }
  clearTimeout(forceTimer);
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
