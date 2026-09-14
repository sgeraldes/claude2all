// Run with: node tests/profile-sync.cjs [launcher-directory]
// Fixtures stay in a printed tests/.profile-sync-fixture-* directory for inspection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { syncProfile } = require('../bin/claude2all-profile.cjs');
const root = fs.mkdtempSync(path.join(__dirname, '.profile-sync-fixture-'));
const home = path.join(root, 'home');
const profile = path.join(root, 'profile');
const bin = path.resolve(process.argv[2] || path.join(__dirname, '../bin'));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
function put(relative, text) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function run(launcher, args, cmd = false) {
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: profile, CLAUDE2ALL_SEED_ONLY: '1', BEDROCK_OPENAI: '0' };
  const file = path.join(bin, launcher + (cmd ? '.cmd' : ''));
  const command = cmd ? process.env.ComSpec : bash;
  const argv = cmd ? ['/d', '/s', '/c', `""${file}" ${args.join(' ')}"`] : [file, ...args];
  const result = spawnSync(command, argv, { env, encoding: 'utf8', windowsVerbatimArguments: cmd });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

put('home/.claude/CLAUDE.md', 'Regla inicial\n');
put('home/.claude/skills/humanizer/SKILL.md', 'Original\n');
put('home/.claude/settings.json', JSON.stringify({ theme: 'light', effortLevel: 'high' }));
put('home/.claude.json', JSON.stringify({ mcpServers: { shared: { command: 'global' }, extra: { command: 'new' } } }));
put('profile/.claude.json', JSON.stringify({ mcpServers: { shared: { command: 'local' } } }));
put('profile/settings.json', JSON.stringify({ theme: 'dark' }));
put('profile/skills.local', '# One skill per line\r\n' + (process.platform === 'win32' ? 'LOCAL-ONLY' : 'local-only') + '\r\n');
put('profile/skills/local-only/SKILL.md', 'Local\n');
put('home/.claude/skills/local-only/SKILL.md', 'Never copy\n');
put('profile/skills/unknown/SKILL.md', 'Untracked\n');
put('outside/SKILL.md', 'Link target\n');
const link = path.join(profile, 'skills', 'linked');
if (!fs.existsSync(link)) fs.symlinkSync(path.join(root, 'outside'), link, 'junction');
put('home/.claude/skills/linked/SKILL.md', 'Do not overwrite the target\n');

const launchers = [
  ['claude2kiro', []], ['claude2openai', []], ['claude2kimi', []],
  ['claude2bedrock', []], ['claude2bedrock', ['--openai']],
];
let version = 0;
for (const cmd of process.platform === 'win32' ? [false, true] : [false]) {
  for (const [launcher, args] of launchers) {
    run(launcher, args, cmd);
    version++;
    put('home/.claude/CLAUDE.md', `Regla modificada ${version}\n`);
    put('home/.claude/skills/humanizer/references/prose.md', `Prosa ${version}\n`);
    put(`home/.claude/skills/new-${version}/SKILL.md`, `Skill ${version}\n`);
    const output = run(launcher, args, cmd);
    assert.equal(read('profile/CLAUDE.md'), `Regla modificada ${version}\n`);
    assert.equal(read('profile/skills/humanizer/references/prose.md'), `Prosa ${version}\n`);
    assert.equal(read(`profile/skills/new-${version}/SKILL.md`), `Skill ${version}\n`);
    const stamp = fs.statSync(path.join(profile, 'CLAUDE.md')).mtimeMs;
    const stateStamp = fs.statSync(path.join(profile, '.claude2all-sync.json')).mtimeMs;
    const again = run(launcher, args, cmd);
    assert.match(again, /"copied":0/);
    assert.equal(fs.statSync(path.join(profile, 'CLAUDE.md')).mtimeMs, stamp);
    assert.equal(fs.statSync(path.join(profile, '.claude2all-sync.json')).mtimeMs, stateStamp);
    console.log(`PASS ${launcher}${cmd ? '.cmd' : ''} ${args.join(' ')}: CLAUDE.md=${version}, skill nuevo, referencias, segunda corrida sin escrituras; ${output}`);
  }
}
assert.equal(read('profile/skills/local-only/SKILL.md'), 'Local\n');
assert.equal(read('profile/skills/unknown/SKILL.md'), 'Untracked\n');
assert.equal(read('outside/SKILL.md'), 'Link target\n');
assert.ok(fs.lstatSync(link).isSymbolicLink());
const settings = JSON.parse(read('profile/settings.json'));
assert.equal(settings.theme, 'dark');
assert.equal(settings.permissions.defaultMode, 'bypassPermissions');
assert.equal(settings.effortLevel, 'high');
const state = JSON.parse(read('profile/.claude.json'));
assert.equal(state.hasCompletedOnboarding, true);
assert.equal(state.penguinModeOrgEnabled, true);
assert.equal(state.mcpServers.shared.command, 'local');
assert.equal(state.mcpServers.extra.command, 'new');
assert.equal(state.projects[process.cwd().replace(/\\/g, '/')].hasTrustDialogAccepted, true);

// Rename out of the source to simulate deletion without deleting fixture data.
fs.renameSync(path.join(home, '.claude/skills/new-1'), path.join(root, 'retired-skill'));
put('profile/skills/new-2/SKILL.md', 'Edited locally after copying\n');
fs.renameSync(path.join(home, '.claude/skills/new-2'), path.join(root, 'retired-edited'));
fs.renameSync(path.join(home, '.claude/skills/humanizer/references/prose.md'), path.join(root, 'retired-reference.md'));
fs.renameSync(path.join(home, '.claude/skills/local-only'), path.join(root, 'retired-local'));
const pruned = syncProfile(profile, 'kiro', home);
assert.equal(fs.existsSync(path.join(profile, 'skills/new-1')), false);
assert.equal(fs.existsSync(path.join(profile, 'skills/humanizer/references/prose.md')), false);
assert.equal(read('profile/skills/new-2/SKILL.md'), 'Edited locally after copying\n');
assert.equal(read('profile/skills/local-only/SKILL.md'), 'Local\n');
console.log(`PASS bajas: copia retirada y referencia eliminadas; edición local conservada; ${JSON.stringify(pruned)}`);

// New source junctions are replicated; an existing copy is never pruned when
// its source becomes a link. A linked profile skills root is never traversed.
fs.symlinkSync(path.join(root, 'outside'), path.join(home, '.claude/skills/source-link'), 'junction');
syncProfile(profile, 'kiro', home);
assert.ok(fs.lstatSync(path.join(profile, 'skills/source-link')).isSymbolicLink());
fs.renameSync(path.join(home, '.claude/skills/humanizer'), path.join(root, 'humanizer-copy'));
fs.symlinkSync(path.join(root, 'humanizer-copy'), path.join(home, '.claude/skills/humanizer'), 'junction');
syncProfile(profile, 'kiro', home);
assert.equal(read('profile/skills/humanizer/SKILL.md'), 'Original\n');
const linkedProfile = path.join(root, 'linked-profile');
fs.mkdirSync(linkedProfile);
fs.symlinkSync(path.join(root, 'outside'), path.join(linkedProfile, 'skills'), 'junction');
syncProfile(linkedProfile, 'kiro', home);
assert.deepEqual(fs.readdirSync(path.join(root, 'outside')), ['SKILL.md']);
console.log('PASS junction del origen, copia convertida en enlace y raíz skills enlazada');

fs.renameSync(path.join(home, '.claude/skills'), path.join(root, 'source-skills-unavailable'));
assert.equal(syncProfile(profile, 'kiro', home).removed, 0);
assert.equal(read('profile/skills/humanizer/SKILL.md'), 'Original\n');
put('profile/settings.json', '{ broken');
assert.throws(() => syncProfile(profile, 'kiro', home), /Cannot read/);
put('profile/settings.json', JSON.stringify(settings));
assert.throws(() => syncProfile(path.join(home, '.claude'), 'kiro', home), /isolated profile/);
console.log('PASS enlaces, skills.local, archivos sin registro, MCP, settings, trust, fuente ausente y JSON inválido');
console.log(`Fixtures: ${root}`);
