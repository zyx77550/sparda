// express-factory.test.js — the app built inside a setup function (Round 7 #2).
// The overwhelmingly common production shape is `export default function createApp() {
// const app = express(); …; app.use('/x', xRouter); return app; }` (directus and most
// real apps). The extractor only walked the module TOP LEVEL, so `const app = express()`
// and every mount were invisible → 0 routes / NO PROOF. Now it descends into setup
// function bodies and their control-flow blocks (an `if`-gated mount is still found),
// without ever descending into function *arguments* (route handlers stay opaque).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-express-factory');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, report, findings };
})();

const eps = () =>
  compiled.graph.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label);

describe('Express app built inside a factory function', () => {
  it('finds routes mounted inside createApp(), not just top-level', () => {
    expect(compiled.report.routes).toBe(3);
    expect(eps()).toContain('GET /things'); // app.use('/things', router) inside createApp
    expect(eps()).toContain('POST /things');
  });

  it('descends into control-flow — an if-gated mount is still found', () => {
    expect(eps()).toContain('GET /admin/stats'); // app.use('/admin', ...) inside an if
  });

  it('resolves the effect through factory → controller → ORM and flags the unguarded write', () => {
    const unguarded = compiled.findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    expect(unguarded.map((f) => f.entrypoint)).toContain('entrypoint:POST /things');
  });
});
