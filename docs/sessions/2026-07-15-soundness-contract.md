# 2026-07-15 — the soundness contract (SPARDA as abstract interpretation)

**Scope:** turn the "safe-direction" invariant from folklore into a written, mechanized
contract — borrow abstract-interpretation discipline (Cousot) without any of its infra.
**Commits:** `<hash>` · **Branch:** `claude/current-task-u45a4d` · **Tests:** 593/593 green (3 skip)

## Done
- **`docs/SOUNDNESS.md`** — the contract. Names SPARDA as abstract interpretation (sound +
  total, drop complete; Rice is unbroken, we stand on Cousot 1977). States the two
  directions every analysis feature must preserve — effects OVER-approximated, guards
  UNDER-approximated — the safety theorem (imprecision ⇒ NOT_PROVEN/more findings, never
  PROVEN/fewer), the honest conditional assumptions (bounded depth = widening; unresolved
  dispatch → blindspot; Hoare-style contracts; LLM advisory-only), and a 6-point
  ship/reject checklist.
- **`tests/soundness.test.js`** (4 tests) — mechanizes both directions on the fixtures:
  no `verified` guard is `opaque`; an unguarded mutation is always flagged while its
  guarded twin is not; an unresolvable wrapper is not waved through. Any inversion → red.
- Registered in `docs/README.md` map; HANDOFF part 39; CHANGELOG 0.43.0.

## Not done / deferred
- The contract's *consumers* — the taint domain (ADR-P1) built as a real abstract
  interpretation, and the Hoare-style contracts layer in `sparda.json` — are the next
  work. SOUNDNESS.md is deliberately the socle they'll be checked against, shipped first.
- No analysis code changed this session (by design). Zero new deps, zero runtime.

## Decisions made
- Borrow the **discipline** of abstract interpretation, not the **machinery** — no SMT
  solver, no fixpoint engine on the request path (would violate hard rules 1 & 8). The
  two-clocks distinction (analysis-time vs request-time) is what makes AI native to SPARDA:
  it lives where SPARDA already thinks (compile → UBG), never on the host's live process.
- Recorded as SOUNDNESS.md itself (a first-class doc in the README map), **not** a new ADR
  — Zak's standing note on ADR ceremony. SOUNDNESS.md is the durable record.

## Bugs hit
- None. But the contract explicitly indicts the *class* of E-039: a silent assumption (a
  failed parse degrading to "no aliases" with no trace). The binding rule — "an assumption
  must be visible" — exists so that failure mode is a contract violation next time.

## Notes for the next session
- When building taint (ADR-P1): the abstract domain is `tainted | clean` on values, the
  transfer functions propagate taint through assignments/calls, `req.body`/params are the
  taint sources, a validator (zod/Pydantic) is the sink-cleaner. Check it against
  SOUNDNESS.md Direction 1 (never lose a tainted→write path) before shipping.
- The soundness test is intentionally NOT vacuous: ubg-verified-guard (JwtGuard) and
  ubg-nextjs-hoc-guard (withWorkspace) both carry `verified:true` guards, so the
  `verified ⟹ !opaque` loop actually executes. If those fixtures ever lose their verified
  guards, add another so the assertion keeps biting.
