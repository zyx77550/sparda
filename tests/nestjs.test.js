// nestjs.test.js — the DI-framework wall-breaker (ADR-039).
// NestJS/Medusa apps used to compile to 0 routes (routes are @Get decorators, the
// real write lives in a DI'd service). These lock the fix: decorator routes are
// found, @UseGuards is a guard, and — the hard part — the effect inside a service
// reached via `this.svc.method()` is resolved through the constructor's type and
// surfaces as a real finding. Same UBG, so the whole downstream stack just works.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import { detectStack } from '../src/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NEST = path.join(here, 'fixtures', 'ubg-nestjs');
const graphOf = (dir) => canonicalizeGraph(compileUBG(dir, { write: false }).graph);

describe('NestJS ingestion — the wall comes down', () => {
  it('detects nestjs and no longer throws "not supported"', () => {
    const stack = detectStack(NEST);
    expect(stack.framework).toBe('nestjs');
  });

  it('compiles @Controller decorators to real routes (was 0)', () => {
    const g = graphOf(NEST);
    const eps = g.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.id);
    expect(eps).toContain('entrypoint:GET /cats');
    expect(eps).toContain('entrypoint:POST /cats');
    expect(eps).toContain('entrypoint:POST /cats/admin');
  });

  it('resolves DI — a write inside a service reached via this.svc surfaces as a finding', () => {
    const { findings } = checkGraph(graphOf(NEST));
    const unguarded = findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    // POST /cats -> this.catsService.create() -> CatsService.create() ->
    // this.prisma.cat.create(): an unguarded write reached through two DI hops.
    expect(unguarded.map((f) => f.entrypoint)).toContain('entrypoint:POST /cats');
  });

  it('@UseGuards makes a route guarded — the admin write is NOT flagged', () => {
    const { findings } = checkGraph(graphOf(NEST));
    const unguarded = findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).not.toContain('entrypoint:POST /cats/admin');
  });

  it('is deterministic — same bytes across runs', () => {
    expect(JSON.stringify(graphOf(NEST))).toBe(JSON.stringify(graphOf(NEST)));
  });
});

// E-034: real Nest monsters (immich, twenty) list `express` as a DIRECT dependency.
// Detection used to pick the Express branch and hard-fail hunting an express() entry
// that doesn't exist. It must fall through to the Nest check instead — and an app
// with an express dep but NO other framework marker must keep the original error.
describe('E-034 — express dep on a Nest app falls through to nestjs', () => {
  const MIXED = path.join(here, 'fixtures', 'ubg-nestjs-express-dep');

  it('detects nestjs despite the direct express dependency', () => {
    const stack = detectStack(MIXED);
    expect(stack.framework).toBe('nestjs');
  });

  it('compiles the same routes as the pure Nest fixture', () => {
    const g = graphOf(MIXED);
    const eps = g.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.id);
    expect(eps).toContain('entrypoint:GET /cats');
    expect(eps).toContain('entrypoint:POST /cats');
  });
});
