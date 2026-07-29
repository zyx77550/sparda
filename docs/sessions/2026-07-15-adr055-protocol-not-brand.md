# 2026-07-15 — Wave 3a + the n8n stress test that became ADR-055 (0.35.0, 0.36.0)

**Scope:** ship Wave 3a (taint's precise core), then stress-test SPARDA on a giant reputed
impossible and generalize whatever wall it hits.
**Commits:** Wave 3a (`feat(apocalypse): UNBOUNDED_WRITE_TARGET`), ADR-055 (this) ·
**Branch:** `claude/current-task-u45a4d` · **Tests:** 568 ✓ (3 skip), ESLint 0, Prettier clean

## Done

- **Wave 3a — `UNBOUNDED_WRITE_TARGET` (0.35.0).** apocalypse O6, critical: a `db_write` to a
  `meta.symbolic` (request-named) table with no guard. Bounded hard (E-029). Corpus: zero false
  positives (every real symbolic write is guarded). Fixture `ubg-unbounded-write` + 4 tests.
- **Stress test on n8n (packages/cli):** 0 routes / NO_PROOF — home-made `@RestController`
  framework. Documented the full capability bilan (speed excellent, depth real-but-capped, the
  wall = ingestion vocabulary).
- **ADR-055 — recognize the protocol, not the brand (0.36.0).** Three structural signals, all
  brand-free: (1) routes by HTTP-verb-shaped decorator; (2) guarded-by-default posture inferred
  from the existence of an auth opt-out flag (`{ skipAuth: true }`); (3) detection routes
  `express` + `reflect-metadata` + verb-decorator apps to the decorator extractor (gated so
  classic express pays nothing). **n8n: 0 → 494 routes, NOT PROVEN F=4 (true-positive skipAuth
  public writes), 429 asserted guards, coverage 21.7%, 2.5s.** Corpus + all 32 fixtures
  byte-identical. Fixture `ubg-decorator-framework` + 6 tests.

## Not done / deferred

- **Wave 3b (validation taint) — NOT shipped, measured DEAD.** The `inserts/sets` meta populates
  only for raw-SQL DML with literal values (`colWrites=0` on the whole corpus), and literal columns
  are the SAFE case (hardcoded, not request-derived) — the signal is inverted for mass-assignment.
  Real taint needs a `req.body → write-column` dataflow EDGE in the IR = ADR-P1 proper. Recorded,
  not faked.
- **n8n's honest ceiling:** guards ASSERTED (registry auth trusted, not verified); effect depth
  bottoms out on n8n's ORM indirection (coverage 21.7%). Both are honest blindspots, the next
  depth ask on n8n.
- ORM import-root provenance (ADR-054 leftover) — still its own session.

## Decisions made

- Do NOT build a per-framework decorator table (a treadmill). Recognize the HTTP protocol (verbs,
  paths, deny-status) — finite and stable where brand names are infinite.
- Guarded-by-default is inferred from an opt-out flag's EXISTENCE, never a framework name — and
  only activates when such a flag is present (plain Nest apps unaffected, corpus byte-identical).
- Guard recognition stays behavioral/asserted, surfaced honestly by the blindspot ledger — no new
  nominal obligation to the prover (E-029 held).

## Bugs hit

- **Scope-arg guard signal was dead downstream:** translate.js re-validates guard names via
  `isGuardLike` (GUARD_NAME regex), which `@GlobalScope`/`@Licensed` fail — so a first attempt to
  mark scope-decorators as guards never reached the graph. Dropped it; the guarded-by-default
  synthetic guard (name contains "auth" → passes isGuardLike) is the correct, effective mechanism.
- **Detection scan cost:** the bounded decorator-framework scan initially ran for every express app
  (directus +1.6s). Gated on `reflect-metadata` (present in n8n, absent in directus) → classic
  express pays nothing.

## Notes for the next session

- The re-test proved the method: point SPARDA at a giant, let the wall name itself, generalize by
  structure. n8n's residual (21.7% coverage, asserted guards) is the honest next frontier.
- `compileUBG(n8n)` now works end-to-end — n8n is a usable corpus target (add to the playbook's
  ephemeral clone table: `n8n-io/n8n`, `packages/cli`, decorator framework).
- Guard DOMINANCE (ADR-046 cran 2) + verifying asserted guards by resolving the decorator's deny
  path (turning n8n's 429 asserted → verified) is the natural depth follow-up to ADR-055.
