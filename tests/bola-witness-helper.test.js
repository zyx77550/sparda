// bola-witness-helper.test.js — the INTERPROCEDURAL half of the ownership-witness verifier
// (ADR-074 V2). The inline verifier (bola-witness.test.js) recognizes the compare+deny in the
// handler's own body; real code just as often delegates it — `assertOwner(row.ownerId,
// req.user.id)` with the compare+deny in the helper. The call-site principal-binding hop:
// arguments are classified at the call site (verified identity vs fetched value), bound to the
// helper's parameters, and the HELPER body must deny behind a compare of exactly those bound
// params. Recall needs the call site, soundness needs the helper body — neither alone clears,
// proven by three adversarial controls that must stay flagged.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bolaRoutes = (() => {
  const c = canonicalizeGraph(
    compileUBG(path.join(here, 'fixtures', 'ubg-bola-witness-helper'), { write: false })
      .graph,
  );
  return new Set(
    checkGraph(c)
      .findings.filter((f) => f.rule === 'OBJECT_SCOPE_UNPROVEN')
      .map((f) => f.entrypoint.replace('entrypoint:', '')),
  );
})();

describe('interprocedural ownership-witness verifier (ADR-074 V2, O7/BOLA)', () => {
  it('DISCHARGES the route whose compare+deny lives in a SAME-FILE helper', () => {
    // `assertOwner(row.ownerId, req.user.id)` + helper `if (owned !== callerId) throw`
    expect([...bolaRoutes].some((r) => r.includes('/docs/'))).toBe(false);
  });

  it('DISCHARGES the whole-object form through an IMPORTED helper', () => {
    // `assertOwnerOf(row, req.user)` + helper `if (row.ownerId !== user.id) throw`
    expect([...bolaRoutes].some((r) => r.includes('/docs2'))).toBe(false);
  });

  it('REJECTS a call whose "identity" is ATTACKER-CONTROLLED (req.body) — spoofable', () => {
    expect([...bolaRoutes].some((r) => r.includes('/spoof'))).toBe(true);
  });

  it('REJECTS a helper that compares but does NOT deny (only logs)', () => {
    expect([...bolaRoutes].some((r) => r.includes('/nodeny'))).toBe(true);
  });

  it('REJECTS a helper that denies WITHOUT consulting the identity-bound param', () => {
    // `assertEditable` throws on `owned !== 'unlocked'` — a deny that never reads the principal
    expect([...bolaRoutes].some((r) => r.includes('/wrongcompare'))).toBe(true);
  });
});
