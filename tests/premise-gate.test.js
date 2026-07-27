// premise-gate.test.js — the PREMISE verifier.
//
// Every other honesty organ checks the PROOF and reasons over the graph, which makes
// them all blind to the same thing: a route that is not IN the graph. `falsify` cannot
// ablate the guard of a route that does not exist. Five false PROVEN verdicts were
// exactly that — absences — and no instrument could have caught them, because every
// instrument took the route surface as given.
//
// The premise is that given. It is checked here against an oracle that is NOT SPARDA:
// the app, booted, reporting the route table the framework really built.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';
import { verifyPremise, gapsAsSkipped, entrypointsAsRoutes } from '../src/ubg/premise.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-premise-gap');

const cleanGraph = {
  nodes: [
    { id: 'entrypoint:GET /x', kind: 'entrypoint', label: 'GET /x', meta: {} },
    {
      id: 'effect:1',
      kind: 'effect',
      meta: { effectType: 'db_write', table: 't', op: 'update' },
    },
  ],
  edges: [],
};

describe('the premise gate — the rule', () => {
  it('a gap forbids PROVEN outright, not merely PROVEN (PARTIAL)', () => {
    const v = verdictOf([], cleanGraph, { coverage: 1, premiseGaps: 2 });
    expect(v.premiseUnverified).toBe(true);
    expect(verdictState(v)).toBe('PREMISE_GAP');
    expect(verdictState(v)).not.toBe('PROVEN');
    expect(verdictState(v)).not.toBe('PARTIAL');
  });

  it('a gap also fails the CI gate — a green over unanalysed routes is the old sin', () => {
    expect(verdictOf([], cleanGraph, { coverage: 1, premiseGaps: 1 }).safe).toBe(false);
  });

  it('NO gaps changes nothing — the oracle can only withhold, never grant', () => {
    const v = verdictOf([], cleanGraph, { coverage: 1, premiseGaps: 0 });
    expect(verdictState(v)).toBe('PROVEN');
    expect(v.safe).toBe(true);
  });

  it('an unrun oracle is not a passed oracle — the default is silence', () => {
    // premiseGaps omitted entirely (every existing caller): prior semantics exactly
    const v = verdictOf([], cleanGraph, { coverage: 1 });
    expect(v.premiseUnverified).toBe(false);
    expect(verdictState(v)).toBe('PROVEN');
  });
});

describe('the premise gate — measured against a real booted app', () => {
  it('finds the routes no AST can reach, and only those', async () => {
    const { graph, report } = compileUBG(FIX, { write: false });
    const canonical = canonicalizeGraph(graph);

    // the static floor: the two literal registrations
    expect(
      entrypointsAsRoutes(canonical)
        .map((r) => `${r.method} ${r.path}`)
        .sort(),
    ).toEqual(['GET /health', 'POST /notes']);

    const premise = await verifyPremise(canonical, {
      framework: 'express',
      entryFile: report.entry,
      cwd: FIX,
    });

    expect(premise.available).toBe(true);
    expect(premise.probed).toBe(4); // the framework really built four
    expect(premise.gaps.map((g) => `${g.method} ${g.path}`).sort()).toEqual([
      'DELETE /admin/purge',
      'POST /admin/wipe',
    ]);
  }, 30000);

  it('end to end: the app cannot be PROVEN once its premise is measured', async () => {
    const { graph, report } = compileUBG(FIX, { write: false });
    const canonical = canonicalizeGraph(graph);
    const { findings } = checkGraph(canonical);
    const premise = await verifyPremise(canonical, {
      framework: 'express',
      entryFile: report.entry,
      cwd: FIX,
    });
    const blind = surveyBlindspots(canonical, {
      ...report,
      skipped: [...(report.skipped ?? []), ...gapsAsSkipped(premise.gaps)],
    });
    const verdict = verdictOf(findings, canonical, {
      coverage: blind.coverage.ratio,
      blindHigh: blind.byRisk.critical + blind.byRisk.high,
      premiseGaps: premise.gaps.length,
    });

    expect(verdictState(verdict)).toBe('PREMISE_GAP');
    // and the gaps entered the ordinary ledger at critical risk — one channel, no
    // special case, so they count in coverage and rank in the blind-spot map
    expect(blind.byRisk.critical).toBeGreaterThanOrEqual(2);
  }, 30000);
});

describe('the premise gate — a broken oracle never certifies', () => {
  it('an unprobeable framework reports unavailable, not verified', async () => {
    const r = await verifyPremise(cleanGraph, {
      framework: 'nestjs',
      entryFile: 'src',
      cwd: FIX,
    });
    expect(r.available).toBe(false);
    expect(r.gaps).toEqual([]);
  });

  it('a probe that returns nothing is UNAVAILABLE, never a clean bill of health', async () => {
    // an app that cannot boot yields zero probed routes; reading that as "no gaps"
    // would make a broken oracle silently CONFIRM every proof — the worst reading
    const r = await verifyPremise(cleanGraph, {
      framework: 'express',
      entryFile: 'does-not-exist.js',
      cwd: FIX,
    });
    expect(r.available).toBe(false);
  }, 30000);
});
