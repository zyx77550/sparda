// coverage-unknown.test.js — E-064 (X4): 0 behaviors resolved out of 0 seen is the
// ABSENCE of a measurement, not a perfect score. The ratio is null ("unknown"),
// every display surface says the word, and the verdict layer treats measured-but-
// unknown coverage as a state that can never carry a complete PROVEN. The golden
// rule: absence of proof is never proof.
import { describe, it, expect } from 'vitest';
import { surveyBlindspots, coveragePct } from '../src/ubg/blindspots.js';
import { verdictOf, badgeFor } from '../src/ubg/apocalypse.js';

// a graph with surface but ZERO resolvable behavior and zero blind spots — the 0/0 case
const emptyBehaviorGraph = {
  nodes: [{ id: 'entrypoint:GET /x', kind: 'entrypoint', label: 'GET /x', meta: {} }],
  edges: [],
};

// a clean graph with one provable write — used to isolate the verdict-layer rule
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

describe('0/0 coverage is Unknown, never 100% (E-064)', () => {
  it('surveyBlindspots: denom 0 → ratio null + unknown flag', () => {
    const { coverage } = surveyBlindspots(emptyBehaviorGraph, { skipped: [] });
    expect(coverage.resolved).toBe(0);
    expect(coverage.blind).toBe(0);
    expect(coverage.ratio).toBeNull();
    expect(coverage.unknown).toBe(true);
  });

  it('a measured denominator still yields a real ratio', () => {
    const { coverage } = surveyBlindspots(cleanGraph, { skipped: [] });
    expect(coverage.ratio).toBe(1);
    expect(coverage.unknown).toBeUndefined();
  });

  it('verdictOf: coverage null (measured-but-unknown) bars complete PROVEN', () => {
    const v = verdictOf([], cleanGraph, { coverage: null });
    expect(v.coverageUnknown).toBe(true);
    expect(v.clean).toBe(true); // nothing found wrong in what WAS seen
    expect(v.partial).toBe(true); // …but the claim is qualified
    expect(v.complete).toBe(false); // never a bare PROVEN on an unknown measurement
  });

  it('verdictOf: coverage undefined (not measured, e.g. heal delta) keeps old semantics', () => {
    const v = verdictOf([], cleanGraph, {});
    expect(v.coverageUnknown).toBe(false);
    expect(v.complete).toBe(true);
  });

  it('coveragePct says the word, never coerces null to a number', () => {
    expect(coveragePct(null)).toBe('unknown');
    expect(coveragePct(undefined)).toBe('unknown');
    expect(coveragePct(0.42)).toBe('42%');
    expect(coveragePct(0)).toBe('0%'); // a real zero is a real (bad) measurement
  });

  it('the badge carries the word too — no "null%" ever ships', () => {
    const v = verdictOf([], cleanGraph, { coverage: null });
    const { message } = badgeFor(v, { coverage: null });
    expect(message).toContain('unknown');
    expect(message).not.toContain('null');
  });
});
