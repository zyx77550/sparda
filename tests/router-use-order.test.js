// router-use-order.test.js — the soundness rail on the router-level guard.
//
// Making `router.use(requireAuth)` visible at depth > 0 is a RECALL win (it removed a
// false positive on the canonical Express idiom), but recall on a GUARD is the dangerous
// direction: credit it one line too generously and you manufacture a PROVEN. Every route
// inside a mounted file shares that file's MOUNT position, so the mount rank alone cannot
// separate them — the intra-file rank (`orderIn`) does.
//
// This pins both sides on the same router: the route above the guard must still flag.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-router-use-order');

const r = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  const blind = surveyBlindspots(c, report);
  return {
    state: verdictState(
      verdictOf(findings, c, {
        coverage: blind.coverage.ratio,
        blindHigh: blind.byRisk.critical + blind.byRisk.high,
      }),
    ),
    eps: c.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label),
    unguarded: findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint),
  };
})();

describe('router.use(guard) — visible, and scoped to what follows it', () => {
  it('both routes are extracted', () => {
    expect(r.eps).toContain('POST /admin/early');
    expect(r.eps).toContain('POST /admin/late');
  });

  it('the route AFTER the guard is credited — the recall win', () => {
    expect(r.unguarded).not.toContain('entrypoint:POST /admin/late');
  });

  it('the route BEFORE the guard is NOT credited — no manufactured PROVEN', () => {
    expect(r.unguarded).toContain('entrypoint:POST /admin/early');
    expect(r.state).toBe('NOT_PROVEN');
  });
});
