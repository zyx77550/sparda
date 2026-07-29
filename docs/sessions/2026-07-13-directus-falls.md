# 2026-07-13 — One thing done well: directus falls (0.27.0 + 0.28.0)

**Scope:** Zak asked to focus on ONE gap and do it very well → the dynamic-Express wall
(directus, 0 routes), then "Go" on the follow-through (instantiated-service effects).
**Commits:** `faa4039` (0.27.0) + this one (0.28.0) · **Branch:** `claude/new-session-5yhx6t` ·
**Tests:** 536/536 green (3 skipped)

## Done
- **0.27.0 — the surface (ADR-047, E-030).** `flattenSetup` in `src/ubg/express.js`: the route
  walk sees setup-function bodies + control-flow blocks, never function arguments. directus
  0 → 239 routes; express-boilerplate 8 → 9 (genuine if-gated `/v1/docs` recovered).
  Fixture `ubg-express-factory` + 3 tests.
- **0.28.0 — the behavior (ADR-048, E-031).** Instantiated-service resolution in the Express
  deep scanner: inline wrapped handlers (`asyncHandler(async…)`) unwrapped;
  `const svc = new XService(…)` → `svc.m()` resolved through the import, up the `extends`
  chain, `this.<m>()` re-dispatching from the instantiated class, `super.<m>()` from the
  declaring base; `this.knex('t')` reads as a table op (`builderTableOf`). Class helpers
  (`classInModule`/`baseClassOf`/`methodInClassChain`) moved to `extract.js`, shared with the
  Nest DI follower. Bundles memoized per (class, method) with their own dedup domain — E-027's
  34s lesson applied from the start. **directus SURFACE ONLY → PROVEN with observed effects.**
  Fixture `ubg-express-instance` + `express-instance.test.js` (4 tests).
- **Full corpus re-run (11 apps):** dub, immich, medusa (476r), express-bp, fastapi, twenty,
  novu, cal, formbricks, open-webui — byte-identical verdicts/findings; twenty's apparent 4.3s
  was a cold-FS outlier (re-runs ~1.2s). Stress-test report updated (both gaps marked FIXED).

## Not done / deferred
- **Bare imported-function calls inside class methods** (`runAst(ast)`) — not followed.
  Deliberate: directus's read path bottoms out in a fully dynamic query builder (runtime
  `collection` string), so following it yields no table literals anyway. That's Round 7 #1
  (interprocedural dataflow) territory.
- Round 7 #1 (dataflow), deep #2 (genuine runtime registry loops), #4 (differential
  validation), #6 (torture bench) — unchanged, recorded in ROADMAP.md.

## Decisions made
- ADR-048 (instantiated-service resolution — four blinders shipped together). CHANGELOG got a
  0.27.0 backfill (the previous commit bumped the version without an entry).

## Bugs hit
- E-031 (the gap itself). Probe-side only: `verdictOf(findings, graph)` arg order tripped the
  ad-hoc probe script twice; medusa/fastapi "failures" in the corpus re-run were wrong clone
  paths ($SP/medusa-api/app and fastapi-tmpl/backend are the real app dirs), not regressions —
  verified by re-running the OLD code via `git stash`.

## Notes for the next session
- "PROVEN" on directus is real but sparse (5 effect nodes / 239 routes). The effect-ratio
  honesty signal (flag thin observation) belongs to Round 7 #4.
- The `git stash` before/after probe trick is the cheapest regression oracle for corpus work —
  use it before blaming a diff.
- Corpus clone paths that actually work: `$SP/corpus/dub-app`, `$SP/corpus/immich-app`,
  `$SP/medusa-api/app`, `$SP/corpus/node-express-boilerplate`, `$SP/corpus/fastapi-tmpl/backend`,
  `$SP/corpus2/_apps/{twenty,novu,cal,formbricks}`, `$SP/corpus2/openwebui/backend`,
  `$SP/corpus2/directus/api`.
