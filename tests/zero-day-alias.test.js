// zero-day-alias.test.js — Z2: one line of aliasing erased a route.
//
// `collectAppVars` only recognised an identifier whose initialiser was literally
// `express()` / `Router()`. Express does not care what the object is called, so
// `const api = app; api.post('/admin/wipe', …)` disappeared from the graph — the
// app read PROVEN at 100% coverage with an unauthenticated mass delete in it.
// Aliases (and aliases OF aliases) are now followed to a fixpoint.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-app-alias');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  const blind = surveyBlindspots(c, report);
  return {
    graph: c,
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

describe('Z2 — app/router aliases', () => {
  it('a route registered through an alias enters the graph', () => {
    expect(eps()).toContain('POST /admin/wipe');
  });

  it('an alias OF an alias resolves too (the fixpoint)', () => {
    expect(eps()).toContain('DELETE /admin/purge');
  });

  it('router aliases work the same way, through their mount', () => {
    expect(eps()).toContain('POST /mounted/create');
  });

  it('the hidden writes flag as unguarded', () => {
    expect(unguarded()).toContain('entrypoint:POST /admin/wipe');
    expect(unguarded()).toContain('entrypoint:DELETE /admin/purge');
  });

  it('THE ZERO-DAY: the corpus can no longer read PROVEN', () => {
    expect(verdictState(compiled.verdict)).toBe('NOT_PROVEN');
  });

  it('the guarded decoy stays clean', () => {
    expect(unguarded()).not.toContain('entrypoint:POST /notes');
  });
});
