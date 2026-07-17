// nestjs-converged.test.js — ADR-054 phase 2: DI following is one receiver kind of
// the ONE walk, so a Nest handler now also resolves what used to be Express-only
// capability: `this.<m>()` sibling dispatch inside a DI-resolved service, and an
// INSTANTIATED class used directly in a controller method. Before convergence both
// writes below were invisible (the DI path only followed `this.<prop>.<m>()`).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, 'fixtures', 'ubg-nestjs-converged');
const graphOf = () => canonicalizeGraph(compileUBG(APP, { write: false }).graph);

describe('NestJS convergence — the one walk resolves beyond DI hops', () => {
  it('follows this.<m>() sibling dispatch inside a DI-resolved service', () => {
    // POST /orders -> this.ordersService.create() -> this.persist() ->
    // this.prisma.order.create(): the write is one SIBLING hop past the DI hop.
    const g = graphOf();
    const effects = g.nodes.filter((n) => n.kind === 'effect');
    expect(effects.some((n) => n.meta.table === 'order')).toBe(true);
    const { findings } = checkGraph(g);
    expect(
      findings.filter((f) => f.rule === 'UNGUARDED_MUTATION').map((f) => f.entrypoint),
    ).toContain('entrypoint:POST /orders');
  });

  it('follows an instantiated class inside a controller method', () => {
    // POST /orders/audit -> new AuditLog().record() -> this.prisma.audit_log.create()
    const g = graphOf();
    const effects = g.nodes.filter((n) => n.kind === 'effect');
    expect(effects.some((n) => n.meta.table === 'audit_log')).toBe(true);
    const { findings } = checkGraph(g);
    expect(
      findings.filter((f) => f.rule === 'UNGUARDED_MUTATION').map((f) => f.entrypoint),
    ).toContain('entrypoint:POST /orders/audit');
  });

  it('is deterministic — same bytes across runs', () => {
    expect(JSON.stringify(graphOf())).toBe(JSON.stringify(graphOf()));
  });
});
