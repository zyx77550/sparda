// nest-passport.test.js — the NestJS half of the auth-library deny catalog (ADR-069/071). A
// `@UseGuards(...)` guard built on @nestjs/passport's AuthGuard provably 401s, but its deny lives in
// node_modules (opaque), so it used to read `asserted` → capping the app at PARTIAL under the
// type-lock. The catalog reads it VERIFIED (a published fact), so a real Nest app on passport can
// reach PROVEN. Two forms verify: inline `AuthGuard('jwt')` and a plain subclass. Deny-FORM
// precision: a subclass that OVERRIDES handleRequest (may swallow the 401) stays asserted — the
// catalog abstains rather than over-verify (which would be a false PROVEN).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nest-passport');

const guardByName = (() => {
  const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  const m = new Map();
  for (const n of c.nodes.filter((x) => x.kind === 'guard')) m.set(n.label, n);
  return m;
})();

describe('NestJS @nestjs/passport auth-guard catalog', () => {
  it('marks inline @UseGuards(AuthGuard("jwt")) VERIFIED', () => {
    expect(guardByName.get('AuthGuard')?.meta.verified).toBe(true);
  });

  it('marks a plain subclass `extends AuthGuard("jwt")` VERIFIED', () => {
    expect(guardByName.get('JwtAuthGuard')?.meta.verified).toBe(true);
  });

  it('keeps a subclass that OVERRIDES handleRequest ASSERTED (may swallow the deny) — honest abstain', () => {
    const g = guardByName.get('SoftGuard');
    expect(g).toBeTruthy();
    expect(g.meta.verified).not.toBe(true);
  });
});
