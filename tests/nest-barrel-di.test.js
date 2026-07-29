// nest-barrel-di.test.js — a DI hop into a workspace package must cross the barrel.
//
// A monorepo package (`@novu/dal`, `@novu/application-generic`) resolves to its entry
// file, and that entry file is a BARREL: sixty `export * from './repositories/…'` lines
// and not one class declaration. The resolver looked for a class DECLARED in the module it
// landed on, found nothing, and returned null — so every constructor-DI hop into a
// workspace package resolved to nothing at all.
//
// Measured on novu: **1479 of 2039 DI hops** died on a barrel, `PinoLogger` and the
// repository classes at the top of the list. `resolveExportedFunction` had crossed barrels
// for FUNCTIONS since the `lib/auth/index.ts` era; classes never got the twin.
//
// The reason this is a soundness bug and not a precision one is what the fixture below
// shows: a route whose ONLY behavior lives behind the barrel resolves to zero behavior,
// and a route with zero behavior has nothing to flag. `POST /orders/purge/:tenant`
// deletes every order of a tenant with no guard, and it produced NO finding, at coverage
// `unknown` (0/0) and verdict SURFACE. Blindness that reads as an empty route is the one
// shape of imprecision that pushes the verdict the unsafe way.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nest-barrel-di');

const { graph, report } = compileUBG(FIX, { write: false });
const canonical = canonicalizeGraph(graph);
const { findings } = checkGraph(canonical);
const effects = canonical.nodes.filter((n) => n.kind === 'effect');
const tables = effects.map((e) => e.meta?.table).sort();

describe('a class behind a barrel is found, exactly as a function already was', () => {
  it('one hop: the repository the controller injects resolves to its real writes', () => {
    // OrderRepository.purge does deleteMany + create. Both live two files past the
    // barrel; neither is reachable by looking only at the module the import resolved to.
    expect(tables).toContain('order');
    expect(tables).toContain('orderarchive');
  });

  it('two hops: a local service injecting a barrelled repository also crosses it', () => {
    // controller → OrdersService (local) → AuditRepository (barrelled). The barrel has to
    // be crossed at DEPTH, not only on the first hop out of the controller.
    expect(tables).toContain('auditlog');
  });

  it('the app resolves its behavior — coverage is a number, not "unknown"', () => {
    const blind = surveyBlindspots(canonical, report);
    expect(blind.coverage.unknown).toBeUndefined();
    expect(blind.coverage.resolved).toBeGreaterThan(0);
  });
});

describe('and the findings that were hiding behind it come back', () => {
  // This is the whole point. The fix is not "more coverage" — it is the two REAL findings
  // that a route resolving to zero behavior could never produce.
  const flagged = findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');

  it('an unguarded deleteMany reached through the barrel is flagged critical', () => {
    const purge = flagged.find((f) => f.entrypoint.endsWith('/orders/purge/:tenant'));
    expect(purge).toBeTruthy();
    expect(purge.severity).toBe('critical');
  });

  it('so is the one reached at depth two', () => {
    expect(flagged.some((f) => f.entrypoint.endsWith('/orders/rotate/:tenant'))).toBe(
      true,
    );
  });

  it('a route with no mutation is NOT flagged — the walk did not invent anything', () => {
    // GET /orders/:tenant crosses the same barrel into the same class and finds a read.
    // If the fix flagged it too, it would be manufacturing findings rather than finding
    // the ones that were lost.
    expect(flagged.some((f) => f.entrypoint.startsWith('entrypoint:GET'))).toBe(false);
  });

  it('the app cannot read PROVEN', () => {
    const blind = surveyBlindspots(canonical, report);
    const state = verdictState(
      verdictOf(findings, canonical, {
        coverage: blind.coverage.ratio,
        blindHigh: blind.byRisk.critical + blind.byRisk.high,
      }),
    );
    expect(state).not.toBe('PROVEN');
  });
});
