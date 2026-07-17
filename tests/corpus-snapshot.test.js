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
];
const VERDICTS = new Set(['PROVEN', 'NOT_PROVEN', 'SURFACE', 'NO_PROOF', 'RISKY']);

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
});
