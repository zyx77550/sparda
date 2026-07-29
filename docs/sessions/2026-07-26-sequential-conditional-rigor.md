# 2026-07-26 — Sequential/conditional rigor: the control-graph approximations closed (ADR-078)

**Scope:** cahier des charges "fiabilisation et robustesse" — fix the four known approximations
(declaration order, conditional branches, silent resource caps, the 0/0 coverage anomaly), their
logical corollaries (nested-mount order inheritance, switch/ternary/short-circuit bifurcations,
dynamic registrations), and the resilience ceilings (time budget, oversized files, unmodeled
syntax) — with ZERO regression on the existing 838-test suite.
**Commits:** see branch · **Branch:** `claude/sparda-hq-robustness-fy1ttv` · **Tests:** 868 ✓ (+30), mutants 47/47 (+4), ESLint 0, Prettier clean

## Done

- **E-061 (X1+Y1) — sequential scope.** `flattenSetup` stamps every statement with its formal
  declaration `order`; routes, global middlewares and mounts carry it; nested mounts inherit the
  TOP mount's position at every depth. `middlewareAppliesTo(mw, route)` refuses credit when
  `mw.order > route.order` — monotone safe (only withholds). Fixture `ubg-sequential-order`
  (route/mount before vs after `app.use(auth)`, two nesting levels) + `tests/sequential-order.test.js`.
- **E-062 (X2+Y2) — conditional surface.** Bifurcation-reached statements (if/else, loop body,
  switch case, catch, ternary branch, `&&`/`||` operand) are marked conditional; try-block and
  do-while first pass stay certain (mathematically exact). Conditional registrations STAY analyzed
  but raise HIGH-risk `skipped-surface` entries → blindHigh bars PROVEN. Ternary/short-circuit
  registrations (previously invisible) now discovered via synthetic statements. Fixture
  `ubg-conditional-surface` + `tests/conditional-surface.test.js`.
- **E-063 (Y3) — UnknownHandler.** Computed verbs (`app[v](…)` — which could even be MISREAD as a
  static verb before), `Reflect.apply`, `.apply`/`.call` → structured `report.unknownHandlers` +
  high-risk skips. Fixture `ubg-dynamic-registration` + `tests/dynamic-registration.test.js`.
- **E-064 (X4) — 0/0 = Unknown.** `surveyBlindspots` returns `ratio: null` + `unknown: true` on a
  zero denominator; `verdictOf` gains `coverageUnknown` (null = measured-but-unknown → bars
  complete PROVEN; undefined = not measured → old semantics, heal delta safe); `coveragePct()` is
  the one formatter (prove/apocalypse/blindspots/badge/dossier/review/stdio all updated — null
  never coerces to a number). `tests/coverage-unknown.test.js`.
- **E-065 (X3) — declared limits.** Mount depth cap and flatten caps (depth 6 / 8000 stmts) now
  surface as high-risk skips entering the coverage denominator; `flattenSetup` returns
  `{statements, info, limit}` and is exported for unit tests; Python extractor gained the same
  depth-limit declaration. Fixture `ubg-mount-depth` + `tests/limits-surface.test.js`.
- **E-066 (P3) — resilience.** `extractExpress` time budget (`budgetMs` / `SPARDA_BUDGET_MS`,
  default 120 s) → clean stop + ONE critical-risk skip, never a hang/crash; `parseModule` 5 MB
  per-file cap with explicit error; unparseable entry = clean refusal (NO_PROOF), locked by test.
  Fixture `ubg-broken-entry` + `tests/analysis-budget.test.js`.
- **Blind-spot channel extension:** skipped entries may carry an explicit `risk`, honored by
  `surveyBlindspots` (additive — unmarked entries keep the mutating-verb heuristic).
- **4 new killing mutants** (order check, if-marking, 0/0, computed-silence) + the existing
  translate-matcher mutant's find string resynced after Prettier. 47/47 killed.

## Not done / deferred

- **Python parity beyond the depth limit:** `fastapi_extract.py` still has no conditional-branch
  marking, order stamps, or time budget (the JS engine got the full treatment; the Python walk
  got the X3 depth-limit declaration only). Same design applies cleanly when picked up.
- **Router-level `router.use(mw)` middlewares at depth > 0** are still not collected as guards
  (pre-existing under-approximation in the safe direction — no credit is ever fabricated).
- **Conditional propagation through mounts:** a conditional mount raises ONE blind spot for the
  subtree; its sub-routes are not individually re-marked (deliberate — one honest entry per
  registration point, no flood).

## Decisions made

- **ADR-078** (in DECISIONS.md): uncertainty degrades the claim through the EXISTING honest
  channels (high-risk blind spots → blindHigh → never PROVEN), never through fabricated findings
  and never by dropping analysis — zero flipped fixtures, zero false criticals.
- `coverage === null` vs `undefined` carries the measured-unknown vs not-measured distinction
  through `verdictOf` without breaking heal's partial-graph semantics.

## Bugs hit

- Prettier reformatted the `globalMiddlewares.filter(…)` call that a mutation-harness `find`
  string pinned — the harness reported "target moved". Resynced the string and re-verified the
  mutant is killed. (Trap for next time: after formatting, re-run the harness before claiming N/N.)

## Notes for the next session

- The order stamp is per-entry-file statement index; cross-body comparisons (mw registered in one
  setup function, route in another) compare positions in the same flattened stream — exact for the
  dominant single-setup-path shape, conservative otherwise.
- `report.unknownHandlers` is new, additive, and only present when non-empty — tooling can rely
  on the `UnknownHandler.via ∈ {computed-method, reflect-apply, apply-call}` vocabulary.
