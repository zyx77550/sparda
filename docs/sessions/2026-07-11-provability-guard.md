# 2026-07-11 — Hardening: never a vacuous proof again (0.14.1)

**Scope:** The corpus run (same day) showed a soundness hole — an unparsed repo
(0 entrypoints) printed "✓ PROVEN over 0 nodes" and exited 0. Close that risk
class for good, and widen parser coverage for the gaps that caused it.
**Branch:** `claude/new-session-5yhx6t` · **Tests:** 424 ✓ Vitest (+5), 10/10 router
self-test · ESLint 0 / Prettier clean · **Version:** 0.14.1 prepared (not published)

## Done
- **Provability guard (ADR-034).** `verdictOf(findings, graph)` computes
  `entrypoints` and `provable = entrypoints > 0`, folded into `safe`/`clean`.
  `apocalypse` and `review` now print **`✗ NO PROOF` and exit 1** on a 0-route
  compile; `apocalypse --verbose` names the detected framework/entry and notes an
  indirect/DI route registration. Enforced once, at the verdict — every
  verdict-emitting command inherits it. `heal` (regression delta, no graph)
  unchanged. Files: `src/ubg/apocalypse.js`, `src/commands/apocalypse.js`,
  `src/commands/review.js`.
- **C-001a fixed — inline-require router mounts.** `app.use('/x',
  require('./x.controller'))` now resolves via `mountTargetFile` in
  `src/ubg/express.js`. `cornflourblue`: 0 nodes → 7 routes, correct PROVEN.
- **Tests + fixtures.** `tests/fixtures/ubg-blind/` (DI loader → NO PROOF) and
  `tests/fixtures/ubg-inline-mount/` (C-001a parses). Unit tests for `verdictOf`
  provability in `apocalypse.test.js`; wrapper tests (NO PROOF exit 1; inline mount
  route count) in `command-smoke.test.js`.
- **Corpus re-run, after hardening:** boilerplate PROVEN (unchanged), cornflourblue
  now real PROVEN, bulletproof now NO PROOF (was vacuous), prisma NOT PROVEN
  (unchanged). Table in the audit doc.
- **Docs:** ADR-034, ERRORS C-001 rewritten (fix + guard), audit follow-up section,
  CHANGELOG 0.14.1, HANDOFF part 10, GEMINI 0.14.1 release task.
- **Version:** bumped 0.14.0 → 0.14.1 in `package.json` + `package-lock.json`. NOT
  published (Gemini, on Zak's go).

## Not done / deferred
- **C-001b — TS DI route loaders** (`export default (app) => {…}`): still unparsed,
  but now *safe* (NO PROOF, not false PROVEN). Next coverage item — treat a
  route-module's first parameter as a candidate router. Scoped, not a correctness risk.
- Publish/sync of 0.14.1 — Gemini's queue.

## Decisions made
- **Provability is a verdict property, not a per-command check** (ADR-034) — one rule
  in `verdictOf` covers all commands and can't drift.
- **Coverage is open-ended; honesty is not.** SPARDA can't promise every repo parses,
  but it now guarantees it never *lies* about coverage (unseen surface = loud NO PROOF).

## Bugs hit
- None new. The soundness hole (vacuous PROVEN) is C-001 in ERRORS — closed here.

## Notes for the next session
- The NO PROOF guard keys purely on entrypoint count — if a future framework can
  legitimately have zero HTTP entrypoints (e.g. a pure GraphQL/handler app), revisit
  what "entrypoint" means before loosening the guard; don't just special-case it.
- `verdictOf`'s second arg is optional on purpose (heal). If you add a new caller,
  pass the candidate graph unless you specifically want provability un-asserted.
