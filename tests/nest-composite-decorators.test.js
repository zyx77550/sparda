// nest-composite-decorators.test.js — `applyDecorators(UseGuards(X))` (ADR-084).
//
// NestJS's OFFICIAL composition API, and the single biggest blind spot measured on real
// enterprise code. A house decorator is declared once and applied everywhere:
//
//   export function RequireAuthentication() {
//     return applyDecorators(UseGuards(CommunityUserAuthGuard), ApiBearerAuth(…));
//   }
//
// SPARDA matched `@RequireAuthentication` on its NAME and stopped: the symbol resolves to
// a FUNCTION, and guard resolution only knew how to open a CLASS. So 340 novu routes —
// every one gated by a guard that provably 401s — read `asserted`: trusted because of what
// they are called, which is the exact epistemic failure this product exists to remove.
//
// Reading the definition settles the OPPOSITE error in the same pass. `RequirePermissions`
// is `SetMetadata(...)` — a tag some guard reads elsewhere, gating nothing on its own —
// and its name matched the same regex. 221 more novu routes carried protection that was
// never there.
//
// The two are one defect: judging a decorator by its name instead of its definition
// (E-060). One resolution fixes both, in opposite directions.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractNest } from '../src/ubg/nestjs.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(here, 'fixtures', n);
const FIX = fx('ubg-nest-composite-guard');

const out = extractNest(FIX, 'src');
const routeOf = (m, p) => out.routes.find((r) => r.method === m && r.path === p);
const stepsOf = (r) => (r?.chain ?? []).filter((c) => c.role === 'middleware');
const proven = (s) => Boolean(s.scan?.guardSignals?.deniesWithStatus);

describe('composite decorators resolve to the guards they apply', () => {
  it('`applyDecorators(UseGuards(X))` credits X, and X is PROVEN — not asserted', () => {
    const steps = stepsOf(routeOf('post', '/orders'));
    // the chain names the GUARD, not the decorator: the decorator is a wrapper, the guard
    // is the thing that denies
    expect(steps.map((s) => s.name)).toEqual(['SessionAuthGuard']);
    expect(steps.map(proven)).toEqual([true]);
  });

  it('the constituent resolves against the module that DECLARED the composite', () => {
    // The controller imports `RequireAuthentication`; only `auth.decorator.ts` imports
    // `SessionAuthGuard`. Resolving the constituent against the CONTROLLER's import map
    // finds nothing — the expansion then renames the step without proving anything, which
    // is how the first version of this feature produced 340 guards and 0 proofs.
    const step = stepsOf(routeOf('post', '/orders'))[0];
    expect(step.scan?.guardSignals?.deniesWithStatus).toBe(true);
  });
});

describe('a branch SPARDA cannot read is credited AND declared', () => {
  it('the readable branch still credits its guard', () => {
    const steps = stepsOf(routeOf('delete', '/orders/:id'));
    expect(steps.map((s) => s.name)).toEqual(['SessionAuthGuard']);
    expect(steps.map(proven)).toEqual([true]);
  });

  it('and the unread branch is declared at HIGH risk', () => {
    // Crediting the branch we read is a true statement about THAT configuration. The
    // sibling we could not open is a configuration we are not entitled to claim, so it
    // must cost the app its ability to read PROVEN.
    const decl = out.skipped.find((s) => /RequireAuthenticationEE/.test(s.reason));
    expect(decl).toBeTruthy();
    expect(decl.risk).toBe('high');
    expect(decl.reason).toMatch(/EERequire\(\)/); // the unread branch is NAMED
  });

  it('so the app cannot read PROVEN', () => {
    const { graph, report } = compileUBG(FIX, { write: false });
    const canonical = canonicalizeGraph(graph);
    const { findings } = checkGraph(canonical);
    const blind = surveyBlindspots(canonical, report);
    const blindHigh = blind.byRisk.critical + blind.byRisk.high;
    expect(blindHigh).toBeGreaterThan(0);
    expect(
      verdictState(
        verdictOf(findings, canonical, { coverage: blind.coverage.ratio, blindHigh }),
      ),
    ).not.toBe('PROVEN');
  });
});

describe('a SetMetadata tag is not a guard', () => {
  it('a metadata-only decorator stops counting as protection', () => {
    // `@RequirePermissions('orders:write')` matches the auth-ish name regex but calls only
    // SetMetadata. Some guard must read that key to gate anything; this app registers
    // none, so the route is not protected by anything SPARDA can see.
    expect(stepsOf(routeOf('post', '/orders/archive'))).toEqual([]);
  });

  it('and the drop is recorded, so the ledger says WHY the name stopped counting', () => {
    const decl = out.skipped.find((s) => /RequirePermissions/.test(s.reason));
    expect(decl).toBeTruthy();
    expect(decl.risk).toBe('low'); // a resolved fact, not a blind spot
    expect(decl.reason).toMatch(/metadata tag, not protection/);
  });

  it('removing invented protection can only ADD findings, never hide one', () => {
    // SOUNDNESS Direction 2, in the safe direction: the archive route mutates with no
    // guard SPARDA can see, and now says so.
    const { graph } = compileUBG(FIX, { write: false });
    const { findings } = checkGraph(canonicalizeGraph(graph));
    expect(
      findings.some(
        (f) => /archive/.test(f.entrypoint) && f.rule === 'UNGUARDED_MUTATION',
      ),
    ).toBe(true);
  });
});

// The other half, and the one that nearly shipped broken. `@Authenticated = () =>
// applyDecorators(SetMetadata('authRoute', true))` is immich's ENTIRE auth model: the tag
// is the route's opt-in to an app-wide guard that reads it. A blanket "SetMetadata is not
// a guard" rule deletes 253 verified guards and invents 253 unguarded routes.
describe('a metadata tag IS protection when a global guard reads it', () => {
  it('the global-guard fixture keeps its verified guard', () => {
    const g = extractNest(fx('ubg-nest-global-guard'), 'src');
    const steps = (g.routes[0]?.chain ?? []).filter((c) => c.role === 'middleware');
    expect(steps.map((s) => s.name)).toEqual(['Authenticated']);
    expect(steps.map(proven)).toEqual([true]);
  });

  it('and no drop is declared for it', () => {
    const g = extractNest(fx('ubg-nest-global-guard'), 'src');
    expect(g.skipped.filter((s) => /metadata tag/.test(s.reason))).toEqual([]);
  });
});
