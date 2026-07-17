// medusa.test.js — the file-based routing extractor (the third pattern).
// Claims: (1) a `src/api/<path>/route.ts` file IS a route, path derived from the
// directory, `[id]` → `:id`; (2) each exported HTTP-verb const/function is a
// method; (3) the AUTHENTICATE=false convention is an INVERTED guard — guarded by
// default, opted out only by the literal false; (4) a *workflow* call is the
// effect (create*Workflow → db_write) even with no ORM call in the body; so
// (5) an unauthenticated mutation is caught as UNGUARDED_MUTATION and an
// authenticated one is not — the whole point, on real Medusa shapes.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';
import { detectStack } from '../src/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-medusa');

function compileFixture() {
  const { graph, report } = compileUBG(FIX, { write: false });
  const canonical = canonicalizeGraph(graph);
  const { findings } = checkGraph(canonical);
  return { graph: canonical, report, findings, verdict: verdictOf(findings, canonical) };
}

describe('medusa detection', () => {
  it('detects framework=medusa and the api entry dir from @medusajs deps', () => {
    const stack = detectStack(FIX);
    expect(stack.framework).toBe('medusa');
    expect(stack.entryFile).toBe('src/api');
  });

  // E-043 regression: the framework's own packages (and the corpus `packages/medusa` clone)
  // list @medusajs/framework in devDeps and `express` as a runtime dep — NO @medusajs runtime
  // dep. Detection must key off the structural signature (src/api tree of verb-exporting
  // route.ts files), not a dep, or the express dep misroutes it to a 1-route express app and
  // the corpus route count stops being reproducible out-of-the-box.
  it('detects medusa STRUCTURALLY with no @medusajs dep and express present', () => {
    const dir = path.join(here, 'fixtures', 'ubg-medusa-nodep');
    const stack = detectStack(dir);
    expect(stack.framework).toBe('medusa');
    expect(stack.entryFile).toBe('src/api');
  });
});

describe('medusa file-based routes', () => {
  it('reads a route per file/verb, with directory-derived paths and :params', () => {
    const { report, graph } = compileFixture();
    expect(report.framework).toBe('medusa');
    // GET+POST /admin/products, DELETE /admin/products/:id, POST /store/carts
    expect(report.routes).toBe(4);
    const eps = graph.nodes
      .filter((n) => n.kind === 'entrypoint')
      .map((n) => n.label)
      .sort();
    expect(eps).toContain('DELETE /admin/products/:id');
    expect(eps).toContain('GET /admin/products');
    expect(eps).toContain('POST /admin/products');
    expect(eps).toContain('POST /store/carts');
  });

  it('synthesizes a db_write from a create*Workflow call (no ORM in the body)', () => {
    const { graph } = compileFixture();
    const writes = graph.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
    );
    // createProductWorkflow, deleteProductWorkflow, createCartWorkflow
    expect(writes.length).toBeGreaterThanOrEqual(3);
    const tables = writes.map((n) => n.meta.table).sort();
    expect(tables).toContain('product');
    expect(tables).toContain('cart');
    const ops = new Set(writes.map((n) => n.meta.op));
    expect(ops.has('insert')).toBe(true);
    expect(ops.has('delete')).toBe(true);
  });

  it('AUTHENTICATE=false is an unguarded mutation — and only that route flags', () => {
    const { findings } = compileFixture();
    const unguarded = findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    expect(unguarded).toHaveLength(1);
    // the store cart is the opted-out (public) mutation; admin routes are guarded
    expect(unguarded[0].entrypoint).toContain('POST /store/carts');
  });

  it('authenticated mutations get a guard node (the default convention)', () => {
    const { graph } = compileFixture();
    const guards = graph.nodes.filter((n) => n.kind === 'guard');
    // admin/products GET+POST and admin/products/:id DELETE are guarded; the
    // store cart route (AUTHENTICATE=false) is not
    expect(guards.length).toBe(3);
    expect(guards.every((g) => /authenticate/i.test(g.label))).toBe(true);
  });

  it('the graph is provable — routes were read, verdict is real', () => {
    const { verdict } = compileFixture();
    expect(verdict.provable).toBe(true);
    expect(verdict.counts.critical).toBe(1); // the public cart mutation
  });
});
