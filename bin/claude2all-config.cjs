#!/usr/bin/env node
// Upsert KEY=value in a launcher config file that is later read with `source`.
// Usage: node claude2all-config.cjs <file> <KEY> <value>
// The value is written as a single-quoted shell literal, so `&`, `|`, `$()`, spaces
// or quotes in a pasted key can never run as code. Duplicate assignments collapse
// into one; a missing assignment is appended. Control characters are rejected.
'use strict';
const fs = require('node:fs');

function shellLiteral(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function upsert(text, key, value) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`invalid variable name: ${key}`);
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('the value contains a control character (line break, tab, ...)');
  const assignment = `${key}=${shellLiteral(value)}`;
  const pattern = new RegExp(`^${key}=`);
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const out = [];
  let done = false;
  for (const line of lines) {
    if (pattern.test(line)) {
      if (!done) { out.push(assignment); done = true; }
    } else out.push(line);
  }
  if (!done) out.push(assignment);
  return out.join('\n') + '\n';
}

if (require.main === module) {
  try {
    const [file, key, value] = process.argv.slice(2);
    if (!file || !key || value === undefined) throw new Error('usage: node claude2all-config.cjs <file> <KEY> <value>');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    fs.writeFileSync(file, upsert(text, key, value));
  } catch (error) {
    console.error(`claude2all config: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { upsert, shellLiteral };
