// type-lock.test.js — the honesty type-lock (ADR-070). PROVEN must mean PROVEN: an app whose
// mutation is guarded ONLY by an asserted (unverified) guard is clean only because an UNPROVEN
// signal suppressed the finding, so it rests on TRUST, not PROOF → it reads PARTIAL, never PROVEN.
// Before this, guard provenance was cosmetic ("does not change the verdict") — a mutation behind an
// opaque `requireAuth` read PROVEN with guardsVerified=0 (a false PROVEN). The rule lives in ONE
// chokepoint (verdictOf) so no signal author can accidentally let an asserted guard buy PROVEN
// (E-060 was exactly that class). It only ever SOFTENS PROVEN→PARTIAL (never masks a finding, never
// touches the CI gate). A verified guard — incl. the ADR-069 auth-library catalog — keeps PROVEN.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const verdict = (fixture) => {
  const c = canonicalizeGraph(
    compileUBG(path.join(here, 'fixtures', fixture), { write: false }).graph,
  );
  return verdictOf(checkGraph(c).findings, c, { coverage: 1 });
};

describe('the honesty type-lock (PROVEN requires verified protection)', () => {
  it('an asserted-only-guarded mutation reads PARTIAL, not PROVEN (closes the false PROVEN)', () => {
    const v = verdict('ubg-typelock-asserted');
    expect(v.assertedMutations).toBe(1);
    expect(v.partial).toBe(true);
    expect(v.complete).toBe(false);
    expect(verdictState(v)).toBe('PARTIAL');
  });

  it('a VERIFIED-guarded mutation stays PROVEN (the lock never downgrades a proven app)', () => {
    const v = verdict('ubg-typelock-verified');
    expect(v.assertedMutations).toBe(0);
    expect(v.guardsVerified).toBeGreaterThan(0);
    expect(verdictState(v)).toBe('PROVEN');
  });

  it('the lock is SOUND: it only softens, it never fails the CI gate (safe) or masks a finding', () => {
    const v = verdict('ubg-typelock-asserted');
    // an asserted-guarded (but not unguarded) mutation has no critical/high finding → still `safe`
    expect(v.safe).toBe(true);
  });
});
