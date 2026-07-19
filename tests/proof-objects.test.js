// proof-objects.test.js — the re-verifiable discharge trace (`buildProofObjects`). A proof
// object turns "trust me, it's PROVEN" into "here is the exact deny_path in the graph — trace
// it". These pin the three properties that make it a proof and not a vibe: it is deterministic
// (a law, same graph → same object), every deny_path is a REAL path of node ids present in the
// graph, and it is honest about provenance (verified vs asserted) — and it is emitted ONLY for a
// genuinely discharged obligation (a guardless mutation is a finding, never a proof).
import { describe, it, expect } from 'vitest';
import { buildProofObjects } from '../src/ubg/apocalypse.js';

// entrypoint → guard → mutation. The guard edge carries the route (a shared middleware fans out);
// the guard→effect edge is route-null (a body step), which reachOf follows for this entrypoint.
function graph({ verified = true, guarded = true } = {}) {
  const nodes = [
    { id: 'entrypoint:POST /x', kind: 'entrypoint', label: 'POST /x', meta: {} },
    {
      id: 'effect:w',
      kind: 'effect',
      label: 'insert t',
      meta: { effectType: 'db_write' },
    },
    { id: 'state:t', kind: 'state', label: 'table t', meta: { table: 't' } },
  ];
  const edges = [
    { kind: 'mutation', from: 'effect:w', to: 'state:t', meta: { op: 'insert' } },
  ];
  if (guarded) {
    nodes.push({ id: 'guard:auth', kind: 'guard', label: 'auth', meta: { verified } });
    edges.push({
      kind: 'control_flow',
      from: 'entrypoint:POST /x',
      to: 'guard:auth',
      meta: { route: 'entrypoint:POST /x' },
    });
    edges.push({ kind: 'control_flow', from: 'guard:auth', to: 'effect:w', meta: {} });
  } else {
    edges.push({
      kind: 'control_flow',
      from: 'entrypoint:POST /x',
      to: 'effect:w',
      meta: { route: 'entrypoint:POST /x' },
    });
  }
  return { nodes, edges };
}

describe('proof objects — a re-verifiable discharge trace', () => {
  it('emits a GUARDED_MUTATION proof whose deny_path is a real path in the graph', () => {
    const g = graph();
    const proofs = buildProofObjects(g);
    expect(proofs).toHaveLength(1);
    const p = proofs[0];
    expect(p.obligation).toBe('GUARDED_MUTATION');
    expect(p.route).toBe('POST /x');
    // every node id in the deny_path exists in the graph — a third party can trace it
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const id of p.discharged_by.deny_path) expect(ids.has(id)).toBe(true);
    expect(p.discharged_by.deny_path).toContain('entrypoint:POST /x');
    expect(p.discharged_by.deny_path).toContain('guard:auth');
    expect(p.discharged_by.mutations).toContain('effect:w');
  });

  it('reports provenance honestly: a verified guard is verified, a name-only guard is asserted', () => {
    expect(buildProofObjects(graph({ verified: true }))[0].discharged_by.provenance).toBe(
      'verified',
    );
    expect(
      buildProofObjects(graph({ verified: false }))[0].discharged_by.provenance,
    ).toBe('asserted');
  });

  it('emits NO proof for a guardless mutation — that is a finding, never a discharge', () => {
    expect(buildProofObjects(graph({ guarded: false }))).toHaveLength(0);
  });

  it('is deterministic — same graph produces byte-identical proofs (a verify law)', () => {
    expect(JSON.stringify(buildProofObjects(graph()))).toBe(
      JSON.stringify(buildProofObjects(graph())),
    );
  });
});
