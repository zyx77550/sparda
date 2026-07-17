// flood-collapse.test.js — lateral inhibition (ADR-060). A rule that fires on a large fraction of
// routes is a codebase-wide PATTERN, not N independent findings; collapse it to ONE summary so the
// rare, sharp signals keep their contrast. The invariant that MUST hold: SOUND + verdict-neutral —
// a hard finding in the flood keeps the summary HARD (we never hide a danger), and a small app
// never collapses (a pattern needs real breadth).
import { describe, it, expect } from 'vitest';
import { collapseFloods } from '../src/ubg/apocalypse.js';

const mk = (rule, ep, severity, advisory) => ({
  rule,
  entrypoint: ep,
  severity,
  ...(advisory ? { advisory: true } : {}),
});

describe('collapseFloods — lateral inhibition', () => {
  it('collapses a pervasive rule (>=15% AND >=10 routes) into one summary', () => {
    const findings = Array.from({ length: 12 }, (_, i) =>
      mk('AGGREGATE_MEMBER_BYPASS', `ep:${i}`, 'info', true),
    );
    const out = collapseFloods(findings, 40); // 12/40 = 30%
    const summary = out.filter((f) => f.rule === 'AGGREGATE_MEMBER_BYPASS');
    expect(summary).toHaveLength(1);
    expect(summary[0].pervasive).toBe(12);
    expect(summary[0].evidence).toHaveLength(12); // nothing lost — all routes in evidence
  });

  it('a hard flood stays HARD (soundness: never hide a danger by collapsing)', () => {
    const findings = Array.from(
      { length: 20 },
      (_, i) => mk('IRREVERSIBLE_OBSERVABLE', `ep:${i}`, 'high'), // hard (no advisory)
    );
    const out = collapseFloods(findings, 40);
    expect(out).toHaveLength(1);
    expect(out[0].advisory).toBeUndefined(); // still hard → still gates the verdict
    expect(out[0].severity).toBe('high');
  });

  it('does NOT collapse below the absolute floor (a 2-route app is never "pervasive")', () => {
    const findings = [mk('UNGUARDED_MUTATION', 'ep:0', 'critical')];
    const out = collapseFloods(findings, 2); // 1/2 = 50% density but only 1 route
    expect(out).toHaveLength(1);
    expect(out[0].entrypoint).toBe('ep:0'); // untouched — keeps its per-route identity
    expect(out[0].pervasive).toBeUndefined();
  });

  it('leaves a sub-threshold rule per-route (contrast preserved for sharp signals)', () => {
    // 10 findings but only 10/100 = 10% (< 15%) → stays per-route
    const findings = Array.from({ length: 10 }, (_, i) =>
      mk('OBJECT_SCOPE_UNPROVEN', `ep:${i}`, 'info', true),
    );
    const out = collapseFloods(findings, 100);
    expect(out).toHaveLength(10);
    expect(out.every((f) => f.pervasive === undefined)).toBe(true);
  });
});
