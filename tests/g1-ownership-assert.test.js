// g1-ownership-assert.test.js — G1: a call-site ownership assertion clears the O7 BOLA advisory.
// Measured on dub (2026-07-18): ~1/3 of the 60 false OBJECT_SCOPE_UNPROVEN advisories come from
// the `getXOrThrow({ workspaceId: workspace.id, id })` pattern — the caller proves, at the call
// site, that the object it is about to mutate is scoped to its own identity, in an IMPORTED
// helper SPARDA does not expand. This is advisory-ONLY: it can never mask a hard finding or make
// a false PROVEN. These tests pin both directions (suppressed when asserted, still fires raw) and
// the soundness guard (a request-controlled value is NOT identity).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-ownership-assert');

function bolaRoutes(dir) {
  const c = canonicalizeGraph(compileUBG(dir, { write: false }).graph);
  const nodes = Array.isArray(c.nodes) ? c.nodes : Object.values(c.nodes);
  const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
  return checkGraph(c)
    .findings.filter((f) => f.rule === 'OBJECT_SCOPE_UNPROVEN')
    .map((f) => label(f.entrypoint));
}

describe('G1 — call-site ownership assertion clears the BOLA advisory', () => {
  const routes = bolaRoutes(FIX);

  it('suppresses BOLA on a route that asserts ownership at the call site', () => {
    // getThingOrThrow({ workspaceId: req.session.workspace.id, id }) proves the scope
    expect(routes.some((l) => /things\/:id/.test(l))).toBe(false);
  });

  it('still fires BOLA on a raw id access with no ownership proven', () => {
    expect(routes.some((l) => /raw\/:id/.test(l))).toBe(true);
  });

  it('soundness: a request-controlled "scope" (req.body.workspaceId) is NOT identity — BOLA fires', () => {
    expect(routes.some((l) => /spoof\/:id/.test(l))).toBe(true);
  });
});
