// nextjs-wrapped.test.js — Next.js route handlers that aren't inline functions.
// The stress test (cal.com 3/39 routes, formbricks 12/91) exposed that the extractor
// only registered a route when the file exported an INLINE `GET`/`POST` function. Real
// Next apps wrap or alias the handler — `export const POST = withAuth(postHandler)`,
// `export const GET = handler`, `export { postHandler as POST }`. Those routes were
// silently dropped (a coverage AND honesty failure — under-reporting the surface).
// Now a route EXISTS as soon as a verb is exported; the body is resolved when possible,
// left blind otherwise.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nextjs-wrapped');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, report, findings };
})();

describe('Next.js wrapped / aliased handlers', () => {
  it('registers a route for every exported verb, inline or not', () => {
    const eps = compiled.graph.nodes
      .filter((n) => n.kind === 'entrypoint')
      .map((n) => n.label)
      .sort();
    // POST is wrapped (withAuth(postHandler)); GET is an opaque alias (factory result)
    expect(eps).toContain('POST /api/things');
    expect(eps).toContain('GET /api/health'); // registered even though its body is blind
    expect(compiled.report.routes).toBe(2);
  });

  it('resolves the wrapped handler body — the effect behind withAuth(postHandler)', () => {
    const writes = compiled.graph.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
    );
    expect(writes.some((w) => w.meta.table === 'thing')).toBe(true);
    // and the unguarded mutation is flagged on the wrapped route
    const unguarded = compiled.findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    expect(unguarded.map((f) => f.entrypoint)).toContain('entrypoint:POST /api/things');
  });
});
