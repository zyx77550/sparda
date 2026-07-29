# 2026-07-15 — ADR-054 phase 1: the interprocedural engine, extracted at byte-identity

**Scope:** promote the audit's ADR-P2 (owner Go) and ship its phase 1 — one resolution
engine (`src/ubg/resolve.js`), Express/Nest as adapters, proven byte-identical.
**Commits:** see branch · **Branch:** `claude/current-task-u45a4d` · **Tests:** 549 ✓ (3 skip), ESLint 0, Prettier clean

## Done

- **ADR-054 accepted and shipped (phase 1)** — `docs/DECISIONS.md`. The three-way duplicated
  call-following machinery (Nest `methodBundle`/`forEachThisCall`/`diMapWithMod`, Express
  `deepScan`/`followCalls`/`classMethodBundle`, `mergeScan` duplicated line-for-line) now lives
  once in `src/ubg/resolve.js`. `express.js` (782 → ~550 lines) and `nestjs.js` (443 → ~260)
  are route-table adapters calling `createResolver({ cwd, scannedFiles, helpers })`.
- **The safety net, three layers deep:**
  1. Fixture oracle: canonical-graph sha256 of ALL 30 fixtures, captured pre-refactor,
     re-run post-refactor — **byte-identical** (`scratchpad/graph-oracle.mjs` pattern).
  2. Real corpus, full pipeline: directus `api/` byte-exact at its v0.32.0 baseline
     (239r / PROVEN F=0 / 344 db effects / 95% coverage).
  3. Real corpus, old-vs-new: twenty (145r) and immich (281r, F=2) canonical-SHA identical
     between stashed old code and the refactor, ~1s each (memoization intact).
- CHANGELOG 0.32.1, version bump, ADR-054, E-034, playbook updated (Wave 2b re-scoped).

## Not done / deferred

- **Phase 2 of ADR-054:** converge the two strategies' preserved divergences (depth-counter vs
  stack-size bounding; raw-AST walk vs @babel/traverse — both feed effect order, hence canonical
  bytes), then plug Next/Python/GraphQL depth + the ORM import-root table into the engine. Gated
  on the corpus oracle, not free.
- **E-034 detection fix** (see Bugs) — recorded, deliberately not fixed here (behavior change,
  out of a byte-identity refactor's scope).

## Decisions made

- ADR-054 (promotes audit ADR-P2). Wave 2b is re-scoped THROUGH it: `resolve.js` is the
  reference spec; `fastapi_extract.py` implements the engine's _contract_ (depth 6, memo per
  (file, qualname), cycle guard, mergeScan semantics) since Python can't import the JS engine.
- Version 0.32.1 (patch): byte-identical refactor = no user-visible change (precedent: 0.19.1).

## Bugs hit

- **Shadowing:** first wiring named the engine instance `resolver` in `extractNest` — shadowed
  by the GraphQL `const resolver = decoratorArg(cls.decorators, 'Resolver')` (0.32.0) inside the
  visitor. Renamed to `engine`. The fixture oracle caught it instantly.
- **ADR-029 valve working as designed:** the publish-gate test went red because the new
  `resolve.js` (imported by published modules) wasn't yet `git add`ed — the self-containment
  rule computes the published set from `git ls-files`. Tracking the file fixed it.
- **E-034 (recorded in ERRORS.md):** immich + twenty at today's HEAD detect as Express (direct
  `express` dep, checked before `@nestjs/*`) and hard-fail. git-stash-verified as upstream
  drift, NOT a refactor regression. Probe workaround: force the lowering (`extractNest` direct).

## Notes for the next session

- Phase-2 candidate order: (1) E-034 detection fall-through (small, unblocks the corpus for
  everything after), (2) traversal/bounding convergence inside resolve.js under the corpus
  oracle, (3) Wave 2b Python port against the engine contract, (4) ORM import-root table.
- The dossier's recommended companion: start ADR-P5 (golden-verdict bench) as phase 2 begins —
  it protects exactly this kind of refactor, and E-034 shows why SHAs must be pinned.
- Guard dominance (ADR-046 cran 2) is still the no-dependency quick win the dossier ordered
  first; it remains open and parallelizable.
