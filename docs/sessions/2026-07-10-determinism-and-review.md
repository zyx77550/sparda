# 2026-07-10 — Determinism fix + `sparda review` (R5/M3)

**Scope:** Re-audit the whole repo for red/orange bugs, fix them, then attack the
roadmap (R5/M3 — the semantic PR diff).
**Commits:** `0295260` (determinism) + this branch · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 406 ✓ Vitest + 10/10 router self-test

## Done
- **Audit → orange bug E-020 (determinism/portability).** `canonicalizeGraph`
  sorted nodes by code unit but edges by `localeCompare`, whose collation is
  host-locale/ICU-dependent (`order_items` vs `Orders` flip). Worse, `localeCompare`
  drove graph *content* decisions (SQL table dedup tie-break, translator first-wins
  helper pick, state-minimization merge-pair pick) and stored meta arrays
  (state-machine transitions, SQL/Prisma invariants). So the same code could compile
  to different canonical bytes on a differently-localed machine — breaking the
  "byte-identical, machine after machine" guarantee (verify only checks same-machine,
  so CI never caught it). Fixed with one exported `cmp` (code units) in `schema.js`,
  applied to every graph-affecting sort. Verified identical under `LC_ALL=C` and
  `en_US.UTF-8`.
- **Roadmap R5/M3 — `sparda review`** (priority 1). Semantic PR diff: compile a git
  base ref (detached worktree, static — no npm install) vs the working tree, compose
  `diffGraphs` (protections removed) + `checkGraph` delta (risks introduced, minus
  what the base already had) + endpoint surface delta. `--base`, `--json`,
  `--markdown`; exit 1 on critical/high (CI gate). Pure core `reviewGraphs(base,
  candidate)` unit-tested; git worktree orchestration integration-tested.
  `src/commands/review.js`, wired in `src/index.js`, `tests/review.test.js` (7),
  ADR-030, ROADMAP M3 → ✅.

## Not done / deferred
- Broader `localeCompare` sweep: report/human-facing sorts (mirror, openapi human
  output, doctor/report) still use `localeCompare` — fine, they don't reach canonical
  bytes and locale order is nicer for humans. Only graph-affecting sorts were changed.
- Flight PII gap (response bodies + db/http taps captured unredacted; only request
  body keys are redacted) — this is the roadmap §6 RGPD chantier, not a surprise bug.
  Left for that dedicated work (SHA-256 + dynamic salt).
- `sparda review` on FastAPI whose extractor imports the app would need deps at the
  base ref (static Express/Next path is fine). Documented in ADR-030.
- Next R5 moves after M3: M1 (interprocedural taint), M2 (stateful mirror), M4
  (cross-service proof). M5 (first external user) is the permanent parallel track.

## Decisions made
- One code-unit comparator for everything that reaches canonical bytes; leave
  human-facing sorts on `localeCompare`. Determinism-across-machines ≠ nice display order.
- `review` = `apocalypse` made relative, baseline = git (no saved-baseline ceremony).
  Pure `reviewGraphs` core + thin git orchestration so semantics test without git.

## Bugs hit
- The self-containment guard (PR #12) failed twice — once per new untracked runtime
  file (`review.js`) — until staged. Working as designed.

## Notes for the next session
- Consider adding `sparda review --markdown` to the GitHub Action (`action.yml`) so
  every PR gets an auto-posted behavior diff — that's the M5 "visible at each PR" hook.
- The three router templates still duplicate logic (noted last session) — a shared
  partial would kill parity bugs at the source.
