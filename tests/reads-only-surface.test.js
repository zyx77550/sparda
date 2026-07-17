// reads-only-surface.test.js — a positive PROVEN must be about a MUTATION. A real stress
// test (Vendure: 312 routes, 0 writes, 26 reads) read "PROVEN" at 0% coverage — a hollow
// proof, because every obligation SPARDA discharges (guard, atomicity, reversibility) is
// about state change, and a reads-only app has none. Such an app must read SURFACE (amber,
// unprovable but not unsafe), never PROVEN. countProvable counts db_write/http_call/fs_write
// only; read-only state nodes carry no obligation and are excluded.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const verdictFor = (fixture) => {
  const { graph } = compileUBG(path.join(here, 'fixtures', fixture), { write: false });
  const c = canonicalizeGraph(graph);
  return verdictOf(checkGraph(c).findings, c);
};

describe('reads-only is SURFACE, not a hollow PROVEN', () => {
  it('a routes-with-reads-only app is SURFACE (nothing to prove safety about)', () => {
    const v = verdictFor('ubg-reads-only');
    expect(v.surfaceOnly).toBe(true);
    expect(v.clean).toBe(false); // not PROVEN
    expect(v.safe).toBe(true); // unprovable != unsafe — still exit 0
  });

  it('an app with a real write is still a genuine PROVEN', () => {
    const v = verdictFor('ubg-proven');
    expect(v.surfaceOnly).toBe(false);
    expect(v.clean).toBe(true);
  });
});

// Coverage-graded verdict: a CLEAN app that resolved almost none of its behavior
// (coverage below the floor) is SURFACE, not PROVEN — even WITH a real write. A real
// stress test found cal-api-v2 (175 routes, 1 effect, ~0% coverage) reading PROVEN.
describe('coverage-graded PROVEN — a proof about ~nothing is SURFACE', () => {
  const graphFor = (fixture) =>
    canonicalizeGraph(
      compileUBG(path.join(here, 'fixtures', fixture), { write: false }).graph,
    );

  it('a clean app below the coverage floor is SURFACE, not PROVEN', () => {
    const c = graphFor('ubg-proven'); // has a real write
    const findings = checkGraph(c).findings; // clean (none)
    const low = verdictOf(findings, c, { coverage: 0.02 });
    expect(low.surfaceOnly).toBe(true);
    expect(low.clean).toBe(false);
  });

  it('the same app at real coverage is a genuine PROVEN', () => {
    const c = graphFor('ubg-proven');
    const findings = checkGraph(c).findings;
    const ok = verdictOf(findings, c, { coverage: 0.9 });
    expect(ok.surfaceOnly).toBe(false);
    expect(ok.clean).toBe(true);
  });

  it('coverage never masks a real finding (a NOT_PROVEN stays NOT_PROVEN)', () => {
    const c = graphFor('ubg-unbounded-write'); // has critical findings
    const findings = checkGraph(c).findings;
    expect(findings.length).toBeGreaterThan(0);
    const v = verdictOf(findings, c, { coverage: 0.0 });
    expect(v.surfaceOnly).toBe(false); // low coverage must NOT hide the findings
    expect(v.clean).toBe(false);
  });
});
