# 2026-07-26 — Five false PROVEN killed + the registration invariant (ADR-079)

**Scope:** eradicate the 4 zero-days an adversarial red-team audit found (Z1–Z4), plus the
scalability failure (Z5), plus the structural invariant that locks the whole class — with zero
regression on the 868-test baseline.
**Branch:** `claude/sparda-hq-robustness-fy1ttv` (restarted from `origin/main` @ `c826da7`)
**Tests:** 898 ✓ (+30) · mutants 54/54 (+7) · ESLint 0 · Prettier clean · 4 deps

## Done

- **Z1 / E-067 — unmodelled verbs.** `app.all()` expanded into the modelled verbs (Express
  semantics; a pseudo-verb would have broken `openapi-emit` and `mirror`); `routeChainOf()` walks
  `app.route(p).get(h).post(h)` and registers EVERY link. Registration factored into one
  `registerRoute()`. Fixture `ubg-invisible-verbs`, `tests/zero-day-verbs.test.js`, 2 mutants.
- **Z2 / E-068 — app/router aliases.** `collectAppVars` follows `const api = app`, alias chains
  and the assignment form, to a bounded fixpoint. Fixture `ubg-app-alias`,
  `tests/zero-day-alias.test.js`, 1 mutant.
- **Z3 / E-069 — a lost file is never medium.** `isFatalSkip()` forces `high` for parse
  errors / unreadable / size-cap skips so they reach `blindHigh` and bar PROVEN.
  `tests/zero-day-effects.test.js` (builds the corpus on the fly), 1 mutant.
- **Z4 / E-070 — computed ORM writes.** A computed member rooted at a proven persistence handle
  emits an opaque `db_write` (`dynamicMember: true`). Also fixed the upstream cause the audit
  report under-stated: `inspectCall` bailed at line ~2135 on any non-Identifier property, well
  before the ADR-068 net at ~2426 — and `collectDbHandles` did not label the CJS destructured
  require, so the whole CommonJS world had no proven handles. Fixture `ubg-computed-write`,
  1 mutant.
- **Z6 / E-071 (found by following the pattern, not in the brief).** `app.use('/api', mw)` was
  credited to every route — the Express twin of E-053. `pathPrefix` travels with the middleware;
  `middlewareAppliesTo` enforces Express segment semantics (`/api` ≠ `/apikeys`). Fixture
  `ubg-scoped-middleware`, 1 mutant.
- **Z5 / E-072 — reachability.** One traversal in `ubg/reach.js` (was three copies), successors
  partitioned by route, cursor queue, topology-stamped memoisation. 16 010 000 → 14 000 edge
  visits at 4 000 routes; `checkGraph` 141.9 → 59.4 ms. Order preserved by rank-merge → outputs
  byte-identical. Bench `bench/scale-gen.mjs` / `bench/scale-run.mjs`.
- **The invariant (ADR-079).** `tests/registration-invariant.test.js` + fixture
  `ubg-registration-invariant`: 7 unmodelled shapes → exactly 7 declared `UnknownHandler`s;
  known plumbing → zero; an unknown forbids PROVEN; a clean app gains no phantom unknowns.
  Killing mutant removes the declaration and the test bites.

## Verified

Every zero-day corpus re-run against the patched engine: `c2` PROVEN → **NOT_PROVEN** (7 routes,
7 findings), `c6` → **NOT_PROVEN**, `c7` → **PARTIAL** (blindHigh 1), `c8b` → **NOT_PROVEN**,
`z6c` → **NOT_PROVEN**. Real CLI on the flagship corpus: `✗ NOT PROVEN`, **exit code 1** (CI
blocks). No previously-passing attack regressed; `a2-unicode` even gained a route (the alias fix
picked up its homoglyph `ᵃpp` alias).

## Not done / deferred

- **`app.use('/path', handler)` used AS a route.** A function mounted at a path answers every
  verb under it; SPARDA still treats it as a global middleware and does not register the
  endpoint. Found in the audit (attack `c3`), NOT in the fix brief — documented rather than
  silently patched. It composes into a false PROVEN with a clean decoy, so it is the next
  candidate. The fix likely belongs in `handleUse` and should reuse the new `pathPrefix`.
- **`parser/express.js` and `openapi.js` verb sets** still exclude `all`. They feed MCP tool
  generation and spec ingestion, not the proof verdict, so they were left alone deliberately —
  changing the tool surface is a separate, user-visible decision.
- **Python parity** (conditional branches, declaration order, budget) — unchanged from ADR-078.

## Bugs hit

- **The mutation harness left residue in the working tree.** Three mutants were still applied
  (`false &&` in `extract.js`, `if (false)` and a dropped `|| !guards.length` in `apocalypse.js`)
  from an interrupted run, and a `git stash`/`pop` cycle preserved them. Symptom: 5 "surviving"
  mutants, 2 reported as "target not found", and one genuinely failing test — all of which looked
  like regressions I had caused. Fix: restored the three lines, then added a STATIC residue audit
  (reads `run.mjs` as text, never imports it) asserting every mutation target is present in the
  source. **Run that check after every harness run** — `finally` restores on a clean exit, not on
  an interrupt.
- A first attempt at Z5 used `export { reachFrom as reachOf } from './reach.js'`, a re-export,
  which creates no local binding — 124 tests failed with `reachOf is not defined`. Local
  `export const reachOf = reachFrom;` instead.

## Notes for the next session

- `NON_ROUTE_METHODS` is now load-bearing: adding a name silences the invariant for that member.
  Treat additions as security review, not housekeeping.
- The `reachabilityOf` memo stamp is `edges` identity + length + node count. It is sound against
  every mutation shape currently in the codebase (topology passes REPLACE the array; `addEdge`
  pushes). A future pass that rewrites edges IN PLACE at constant length would defeat it — if you
  write one, bump a version counter instead.
- The red-team corpus lives outside the repo; the five fixtures under `tests/fixtures/ubg-*`
  (invisible-verbs, app-alias, computed-write, scoped-middleware, registration-invariant) are its
  distilled, permanent form.
