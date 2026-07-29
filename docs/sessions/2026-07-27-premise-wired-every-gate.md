# 2026-07-27 — The premise reaches every gate (ADR-083)

**Scope:** the hole the previous session's own audit surfaced — the premise verifier was
wired into `prove` and nothing else.
**Branch:** `claude/sparda-hq-robustness-fy1ttv` (restarted from the merged `main`)
**Tests:** 1094 ✓ (+9) · mutants 81/81 (+4) · ESLint 0 · Prettier clean · 4 deps

## The measurement that started it

Grading our own work rather than re-reading it. Of the seven commands that emit a verdict:

| command | verdict | premise checked (before) |
|---|---|---|
| `apocalypse` | yes | **no** ← the CI deploy gate |
| `badge` | yes | **no** ← the public artifact |
| `dossier` | yes | **no** ← the public report |
| `review` | yes | **no** ← the PR gate |
| `enforce` | yes | no |
| `heal` | yes | no |
| `prove` | yes | yes |

Two sessions were spent building the organ that stops SPARDA certifying an app it did not
fully see, and it was reachable from one command.

## The lesson worth keeping

**A safety property that holds on one consumer out of seven is not a partial guarantee —
it is a false one.** The ADR, the docs and the release notes all said "SPARDA no longer
certifies what it has not seen". That sentence was believed everywhere and true in exactly
one place, which makes the half-wired version strictly worse than no feature: it bought
confidence it had not earned. Building an organ and wiring it into one caller is not
shipping it.

## Done

- **`premiseFor()` + `withPremiseGaps()`** in `premise.js` — one shared code path, called
  by `apocalypse`, `badge`, `dossier`, `review`, `prove`. Not a convention to follow: four
  duplicated lines per command is exactly how one silently drifts, and the drift is
  invisible because each command's own tests keep passing. The opt-in boundary lives inside
  the helper so it cannot be got wrong per caller.
- **`apocalypse` now exits 1** on a premise gap and names the missing routes. Verified end
  to end on `ubg-next-premise-gap`: `✗ PREMISE NOT VERIFIED`, `GET /api/legacy/purge`,
  exit 1.
- **E-084 — the badge said "0 findings" on a premise gap.** `badgeFor` had no
  `PREMISE_GAP` branch, so it fell through to the finding-count default. On the one
  artifact designed to leave the repo and be believed by strangers. The colour was already
  correct (grey), which is exactly what hid it — the badge looked plausible.
- **E-085 — `review` graded the graph and never read the report.** `surveyBlindspots`
  was called with no report at all, so the PR gate never saw a skipped surface: a pull
  request that made a whole file unparseable reviewed exactly like one that changed
  nothing. Found while plumbing the premise through, not by looking for it.

## Decisions worth keeping

- **Sealed by a rule, not a list.** `tests/premise-wired-everywhere.test.js` scans
  `src/commands/` and fails when any module that grades a compiled graph does not call
  `premiseFor`. Pinning today's five commands would only re-prove the fix; pinning the rule
  is what stops the eighth command repeating it. A second assertion keeps the scan from
  passing vacuously if the detection stops matching.
- **`enforce` and `heal` deliberately excluded.** Their verdict is about a DELTA — "did
  this synthesis introduce anything", "did this replay regress" — not about the app.
  Feeding a premise gap in would make them refuse to act on any app that has one, which is
  backwards: enforcing a guard on an incompletely-seen app is still the right move. It is a
  named two-item allowlist in the test, not a silent gap.
- **Two of my own new assertions were vacuous and had to be rewritten** (`?? true` always
  passes; `toBeDefined()` asserts nothing). Caught by re-reading the test before trusting
  the green. Worth naming: this is the same failure the whole audit is about, committed in
  the test that audits it.

## Not done / deferred

- **The corpus has not been re-measured with the oracle wired.** The committed baseline is
  pre-premise, and it contains one `PROVEN` on real code — **nocodb, 338 routes, 127
  writes, 90.2 % coverage**. That verdict was earned with no premise check of any kind, and
  `scripts/corpus-oracle.mjs` calls `compileUBG` directly, so it still is. Until it is
  re-run, it is the least trustworthy claim in the repository. Handed to the local IA.
- Python still has no conditional marking, declaration order or registration invariant.
- OpenAPI has no premise oracle and never will — the spec IS the premise.
- Strapi's core routers stay outside the boot-free oracle (its pluraliser would be a guess).

## Notes for the next session

- The structural test is the asset here, more than the four wirings. When a new
  verdict-emitting command appears, it fails **before** the command ships, which is the
  only moment the fix is cheap.
- `scripts/corpus-oracle.mjs` is the last consumer that grades without a premise. It is a
  measurement harness rather than a user-facing gate, but its numbers are what the project
  quotes about itself — so it deserves the same treatment.
