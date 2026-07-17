// llm-resolve.test.js — the verify-before-admit guardrail for LLM-assisted guard resolution
// (papers 2+3, docs/RESEARCH-AND-10X-IDEAS §Part 1). The cardinal invariant, mechanized: an LLM
// resolution hint can NEVER mark a guard `verified` on its own — only a hint that SPARDA's own
// structural prover confirms does. This is the exact step whose absence produced the false-PROVEN
// incidents (E-022/E-025/E-026). If a future change lets a hint through un-verified, this fails.
import { describe, it, expect } from 'vitest';
import { resolutionTargets, admitResolutionHint } from '../src/ubg/llm-resolve.js';

const guard = (over = {}) => ({
  id: 'guard:auth',
  kind: 'guard',
  meta: { verified: false },
  ...over,
});

describe('llm-resolve — resolutionTargets', () => {
  it('selects only unverified guards', () => {
    const graph = {
      nodes: [
        guard({ id: 'g1' }),
        guard({ id: 'g2', meta: { verified: true } }),
        { id: 'e1', kind: 'effect', meta: {} },
      ],
    };
    const t = resolutionTargets(graph);
    expect(t.map((n) => n.id)).toEqual(['g1']);
  });

  it('is safe on an empty/absent graph', () => {
    expect(resolutionTargets(null)).toEqual([]);
    expect(resolutionTargets({ nodes: [] })).toEqual([]);
  });
});

describe('llm-resolve — admitResolutionHint (the guardrail)', () => {
  it('a hint alone, NOT structurally confirmed, NEVER verifies the guard', () => {
    const g = guard();
    const r = admitResolutionHint(
      g,
      { file: 'auth.ts', symbol: 'AuthGuard' },
      { proveDeny: () => false },
    );
    expect(r.admitted).toBe(false);
    expect(r.reason).toBe('hint-not-structurally-confirmed');
    expect(g.meta.verified).toBe(false); // the cardinal invariant — untouched
    expect(g.meta.verifiedVia).toBeUndefined();
  });

  it('a hint SPARDA structurally confirms verifies the guard, with llm-guided provenance', () => {
    const g = guard();
    const r = admitResolutionHint(
      g,
      { file: 'auth.ts', symbol: 'AuthGuard' },
      { proveDeny: () => true },
    );
    expect(r.admitted).toBe(true);
    expect(g.meta.verified).toBe(true);
    expect(g.meta.verifiedVia).toBe('llm-guided'); // distinct provenance — never silently native
  });

  it('refuses to run without a structural prover (no proveDeny → no admit)', () => {
    const g = guard();
    const r = admitResolutionHint(g, { file: 'auth.ts' }, {});
    expect(r.admitted).toBe(false);
    expect(r.reason).toBe('no-structural-prover');
    expect(g.meta.verified).toBe(false);
  });

  it('never re-touches an already-verified guard', () => {
    const g = guard({ meta: { verified: true } });
    const r = admitResolutionHint(g, { file: 'x' }, { proveDeny: () => true });
    expect(r.admitted).toBe(false);
    expect(r.reason).toBe('already-verified');
  });

  it('a truthy-but-not-true prover result is treated as NOT confirmed (strict === true)', () => {
    const g = guard();
    // a sloppy prover returning a truthy object must not count as a proof
    admitResolutionHint(g, { file: 'x' }, { proveDeny: () => ({ maybe: 1 }) });
    expect(g.meta.verified).toBe(false);
  });
});
