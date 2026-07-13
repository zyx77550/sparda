// express-instance.test.js — instantiated-service resolution (Round 7, directus-class).
// The class-service Express idiom: the handler does `const svc = new ThingsService(…);
// await svc.createOne(…)` and the real DB call lives on a BASE class the service
// extends. Four hops have to work together or the app reads as SURFACE ONLY:
//   1. wrapped INLINE handler — asyncHandler(async (req, res) => {…}) in route position
//   2. `new X(…)` → class X through the import, method up the `extends` chain
//   3. `this.<m>()` re-dispatch from the instantiated class, `super.<m>()` from the base
//   4. `this.knex('t')` — the class-field knex builder — read as a real table op
// directus (239 routes) read as 0 effects without them.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-express-instance');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, report, findings, verdict: verdictOf(findings, c) };
})();

const effectsOf = (type) =>
  compiled.graph.nodes.filter((n) => n.kind === 'effect' && n.meta.effectType === type);

describe('instantiated-service resolution (new Service().method())', () => {
  it('registers both routes from wrapped inline handlers', () => {
    const eps = compiled.graph.nodes
      .filter((n) => n.kind === 'entrypoint')
      .map((n) => n.label);
    expect(eps).toContain('GET /things');
    expect(eps).toContain('POST /things');
  });

  it('resolves the read through new → inherited method → this.<m>() → this.knex(…)', () => {
    // svc.readAll (on BaseService via extends) → this.fetchAll() → this.knex('things').select
    const reads = effectsOf('db_read');
    expect(reads.some((e) => e.meta.table === 'things' && e.meta.op === 'select')).toBe(
      true,
    );
  });

  it('resolves the write through the override → super.createOne() → base insert', () => {
    const writes = effectsOf('db_write');
    expect(writes.some((e) => e.meta.table === 'things' && e.meta.op === 'insert')).toBe(
      true,
    );
    // Date.now() lives in the OVERRIDE body — proves the subclass method was scanned
    expect(effectsOf('entropy').some((e) => e.meta.target === 'time')).toBe(true);
  });

  it('is a real verdict, not SURFACE ONLY — and the unguarded write is flagged', () => {
    expect(compiled.verdict.surfaceOnly).toBe(false);
    expect(compiled.verdict.observed).toBeGreaterThan(0);
    const unguarded = compiled.findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    expect(unguarded.map((f) => f.entrypoint)).toContain('entrypoint:POST /things');
  });
});
