// nest-forroutes-middleware.test.js — a Nest module can authenticate routes NOT with a
// `@UseGuards` decorator on the controller, but by binding middleware in its own
// `configure()` method: `consumer.apply(AuthMiddleware).forRoutes({ path, method })`. The
// controller carries no guard, so a per-method decorator scan reads the mutation as
// UNGUARDED — a false CRITICAL on a route the framework actually gates (measured on
// nestjs-realworld: 4 of 7 hard findings were this exact false positive). SPARDA now reads
// the binding from the module, proves the middleware's `use()` denies, and attaches the
// guard to every route it PROVABLY targets (ADR-089).
//
// The soundness edges this fixture pins — a mis-match here HIDES a hole (Direction 2):
//   • a proven-denying middleware makes its route PROVEN (verified), not merely asserted;
//   • a LoggerMiddleware bound via forRoutes gates NOTHING — its destructive route STILL flags;
//   • a guard bound to a different LITERAL path does not over-cover — the mismatched route
//     STILL flags (the invariant that keeps DELETE /users/:slug flagged on the real app);
//   • the method matters — a POST binding does not cover the DELETE.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nest-forroutes');
const compiled = (() => {
  const g = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  return { g, findings: checkGraph(g).findings };
})();

const unguarded = () =>
  compiled.findings
    .filter((f) => f.rule === 'UNGUARDED_MUTATION')
    .map((f) => f.entrypoint);

describe('NestJS MiddlewareConsumer.forRoutes() — auth bound in the module, not the controller', () => {
  it('the forRoutes-guarded mutation is NOT a false UNGUARDED_MUTATION', () => {
    expect(unguarded()).not.toContain('entrypoint:POST /items/:id');
  });

  it('the proven-denying middleware makes it VERIFIED (→ PROVEN), not merely asserted', () => {
    const guard = compiled.g.nodes.find(
      (n) => n.kind === 'guard' && n.label === 'AuthMiddleware',
    );
    expect(guard).toBeTruthy();
    expect(guard.meta.verified).toBe(true);
  });

  it('a LoggerMiddleware bound via forRoutes does NOT soften — the destructive DELETE still flags', () => {
    expect(unguarded()).toContain('entrypoint:DELETE /items/:id');
  });

  it('a guard bound to a different LITERAL path does not over-cover — PUT /items/publish still flags', () => {
    expect(unguarded()).toContain('entrypoint:PUT /items/publish');
  });
});
