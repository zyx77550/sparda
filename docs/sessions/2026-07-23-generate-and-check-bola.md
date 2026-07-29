# 2026-07-23 — Generate-and-check: untrusted witness + deterministic verifier (ADR-074)

**Scope:** Find the way PAST the giants' wall (not around it), grounded in real cross-domain science,
and ship the first working, honest piece. Result: the deterministic CHECKER half of a
generate-and-check loop, applied to O7/BOLA, killing the commonest ownership false positive soundly.
**Branch:** `claude/sparda-mcp-security-audit-nw3kek` · **Tests:** 795 / 3 skipped · **Mutants:** 33/33.

## The thinking (why, before the what)
- The wall is **Rice's theorem**: no tool proves semantic properties by observation. Giants (CodeQL,
  Semgrep, Snyk, Infer) live entirely on the static side → false positives OR false negatives, forever.
- The escape is the **P-vs-NP / proof-carrying-code asymmetry** (Necula–Lee 1996): finding a proof is
  undecidable; CHECKING a proposed one is cheap. Confirmed live 2024-2026 for loop invariants
  (LLM proposes → SMT checks → repair), but on toy benchmarks, with SMT, calling GPT-4 — nobody in
  APP SECURITY, nobody with our checker (UBG, no SMT), our free generator (client LLM via MCP), our
  reversible enforcer, our git memory.
- **Five domains converge** on `untrusted generator + cheap trusted verifier`: crypto (Prover/Verifier),
  immune clonal selection (random antibodies / affinity test), evolution (mutation / selection), maths
  (conjecture / proof), negative selection (random T-cells / self-test). Convergence = it's the law of
  "can't inspect everything", not a metaphor.
- SPARDA is the only one holding all three legs: **sound checker** (UBG, SAST has it), **free generator**
  (client LLM, the LLM tools have it → but they hallucinate, no checker), **reversible in-process
  enforcer** (injection, RASP has it → no proof). SAST=1 leg, RASP=1 leg, LLM-tools=1 leg, SPARDA=3.

## Done (measured, adversarial, integrated)
- **Enforcement spike (validated, not integrated):** on `ubg-typelock-asserted` (PARTIAL, guard
  asserted-only), inserting a proven-deny boundary check flips PARTIAL→PROVEN; surgical remove is
  byte-for-byte clean; a FAKE non-denying check stays PARTIAL (can't buy green). The 3rd leg works.
- **Generate-and-check spike (validated):** an untrusted generator proposing the SAME ownership claim
  for 4 routes; the deterministic verifier accepts only the genuinely safe one and rejects a real
  leak, a `req.body` spoof-compare, and a no-deny compare. Zero false discharge.
- **Integrated (shipped): the deterministic verifier `ifAssertsOwnership`** in `src/ubg/extract.js` —
  fetch-then-compare ownership (`if (row.ownerId !== req.user.id) deny`) clears O7 via the existing
  `ownerAsserted` path. Sound both ways: `valueIsIdentity` rejects `req.body`/`req.params` (spoof), and
  the branch must actually deny. Fixture `ubg-bola-witness` (1 safe cleared + 3 controls kept),
  `tests/bola-witness.test.js` (4), killing mutant (drop identity gate → spoof clears a real BOLA).
  **Measured: O7 4 → 3.** O7 is advisory, so a mis-clear can never create a false PROVEN.
- ADR-074, HANDOFF Brick #20.

## Not done / deferred (honest)
- **The LLM generator is NOT shipped.** Today's verifier recognizes ONE hand-coded pattern (inline
  fetch-then-compare). That alone is a real win, but the LLM generator — proposing witnesses for
  patterns we did not hand-code (policy `can(user,'read',doc)`, tenant-scoped clients, RLS) so the SAME
  verifier extends recall without ever risking soundness — is the recall multiplier, and the next layer.
- **Interprocedural form is V2:** the compare living in a helper (`assertOwner(id, req.user.id)`) needs
  the call-site principal-binding hop. The spike did it; the integrated version does inline only.
- **The enforcement tier is validated but not integrated** as a first-class `PROVEN-ENFORCED` verdict
  (distinct from `PROVEN-STATIC`, opt-in, reversible). That's a real chantier of its own.

## Notes for the next session
- The honest positioning to hold: SPARDA is the trust layer for AI-written code precisely because it
  is the sound CHECKER for what an (untrusted) AI proposes — the generate-and-check loop IS "AI writes,
  SPARDA proves". The verifier is the moat; the generator is commodity (anyone's LLM).
- Next measured wall to break with this method: wire an MCP-sampling generator behind `ifAssertsOwnership`
  and a small witness API, prove one non-hand-coded ownership pattern discharges via a proposed+checked
  witness while a decoy is rejected — offline test via a deterministic generator stub.
