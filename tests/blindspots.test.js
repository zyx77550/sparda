// blindspots.test.js — the Unknown Behavior Surface ledger + symbolic table resolution.
// SPARDA's honesty organ: it must name every place it could NOT see, ranked by what
// that blindness could hide, AND it must NOT cry blind where it genuinely saw nothing
// to see. The fixture packs one of each shape:
//   - GET/POST /items/:collection — table from the URL param → SYMBOLIC (:collection),
//     a precise rule, NOT a blind spot (the surface-reducer)
//   - POST /webhook/relay — axios to a computed URL → opaque-target (HIGH)
//   - PUT /legacy/:id — opaque imported handler → blind-mutation (HIGH)
//   - requireAuth — named guard, opaque body → unverified-guard (LOW)
//   - DELETE /ping — a mutating route SPARDA fully read (empty) → NOT flagged
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-blindspots');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  return { graph: c, survey: surveyBlindspots(c, report) };
})();

const spotsOf = (kind) => compiled.survey.spots.filter((s) => s.kind === kind);
const effects = () => compiled.graph.nodes.filter((n) => n.kind === 'effect');

describe('symbolic table resolution (:param)', () => {
  it('resolves a request-param table to a symbolic rule, not an unknown', () => {
    const dbEffects = effects().filter((e) => e.meta.effectType?.startsWith('db_'));
    // both /items/:collection routes → db op on :collection, marked symbolic
    const symbolic = dbEffects.filter((e) => e.meta.symbolic);
    expect(symbolic.length).toBeGreaterThanOrEqual(2);
    expect(symbolic.every((e) => e.meta.table === ':collection')).toBe(true);
  });

  it('a symbolic table is NOT counted as an opaque blind spot', () => {
    const opaque = spotsOf('opaque-target');
    // the only opaque target is the http call — never the symbolic db ops
    expect(opaque.every((s) => !s.label.includes('collection'))).toBe(true);
  });
});

describe('blindspot ledger', () => {
  it('flags the opaque external call as high-risk', () => {
    const opaque = spotsOf('opaque-target');
    expect(opaque).toHaveLength(1);
    expect(opaque[0].risk).toBe('high');
    expect(opaque[0].label).toContain('http');
  });

  it('flags the mutating route with an unreadable handler as blind-mutation (high)', () => {
    const blind = spotsOf('blind-mutation');
    expect(blind).toHaveLength(1);
    expect(blind[0].risk).toBe('high');
    expect(blind[0].label).toBe('PUT /legacy/:id');
  });

  it('flags the name-only guard as unverified (low)', () => {
    const g = spotsOf('unverified-guard');
    expect(g.length).toBeGreaterThanOrEqual(1);
    expect(g[0].risk).toBe('low');
  });

  it('does NOT flag a mutating route it fully read as empty (no false blindness)', () => {
    const blind = spotsOf('blind-mutation');
    expect(blind.some((s) => s.label.includes('/ping'))).toBe(false);
  });

  it('reports a coverage ratio and a stable risk-sorted surface', () => {
    const { surface, byRisk, coverage } = compiled.survey;
    expect(surface).toBe(byRisk.critical + byRisk.high + byRisk.medium + byRisk.low);
    expect(coverage.ratio).toBeGreaterThan(0);
    expect(coverage.ratio).toBeLessThanOrEqual(1);
    // sorted by risk: no lower-risk spot precedes a higher-risk one
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    const ranks = compiled.survey.spots.map((s) => rank[s.risk]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
