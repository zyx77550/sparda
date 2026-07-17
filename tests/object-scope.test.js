// object-scope.test.js — the BOLA substrate (ADR-058 B). SPARDA now records, per query,
// whether it targets a bare `id` (`idScoped`) and whether it is scoped to the caller by an
// ownership key or a session value (`ownerScoped`). A route with an idScoped access and NO
// ownerScoped access anywhere on its resolved path is a BOLA candidate. Also pins the
// PRISMA_OPS completeness fix: `findUniqueOrThrow` was unrecognized, so SPARDA missed the
// very reads where the ownership-scoping fetch lives (and missed writes like
// createManyAndReturn — a Direction-1 blind spot, now closed).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { indexGraph, reachOf, checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-object-scope');
const canon = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
const g = indexGraph(canon);
const findings = checkGraph(canon).findings;

// reachable effects of a route, using apocalypse's own per-route (leak-free) reachability
const effectsOf = (label) => {
  const ep = g.entrypoints.find((n) => n.label === label);
  return [...reachOf(ep.id, g.cfOut)]
    .map((id) => g.nodes.get(id))
    .filter((n) => n?.kind === 'effect');
};
const isBola = (label) => {
  const eff = effectsOf(label);
  return eff.some((n) => n.meta.idScoped) && !eff.some((n) => n.meta.ownerScoped);
};

describe('object-scope provenance — the BOLA substrate', () => {
  it('findUniqueOrThrow is recognized as a read (the ownership-scoping fetch is visible)', () => {
    const reads = g.entrypoints.length
      ? [...g.nodes.values()].filter(
          (n) => n.kind === 'effect' && n.meta.effectType === 'db_read',
        )
      : [];
    expect(reads.some((n) => n.meta.table === 'thing')).toBe(true);
  });

  it('a query filtered by the caller (userId / session) is ownerScoped → NOT a BOLA', () => {
    expect(isBola('DELETE /things/:id')).toBe(false);
  });

  it('a query by bare id with no ownership predicate anywhere on the path IS a BOLA shape', () => {
    expect(isBola('DELETE /widgets/:id')).toBe(true);
  });

  it('the unscoped route gets an OBJECT_SCOPE_UNPROVEN advisory; the scoped one does not', () => {
    const bola = findings.filter((f) => f.rule === 'OBJECT_SCOPE_UNPROVEN');
    const eps = bola.map((f) => f.entrypoint);
    expect(eps).toContain('entrypoint:DELETE /widgets/:id');
    expect(eps).not.toContain('entrypoint:DELETE /things/:id');
  });

  it('BOLA is ADVISORY — it never gates the verdict (advisory:true, info)', () => {
    const bola = findings.find((f) => f.rule === 'OBJECT_SCOPE_UNPROVEN');
    expect(bola.advisory).toBe(true);
    expect(bola.severity).toBe('info');
    // the app has ONLY an advisory finding → its safe/clean gates ignore it
    const v = verdictOf(findings, canon, { coverage: 1 });
    expect(v.safe).toBe(true); // no critical/high — the advisory doesn't fail the CI gate
  });
});
