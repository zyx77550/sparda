// registration-invariant.test.js — THE lock on the whole zero-day class.
//
// The red-team audit found four independent ways to earn a false PROVEN, and they
// were one defect wearing four masks: SPARDA measured what it understood, divided by
// what it understood. An extraction failure it never DECLARED entered neither the
// numerator nor the denominator, so the blinder it got, the better its coverage read.
//
// The invariant that closes the class:
//
//   A call on an app/router object is either MODELLED (a route, a mount, a
//   middleware) or DECLARED (an UnknownHandler plus a high-risk blind spot).
//   There is no silent third option.
//
// Concretely: no `continue` may leave the registration dispatch without either
// registering something or emitting an UnknownHandler. `NON_ROUTE_METHODS` is the
// only escape hatch, and putting a name in it is a deliberate, reviewable claim that
// the member cannot register a route.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractExpress } from '../src/ubg/express.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-registration-invariant');

const extracted = extractExpress(FIX, 'src/app.js');

describe('structural invariant — an unmodelled registration is never silent', () => {
  it('every unmodelled shape in the fixture yields an UnknownHandler', () => {
    // 7 shapes: options, propfind, computed verb, Reflect.apply, .call,
    // route-chain with a dynamic base, all() with a dynamic path
    expect(extracted.unknownHandlers.length).toBe(7);
    const vias = extracted.unknownHandlers.map((u) => u.via).sort();
    expect(vias).toEqual([
      'all-dynamic-path',
      'apply-call',
      'computed-method',
      'reflect-apply',
      'route-chain-dynamic-path',
      'unmodelled-member:options',
      'unmodelled-member:propfind',
    ]);
  });

  it('every UnknownHandler is paired with a HIGH-risk skipped entry', () => {
    const highSkips = extracted.skipped.filter((s) => s.risk === 'high');
    expect(highSkips.length).toBeGreaterThanOrEqual(extracted.unknownHandlers.length);
    for (const u of extracted.unknownHandlers) {
      expect(u.kind).toBe('UnknownHandler');
      expect(u.file).toMatch(/app\.js$/);
    }
  });

  it('known plumbing stays silent — no UnknownHandler for listen/set/on/param/…', () => {
    // the fixture calls set, enable, disable, engine, param, on, once, listen.
    // If any of them leaked into unknownHandlers the count above would exceed 7.
    const plumbing = extracted.unknownHandlers.filter((u) =>
      /unmodelled-member:(set|enable|disable|engine|param|on|once|listen)$/.test(u.via),
    );
    expect(plumbing).toEqual([]);
  });

  it('an UnknownHandler forbids the PROVEN verdict — uncertainty cannot read as proof', () => {
    const { graph, report } = compileUBG(FIX, { write: false });
    const canonical = canonicalizeGraph(graph);
    const { findings } = checkGraph(canonical);
    const blind = surveyBlindspots(canonical, report);
    const verdict = verdictOf(findings, canonical, {
      coverage: blind.coverage.ratio,
      blindHigh: blind.byRisk.critical + blind.byRisk.high,
    });
    expect(blind.byRisk.critical + blind.byRisk.high).toBeGreaterThan(0);
    expect(verdictState(verdict)).not.toBe('PROVEN');
  });

  it('the report carries the unknowns for tooling, not just the human log', () => {
    const { report } = compileUBG(FIX, { write: false });
    expect(report.unknownHandlers.length).toBe(7);
  });
});

// The other half of the invariant: a clean app must NOT acquire phantom unknowns.
// Without this, "declare everything" degenerates into "declare noise", and the
// blind-spot channel — the thing that makes the verdict honest — stops meaning
// anything. Every existing fixture is a de-facto witness (the suite would light up),
// so this pins the canonical clean app explicitly.
describe('structural invariant — no false unknowns on a clean app', () => {
  it('the PROVEN fixture emits zero UnknownHandlers and still reads PROVEN', () => {
    const PROVEN_FIX = path.join(here, 'fixtures', 'ubg-proven');
    const out = extractExpress(PROVEN_FIX, 'src/app.js');
    expect(out.unknownHandlers).toEqual([]);

    const { graph, report } = compileUBG(PROVEN_FIX, { write: false });
    const canonical = canonicalizeGraph(graph);
    const { findings } = checkGraph(canonical);
    const blind = surveyBlindspots(canonical, report);
    const verdict = verdictOf(findings, canonical, {
      coverage: blind.coverage.ratio,
      blindHigh: blind.byRisk.critical + blind.byRisk.high,
    });
    expect(verdictState(verdict)).toBe('PROVEN');
  });
});
