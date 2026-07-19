// g2-credential-gate.test.js — G2 (guard taxonomy, families B–D/F): a public-by-design route
// whose body checks a CREDENTIAL and can refuse (stored-token lookup + throw, verify call + 4xx,
// callback + redirect-away) is not "unguarded" in the critical sense — the UNGUARDED_MUTATION
// finding is DOWNGRADED to an advisory naming the mechanism. The non-negotiable invariant: this
// only ever downgrades critical → advisory (never silences, never verifies a guard), so it can
// never hide a real finding. Measured on dub: 5 false criticals → 1 (the honest survivor).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-credential-gate');

function unguardedByRoute() {
  const c = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  const nodes = Array.isArray(c.nodes) ? c.nodes : Object.values(c.nodes);
  const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
  const map = new Map();
  for (const f of checkGraph(c).findings)
    if (f.rule === 'UNGUARDED_MUTATION') map.set(label(f.entrypoint), f);
  return map;
}

describe('G2 — credential-gated mutations downgrade to advisory, never vanish', () => {
  const byRoute = unguardedByRoute();

  it('a stored-token lookup that throws downgrades to an advisory naming the family', () => {
    const f = [...byRoute.entries()].find(([l]) => /reset-password/.test(l))?.[1];
    expect(f).toBeTruthy(); // never silenced — the finding remains
    expect(f.advisory).toBe(true);
    expect(f.severity).toBe('info');
    expect(f.credentialFamily).toMatch(/token lookup/);
  });

  it('a verify call refusing with 4xx downgrades to an advisory', () => {
    const f = [...byRoute.entries()].find(([l]) => /unsubscribe/.test(l))?.[1];
    expect(f?.advisory).toBe(true);
    expect(f?.credentialFamily).toMatch(/verification/);
  });

  it('a mutation with no credential at all stays CRITICAL', () => {
    const f = [...byRoute.entries()].find(([l]) => /naked/.test(l))?.[1];
    expect(f?.severity).toBe('critical');
    expect(f?.advisory).toBeUndefined();
  });

  it('soundness: reading a token table WITHOUT any refusal shape stays CRITICAL', () => {
    // reading is not gating — without a throw/4xx the "credential" proves nothing
    const f = [...byRoute.entries()].find(([l]) => /reads-token-no-gate/.test(l))?.[1];
    expect(f?.severity).toBe('critical');
    expect(f?.advisory).toBeUndefined();
  });

  // family A (API key), reached THROUGH THE CALL GRAPH: the apikey lookup and the refusal (a named
  // `unauthorizedResponse()` helper, not a literal 4xx) live in a delegated helper. Both the api-key
  // token family and the named-refusal shape must be seen across the call edge.
  it('an API-key lookup + named-refusal helper in a delegated body downgrades to advisory', () => {
    const f = [...byRoute.entries()].find(([l]) => /management\/me/.test(l))?.[1];
    expect(f).toBeTruthy(); // never silenced
    expect(f.advisory).toBe(true);
    expect(f.credentialFamily).toMatch(/token lookup/);
  });

  // family E (first-run / admin-setup): a bootstrap-shaped path whose refusal (throw when an admin
  // already exists) lives in a delegated service helper — the signal must survive the call graph
  // AND the thin-delegator node merge.
  it('a first-run/admin-setup route whose delegated body throws downgrades to advisory', () => {
    const f = [...byRoute.entries()].find(([l]) => /setup\/admin/.test(l))?.[1];
    expect(f).toBeTruthy();
    expect(f.advisory).toBe(true);
    expect(f.credentialFamily).toMatch(/first-run/);
  });

  // soundness: a bootstrap-shaped path is NOT a free pass. Read identity, mutate, but never refuse —
  // and it stays CRITICAL. The path family only ever narrows WHERE a real refusal shape counts.
  it('soundness: a bootstrap path with NO refusal shape stays CRITICAL', () => {
    const f = [...byRoute.entries()].find(([l]) => /setup\/import/.test(l))?.[1];
    expect(f?.severity).toBe('critical');
    expect(f?.advisory).toBeUndefined();
  });

  // Class 1 (public-by-design): a login route with no MODELED gate is re-labeled EXPECTED_PUBLIC
  // (info) — convention-based triage, NOT proof. Marked distinctly (expectedPublic, no
  // credentialFamily) so it reads as "confirm intent", never as a proven gate. Never hidden.
  it('a public-by-design login route is re-labeled expectedPublic (info), not critical', () => {
    const f = [...byRoute.entries()].find(([l]) => /auth\/login/.test(l))?.[1];
    expect(f).toBeTruthy(); // never silenced
    expect(f.severity).toBe('info');
    expect(f.expectedPublic).toBe(true);
    expect(f.credentialFamily).toBeUndefined(); // convention, not an evidenced credential family
  });

  // soundness: the public list is PRECISE, never a `/auth/**` blanket. An auth-adjacent route that
  // is NOT public by convention (change-password needs a session) must STAY critical — re-labeling
  // it would hide a real hole.
  it('soundness: an auth-adjacent but non-public route (change-password) stays CRITICAL', () => {
    const f = [...byRoute.entries()].find(([l]) => /change-password/.test(l))?.[1];
    expect(f?.severity).toBe('critical');
    expect(f?.advisory).toBeUndefined();
    expect(f?.expectedPublic).toBeUndefined();
  });
});
