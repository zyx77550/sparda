// conditional-surface.test.js — E-062: a registration behind a control-flow
// bifurcation (if, switch, ternary, &&) is active in only PART of the executions.
// Flattening used to erase the branch — an if-gated element read as 100% active.
// Now every conditional registration raises a HIGH-risk skipped-surface blind spot,
// which bars the PROVEN verdict (the golden rule: uncertainty breeds caution, not
// certainty) while the element itself STAYS analyzed (findings must still fire).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-conditional-surface');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  const blind = surveyBlindspots(c, report);
  const verdict = verdictOf(findings, c, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
  });
  return { graph: c, report, findings, blind, verdict };
})();

const skippedReasons = () => compiled.report.skipped.map((s) => s.reason);
const eps = () =>
  compiled.graph.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label);

describe('conditional registrations degrade certainty (E-062)', () => {
  it('an if-gated global middleware raises a conditional blind spot', () => {
    expect(
      skippedReasons().some(
        (r) => r.includes('conditional middleware') && r.includes('requireAuth'),
      ),
    ).toBe(true);
  });

  it('a switch-case route raises a conditional blind spot and STAYS analyzed', () => {
    expect(
      skippedReasons().some(
        (r) => r.includes('conditional registration') && r.includes('POST /admin/reset'),
      ),
    ).toBe(true);
    expect(eps()).toContain('POST /admin/reset');
  });

  it('ternary and short-circuit registrations are seen AND marked conditional (Y2)', () => {
    expect(eps()).toContain('GET /debug'); // flag ? app.get(…) : null
    expect(eps()).toContain('GET /metrics'); // flag && app.get(…)
    expect(
      skippedReasons().some(
        (r) => r.includes('conditional registration') && r.includes('GET /debug'),
      ),
    ).toBe(true);
    expect(
      skippedReasons().some(
        (r) => r.includes('conditional registration') && r.includes('GET /metrics'),
      ),
    ).toBe(true);
  });

  it('every conditional blind spot carries HIGH risk — it must bar PROVEN', () => {
    const conditional = compiled.report.skipped.filter((s) =>
      s.reason.startsWith('conditional'),
    );
    expect(conditional.length).toBeGreaterThanOrEqual(4);
    for (const s of conditional) expect(s.risk).toBe('high');
  });

  it('the verdict can never read a bare PROVEN over a conditional surface', () => {
    expect(verdictState(compiled.verdict)).not.toBe('PROVEN');
  });

  it('the unconditional guarded route stays clean — no fabricated finding', () => {
    const unguarded = compiled.findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).not.toContain('entrypoint:POST /notes');
  });
});
