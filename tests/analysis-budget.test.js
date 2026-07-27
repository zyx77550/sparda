// analysis-budget.test.js — P3: a pathological tree (generated mega-files, endless
// mounts) must degrade to an HONEST partial result — never hang, never crash, and
// never certify. Budget exhaustion is a critical-risk skipped-surface entry, and an
// entry file whose syntax is outside the modeled grammar is a clean refusal to
// certify (NO_PROOF), not a guess.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractExpress } from '../src/ubg/express.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('analysis time budget (P3)', () => {
  it('an exhausted budget stops cleanly with a critical skipped entry — no crash', () => {
    const FIX = path.join(here, 'fixtures', 'ubg-sequential-order');
    const out = extractExpress(FIX, 'src/app.js', { budgetMs: -1 });
    const hit = out.skipped.find((s) => s.reason.includes('analysis time budget'));
    expect(hit).toBeDefined();
    expect(hit.risk).toBe('critical');
    expect(out.routes).toEqual([]); // nothing scanned — and nothing pretended
  });

  it('a budget-starved compile can never read PROVEN', () => {
    const FIX = path.join(here, 'fixtures', 'ubg-sequential-order');
    const { graph, report } = compileUBG(FIX, { write: false, budgetMs: -1 });
    const c = canonicalizeGraph(graph);
    const { findings } = checkGraph(c);
    const blind = surveyBlindspots(c, report);
    const v = verdictOf(findings, c, {
      coverage: blind.coverage.ratio,
      blindHigh: blind.byRisk.critical + blind.byRisk.high,
    });
    expect(verdictState(v)).toBe('NO_PROOF'); // zero routes reached — refusal, not a pass
  });

  it('a generous budget changes nothing — the ordinary path is untouched', () => {
    const FIX = path.join(here, 'fixtures', 'ubg-sequential-order');
    const out = extractExpress(FIX, 'src/app.js', { budgetMs: 600000 });
    expect(out.routes.length).toBe(6);
    expect(out.skipped.some((s) => s.reason.includes('analysis time budget'))).toBe(
      false,
    );
  });
});

describe('unmodeled syntax is a refusal to certify (P3)', () => {
  it('an unparseable entry file → parse error surfaced + NO_PROOF, never a crash', () => {
    const FIX = path.join(here, 'fixtures', 'ubg-broken-entry');
    const { graph, report } = compileUBG(FIX, { write: false });
    expect(report.skipped.some((s) => s.reason.includes('parse error'))).toBe(true);
    const c = canonicalizeGraph(graph);
    const { findings } = checkGraph(c);
    const v = verdictOf(findings, c, {});
    expect(verdictState(v)).toBe('NO_PROOF');
  });
});
