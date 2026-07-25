// opaque-write.test.js — the effect-bias inversion (ADR-068, from the tri-AI research). An UNKNOWN
// method on a PROVEN persistence handle (`db.purgeEverything(...)`, db = knex(...)) used to produce
// ZERO effects → an unguarded custom write passed completely invisible (a hidden hole, the
// dangerous direction). Now it is treated as a write: it fires the guard obligation (O1) with a
// NULL table, so it never fabricates column/atomicity precision (O2/O3), only the unguarded check.
// Locks: (1) the unguarded opaque write flags; (2) the guarded one does not; (3) a READ on the same
// handle is NOT treated as a write (no flood); (4) the write is provenance-gated, never name-based.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-opaque-write');

const compiled = (() => {
  const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  return { graph: c, findings: checkGraph(c).findings };
})();

const unguarded = () =>
  compiled.findings
    .filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => f.entrypoint);

describe('opaque write on a proven persistence handle (effect-bias inversion)', () => {
  it('emits an opaque db_write (unknown method on a proven handle), null table', () => {
    const opaque = compiled.graph.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'db_write' && n.meta.opaque,
    );
    expect(opaque.length).toBeGreaterThan(0);
    for (const o of opaque) expect(o.meta.table).toBeFalsy(); // no fabricated table
  });

  it('flags the UNGUARDED opaque write (was invisible — the hidden hole)', () => {
    expect(unguarded()).toContain('entrypoint:POST /purge');
  });

  it('does NOT flag the GUARDED opaque write (the guard covers it)', () => {
    expect(unguarded()).not.toContain('entrypoint:POST /admin/purge');
  });

  it('does NOT treat a READ on the handle as a write (no flood)', () => {
    // /list does db.select(...).from(...) — a read; it must produce no unguarded-mutation finding
    expect(unguarded()).not.toContain('entrypoint:GET /list');
    const reads = compiled.findings.filter(
      (f) => f.entrypoint === 'entrypoint:GET /list',
    );
    expect(reads).toHaveLength(0);
  });

  it('is provenance-gated: O2/O3 never fire on the opaque write (null state, no invariants)', () => {
    // an opaque write carries no table → no constrained/aggregate obligations can attach to it.
    const o2o3 = compiled.findings.filter(
      (f) =>
        f.rule === 'UNVALIDATED_CONSTRAINED_WRITE' ||
        f.rule === 'NON_ATOMIC_AGGREGATE_WRITE',
    );
    expect(o2o3).toHaveLength(0);
  });
});
