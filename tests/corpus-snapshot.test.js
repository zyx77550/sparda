// corpus-snapshot.test.js — guards the committed corpus oracle baseline itself.
// The real drift check (scripts/corpus-oracle.mjs) needs the giant repos present and runs
// out-of-band via `npm run corpus`. This in-repo test can't compile the giants, but it CAN
// make sure the committed snapshot stays well-formed and non-empty — so an accidental
// corruption (a bad --update, a merge botch) is caught by `npm test`, not discovered later
// when someone finally runs the oracle. It also documents the metric shape the oracle pins.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
  fs.readFileSync(path.join(here, '..', 'corpus.snapshot.json'), 'utf8'),
);

const KEYS = [
  'verdict',
  'routes',
  'findings',
  'findingsByRule',
  'advisories',
  'dbWrites',
  'dbReads',
  'guards',
  'guardsVerified',
  'coverage',
  // the premise trio (ADR-083): which second opinion ran, how much of the app it
  // enumerated, and how much of that the compiler never saw
  'premiseOracle',
  'premiseProbed',
  'premiseGaps',
];
const VERDICTS = new Set([
  'PROVEN',
  'PARTIAL',
  'NOT_PROVEN',
  'SURFACE',
  'NO_PROOF',
  'RISKY',
  'PREMISE_GAP',
]);
const ORACLES = new Set([null, 'runtime', 'convention']);

describe('corpus snapshot — the committed oracle baseline is well-formed', () => {
  it('pins a non-trivial set of giants', () => {
    expect(Object.keys(snapshot).length).toBeGreaterThanOrEqual(5);
  });

  it('every app carries the full, correctly-typed metric shape', () => {
    for (const [name, m] of Object.entries(snapshot)) {
      for (const k of KEYS) expect(m, `${name}.${k}`).toHaveProperty(k);
      expect(VERDICTS.has(m.verdict), `${name}.verdict=${m.verdict}`).toBe(true);
      expect(Number.isInteger(m.findings)).toBe(true);
      expect(Number.isInteger(m.dbWrites)).toBe(true);
      expect(m.guardsVerified).toBeLessThanOrEqual(m.guards);
      // findingsByRule counts every finding (hard + advisory), so it sums to both totals
      const summed = Object.values(m.findingsByRule).reduce((a, b) => a + b, 0);
      expect(summed, `${name} findingsByRule sum`).toBe(m.findings + m.advisories);
    }
  });

  it('the premise fields are internally consistent with the verdict', () => {
    for (const [name, m] of Object.entries(snapshot)) {
      expect(ORACLES.has(m.premiseOracle), `${name}.premiseOracle`).toBe(true);
      expect(Number.isInteger(m.premiseGaps)).toBe(true);
      expect(m.premiseGaps).toBeLessThanOrEqual(m.premiseProbed);
      // an oracle that did not run cannot have found anything
      if (m.premiseOracle === null) expect(m.premiseGaps, `${name}`).toBe(0);
      // …and a recorded gap MUST have taken the verdict down. A baseline holding both a
      // gap and a PROVEN is the exact corruption this whole brick exists to prevent, so
      // it is a broken snapshot, not a curiosity.
      if (m.premiseGaps > 0) expect(m.verdict, `${name}`).toBe('PREMISE_GAP');
      if (m.verdict === 'PREMISE_GAP') expect(m.premiseGaps).toBeGreaterThan(0);
    }
  });

  it('every entry records the corpus commit it was measured on', () => {
    // Without it a drift is uninterpretable — "did SPARDA change, or did the giant land 14
    // routes?" — and an uninterpretable drift is re-baselined by reflex, which is how a
    // regression becomes the new normal.
    for (const [name, m] of Object.entries(snapshot)) {
      expect(m._pinned, `${name}._pinned`).toBeTruthy();
      expect(typeof m._pinned.commit, `${name}._pinned.commit`).toBe('string');
      expect(m._pinned.date, `${name}._pinned.date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
