// unbounded-write.test.js — Wave 3a (ADR-054 built the dataflow this leans on).
// UNBOUNDED_WRITE_TARGET: a db_write whose TABLE is chosen by the request (symbolic,
// e.g. the URL names the collection) with NO guard on the path. "Anyone can write to
// any table they name" — a mass-assignment-of-target escalation. Bounded HARD (E-029):
// symbolic AND unguarded. A GUARDED symbolic write (directus's per-collection
// permission layer, invisible to the static eye) is deliberately NOT flagged, so the
// rule fires zero false positives on the real corpus (every symbolic write there is
// guarded).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, 'fixtures', 'ubg-unbounded-write');
const findingsOf = () =>
  checkGraph(canonicalizeGraph(compileUBG(APP, { write: false }).graph)).findings;
const unbounded = (fs) =>
  fs.filter((f) => f.rule === 'UNBOUNDED_WRITE_TARGET').map((f) => f.entrypoint);

describe('UNBOUNDED_WRITE_TARGET — the caller chooses the table', () => {
  it('flags an unguarded write to a request-named table', () => {
    expect(unbounded(findingsOf())).toContain('entrypoint:POST /open/:collection');
  });

  it('does NOT flag a GUARDED symbolic write (the directus posture)', () => {
    expect(unbounded(findingsOf())).not.toContain('entrypoint:POST /guarded/:collection');
  });

  it('is critical severity — a real, rare, severe hole', () => {
    const f = findingsOf().find((x) => x.rule === 'UNBOUNDED_WRITE_TARGET');
    expect(f.severity).toBe('critical');
  });

  it('is deterministic across runs', () => {
    expect(JSON.stringify(findingsOf())).toBe(JSON.stringify(findingsOf()));
  });
});
