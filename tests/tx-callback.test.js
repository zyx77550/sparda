// tx-callback.test.js — client-provenance through an interactive (callback) transaction.
// Audit blind spot #3: `prisma.$transaction(async (tx) => { tx.order.create(...) })` — the
// dominant Prisma idiom — hands the callback a transactional client named `tx`, which the
// /prisma|client|db/ heuristic can't recognize. Every write inside used to VANISH, so the
// handler compiled to SURFACE (blind, but honest). The client-provenance bind templates the
// receiver's db-identity onto the callback param for the scope of the transaction. This locks:
// (1) the writes reappear, (2) they share the transaction scope (atomic — no false NON_ATOMIC),
// (3) the handler is no longer surface-only.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-tx-callback');

const compiled = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, findings, verdict: verdictOf(findings, c) };
})();

describe('client-provenance: interactive (callback) transaction', () => {
  const writes = compiled.graph.nodes.filter(
    (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
  );

  it('resolves BOTH writes made through the callback `tx` client (was: SURFACE)', () => {
    const tables = writes.map((w) => w.meta.table).sort();
    expect(tables).toEqual(['order', 'user']);
  });

  it('tags both writes with the SAME transaction scope (atomic)', () => {
    const txIds = new Set(writes.map((w) => w.meta.transaction?.id ?? null));
    expect(txIds.size).toBe(1);
    expect(txIds.has(null)).toBe(false);
  });

  it('is not surface-only, and does NOT raise a false NON_ATOMIC on the atomic aggregate', () => {
    expect(compiled.verdict.surfaceOnly).toBe(false);
    expect(compiled.findings.some((f) => f.rule === 'NON_ATOMIC_AGGREGATE_WRITE')).toBe(
      false,
    );
  });
});
