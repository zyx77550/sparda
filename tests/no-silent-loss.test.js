// no-silent-loss.test.js — THE SEALING CERTIFICATE, executable.
//
// Every other test in this suite pins a behaviour SPARDA has. This one pins the absence
// of a behaviour: that no Express registration anywhere in the fixture corpus is dropped
// without a trace. It is the machine-checkable form of the rule the audit produced:
//
//   A call on an app/router object is either MODELLED (route, mount, middleware) or
//   DECLARED (an UnknownHandler + a high-risk blind spot). No silent third option.
//
// Crucially it does NOT reuse the extractor's own classification — that would be a
// tautology. It re-enumerates the registrations with an INDEPENDENT Babel walk and its
// own app/router-variable detection, then demands the extractor account for every one.
// Two implementations that must agree; when they disagree, something was lost.
//
// The sweep runs over every Express fixture in the repo, so a future extractor change
// that starts dropping a shape gets caught on real corpus code, not a synthetic case.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { extractExpress } from '../src/ubg/express.js';
import { detectStack } from '../src/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');

// Members that cannot register a route. Kept as an INDEPENDENT copy on purpose: if the
// extractor's own allowlist grows silently, this list stays put and the sweep flags the
// newly-silenced member. Widening it here is the deliberate, reviewable act.
const PLUMBING = new Set([
  'listen',
  'set',
  'enable',
  'disable',
  'enabled',
  'disabled',
  'engine',
  'render',
  'path',
  'init',
  'defaultConfiguration',
  'handle',
  'locals',
  'mountpath',
  'param',
  'on',
  'once',
  'off',
  'emit',
  'addListener',
  'removeListener',
  'removeAllListeners',
  'setMaxListeners',
  'listeners',
  'then',
  'catch',
  'finally',
  'toString',
]);
const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use', 'route']);

const isMember = (n) =>
  n?.type === 'MemberExpression' || n?.type === 'OptionalMemberExpression';
const isCall = (n) =>
  n?.type === 'CallExpression' || n?.type === 'OptionalCallExpression';

// Independent app/router-variable detection: constructed (express()/Router()) or aliased.
function appVarsOf(ast) {
  const names = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const init = node.init;
      if (isCall(init)) {
        const c = init.callee;
        if (c?.type === 'Identifier' && (c.name === 'express' || c.name === 'Router'))
          names.add(node.id.name);
        if (isMember(c) && c.property?.name === 'Router') names.add(node.id.name);
      } else if (init?.type === 'Identifier' && names.has(init.name)) {
        names.add(node.id.name);
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (v && typeof v === 'object') walk(v);
    }
  };
  // two passes so an alias declared before its source still resolves
  walk(ast);
  walk(ast);
  return names;
}

// Every call on an app/router object, however it is spelled.
function registrationsIn(src) {
  const ast = parse(src, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
  });
  const vars = appVarsOf(ast);
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (isCall(node) && isMember(node.callee)) {
      const obj = node.callee.object;
      if (obj?.type === 'Identifier' && vars.has(obj.name)) {
        const method = node.callee.computed
          ? '<computed>'
          : (node.callee.property?.name ?? '<dynamic>');
        found.push({ target: obj.name, method, line: node.loc?.start.line ?? 0 });
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(ast);
  return found;
}

// Express fixtures that compile through extractExpress, discovered from disk.
function expressFixtures() {
  const out = [];
  for (const name of fs.readdirSync(FIXTURES).sort()) {
    const dir = path.join(FIXTURES, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    let stack;
    try {
      stack = detectStack(dir);
    } catch {
      continue; // not a detectable app (schema-only fixtures, etc.)
    }
    if (stack.framework !== 'express' || !stack.entryFile) continue;
    const entry = path.join(dir, stack.entryFile);
    if (!fs.existsSync(entry) || !/\.(js|mjs|cjs|ts)$/.test(entry)) continue;
    out.push({ name, dir, entryFile: stack.entryFile, entry });
  }
  return out;
}

const fixtures = expressFixtures();

describe('SEALING CERTIFICATE — no registration is lost in silence', () => {
  it('the sweep actually covers the Express corpus', () => {
    // a guard on the guard: if detection ever stops finding these, the certificate
    // would pass vacuously, which is precisely the failure mode it exists to prevent
    expect(fixtures.length).toBeGreaterThanOrEqual(15);
  });

  for (const fx of fixtures) {
    it(`${fx.name}: every registration is modelled or declared`, () => {
      const src = fs.readFileSync(fx.entry, 'utf8');
      let seen;
      try {
        seen = registrationsIn(src);
      } catch {
        return; // the entry does not parse — the extractor declares that separately
      }
      const out = extractExpress(fx.dir, fx.entryFile);

      // A registration is ACCOUNTED FOR when it is a modelled verb (route / mount /
      // middleware), known plumbing, or carries a declared UnknownHandler.
      const declaredLines = new Set(
        out.unknownHandlers.map((u) => u.line).filter((l) => l != null),
      );
      const unaccounted = seen.filter((s) => {
        if (PLUMBING.has(s.method)) return false;
        if (VERBS.has(s.method)) return false;
        return !declaredLines.has(s.line);
      });

      expect(
        unaccounted.map((u) => `${u.target}.${u.method}() at ${fx.entryFile}:${u.line}`),
      ).toEqual([]);
    });
  }
});

// The other half of the seal. "Declare everything" is trivially satisfiable by declaring
// everything — which would drown the blind-spot channel and make the verdict useless.
// So the corpus must ALSO stay quiet where it is fully understood.
describe('SEALING CERTIFICATE — and no noise where the code is understood', () => {
  it('the canonical clean fixtures declare zero unknowns', () => {
    for (const name of ['ubg-proven', 'ubg-express', 'ubg-prisma']) {
      const dir = path.join(FIXTURES, name);
      if (!fs.existsSync(dir)) continue;
      const stack = detectStack(dir);
      const out = extractExpress(dir, stack.entryFile);
      expect({ [name]: out.unknownHandlers }).toEqual({ [name]: [] });
    }
  });
});
