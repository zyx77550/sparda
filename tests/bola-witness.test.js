// bola-witness.test.js — the deterministic witness verifier for O7/BOLA (ADR-074), the checker
// half of the generate-and-check loop. Rice's theorem caps what any tool can PROVE by observation;
// the escape is the P-vs-NP asymmetry — FINDING a proof is undecidable, CHECKING a proposed one is
// cheap. A generator (the client's LLM / the code's AI author, untrusted) proposes an ownership
// witness; this deterministic verifier CHECKS it against the AST, so recall comes from the generator
// and soundness never does. Here the verified pattern is the commonest hand-rolled ownership check:
// FETCH-THEN-COMPARE — `const row = await find({where:{id}}); if (row.ownerId !== req.user.id) deny`.
// The scope lives in a value comparison + deny, not a `where` clause, so static `whereOwnerScoped`
// abstains and O7 used to false-positive on it. The verifier clears it — WITHOUT ever discharging a
// real hole, proven by three adversarial controls that must stay flagged.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bolaRoutes = (() => {
  const c = canonicalizeGraph(
    compileUBG(path.join(here, 'fixtures', 'ubg-bola-witness'), { write: false }).graph,
  );
  return new Set(
    checkGraph(c)
      .findings.filter((f) => f.rule === 'OBJECT_SCOPE_UNPROVEN')
      .map((f) => f.entrypoint.replace('entrypoint:', '')),
  );
})();

describe('deterministic ownership-witness verifier (ADR-074, O7/BOLA)', () => {
  it('DISCHARGES the fetch-then-compare-against-principal route (kills the false positive)', () => {
    // `if (row.ownerId !== req.user.id) return res.sendStatus(403)` IS a proven ownership scope.
    expect([...bolaRoutes].some((r) => r.includes('/docs'))).toBe(false);
  });

  it('KEEPS a real BOLA (fetch by id, no ownership comparison at all)', () => {
    expect([...bolaRoutes].some((r) => r.includes('/leak'))).toBe(true);
  });

  it('REJECTS a compare against ATTACKER-CONTROLLED input (req.body) — spoofable, not identity', () => {
    expect([...bolaRoutes].some((r) => r.includes('/spoof'))).toBe(true);
  });

  it('REJECTS a compare that does NOT deny (only logs) — proves nothing', () => {
    expect([...bolaRoutes].some((r) => r.includes('/nodeny'))).toBe(true);
  });
});
