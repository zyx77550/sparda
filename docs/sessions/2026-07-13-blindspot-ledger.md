# 2026-07-13 — The honesty organ: SPARDA measures its own blindness (0.29.0)

**Scope:** Zak shared Reyna Provocateur (his closed-loop fuzzer with a measurable Unknown
Behavior Surface) and said: if there's gold, take it and build it. There was. Built the real
SPARDA version + the symbolic `:collection` resolution promised earlier.
**Commits:** this one · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 543/543 (3 skipped)

## Done
- **Blindspot ledger (ADR-049, E-032).** `src/ubg/blindspots.js` → `surveyBlindspots(graph,
  report)`: opaque-target / blind-mutation / unverified-guard / skipped-surface, ranked by what
  each could hide, + a coverage ratio. Command `sparda blindspots` (exit 1 on high+), honesty
  line under every `apocalypse` verdict, "Where the proof stops" dossier section. Derived from
  the REAL graph + skip log — no hand-authored regions. Fixture `ubg-blindspots` + 7 tests.
- **Symbolic table resolution (ADR-050).** `collectReqDerived`/`reqParamName` in extract.js;
  knex/supabase/kysely readers fall back to `:param` when the table isn't a literal, emitting
  `symbolic: true`. Excluded from opaque-target. Proven on the fixture.
- **`meta.opaque`** on handler/logic nodes (translate.js) when fn:null with no scan — the signal
  that lets blind-mutation tell "couldn't read" from "read and empty" (the false-positive guard).
- **Corpus re-run (11 apps): zero verdict change**, and the ledger quantified every hollow-PROVEN
  hunch: twenty PROVEN→coverage 8%, formbricks→8%, open-webui→0%, directus→13%, dub NOT PROVEN→99%.
  Stress-test report updated with the coverage table.

## Not done / deferred
- **Cross-class constructor dataflow** — directus's `new ItemsService(req.params.collection)` →
  `this.collection` → `this.knex(this.collection)`. This is Round 7 #1 proper (interprocedural,
  cross-class, invasive to the scanner's per-function contract). Deliberately scoped, not rushed —
  the ledger already tells directus's honest truth (coverage 13%) in the meantime. sym=0 on the
  whole corpus (none use the within-handler dynamic-table shape; proven on the fixture only).
- **The reduction-by-execution loop** — drive `mirror` at the high-risk blind spots, fold what it
  observes back as resolved. This is Reyna's actual loop and the natural next arc (Round 7 #4).

## Decisions made
- ADR-049 (blindspot ledger), ADR-050 (symbolic tables). Risk assigned by what a spot could HIDE,
  never by its name (E-029's lesson carried forward). The ledger REPORTS, never re-judges — so it
  ships with zero verdict risk.

## Bugs hit
- E-032 (the gap itself: PROVEN standing in for omniscient). Self-caught during build: my first
  blind-mutation rule would have false-flagged a genuine no-op POST — added the `meta.opaque`
  gate and a fixture route (`DELETE /ping`) that asserts it is NOT flagged.
- Publish-gate + dossier-renderer tests both caught real omissions (new files untracked; renderer
  called with data lacking `blindspots`) — fixed with a git add and a defensive default.

## Notes for the next session
- Reyna itself: `getUBSReport↔estimateTimeToTarget` infinite recursion, `index.ts` French
  apostrophes break compilation, metrics contradict (coverage 98% while reduction 52%, all
  rewards −1). It's a prototype of ideas, not a lib — took the idea, not the code.
- The coverage number is the strongest honesty signal SPARDA now has. If one metric goes on the
  landing page / dossier hero, it's this one.
- Blind `surface` counts unverified-guards (can be large: immich ~250); `coverage.blind` does
  NOT (guards are a trust axis, not a behavior-resolution axis). Intentional — but if the
  headline surface number ever reads as noise, split guard-trust from behavior-coverage in the UI.
