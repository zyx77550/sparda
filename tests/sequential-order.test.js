// sequential-order.test.js — E-061: the framework reads setup top-to-bottom.
// A global app.use(auth) declared at line 50 NEVER runs for a route declared at
// line 10 — crediting it fabricated protection out of thin air (a false-PROVEN
// vector). The extractor now stamps every registration with its formal declaration
// order, and translate only credits a global middleware to routes declared AFTER
// it. Nested mounts inherit the TOP mount's position, at every depth (Y1).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-sequential-order');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, report, findings };
})();

const unguarded = () =>
  compiled.findings
    .filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => f.entrypoint);

describe('sequential declaration order (E-061)', () => {
  it('a route declared BEFORE app.use(auth) is not credited with the guard', () => {
    expect(unguarded()).toContain('entrypoint:POST /before');
  });

  it('a route declared AFTER app.use(auth) keeps the guard credit', () => {
    expect(unguarded()).not.toContain('entrypoint:POST /after');
  });

  it('a router mounted BEFORE the auth middleware is unprotected — the whole subtree', () => {
    expect(unguarded()).toContain('entrypoint:POST /pub/create');
  });

  it('a router mounted AFTER the auth middleware inherits the guard', () => {
    expect(unguarded()).not.toContain('entrypoint:POST /priv/create');
  });

  it('nested sub-routers inherit the TOP mount position, at every depth (Y1)', () => {
    // pub/sub sits under the pre-auth mount → unguarded; priv/sub under the post-auth one → guarded
    expect(unguarded()).toContain('entrypoint:POST /pub/sub/create');
    expect(unguarded()).not.toContain('entrypoint:POST /priv/sub/create');
  });

  it('all six routes are extracted — order scoping never drops surface', () => {
    const eps = compiled.graph.nodes
      .filter((n) => n.kind === 'entrypoint')
      .map((n) => n.label);
    for (const ep of [
      'POST /before',
      'POST /after',
      'POST /pub/create',
      'POST /pub/sub/create',
      'POST /priv/create',
      'POST /priv/sub/create',
    ])
      expect(eps).toContain(ep);
  });
});
