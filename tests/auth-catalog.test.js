// auth-catalog.test.js — the auth-library deny catalog (ADR-069). Opaque npm auth guards
// (passport.authenticate, express-jwt) live in node_modules, so SPARDA can't read their deny
// in-repo → they used to read `asserted`, capping their apps at PARTIAL forever. The catalog is a
// VERIFIED published fact that they DENY, so the guard reads `verified` and the app can legitimately
// reach PROVEN. Locks the honesty contract: deny-FORM verifies; a custom-callback passport form
// (which does NOT auto-deny) stays asserted — the catalog abstains rather than over-verify.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-auth-catalog');

const guards = (() => {
  const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  return c.nodes.filter((n) => n.kind === 'guard');
})();

const guardAt = (line) => guards.find((g) => g.loc.line === line);

describe('auth-library deny catalog', () => {
  it('marks deny-form passport.authenticate() VERIFIED (opaque body, catalog-proven deny)', () => {
    // line 14 — passport.authenticate('jwt', { session: false }), no callback
    expect(guardAt(14)?.meta.verified).toBe(true);
  });

  it('marks an aliased express-jwt middleware VERIFIED', () => {
    // line 21 — const requireJwt = expressjwt({...}) used on /aliased
    expect(guardAt(21)?.meta.verified).toBe(true);
  });

  it('keeps a custom-callback passport.authenticate() ASSERTED (does not auto-deny) — honest abstain', () => {
    // line 27 — passport.authenticate('jwt', (e,u)=>u): the deny logic is the user callback's,
    // not passport's default 401, so the catalog must NOT verify it.
    expect(guardAt(27)?.meta.verified).not.toBe(true);
  });

  it('keeps an ALIASED custom-callback passport guard ASSERTED (deny-form check must abstain)', () => {
    // line 34 — const customAuth = passport.authenticate('jwt', (e,u)=>u): the catalog must NOT
    // verify it, or it would falsely claim a deny the callback may not perform (a false PROVEN).
    expect(guardAt(34)?.meta.verified).not.toBe(true);
  });

  it('abstains on express-jwt credentialsRequired:false — exactly the two deny-forms verify', () => {
    // an express-jwt with credentialsRequired:false lets anonymous through — it does NOT deny, so
    // the catalog must not verify it. Only the passport deny-form (l.14) and the plain express-jwt
    // (l.21) are verified; a broken precision would make optionalJwt a 3rd verified guard.
    const verified = guards.filter((g) => g.meta.verified === true);
    expect(verified.length).toBe(2);
  });
});
