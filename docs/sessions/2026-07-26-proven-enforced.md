# 2026-07-26 — PROVEN-ENFORCED: synthesis under the court (ADR-076)

**Scope:** Integrate the third leg the Brick #20 spike validated — don't just observe the missing
proof, SYNTHESIZE it: `sparda enforce` turns a type-lock PARTIAL into PROVEN (ENFORCED) by
inserting a boundary check SPARDA can verify, kept only if it proves itself, reversible
byte-for-byte.
**Commits:** see branch · **Branch:** `claude/sparda-hq-audit-evolution-r8ml8t` · **Tests:** 832 ✓
(3 skip) · **Mutants:** 40/40 · lint/format/publish-gate clean · 4 deps.

## The conceptual move

- No dominator-tree computation: the Express middleware chain IS a dominance spine by
  construction (every chain step dominates the handler — the exact property guard-dominance
  already trusts). Inject where domination is syntactically free.
- **The court**: after writing, recompile; keep the edit ONLY if verdict == PROVEN, zero
  asserted-only mutations remain, and findings did not grow — else byte-for-byte rollback +
  error. The synthesized proof passes the same verifier that demanded a proof. A counterfeit
  non-denying shim cannot buy green (tested + mutant).
- **Disclosure, never upgrade**: `prove` reports PROVEN (ENFORCED) from `.sparda/enforce.json`,
  which counts only while the injected bytes are in place (hash-checked). Soundness never rests
  on the manifest — strip the shim and the type-lock drops the app to PARTIAL on its own.

## Done

- `src/commands/enforce.js` — plan (dry-run default) / `--apply` (write + court + manifest) /
  `--revert` (hash-verified byte-for-byte restore) / `--principal` (member-path grammar, cannot
  inject code). `assertedOnlyMutationRoutes` exported from `apocalypse.js` (the SAME walk as the
  type-lock count, refactored: count = list.length — enforce can never target a route the lock
  would not count).
- CLI wiring (`enforce` case + HELP + listing), `prove` PARTIAL hint + PROVEN (ENFORCED) head +
  `enforced`/`enforcedRoutes` in JSON, `remove` reverts enforcement before deleting `.sparda/`
  (hard rule #4).
- `tests/enforce.test.js` (8: targeting, dry-run writes nothing, PARTIAL→PROVEN with the shim
  guard VERIFIED by its body, idempotence, byte-for-byte revert, the court rejecting a
  counterfeit with full rollback, principal-injection rejection, hand-stripped shim killing the
  ENFORCED claim) + 3 killing mutants (dissolve the court / shim stops denying / disclosure
  stops following the bytes).
- Verified end-to-end on a live copy: PARTIAL → `enforce --apply` → PROVEN (ENFORCED) →
  `--revert` → `diff` clean.

## Not done / deferred

- Nest/Next/FastAPI injection grammars (same court, different insertion syntax). Express V1 only.
- `badge`/`dossier` don't surface the ENFORCED qualifier yet (verdict word stays PROVEN — true,
  just less disclosed than `prove`).
- Auto-detect the principal convention (`req.user` vs `req.auth` vs session) from the codebase
  instead of a flag.

## Decisions made

- ADR-076. Dry-run is the DEFAULT (enforce writes code — the plan is shown first, `--apply` is
  the consent). The `--principal` value is grammar-validated (member path only).
- The existing type-lock mutant was retargeted to the refactored line (`if (!guards.some(...))`
  now pushes a route instead of counting) — same semantics, same killing test.

## Bugs hit

- `no-useless-assignment` (eslint) on `let manifest = null` before try-assign — declare bare.
- Publish-gate red until `git add` (self-containment runs over `git ls-files`; same trap as
  yesterday — new module imported by a published one must be tracked).

## Notes for the next session

- The court pattern generalizes: ANY future code-writing feature (heal's fix briefs, witness
  enforcement for BOLA — inserting a proven ownership check) should reuse "write → recompile →
  prove or rollback". Consider extracting it if a second writer lands.
- Enforce + gate compose: an agent seeing the gate block a guard removal could run
  `sparda enforce --apply` to re-prop the proof — worth a doc line in agent-loops.md when the
  Nest grammar lands.

> Remember: rewrite `docs/HANDOFF.md` before committing this file.
