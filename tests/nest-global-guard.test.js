// nest-global-guard.test.js — most real Nest apps authenticate app-wide: a global guard
// registered via `{ provide: APP_GUARD, useClass: AuthGuard }` (immich, and the majority).
// It gates every route but is invisible to a per-method decorator scan, so its guards read
// asserted-by-name, never verified (immich: 253 guards, 0 verified). SPARDA now proves the
// global guard ONCE — resolving its canActivate THROUGH DI to a real deny (immich's
// AuthGuard delegates to `this.authService.authenticate()`, which throws) — and every
// auth-named guard on the app earns `verified`. Additive: the guarded/unguarded verdict is
// unchanged; only the credibility signal sharpens (0 → proven).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nest-global-guard');
const compiled = (() => {
  const g = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  return { g, findings: checkGraph(g).findings };
})();

describe('verified global guards — app-wide APP_GUARD proven to deny', () => {
  it('the @Authenticated guard is VERIFIED via the global guard (deny is one DI hop deep)', () => {
    const guard = compiled.g.nodes.find(
      (n) => n.kind === 'guard' && n.label === 'Authenticated',
    );
    expect(guard).toBeTruthy();
    expect(guard.meta.verified).toBe(true);
  });

  it('the guarded mutation is not flagged — verification is additive, not a gate change', () => {
    const unguarded = compiled.findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).toEqual([]);
  });
});
