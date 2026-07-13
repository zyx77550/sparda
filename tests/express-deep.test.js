// express-deep.test.js — deep Express (CommonJS) effect resolution.
// The Express analogue of nestjs-deep: the real DB write is two+ modules below the
// route, reached through `moduleObject.method()` calls (not `this.dep.method()`). This
// locks the four that a stock Express boilerplate needs:
//   1. module-member handlers (`thingController.create`) resolved to their body
//   2. recursive module-member calls (controller → service → model)
//   3. barrel re-exports (`const { thingService } = require('./services')`)
//   4. Mongoose effects (`Thing.create()`) + guard middleware (`auth()`)
// Without all four, express-boilerplate read as 0 effects / SURFACE ONLY.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-express-deep');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, report, findings, verdict: verdictOf(findings, c) };
})();

describe('deep Express (CommonJS) resolution', () => {
  it('resolves the Mongoose write through controller → barrel service → model', () => {
    const writes = compiled.graph.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
    );
    // thingController.create → thingService.createThing (via barrel) → Thing.create()
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes.some((w) => w.meta.table === 'thing' && w.meta.op === 'insert')).toBe(
      true,
    );
  });

  it('is NOT surface-only — real behavior was resolved', () => {
    expect(compiled.verdict.surfaceOnly).toBe(false);
    expect(compiled.verdict.observed).toBeGreaterThan(0);
  });

  it('flags only the genuinely unguarded mutation (auth() guards the other)', () => {
    const unguarded = compiled.findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    expect(unguarded).toHaveLength(1);
    expect(unguarded[0].entrypoint).toBe('entrypoint:POST /things/public');
  });
});
