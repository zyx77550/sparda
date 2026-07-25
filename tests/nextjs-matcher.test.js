// tests/nextjs-matcher.test.js — a Next `config.matcher` scopes which paths a
// (denying) middleware guards. Ignoring it credits the guard on paths it never
// runs on = a FALSE PROVEN (E-NEXT-MW). These lock the two dominant forms.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matcherCovers } from '../src/ubg/nextjs.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('Next middleware matcher coverage (E-NEXT-MW soundness)', () => {
  it('positive path glob covers its subtree only', () => {
    expect(matcherCovers(['/dashboard/:path*'], '/dashboard/settings')).toBe(true);
    expect(matcherCovers(['/dashboard/:path*'], '/dashboard')).toBe(true);
    // the measured false-PROVEN case: /api is NOT under /dashboard
    expect(matcherCovers(['/dashboard/:path*'], '/api/items')).toBe(false);
  });

  it('a matcher listing /api covers /api routes', () => {
    expect(matcherCovers(['/api/:path*'], '/api/items')).toBe(true);
    expect(matcherCovers(['/settings/:path*', '/api/:path*'], '/api/items')).toBe(true);
  });

  it('negative-lookahead exclude (dub form): excluded prefixes are NOT covered', () => {
    const m = ['/((?!api/|_next/|favicon.ico).*)'];
    expect(matcherCovers(m, '/api/items')).toBe(false); // dub excludes /api
    expect(matcherCovers(m, '/dashboard')).toBe(true); // everything else covered
  });

  it('an undecidable matcher returns null so the caller abstains (never a false PROVEN)', () => {
    expect(matcherCovers(['/some/[weird]/(x|y)regex'], '/api/items')).toBe(null);
  });
});

// End-to-end: it is not enough that matcherCovers() is correct — the translator must
// actually USE it to withhold the guard. This pins the real false-PROVEN: a denying
// middleware scoped to /dashboard must NOT be credited on an unrelated /api route.
describe('E-NEXT-MW end-to-end — scoped middleware guards only what its matcher covers', () => {
  const FIX = path.join(here, 'fixtures', 'ubg-next-matcher');
  const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  const nodes = Array.isArray(c.nodes) ? c.nodes : Object.values(c.nodes);
  const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
  const unguarded = new Set(
    checkGraph(c)
      .findings.filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => label(f.entrypoint)),
  );
  const flagged = (re) => [...unguarded].some((l) => re.test(l));

  it('the /api route the matcher excludes is UNGUARDED (was a false PROVEN)', () => {
    expect(flagged(/\/api\/items/)).toBe(true);
  });

  it('the /dashboard route the matcher covers keeps the middleware guard (not flagged)', () => {
    expect(flagged(/\/dashboard/)).toBe(false);
  });
});
