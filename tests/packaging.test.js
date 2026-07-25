// packaging.test.js — the published package must actually run. `src/` is shipped (package.json
// `files`), so every RUNTIME import it makes must be a declared runtime `dependency` — not a
// devDependency, which npm does NOT install for a consumer. v0.66.2 shipped with @babel/parser,
// @babel/traverse and @clack/prompts in devDependencies, so `sparda ubg|prove|apocalypse|init`
// all crashed with "Cannot find package '@babel/parser'" on a clean install (E-059). The
// prepublish gate (`vitest run`) never caught it because tests run WITH devDependencies present.
// This test parses src/ with babel (so imports inside generated-code TEMPLATE STRINGS are ignored)
// and asserts every external package it imports is a declared dependency.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { parse } from '@babel/parser';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = new Set(Object.keys(pkg.dependencies ?? {}));
const builtins = new Set(builtinModules);

const pkgNameOf = (spec) =>
  spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

function importsOf(file) {
  const found = new Set();
  let ast;
  try {
    ast = parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
    });
  } catch {
    return found; // a file babel can't parse ships no runnable import we can check here
  }
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (n.type === 'ImportDeclaration') found.add(n.source.value);
    if (
      n.type === 'CallExpression' &&
      n.callee.type === 'Identifier' &&
      n.callee.name === 'require' &&
      n.arguments[0]?.type === 'StringLiteral'
    )
      found.add(n.arguments[0].value);
    for (const k in n) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
      if (n[k] && typeof n[k] === 'object') visit(n[k]);
    }
  };
  visit(ast.program.body);
  return found;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(js|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe('packaging: every runtime import in src/ is a declared dependency', () => {
  const external = new Map(); // package -> first file that imports it
  for (const file of walk(path.join(root, 'src'))) {
    for (const spec of importsOf(file)) {
      if (spec.startsWith('.') || spec.startsWith('node:')) continue;
      const name = pkgNameOf(spec);
      if (builtins.has(name)) continue; // node builtin imported without the node: prefix
      if (name === pkg.name) continue; // self-reference (the shipped subpaths)
      if (!external.has(name)) external.set(name, path.relative(root, file));
    }
  }

  it('resolves the shipped runtime imports against package.json dependencies', () => {
    const missing = [...external].filter(([name]) => !deps.has(name));
    expect(
      missing,
      `these packages are imported by src/ but are NOT in "dependencies" (a clean ` +
        `\`npm i ${pkg.name}\` would crash): ${missing.map(([n, f]) => `${n} (${f})`).join(', ')}`,
    ).toEqual([]);
  });

  it('keeps the runtime surface to exactly the four exact-pinned deps (selling point)', () => {
    expect([...deps].sort()).toEqual([
      '@babel/parser',
      '@babel/traverse',
      '@clack/prompts',
      '@modelcontextprotocol/sdk',
    ]);
    for (const [name, range] of Object.entries(pkg.dependencies))
      expect(/^\d/.test(range), `${name} must be exact-pinned, got "${range}"`).toBe(
        true,
      );
  });
});
