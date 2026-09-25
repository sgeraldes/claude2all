// Contract test for bin/claude2deepseek: runs the real launcher against a fake `claude`
// and a temporary HOME, and checks the environment and arguments that reach Claude Code.
// Run with: node tests/claude2deepseek.cjs
// Fixtures live under the OS temp dir and are removed on success (kept and printed on failure).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.resolve(__dirname, '../bin');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude2deepseek-test-'));
const fakeBin = path.join(root, 'fakebin');
fs.mkdirSync(fakeBin);

// Git Bash needs the PATH entry in POSIX form; a `C:/...` entry splits on the drive colon.
function posix(p) {
  return process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p;
}

const tracked = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE2ALL_TIMEOUT_ACTIVE',
];
fs.writeFileSync(path.join(fakeBin, 'claude'), [
  '#!/usr/bin/env bash',
  'for a in "$@"; do printf \'ARG\\t%s\\n\' "$a"; done',
  `for n in ${tracked.join(' ')}; do printf 'ENV\\t%s\\t%s\\n' "$n" "\${!n-<unset>}"; done`,
  '',
].join('\n'));
fs.chmodSync(path.join(fakeBin, 'claude'), 0o755);

function home(name, config) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude2deepseek'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude2deepseek', 'config'), config);
  }
  return dir;
}

function run(homeDir, args, extraEnv = {}, cmd = false) {
  const env = { ...process.env, HOME: homeDir, PATH: `${posix(fakeBin)}:${process.env.PATH}`, ...extraEnv };
  // The suite may itself run inside a launcher session: start from an environment without the
  // helper's guard, limit or MCP opt-in, then apply each case's own values.
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'CLAUDE_CONFIG_DIR',
    'CLAUDE2ALL_TIMEOUT_ACTIVE', 'CLAUDE2_MAX_MINUTES', 'CLAUDE2ALL_MCP']) delete env[k];
  Object.assign(env, extraEnv);
  const file = path.join(bin, 'claude2deepseek' + (cmd ? '.cmd' : ''));
  const command = cmd ? process.env.ComSpec : bash;
  const argv = cmd ? ['/d', '/s', '/c', `""${file}" ${args.map((a) => `"${a}"`).join(' ')}"`] : [file, ...args];
  const result = spawnSync(command, argv, { env, encoding: 'utf8', windowsVerbatimArguments: cmd });
  const seen = { args: [], env: {} };
  for (const line of (result.stdout || '').split(/\r?\n/)) {
    const [kind, a, b] = line.split('\t');
    if (kind === 'ARG') seen.args.push(a);
    if (kind === 'ENV') seen.env[a] = b;
  }
  return { status: result.status, stderr: result.stderr || '', ...seen };
}

const example = fs.readFileSync(path.resolve(__dirname, '../config/claude2deepseek.config.example'), 'utf8');
const configured = home('configured', example.replace('paste-your-deepseek-api-key-here', 'sk-test-key'));
const placeholder = home('placeholder', example);
const empty = home('empty', 'DEEPSEEK_API_KEY=\n');
const bare = home('bare');
const pinned = home('pinned', 'DEEPSEEK_API_KEY=sk-pinned\nDEEPSEEK_MODEL=deepseek-v4-pro\nDEEPSEEK_EFFORT=low\nDEEPSEEK_HAIKU_MODEL=deepseek-flash[1m]\n');

let r = run(configured, ['-p', 'hello', '--max-turns', '3']);
assert.equal(r.status, 0, r.stderr);
// Headless runs go through the clock-limit helper, which adds --strict-mcp-config.
assert.deepEqual(r.args, ['--strict-mcp-config', '-p', 'hello', '--max-turns', '3']);
assert.equal(r.env.CLAUDE2ALL_TIMEOUT_ACTIVE, '<unset>');
assert.equal(r.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
assert.equal(r.env.ANTHROPIC_AUTH_TOKEN, 'sk-test-key');
assert.equal(r.env.ANTHROPIC_API_KEY, '<unset>');
assert.equal(r.env.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
assert.equal(r.env.ANTHROPIC_DEFAULT_FABLE_MODEL, 'deepseek-flash[1m]');
assert.equal(r.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-flash[1m]');
assert.equal(r.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-flash[1m]');
assert.equal(r.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-flash');
assert.equal(r.env.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-flash');
assert.equal(r.env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
assert.equal(r.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '786432');
assert.equal(r.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '1048576');
assert.match(r.env.CLAUDE_CONFIG_DIR, /[\\/]\.claude-profiles[\\/]deepseek$/);
assert.ok(fs.existsSync(path.join(configured, '.claude-profiles', 'deepseek', 'settings.json')), 'profile seeded');
console.log('PASS defaults follow the official DeepSeek recipe; arguments pass through untouched');

r = run(configured, ['--model', 'pro', '--effort', 'high', '-p', 'x']);
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(r.args, ['--strict-mcp-config', '-p', 'x']);
assert.equal(r.env.ANTHROPIC_MODEL, 'deepseek-v4-pro[1m]');
assert.equal(r.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-v4-pro[1m]');
assert.equal(r.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-v4-pro[1m]');
assert.equal(r.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-flash');
assert.equal(r.env.CLAUDE_CODE_EFFORT_LEVEL, 'high');
r = run(configured, ['--model', 'deepseek-v4-pro']);
assert.equal(r.status, 0, r.stderr);
assert.equal(r.env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
assert.deepEqual(r.args, []);
console.log('PASS --model flash|pro|<id> and --effort are consumed by the launcher');

// The clock limit: --max-minutes is the helper's, never Claude Code's; MCP comes back on request.
r = run(configured, ['--max-minutes', '5', '-p', 'x']);
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(r.args, ['--strict-mcp-config', '-p', 'x']);
r = run(configured, ['-p', 'x'], { CLAUDE2ALL_MCP: 'all' });
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(r.args, ['-p', 'x']);
r = run(configured, ['--max-minutes', '0', '-p', 'x']);
assert.equal(r.status, 2, 'an invalid limit stops the run before Claude Code starts');
console.log('PASS --max-minutes is consumed by the helper; headless runs load no MCP unless CLAUDE2ALL_MCP=all');

r = run(pinned, ['--effort', 'medium']);
assert.equal(r.status, 0, r.stderr);
assert.equal(r.env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
assert.equal(r.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-v4-pro');
assert.equal(r.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-flash[1m]');
assert.equal(r.env.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-flash[1m]');
assert.equal(r.env.CLAUDE_CODE_EFFORT_LEVEL, 'medium');
console.log('PASS precedence: defaults, then config, then flags');

r = run(configured, ['--', '--model', 'pro', '-p', 'literal']);
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(r.args, ['--', '--model', 'pro', '-p', 'literal']);
assert.equal(r.env.ANTHROPIC_MODEL, 'deepseek-flash[1m]');
console.log('PASS -- ends option parsing and everything after it is forwarded literally');

r = run(configured, ['-p', 'x'], { CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_API_KEY: 'stale', CLAUDE2ALL_TIMEOUT_ACTIVE: '1' });
assert.equal(r.status, 0, r.stderr);
assert.equal(r.env.CLAUDE_CODE_USE_BEDROCK, '<unset>');
assert.equal(r.env.CLAUDE_CODE_USE_VERTEX, '<unset>');
assert.equal(r.env.CLAUDE_CODE_USE_FOUNDRY, '<unset>');
assert.equal(r.env.ANTHROPIC_API_KEY, '<unset>');
assert.equal(r.env.CLAUDE2ALL_TIMEOUT_ACTIVE, '<unset>');
console.log('PASS leftover provider selectors, ANTHROPIC_API_KEY and the clock-limit guard are cleared');

for (const [args, code, message] of [
  [['--model'], 2, /--model requires/],
  [['--model', '--effort', 'high'], 2, /--model requires/],
  [['--effort'], 2, /--effort requires/],
  [['--effort', 'turbo'], 2, /invalid --effort/],
  [['--effort', '--max'], 2, /--effort requires/],
]) {
  r = run(configured, args);
  assert.equal(r.status, code, `${args.join(' ')}: ${r.stderr}`);
  assert.match(r.stderr, message);
  assert.deepEqual(r.args, [], 'claude must not start on a parser error');
}
console.log('PASS parser errors exit 2 before Claude Code starts');

r = run(placeholder, ['-p', 'x']);
assert.equal(r.status, 1); assert.match(r.stderr, /set DEEPSEEK_API_KEY/); assert.deepEqual(r.args, []);
r = run(empty, ['-p', 'x']);
assert.equal(r.status, 1); assert.match(r.stderr, /set DEEPSEEK_API_KEY/); assert.deepEqual(r.args, []);
r = run(bare, ['-p', 'x']);
assert.equal(r.status, 1); assert.match(r.stderr, /missing config file/); assert.deepEqual(r.args, []);
console.log('PASS placeholder, empty and missing keys exit 1 before Claude Code starts');

if (process.platform === 'win32') {
  r = run(configured, ['--model', 'pro', '-p', 'via cmd'], {}, true);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.args, ['--strict-mcp-config', '-p', 'via cmd']);
  assert.equal(r.env.ANTHROPIC_MODEL, 'deepseek-v4-pro[1m]');
  console.log('PASS claude2deepseek.cmd delegates to the Bash launcher');
}

// The wizard stores the key through bin/claude2all-config.cjs; the file is later `source`d.
const { upsert } = require('../bin/claude2all-config.cjs');
const cfg = "# c\nDEEPSEEK_API_KEY=paste-your-deepseek-api-key-here\nDEEPSEEK_MODEL=deepseek-flash[1m]\n";
assert.equal(upsert(cfg, 'DEEPSEEK_API_KEY', 'sk-plain'), "# c\nDEEPSEEK_API_KEY='sk-plain'\nDEEPSEEK_MODEL=deepseek-flash[1m]\n");
assert.equal(upsert("DEEPSEEK_MODEL=x\n", 'DEEPSEEK_API_KEY', 'sk-new'), "DEEPSEEK_MODEL=x\nDEEPSEEK_API_KEY='sk-new'\n", 'appends when missing');
assert.equal(upsert("DEEPSEEK_API_KEY=a\nX=1\nDEEPSEEK_API_KEY=b\n", 'DEEPSEEK_API_KEY', 'c'), "DEEPSEEK_API_KEY='c'\nX=1\n", 'collapses duplicates');
assert.equal(upsert('', 'DEEPSEEK_API_KEY', 'sk'), "DEEPSEEK_API_KEY='sk'\n", 'empty file');
assert.throws(() => upsert(cfg, 'DEEPSEEK_API_KEY', 'sk\nX=1'), /control character/);
assert.throws(() => upsert(cfg, 'bad-name', 'x'), /invalid variable name/);
const hostile = `ab&printf x|c d$(echo e)\`f\` 'g' "h" \\i`;
const written = path.join(root, 'hostile.cfg');
fs.writeFileSync(written, upsert(cfg, 'DEEPSEEK_API_KEY', hostile));
const sourced = spawnSync(bash, ['-c', `source "$1" && printf '%s' "$DEEPSEEK_API_KEY"`, 'bash', posix(written)], { encoding: 'utf8' });
assert.equal(sourced.status, 0, sourced.stderr);
assert.equal(sourced.stdout, hostile, 'a hostile key round-trips through source unchanged');
console.log('PASS config helper stores the key as a shell literal; hostile keys round-trip through source');

fs.rmSync(root, { recursive: true, force: true });
console.log('claude2deepseek contract tests passed');
