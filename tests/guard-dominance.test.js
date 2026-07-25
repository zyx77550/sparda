// guard-dominance.test.js — a guard on a route does NOT make every mutation on it safe: the guard
// must run BEFORE the write (dominance). A handler that mutates in an early-return branch and only
// checks auth afterwards — or writes in a branch a sibling guards — bypasses its own guard. SPARDA
// used to read those as ✓ PROVEN (the C2 false PROVEN, the cardinal sin). The check is SOUND by
// construction: `bypassesGuard` is under-approximated (marked only when a guard demonstrably follows
// the write in the SAME handler body), so it can only turn a PROVEN into NOT_PROVEN — never the
// reverse — and a service's INTERNAL ordering never flags the route (measured: 0 false positives on
// dub/immich/nocodb/+6).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, buildProofObjects } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-guard-dominance');

const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
const nodes = Array.isArray(c.nodes) ? c.nodes : Object.values(c.nodes);
const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
const byRoute = new Map(
  checkGraph(c)
    .findings.filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => [label(f.entrypoint), f]),
);
const find = (re) => [...byRoute].find(([l]) => re.test(l))?.[1];

describe('guard-dominance — a guard does not cover a mutation that runs before it (C2)', () => {
  it('a mutation in an early-return branch BEFORE the guard is a guardBypass critical', () => {
    const f = find(/\/api\/bypass/);
    expect(f).toBeTruthy(); // never silenced
    expect(f.severity).toBe('critical');
    expect(f.guardBypass).toBe(true);
  });

  it('a write in a branch a SIBLING guards (guard in if, write in else) is flagged too', () => {
    const f = find(/\/api\/sibling/);
    expect(f?.guardBypass).toBe(true);
    expect(f?.severity).toBe('critical');
  });

  it('soundness: guard BEFORE the write (correct order) stays PROVEN — no finding', () => {
    expect(find(/\/api\/ordered/)).toBeUndefined();
  });

  it('soundness: guard + write in the SAME branch is NOT a false positive', () => {
    expect(find(/\/api\/nested-ok/)).toBeUndefined();
  });

  it('a proof object never claims a bypassed write as discharged', () => {
    const proofs = buildProofObjects(c);
    // sibling's only mutation is the bypass → the route must not appear as a discharged proof
    expect(proofs.some((p) => /\/api\/sibling/.test(p.route))).toBe(false);
    // the correctly-ordered route IS legitimately discharged
    expect(proofs.some((p) => /\/api\/ordered/.test(p.route))).toBe(true);
  });
});
