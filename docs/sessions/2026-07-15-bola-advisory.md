# 2026-07-15 — the first BOLA/IDOR advisory, tested on the giants

**Scope:** turn the object-scope substrate into a real BOLA signal, ship it verdict-safe,
and let the giants say where we stand.
**Commits:** `<hash>` · **Branch:** `claude/current-task-u45a4d` · **Tests:** 608/608 green (3 skip)

## Done
- **`OBJECT_SCOPE_UNPROVEN`** (apocalypse O7): an idScoped object access with NO ownerScoped
  access anywhere on the resolved path, under a guard, excluding admin/system routes. OWASP
  API #1 — the bug class that survives on authenticated apps.
- **Advisory by design** — `advisory: true`, severity `info`; `verdictOf` computes `hardCount`
  (non-advisory) for the PROVEN/SURFACE gates, so an advisory NEVER flips the verdict (cal.com
  / nocodb stay PROVEN with advisories on other apps). It is an honest review list, not a vuln
  claim.
- **Tested on the giants:** dub 60, ghostfolio 8; immich/twenty/novu 0 (TypeORM query-builders
  carry no prisma `where` yet). Corpus oracle now tracks `advisories` separately from hard
  `findings` (dub hard=9 advisories=60). Fixture `ubg-object-scope` + 2 tests (advisory fires
  on the unscoped route, not the scoped one; and never gates the verdict).

## Not done / deferred — the honest precision gap
- **Bare-call following is the next enabler.** Many of dub's 60 are scoped by a BARE helper
  (`getCustomerOrThrow({ workspaceId })`) the resolver doesn't follow (it follows `x.method()`,
  not `helper()`). This same gap caps taint and the deny-probe. Following bare imported calls:
  (1) cuts BOLA FPs, (2) unlocks interprocedural taint, (3) raises effect coverage. It's a
  resolver change with corpus-wide impact — measure + re-baseline carefully in its own pass.
- **TypeORM/query-builder object-scope.** immich/twenty/novu emit 0 because BOLA reads the
  prisma `where` object; the query-builder `.where('x = :id')` / `.andWhere(...)` shape needs
  its own idScoped/ownerScoped extraction to light up those giants.

## Decisions made
- Ship BOLA as a verdict-safe ADVISORY (not held like the taint standalone finding) because it
  cannot pollute the PROVEN verdict and is honestly a "couldn't prove — review this" list,
  which IS SPARDA's value on a giant. The precision gap is disclosed, not hidden.
- Advisories are a first-class, separately-tracked channel (oracle `advisories` metric,
  `verdictOf` hardCount) — a precision change in the review list never masquerades as a change
  in the hard findings that gate the verdict.

## Notes for the next session
- Bare-call following (resolve.js `followCalls`): add an Identifier-callee branch resolving to
  `mod.functions` (local) or `resolveExportedFunction(mod.imports)` (imported), scan + recurse,
  memoised, bounded by depth. Measure cost on twenty (the 34s memo lesson) and the oracle drift
  (effects/coverage up, some BOLA advisories drop, maybe new UNGUARDED on newly-seen writes).
- After bare-call following, re-run `bola-graph.mjs` — dub's 60 should fall to a small,
  eyeball-clean set; that's when BOLA earns a look as more than advisory.
