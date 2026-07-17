// verdict-partial.test.js — the PROVEN-COMPLETE vs PARTIAL line (honest packaging).
// A clean whole-app proof is PROVEN only when it resolved enough of its surface; between
// the coverage floor and the completeness bar it is PARTIAL — proved what was seen, the
// rest UNPROVEN. This is a LABEL refinement: it never masks a finding, never changes the
// CI gate (`safe`), and only ever downgrades a would-be-PROVEN app. Pins that a low-
// coverage clean app can no longer read a bare "PROVEN" (the cal.com 23% overclaim).
import { describe, it, expect } from 'vitest';
import { verdictOf } from '../src/ubg/apocalypse.js';

// minimal clean whole-app graph: one entrypoint, one provable (db_write) effect, no findings
const cleanGraph = {
  nodes: [
    { id: 'entrypoint:GET /x', kind: 'entrypoint', label: 'GET /x', meta: {} },
    {
      id: 'effect:1',
      kind: 'effect',
      meta: { effectType: 'db_write', table: 't', op: 'update' },
    },
  ],
  edges: [],
};

describe('verdict — PROVEN-COMPLETE vs PARTIAL', () => {
  it('high coverage → complete PROVEN', () => {
    const v = verdictOf([], cleanGraph, { coverage: 0.9 });
    expect(v.clean).toBe(true);
    expect(v.partial).toBe(false);
    expect(v.complete).toBe(true);
  });

  it('mid coverage (below the completeness bar) → PARTIAL, still clean & safe', () => {
    const v = verdictOf([], cleanGraph, { coverage: 0.23 });
    expect(v.clean).toBe(true); // still a proof of what was resolved
    expect(v.partial).toBe(true); // but honestly qualified
    expect(v.complete).toBe(false);
    expect(v.safe).toBe(true); // the CI gate is unchanged — a label refinement only
  });

  it('below the coverage floor → SURFACE, not clean (unchanged)', () => {
    const v = verdictOf([], cleanGraph, { coverage: 0.03 });
    expect(v.surfaceOnly).toBe(true);
    expect(v.clean).toBe(false);
    expect(v.partial).toBe(false);
  });

  it('coverage unknown (partial-app run) is never labelled partial', () => {
    const v = verdictOf([], cleanGraph, {});
    expect(v.clean).toBe(true);
    expect(v.partial).toBe(false);
    expect(v.complete).toBe(true);
  });

  it('a hard finding is never hidden behind PARTIAL — it stays NOT clean', () => {
    const v = verdictOf(
      [{ rule: 'UNGUARDED_MUTATION', severity: 'critical' }],
      cleanGraph,
      { coverage: 0.23 },
    );
    expect(v.clean).toBe(false);
    expect(v.partial).toBe(false);
  });
});
