// immune-observable.test.js — innate immunity for O4 (ADR-072). O4 (IRREVERSIBLE_OBSERVABLE) used
// to hard-flag EVERY observable external call on a mutating route — including a generic fetch (a
// search hitting an API, an OAuth handshake), which in the wild is almost always a read. That was a
// wolf-cry (measured: immich's only 2 hard findings were both generic fetches, blocking a fully-
// guarded app off PROVEN). The immune refinement: attack the KNOWN pathogen (a `sdk:` PAMP-catalog
// effect — payment/mail you cannot undo → HARD), TOLERATE the unfamiliar (a generic call → ADVISORY,
// surfaced not cried-wolf). It kills the false positive WITHOUT hiding a hole — the unknown call
// stays visible at honest confidence, and a real irreversible effect still hard-flags.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-immune-observable');

const o4 = (() => {
  const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  return checkGraph(c).findings.filter((f) => f.rule === 'IRREVERSIBLE_OBSERVABLE');
})();

const forEp = (frag) => o4.find((f) => f.entrypoint.includes(frag));

describe('innate immunity for O4 — attack the known, tolerate the unknown', () => {
  it('a KNOWN-dangerous effect (Stripe charge) + write stays a HARD finding (real saga risk)', () => {
    const f = forEp('/pay');
    expect(f).toBeTruthy();
    expect(f.advisory).not.toBe(true);
    expect(f.severity).toBe('high');
  });

  it('a GENERIC external call (unknown fetch) + write is ADVISORY, not a hard cry-wolf', () => {
    const f = forEp('/enrich');
    expect(f).toBeTruthy();
    expect(f.advisory).toBe(true);
    expect(f.severity).toBe('info');
  });

  it('the generic call is SURFACED, never silenced (a hole is never hidden)', () => {
    // the advisory still exists — SPARDA says "review if this is irreversible", it does not drop it
    expect(forEp('/enrich')).toBeTruthy();
  });
});
