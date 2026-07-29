# 2026-07-26 (2) — `sparda falsify`: the proof, challenged (ADR-077)

**Scope:** Invent the instrument the proof system was missing — falsifiability as a command.
Ablate every guard in memory (graph surgery) and demand the verifier re-derive a violation on
each route whose green depended on protection. The mechanical detector of the E-022 class
(the vacuous / false PROVEN), priced at one extra checkGraph pass.
**Branch:** `claude/sparda-hq-audit-evolution-r8ml8t` · **Tests:** 838 ✓ (3 skip) · **Mutants:**
43/43 · lint/format/publish-gate clean · 4 deps.

## The measured claim

- **dub** (580 routes, 2 829 graph nodes): 169 counterfactual obligations, **169 flipped, 105 ms**.
- **ghostfolio**: 31/31, **8 ms**.
- 200 counterfactuals on two real apps, 100% falsifiable, offline, deterministic, zero recompile.

## The three precision decisions (each with a killing mutant)

1. **Contraction, never deletion** — a mid-chain guard is contracted (preds rewired to succs,
   pred's route meta carried) so the handler stays reachable; deletion would let "unreachable"
   masquerade as "clean" and mask a real hole.
2. **O1-exact obligations** — a route is an obligation iff it reaches a write in O1's own sense
   (mutation-edge effect or opaque db_write) and holds ≥1 guard. The first giant run showed 13
   false "holes" on dub that were http_call-only routes — O4's jurisdiction, not O1's.
3. **Flood-aware attribution** — the all-guards-ablated world makes UNGUARDED pervasive and
   checkGraph collapses it into one codebase-wide row; unfold its `evidence` per route. The
   very first run read score 0.000 for exactly this reason — the falsifier's development
   falsified itself first, which is the instrument working.

## Done

- `src/ubg/falsify.js` — `ablateGuards` (pure contraction), `protectedMutationRoutes`
  (O1-mirrored), `falsifyGraph` (two-world diff, injectable `check` ONLY for the blind-checker
  tests). `src/commands/falsify.js` + CLI wiring/help. Exit 1 on any hole.
- `tests/falsify.test.js` (6): healthy fixtures 100% falsifiable (THE permanent negative
  control for O1's sensitivity — any refactor that makes O1 vacuous now bites here), vacuous-1
  on read-only apps, a frozen/blind checker scores 0, flood unfolding, contraction
  reachability, purity. 3 killing mutants.
- ADR-077, HANDOFF Brick #24, CHANGELOG.

## Not done / deferred

- Falsify O7 (`where`-scope ablation) and O2 (validator ablation) — same two-world engine,
  different ablation grammar.
- Surface the falsify score in `prove`/`dossier` (kept standalone deliberately — prove's
  output shape is pinned by many tests; fold in when the next prove revision lands).
- Per-guard (not all-at-once) ablation for redundant-guard attribution — O(guards) checkGraph
  passes; measure before building.

## Bugs hit / found by the instrument

- **First run scored 0.000 on both giants** — not a checker hole: `collapseFloods` had
  aggregated all 200 per-route flips into codebase-wide rows. The per-route evidence list was
  there; the falsifier now unfolds it. (Had the checker actually been blind, the same 0.000
  would have been the alarm — the instrument cannot tell a comfortable lie.)
- 13 initial dub "holes" were falsifier-side jurisdiction errors (http_call-only routes) —
  fixed by mirroring O1's write definition exactly.

## Notes for the next session

- The two-world engine (`real vs ablated, diff the findings`) is generic: any premise the
  verdict rests on can be ablated to test the checker's sensitivity to it. This composes with
  `verify` (the compiler's own laws) as the app-level counterpart.
- Consider a `falsify --json` field in the GitHub Action / dossier once the badge story for
  "falsifiable N/N" is decided (it is a trust DISCLOSURE, like ENFORCED).

> Remember: rewrite `docs/HANDOFF.md` before committing this file.
