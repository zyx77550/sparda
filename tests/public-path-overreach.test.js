// public-path-overreach.test.js — the `expectedPublic` softener (apocalypse.js) re-labels an
// unguarded mutation critical → info advisory when the route PATH matches a public-by-design
// signature. It carries NO evidence of a gate (unlike the credential families), so it is pure
// convention triage — and its token list contains generic VERBS (`register`, `webhook`/`hook`)
// that also name AUTHENTICATED management. A breaker pass found that `POST /account/2fa/register`
// (bind a 2FA authenticator — account takeover if open) and `POST /api/webhooks` (create a
// subscription) were both swallowed by the `register`/`callbackish` tokens: critical → info,
// advisory:true → excluded from the CI gate → the app read `safe`, even `PROVEN`.
//
// Invariant (softening only ever DOWNGRADES safely): an evidence-free path re-label must ABSTAIN in
// an authenticated namespace. It may soften a genuine public route (signup/login/health), never an
// authenticated mutation. This test pins both directions.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-public-path-overreach');

const graph = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes);
const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
const byRoute = new Map();
for (const f of checkGraph(graph).findings)
  if (f.rule === 'UNGUARDED_MUTATION') byRoute.set(label(f.entrypoint), f);

describe('public-by-design re-label must abstain in an authenticated namespace', () => {
  it('an unguarded 2FA-authenticator register route stays CRITICAL, never expectedPublic', () => {
    const f = [...byRoute].find(([l]) => /2fa\/register/.test(l))?.[1];
    expect(f).toBeTruthy(); // never silenced
    expect(f.severity).toBe('critical');
    expect(f.advisory).toBeUndefined();
    expect(f.expectedPublic).toBeUndefined();
  });

  it('an unguarded webhook-subscription create stays CRITICAL, never expectedPublic', () => {
    const f = [...byRoute].find(([l]) => /api\/webhooks/.test(l))?.[1];
    expect(f).toBeTruthy();
    expect(f.severity).toBe('critical');
    expect(f.advisory).toBeUndefined();
    expect(f.expectedPublic).toBeUndefined();
  });

  // the safe direction is preserved: a genuine public signup is STILL re-labeled to an info
  // advisory. The fix narrows WHERE the convention applies, it does not remove it.
  it('a genuine public signup is still re-labeled expectedPublic (info advisory)', () => {
    const f = [...byRoute].find(([l]) => /\/register$/.test(l) && !/2fa/.test(l))?.[1];
    expect(f).toBeTruthy();
    expect(f.severity).toBe('info');
    expect(f.expectedPublic).toBe(true);
  });

  // the whole point: the hidden holes defeated the CI gate. With the fix, an app carrying an
  // unguarded authenticated mutation is NOT `safe` and can never read PROVEN.
  it('the app is NOT safe — the CI deploy gate must block, not pass', () => {
    const verdict = verdictOf(checkGraph(graph).findings, graph, {
      coverage: 1,
      premiseBasis: 'measured',
    });
    expect(verdict.counts.critical).toBeGreaterThan(0);
    expect(verdict.safe).toBe(false);
    expect(verdict.clean).toBe(false);
  });
});
