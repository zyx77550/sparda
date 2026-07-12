// fingerprint.test.js — the portable behavior fingerprint (ADR-035, Brick 1).
// The load-bearing property: the SAME behavioral shape in two DIFFERENT repos
// (different files, lines, names, paths) must produce the SAME behaviorHash —
// that shared address is what makes a diagnosis collective. And a DIFFERENT
// shape must produce a different hash, or the address is meaningless.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { fingerprintGraph, fingerprintEntrypoint } from '../src/ubg/fingerprint.js';
import { indexGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const graphOf = (fx) =>
  canonicalizeGraph(compileUBG(path.join(here, 'fixtures', fx), { write: false }).graph);

// Build a canonical-shaped graph for ONE entrypoint with the given coordinates,
// so two "repos" can share a behavioral shape while differing in every id detail.
function repoGraph({ method, urlPath, file, line, guard = false, op = 'insert' }) {
  const ep = `entrypoint:${method} ${urlPath}`;
  const eff = `effect:db_write:${file}:${line}:0`;
  const st = `state:sql:${file}_table`;
  const nodes = [
    {
      id: ep,
      kind: 'entrypoint',
      label: urlPath,
      loc: { file, line },
      meta: { inputValidated: false },
    },
    {
      id: eff,
      kind: 'effect',
      label: 'w',
      loc: { file, line },
      meta: { effectType: 'db_write', op },
    },
    {
      id: st,
      kind: 'state',
      label: 't',
      loc: null,
      meta: { invariants: [{ type: 'unique' }] },
    },
  ];
  const edges = [
    { kind: 'control_flow', from: ep, to: eff, meta: { route: ep } },
    { kind: 'mutation', from: eff, to: st, meta: {} },
  ];
  if (guard) {
    const g = `guard:${file}#auth:${line}`;
    nodes.push({ id: g, kind: 'guard', label: 'auth', loc: { file, line }, meta: {} });
    edges.push({ kind: 'control_flow', from: ep, to: g, meta: { route: ep } });
  }
  return { version: 'sparda-ubg/v1.2', meta: {}, nodes, edges };
}

describe('behavior fingerprint — portability across repos', () => {
  it('same shape, different coordinates → SAME hash', () => {
    const a = fingerprintGraph(
      repoGraph({ method: 'POST', urlPath: '/users', file: 'src/a.js', line: 5 }),
    );
    const b = fingerprintGraph(
      repoGraph({
        method: 'POST',
        urlPath: '/members',
        file: 'lib/deep/b.ts',
        line: 812,
      }),
    );
    expect(a[0].behaviorHash).toBe(b[0].behaviorHash);
  });

  it('a guard on the path changes the shape → DIFFERENT hash', () => {
    const open = fingerprintGraph(
      repoGraph({ method: 'POST', urlPath: '/x', file: 'a.js', line: 1 }),
    );
    const guarded = fingerprintGraph(
      repoGraph({ method: 'POST', urlPath: '/x', file: 'a.js', line: 1, guard: true }),
    );
    expect(open[0].behaviorHash).not.toBe(guarded[0].behaviorHash);
  });

  it('a different write op changes the shape → DIFFERENT hash', () => {
    const ins = fingerprintGraph(
      repoGraph({ method: 'POST', urlPath: '/x', file: 'a.js', line: 1, op: 'insert' }),
    );
    const del = fingerprintGraph(
      repoGraph({ method: 'POST', urlPath: '/x', file: 'a.js', line: 1, op: 'delete' }),
    );
    expect(ins[0].behaviorHash).not.toBe(del[0].behaviorHash);
  });

  it('the descriptor is coordinate-free — no file, line, or path literal leaks in', () => {
    const g = repoGraph({
      method: 'POST',
      urlPath: '/secret-path',
      file: 'src/private/handler.ts',
      line: 4242,
    });
    const [{ descriptor }] = fingerprintGraph(g);
    const json = JSON.stringify(descriptor);
    expect(json).not.toContain('src/private/handler.ts');
    expect(json).not.toContain('4242');
    expect(json).not.toContain('secret-path');
  });

  it('hash is versioned and stable-shaped', () => {
    const [{ behaviorHash }] = fingerprintGraph(
      repoGraph({ method: 'GET', urlPath: '/a', file: 'a.js', line: 1, op: 'insert' }),
    );
    expect(behaviorHash).toMatch(/^bh1_[0-9a-f]{32}$/);
  });
});

describe('behavior fingerprint — determinism on a real fixture', () => {
  it('twice on the same graph → identical fingerprints (byte-stable)', () => {
    const g = graphOf('ubg-express');
    expect(JSON.stringify(fingerprintGraph(g))).toBe(JSON.stringify(fingerprintGraph(g)));
  });

  it('one fingerprint per entrypoint, sorted by id', () => {
    const g = graphOf('ubg-express');
    const prints = fingerprintGraph(g);
    const eps = g.nodes.filter((n) => n.kind === 'entrypoint').length;
    expect(prints.length).toBe(eps);
    const ids = prints.map((p) => p.entrypoint);
    expect(ids).toEqual([...ids].sort());
  });

  it('fingerprintEntrypoint matches fingerprintGraph for the same ep', () => {
    const g = graphOf('ubg-express');
    const indexed = indexGraph(g);
    const one = fingerprintEntrypoint(indexed, indexed.entrypoints[0]);
    const viaGraph = fingerprintGraph(g).find(
      (p) => p.entrypoint === indexed.entrypoints[0].id,
    );
    expect(one.behaviorHash).toBe(viaGraph.behaviorHash);
  });
});
