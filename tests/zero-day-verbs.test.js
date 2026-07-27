// zero-day-verbs.test.js — Z1: the verbs that were not modelled.
//
// `app.all(path, …)` answers EVERY verb and `app.route(path).post(…)` is the
// chainable Route API from the Express documentation. Neither was recognised, and
// the miss was SILENT (no skipped entry), so a red-team corpus with an
// unauthenticated `deleteMany` beside one clean decoy route read:
//     ✓ PROVEN · 1 route · coverage 100% · 0 blind spots · exit 0
// The fix expands `all` into the modelled verbs (what Express actually does, and
// what keeps the OpenAPI emitter and the mirror exact) and walks the whole route
// chain, so every verb it declares becomes an entrypoint.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-invisible-verbs');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  const blind = surveyBlindspots(c, report);
  return {
    graph: c,
    report,
    findings,
    verdict: verdictOf(findings, c, {
      coverage: blind.coverage.ratio,
      blindHigh: blind.byRisk.critical + blind.byRisk.high,
    }),
  };
})();

const eps = () =>
  compiled.graph.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label);
const unguarded = () =>
  compiled.findings
    .filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => f.entrypoint);

describe('Z1 — app.all() and the chainable Route API', () => {
  it('app.all() expands into every modelled verb, not one pseudo-route', () => {
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      expect(eps()).toContain(`${verb} /admin/wipe`);
  });

  it('app.route(path).post() registers the chained verb', () => {
    expect(eps()).toContain('POST /admin/promote');
  });

  it('EVERY link of a multi-verb chain is registered, not just the outermost', () => {
    expect(eps()).toContain('GET /admin/flag'); // .get(…) — an inner link
    expect(eps()).toContain('PUT /admin/flag'); // .put(…) — the outer link
  });

  it('the hidden mass-deletion now flags on each mutating verb', () => {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(unguarded()).toContain(`entrypoint:${verb} /admin/wipe`);
  });

  it('the hidden privilege escalation flags', () => {
    expect(unguarded()).toContain('entrypoint:POST /admin/promote');
  });

  it('THE ZERO-DAY: the corpus can no longer read PROVEN', () => {
    expect(verdictState(compiled.verdict)).toBe('NOT_PROVEN');
  });

  it('the clean decoy route is still clean — no collateral false positive', () => {
    expect(unguarded()).not.toContain('entrypoint:POST /notes');
  });

  it('known plumbing (set/disable/on) produced no phantom unknowns', () => {
    expect(compiled.report.unknownHandlers ?? []).toEqual([]);
  });
});
