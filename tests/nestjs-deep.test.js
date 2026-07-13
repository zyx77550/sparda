// nestjs-deep.test.js — deep NestJS effect resolution (the immich shape).
// Real Nest monsters hide the DB write far below the controller and behind idioms the
// first NestJS extractor couldn't follow. This locks the four that immich needed:
//   1. tsconfig baseUrl/paths imports (`src/services/x`, not `../../`)
//   2. multi-hop DI (controller → service → repository, 2 hops before the effect)
//   3. inherited DI (the repository is injected in a BaseService the service `extends`)
//   4. Kysely effects (`db.insertInto('t')`) + custom guard decorators (`@Authenticated`)
// Without all four, immich read as 1 effect / hollow PROVEN; with them, a real verdict.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nestjs-deep');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, report, findings, verdict: verdictOf(findings, c) };
})();

describe('deep NestJS resolution', () => {
  it('resolves the effect 2 DI hops down, through inheritance + tsconfig paths + Kysely', () => {
    const writes = compiled.graph.nodes.filter(
      (n) => n.kind === 'effect' && n.meta.effectType === 'db_write',
    );
    // controller → ThingService.create → (inherited) thingRepository.insert → db.insertInto('things')
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes.some((w) => w.meta.table === 'things')).toBe(true);
    expect(writes.some((w) => w.meta.op === 'insert')).toBe(true);
  });

  it('is NOT surface-only — real behavior was resolved', () => {
    expect(compiled.verdict.surfaceOnly).toBe(false);
    expect(compiled.verdict.observed).toBeGreaterThan(0);
  });

  it('recognizes a custom guard decorator (@Authenticated), so the guarded route is clean', () => {
    const guards = compiled.graph.nodes.filter((n) => n.kind === 'guard');
    expect(guards.length).toBeGreaterThanOrEqual(1);
    const flagged = compiled.findings.map((f) => f.entrypoint);
    expect(flagged).not.toContain('entrypoint:POST /things'); // @Authenticated → guarded
  });

  it('flags exactly the genuinely unguarded mutation', () => {
    const unguarded = compiled.findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    expect(unguarded).toHaveLength(1);
    expect(unguarded[0].entrypoint).toBe('entrypoint:POST /things/public');
  });
});
