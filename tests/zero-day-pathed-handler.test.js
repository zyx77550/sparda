// zero-day-pathed-handler.test.js — C3: a callable mounted at a PATH.
//
// `app.use('/admin/wipe', handler)` is a real endpoint answering every verb at that
// path; `app.use('/api', requireAuth)` is a middleware scoping the prefix. Express
// decides which at runtime, by whether the function hands control on. SPARDA used to
// treat BOTH as middleware, so a terminal handler mounted at a path never entered the
// graph — an unauthenticated `deleteMany` was simply absent, and one clean decoy route
// carried the app to a bare PROVEN.
//
// The decision is now made from BEHAVIOUR (`callsNext`), never from the position or the
// signature: a `(req, res, next)` that never calls next IS terminal, and this says so.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-pathed-handler');

const r = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  const blind = surveyBlindspots(c, report);
  const verdict = verdictOf(findings, c, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
  });
  return {
    state: verdictState(verdict),
    eps: c.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label),
    findings,
  };
})();

// UNGUARDED_MUTATION flood-collapses on this fixture (11 routes, 10 of them unguarded),
// so read the routes out of the collapsed row's evidence as well as the per-route rows.
const unguardedRoutes = () => {
  const out = new Set();
  for (const f of r.findings) {
    if (f.rule !== 'UNGUARDED_MUTATION') continue;
    if (f.entrypoint && f.entrypoint !== '(codebase-wide)') out.add(f.entrypoint);
    for (const e of f.evidence ?? []) out.add(e);
  }
  return out;
};

describe('C3 — a terminal handler mounted at a path IS an endpoint', () => {
  it('the pathed handler becomes a route on every verb', () => {
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      expect(r.eps).toContain(`${verb} /admin/wipe`);
  });

  it('the same shape one level down (inside a mounted router) is no longer dropped', () => {
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      expect(r.eps).toContain(`${verb} /sub/purge`);
  });

  it('the hidden mass deletions flag as unguarded', () => {
    expect(unguardedRoutes()).toContain('entrypoint:POST /admin/wipe');
    expect(unguardedRoutes()).toContain('entrypoint:POST /sub/purge');
  });

  it('THE LEAK: the corpus can no longer read PROVEN', () => {
    expect(r.state).toBe('NOT_PROVEN');
  });
});

describe('C3 — a real middleware at a path is NOT turned into endpoints', () => {
  it('app.use("/api", requireAuth) creates no /api endpoint', () => {
    // requireAuth calls next() → middleware, not a terminal handler
    expect(r.eps).not.toContain('GET /api');
    expect(r.eps).not.toContain('POST /api');
  });

  it('…and it still guards the routes under its prefix', () => {
    expect(unguardedRoutes()).not.toContain('entrypoint:POST /api/notes');
  });
});
