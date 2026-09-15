#!/usr/bin/env node
// Shared profile seed and instruction sync. No backend credentials are needed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function stat(file) {
  try { return fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function json(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
}

function writeAtomic(file, content) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (stat(temporary)) fs.unlinkSync(temporary);
  }
}

function writeChanged(file, text) {
  if (stat(file) && fs.readFileSync(file, 'utf8') === text) return false;
  writeAtomic(file, text);
  return true;
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function syncProfile(dir, backend, home = process.env.HOME || os.homedir()) {
  dir = path.resolve(dir);
  const source = path.resolve(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  if (stat(source) && fs.realpathSync(dir) === fs.realpathSync(source)) {
    throw new Error('The destination must be an isolated profile, not ~/.claude');
  }
  const result = { copied: 0, removed: 0, unchanged: 0, preserved: 0 };
  const jp = path.join(dir, '.claude.json');
  const sp = path.join(dir, 'settings.json');
  const j = json(jp);
  const s = json(sp);
  const global = json(path.join(home, '.claude.json'));
  const main = json(path.join(source, 'settings.json'));
  const statePath = path.join(dir, '.claude2all-sync.json');
  const previous = json(statePath);
  const owned = previous.source === source ? (previous.skills || {}) : {};
  const next = Object.create(null);
  const skipped = new Set();
  const skillKey = name => process.platform === 'win32' ? name.toLowerCase() : name;
  const localFile = path.join(dir, 'skills.local');
  const locals = new Set(stat(localFile) ? fs.readFileSync(localFile, 'utf8')
    .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(skillKey) : []);
  for (const name of locals) {
    if (name === '.' || name === '..' || /[\\/:*?\[\]]/.test(name)) {
      throw new Error(`Invalid skill name in ${localFile}: ${name}`);
    }
  }

  function fingerprint(file) {
    const info = stat(file);
    return info ? [info.size, info.mtimeMs, info.ctimeMs].join(':') : null;
  }

  function copyFile(from, to, cached) {
    const src = fingerprint(from);
    const dst = fingerprint(to);
    if (cached && cached.src === src && cached.dst === dst && dst !== null) {
      result.unchanged++;
      return cached;
    }
    const digest = hash(from);
    if (stat(to) && hash(to) === digest) result.unchanged++;
    else { writeAtomic(to, fs.readFileSync(from)); result.copied++; }
    return { type: 'file', hash: digest, src, dst: fingerprint(to) };
  }

  let mdState;

  const md = path.join(source, 'CLAUDE.md');
  const targetMd = path.join(dir, 'CLAUDE.md');
  if (stat(md)) {
    // Replace a profile file link instead of writing through it into its target.
    if (stat(targetMd)?.isSymbolicLink()) fs.unlinkSync(targetMd);
    mdState = copyFile(md, targetMd, previous.source === source ? previous.md : null);
  }

  const sourceSkills = path.join(source, 'skills');
  const targetSkills = path.join(dir, 'skills');
  function protectedPath(relative) {
    if (locals.has(skillKey(relative.split('/')[0]))) return true;
    let current = targetSkills;
    if (stat(current)?.isSymbolicLink()) return true;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if (stat(current)?.isSymbolicLink()) return true;
    }
    return false;
  }

  function mirror(from, to, relative) {
    const src = fs.lstatSync(from);
    const dst = stat(to);
    if (protectedPath(relative)) { result.preserved++; return; }
    if (src.isSymbolicLink()) {
      skipped.add(relative);
      if (!dst) {
        const link = path.resolve(path.dirname(from), fs.readlinkSync(from));
        fs.symlinkSync(link, to, fs.statSync(from).isDirectory() ? 'junction' : 'file');
        result.copied++;
      } else result.preserved++;
      return;
    }
    if (src.isDirectory()) {
      if (dst && !dst.isDirectory()) throw new Error(`Skill type conflict: ${to}`);
      fs.mkdirSync(to, { recursive: true });
      next[relative] = { type: 'directory' };
      for (const name of fs.readdirSync(from)) mirror(path.join(from, name), path.join(to, name), `${relative}/${name}`);
    } else if (src.isFile()) {
      if (dst && !dst.isFile()) throw new Error(`Skill type conflict: ${to}`);
      next[relative] = copyFile(from, to, owned[relative]);
    }
  }

  if (stat(sourceSkills)) {
    if (stat(targetSkills)?.isSymbolicLink()) result.preserved++;
    else {
      fs.mkdirSync(targetSkills, { recursive: true });
      for (const name of fs.readdirSync(sourceSkills)) mirror(path.join(sourceSkills, name), path.join(targetSkills, name), name);
      // Only delete recorded copies. Never traverse a profile link or delete local skills.
      // On Windows the comparison is case-insensitive: a case-only rename in the
      // source is the same file on disk, not a copy to prune.
      const nextKeys = new Set(Object.keys(next).map(skillKey));
      for (const relative of Object.keys(owned).sort((a, b) => b.split('/').length - a.split('/').length)) {
        if (relative.split('/').some(part => !part || part === '.' || part === '..') || /[\\:]/.test(relative)) {
          throw new Error(`Invalid path in ${statePath}: ${relative}`);
        }
        if (nextKeys.has(skillKey(relative)) || protectedPath(relative) || [...skipped].some(link => relative === link || relative.startsWith(`${link}/`))) continue;
        const to = path.join(targetSkills, relative);
        const dst = stat(to);
        if (!dst) continue;
        if (owned[relative].type === 'file' && dst.isFile() && hash(to) === owned[relative].hash) {
          fs.unlinkSync(to);
          result.removed++;
        } else if (owned[relative].type === 'directory' && dst.isDirectory() && fs.readdirSync(to).length === 0) {
          fs.rmdirSync(to);
          result.removed++;
        } else result.preserved++;
      }
    }
  } else Object.assign(next, owned); // A missing source mount must not erase the profile.

  j.hasCompletedOnboarding = true;
  if (backend === 'kimi' || backend === 'openai' || backend === 'deepseek') j.penguinModeOrgEnabled = true;
  const cwd = process.cwd().replace(/\\/g, '/');
  (j.projects ??= {})[cwd] = { ...(j.projects[cwd] || {}), hasTrustDialogAccepted: true };
  if (global.mcpServers) j.mcpServers = { ...global.mcpServers, ...(j.mcpServers || {}) };
  writeChanged(jp, JSON.stringify(j, null, 2) + '\n');
  (s.permissions ??= {}).defaultMode ??= 'bypassPermissions';
  s.skipDangerousModePermissionPrompt ??= true;
  const keys = ['env', 'statusLine', 'theme', 'editorMode', 'verbose', 'promptSuggestionEnabled',
    'autoCompactEnabled', 'skipWorkflowUsageWarning', 'teammateMode', 'askUserQuestionTimeout',
    'inputNeededNotifEnabled', 'agentPushNotifEnabled', 'remoteControlAtStartup'];
  if (backend.startsWith('bedrock')) keys.push('effortLevel');
  for (const key of keys) if (s[key] === undefined && main[key] !== undefined) s[key] = main[key];
  writeChanged(sp, JSON.stringify(s, null, 2) + '\n');
  writeChanged(statePath, JSON.stringify({ source, md: mdState, skills: next }, null, 2) + '\n');
  return result;
}

if (require.main === module) {
  try {
    const [dir, backend] = process.argv.slice(2);
    if (!dir || !backend) throw new Error('Usage: node claude2all-profile.cjs <profile-dir> <backend>');
    const result = syncProfile(dir, backend);
    if (process.env.CLAUDE2ALL_SEED_ONLY === '1') console.log(`${backend}: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`claude2all profile sync: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { syncProfile };
