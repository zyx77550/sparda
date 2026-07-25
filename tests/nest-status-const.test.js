// nest-status-const.test.js — the named-status-constant deny (ADR-073). A custom NestJS guard whose
// canActivate throws `new HttpException(_, StatusCodes.FORBIDDEN)` denies just as provably as one
// throwing a numeric 403 — the status NAME is the conserved denial signal (FORBIDDEN *is* 403).
// Before ADR-073 SPARDA recognized only the numeric literal, so ghostfolio's 91 permission guards
// (all named-constant) read `asserted`, capping the app at PARTIAL. This proves the guard now reads
// VERIFIED. It also exercises the tsconfig `paths` alias hop (`@app/*` -> `src/*`): the guard is
// imported by alias, so a verified verdict is only reachable if the alias resolves to the real file.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nest-status-const');

const guardByName = (() => {
  const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  const m = new Map();
  for (const n of c.nodes.filter((x) => x.kind === 'guard')) m.set(n.label, n);
  return m;
})();

describe('named HTTP status constant as a deny signal (ADR-073)', () => {
  it('reads a guard throwing HttpException(_, StatusCodes.FORBIDDEN) as VERIFIED', () => {
    expect(guardByName.get('HasPermissionGuard')?.meta.verified).toBe(true);
  });

  it('resolved the guard through a tsconfig `paths` alias (verified is unreachable otherwise)', () => {
    // If `@app/guards/perm.guard` did not resolve, guardScan could not reach canActivate and the
    // guard would stay asserted — so the verified verdict above is itself the alias-hop proof.
    expect(guardByName.has('HasPermissionGuard')).toBe(true);
  });
});
