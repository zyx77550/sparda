// speculative.test.js — speculative verification (ADR-038).
// The load-bearing claims: (1) re-verifying an unchanged tree against its own frozen
// capsule settles EVERY route by lookup (0 novel, acceptanceRate 1) — the speedup;
// (2) a lookup verdict is EXACT — for every settled route, speculate's safe/exposed
// equals what the full prover (checkGraph) says; (3) a genuinely new shape is novel
// and correctly falls through to the prover.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import { buildCapsule } from '../src/ubg/immunity.js';
import { exposedAxes } from '../src/ubg/polarity.js';
import { speculativeVerify } from '../src/ubg/speculative.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const graphOf = (fx) =>
  canonicalizeGraph(compileUBG(path.join(here, 'fixtures', fx), { write: false }).graph);

// A one-route graph with a tunable shape, so we can introduce a NOVEL shape the
// capsule has never seen.
function routeGraph({
  method = 'GET',
  pathStr = '/a',
  guard = false,
  write = true,
} = {}) {
  const ep = `entrypoint:${method} ${pathStr}`;
  const nodes = [{ id: ep, kind: 'entrypoint', label: pathStr, loc: null, meta: {} }];
  const edges = [];
  if (write) {
    const eff = 'effect:db_write:a.js:1:0';
    const st = 'state:sql:t';
    nodes.push({
      id: eff,
      kind: 'effect',
      label: 'w',
      loc: null,
      meta: { effectType: 'db_write', op: 'update' },
    });
    nodes.push({ id: st, kind: 'state', label: 't', loc: null, meta: {} });
    edges.push({ kind: 'control_flow', from: ep, to: eff, meta: { route: ep } });
    edges.push({ kind: 'mutation', from: eff, to: st, meta: {} });
  }
  if (guard) {
    const g = 'guard:a.js#auth:1';
    nodes.push({ id: g, kind: 'guard', label: 'auth', loc: null, meta: {} });
    edges.push({ kind: 'control_flow', from: ep, to: g, meta: { route: ep } });
  }
  return { version: 'sparda-ubg/v1.2', meta: {}, nodes, edges };
}

describe('speculative verification', () => {
  for (const fx of ['demo-app-like', 'ubg-express', 'ubg-semantics']) {
    const dir = fx === 'demo-app-like' ? 'ubg-lifecycle' : fx;
    it(`unchanged tree settles every route by lookup, 0 novel (${dir})`, () => {
      const g = graphOf(dir);
      const capsule = buildCapsule(g);
      const r = speculativeVerify(capsule, g);
      expect(r.novel).toEqual([]);
      expect(r.settled).toBe(r.total);
      expect(r.acceptanceRate).toBe(1);
    });
  }

  it('a lookup verdict is EXACT — matches the full prover for every settled route', () => {
    const g = graphOf('ubg-semantics');
    const capsule = buildCapsule(g);
    const r = speculativeVerify(capsule, g);

    // ground truth: the full prover's exposure per entrypoint
    const { polarity } = checkGraph(g);
    const truthExposed = new Map(
      polarity.map((p) => [p.entrypoint, exposedAxes(p.vector).length > 0]),
    );
    for (const a of r.accepted) expect(truthExposed.get(a.entrypoint)).toBe(false);
    for (const rej of r.rejected) expect(truthExposed.get(rej.entrypoint)).toBe(true);
  });

  it('a novel shape is not in the capsule → classified novel (falls to the prover)', () => {
    // capsule knows only a guarded GET-with-write shape...
    const known = routeGraph({ method: 'GET', pathStr: '/known', guard: true });
    const capsule = buildCapsule(canonicalizeGraph(known));
    // ...candidate introduces a DELETE-unguarded-write shape it has never seen
    const candidate = canonicalizeGraph(
      routeGraph({ method: 'DELETE', pathStr: '/danger', guard: false }),
    );
    const r = speculativeVerify(capsule, candidate);
    expect(r.novel).toHaveLength(1);
    expect(r.novel[0].entrypoint).toBe('entrypoint:DELETE /danger');
    expect(r.settled).toBe(0);
    expect(r.acceptanceRate).toBe(0);
  });

  it('a known-safe shape reused at a new path is still settled for free', () => {
    const base = routeGraph({ method: 'GET', pathStr: '/a', guard: true });
    const capsule = buildCapsule(canonicalizeGraph(base));
    // same shape (GET, guarded, one write), different path → same behaviorHash
    const candidate = canonicalizeGraph(
      routeGraph({ method: 'GET', pathStr: '/b', guard: true }),
    );
    const r = speculativeVerify(capsule, candidate);
    expect(r.novel).toEqual([]);
    expect(r.settled).toBe(1);
  });

  it('is deterministic across runs', () => {
    const g = graphOf('ubg-express');
    const capsule = buildCapsule(g);
    expect(JSON.stringify(speculativeVerify(capsule, g))).toBe(
      JSON.stringify(speculativeVerify(capsule, g)),
    );
  });
});
