// verified-guard.test.js — apocalypse's next notch: prove a guard can DENY, don't just
// trust its name. SPARDA resolves a @UseGuards(X) class's canActivate and marks the guard
// VERIFIED only when it saw a real deny path (a 401/403 or an auth exception). A guard
// whose canActivate can never deny stays ASSERTED — honest either way. This is additive:
// the guarded/unguarded verdict is unchanged; only the credibility signal sharpens.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, 'fixtures', 'ubg-verified-guard');
const graphOf = () => canonicalizeGraph(compileUBG(APP, { write: false }).graph);
const guard = (g, name) => g.nodes.find((n) => n.kind === 'guard' && n.label === name);

describe('verified guards — proven able to deny, not trusted by name', () => {
  it('a canActivate that throws UnauthorizedException is VERIFIED', () => {
    expect(guard(graphOf(), 'JwtGuard').meta.verified).toBe(true);
  });

  it('a canActivate that can never deny stays ASSERTED (not verified)', () => {
    expect(guard(graphOf(), 'NoopGuard').meta.verified).toBe(false);
  });

  it('both routes are still GUARDED — verification is additive, not a gate', () => {
    const g = graphOf();
    const { findings } = checkGraph(g);
    const unguarded = findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).not.toContain('entrypoint:POST /cats/secure');
    expect(unguarded).not.toContain('entrypoint:POST /cats/weak');
  });

  it('the verdict counts verified guards (1 of 2 here)', () => {
    const g = graphOf();
    const v = verdictOf(checkGraph(g).findings, g);
    expect(v.guards).toBe(2);
    expect(v.guardsVerified).toBe(1);
  });
});
