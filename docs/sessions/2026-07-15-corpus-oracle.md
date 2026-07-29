# 2026-07-15 — the corpus oracle (regression net for real giants)

**Scope:** stop finding FPs one giant at a time by luck and let them silently regress —
freeze the corrected state of the giants as a committed, diffable baseline.
**Commits:** `<hash>` · **Branch:** `claude/current-task-u45a4d` · **Tests:** 601/601 green (3 skip)

## Done
- **`scripts/corpus-oracle.mjs` + `corpus.snapshot.json`** — compiles 7 giants that build
  cleanly (dub, novu, cal.com, twenty, immich, nocodb, ghostfolio), computes drift-sensitive
  metrics (verdict, findingsByRule, dbWrites/Reads, guards/guardsVerified, coverage), diffs
  vs the committed snapshot. Drift → exit 1 with a per-field delta. `--update` re-baselines.
- **Graceful, ephemeral-aware:** giants aren't committed; the snapshot is. `SPARDA_CORPUS`
  points at the clones; absent apps are SKIPPED (reported, never failed); no `SPARDA_CORPUS`
  → clean no-op. So it runs wherever the corpus is cached and never blocks where it isn't.
- **Verified it bites:** a simulated regression (novu dbWrites 24 → 636) produced `DRIFT`
  + exit 1 with the exact field deltas. Restored the true snapshot.
- **`npm run corpus` / `corpus:update`**; `tests/corpus-snapshot.test.js` keeps the baseline
  well-formed (shape, types, findingsByRule sums to findings) under `npm test`.

## Not done / deferred
- **CI wiring** — the oracle is ready to run in CI, but that needs the giants cloned/cached
  in the CI env (network + pinned commits). Left as an ops step; the script is CI-shaped
  (exit codes, env-driven, graceful skip).
- **The crypto `sha256` FP** (from part 40) still deferred — the oracle now FREEZES novu at
  2 findings, so fixing it later will show as an intended DRIFT (2 → 0), which is the point.

## Decisions made
- Metrics are integers + a 1-decimal coverage — drift-sensitive but free of float/source-line
  noise, so the snapshot only moves when SPARDA's SEEING changes, not on cosmetic edits.
- The snapshot is a first-class committed record ("what SPARDA sees on real code"); it moves
  only on `--update` with a reason in the commit — treated like the byte-identity fixtures.

## Notes for the next session
- **nocodb reads PROVEN with 108 writes / 0 verified guards** — a possible hollow PROVEN
  (all guards asserted-by-name, none proven to deny). The oracle freezes it; worth an audit
  (is every write really guarded, or is a guard being trusted by name?). Same smell as the
  hollow-PROVEN work (E-037 / ADR-056) but on the guard axis.
- To add a giant: get it compiling, add `{ name, dir }` to APPS, `npm run corpus:update`,
  eyeball the baseline, commit. To fix a giant's FP: make the change, `corpus:update`, and
  the diff in the snapshot IS the proof of what moved.
