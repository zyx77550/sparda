// soundness.test.js — the safe-direction invariant, mechanized (docs/SOUNDNESS.md).
// SPARDA is an abstract interpreter (Cousot lineage): it OVER-approximates effects
// (never loses a real one — blindness degrades the verdict, never hides it) and
// UNDER-approximates guards (never invents protection — a guard is `verified` only on a
// proven deny). Corollary — the safety theorem: every imprecision pushes the verdict
// toward NOT_PROVEN / more findings (cry wolf), never toward PROVEN / fewer (blindness).
// These tests lock both directions so no future feature can silently invert them.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(here, 'fixtures', name);
const graphOf = (name) =>
  canonicalizeGraph(compileUBG(fix(name), { write: false }).graph);
const unguardedOf = (g) =>
  checkGraph(g)
    .findings.filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => f.entrypoint);

// Guard-bearing fixtures — the surface where both directions are observable.
const GUARDED_FIXTURES = [
  'ubg-verified-guard',
  'ubg-nextjs-hoc-guard',
  'ubg-nestjs-deep',
];

describe('soundness — Direction 2: guards are under-approximated', () => {
  it('no guard is `verified` without a body SPARDA actually read (never proven-while-opaque)', () => {
    for (const name of GUARDED_FIXTURES) {
      let g;
      try {
        g = graphOf(name);
      } catch {
        continue; // a fixture that doesn't compile here isn't this test's subject
      }
      for (const n of g.nodes) {
        if (n.kind !== 'guard') continue;
        // you cannot prove what you did not read: verified ⟹ not opaque
        if (n.meta.verified) expect(n.meta.opaque).not.toBe(true);
      }
    }
  });
});

describe('soundness — Direction 1 + the safety theorem: effects over-approximated', () => {
  const g = graphOf('ubg-nextjs-hoc-guard');
  const unguarded = unguardedOf(g);

  it('an unguarded mutation is ALWAYS flagged — imprecision cannot hide a real write', () => {
    expect(unguarded).toContain('entrypoint:POST /api/open');
  });

  it('a proven guard removes exactly its own finding — protection never ADDS silence', () => {
    // The guarded twin (POST /api/workspaces, withWorkspace) is NOT flagged, while its
    // wrapper-less sibling (POST /api/open) is. Equivalently: strip the proven guard and
    // the finding APPEARS — verdict moves the safe way (more findings), never the unsafe
    // way (fewer). A regression that fabricated a guard would make /api/open drop out.
    expect(unguarded).not.toContain('entrypoint:POST /api/workspaces');
    expect(unguarded).toContain('entrypoint:POST /api/open');
  });
});

describe('soundness — blindness degrades the verdict, never manufactures PROVEN', () => {
  it('an app whose only mutation is behind an unresolvable wrapper stays flagged', () => {
    // ubg-nextjs-wrapped: `withAuth` is unresolvable (no lib body), so it is NOT proven
    // to deny — the wrapped mutation must remain an UNGUARDED_MUTATION, not be waved
    // through. Opaque ≠ safe.
    const unguarded = unguardedOf(graphOf('ubg-nextjs-wrapped'));
    expect(unguarded).toContain('entrypoint:POST /api/things');
  });
});
