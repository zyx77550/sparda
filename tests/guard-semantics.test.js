// guard-semantics.test.js — a guard must actually GUARD (Round 7 #3, first cut).
// A middleware named like an auth gate but whose visible body is a pure unconditional
// `next()` pass-through guards nothing — a disabled/stubbed auth. SPARDA used to credit
// it purely on its name. Now: a visible no-op guard is downgraded (the route reads as
// unguarded), while a guard with a real deny path (throw / res.status(401) / next(err))
// is `verified`, and an opaque middleware/decorator (body unreadable) is trusted by name
// but marked `asserted` — honest either way, and with zero false-positive regression on
// real apps (immich's 253 opaque @Authenticated guards still count).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-noop-guard');

const compiled = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, findings, verdict: verdictOf(findings, c) };
})();

describe('guard semantics — a guard must be able to deny', () => {
  it('downgrades a visible no-op guard (pure next()) — its route is unguarded', () => {
    const guardLabels = compiled.graph.nodes
      .filter((n) => n.kind === 'guard')
      .map((n) => n.label);
    expect(guardLabels).toContain('realAuth'); // the real one survives
    expect(guardLabels).not.toContain('requireAuth'); // the no-op is not a guard
    const unguarded = compiled.findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    expect(unguarded.map((f) => f.entrypoint)).toEqual(['entrypoint:POST /leaky']);
  });

  it('marks a real deny-bodied guard as verified', () => {
    const real = compiled.graph.nodes.find(
      (n) => n.kind === 'guard' && n.label === 'realAuth',
    );
    expect(real.meta.verified).toBe(true);
  });

  it('exposes guard provenance in the verdict (verified vs asserted)', () => {
    expect(compiled.verdict.guards).toBe(1);
    expect(compiled.verdict.guardsVerified).toBe(1);
  });
});
