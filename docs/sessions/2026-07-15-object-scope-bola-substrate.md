# 2026-07-15 — object-scope provenance (BOLA substrate) + prisma op completeness

**Scope:** ADR-058 Phase A → pivoted to Phase B substrate when measuring showed the DI
taint path is memoised (foundation-risk) and SPARDA already resolves the full path.
**Commits:** `<hash>` · **Branch:** `claude/current-task-u45a4d` · **Tests:** 606/606 green (3 skip)

## Done
- **Object-scope provenance** (extract.js): `whereHasIdKey` → `idScoped`, `whereOwnerScoped`
  → `ownerScoped` (ownership KEY like `userId`/`workspaceId`, or a session/auth value) on
  prisma read/write effects; propagated to effect meta (translate.js). MUST-analysis per
  SOUNDNESS — `ownerScoped` set only when a scope is proven, so "not scoped" is the honest
  default.
- **BOLA measured on the RESOLVED graph** (measure-first): file-local heuristic = 1019 false
  candidates on dub; resolved-graph (apocalypse `reachOf`, leak-free) + E-041 + admin/cron
  excluded = ~71. Tractable, still too noisy for a hard finding → substrate only, advisory is
  next (ADR-058 says BOLA is advisory regardless).
- **E-041 fix:** `PRISMA_OPS` completed — `findUniqueOrThrow`/`findFirstOrThrow` (the auth
  fetch), `createManyAndReturn` (a missed WRITE — Direction-1 blind spot), `groupBy`. dub reads
  435 → 539, no verdict/finding change; oracle re-baselined (dub, ghostfolio reads up).
- Fixture `ubg-object-scope` + 3 tests (OrThrow recognized; scoped vs unscoped route).

## Not done / deferred
- **The BOLA advisory finding.** Needs: admin-guard exclusion via the graph (not a path regex);
  more scope-detection precision (the ~71 still includes routes scoped by a mechanism SPARDA
  can't see). Ships only when the candidate set is eyeball-clean, at info severity.
- **Phase A/C interprocedural provenance.** The dominant taint/scope flow is the DI-resolved
  service call, which is MEMOISED (`classMethodBundle` bundle cache keyed by `symSig`). Taint
  must join that memo key or the cache shares a tainted bundle across routes (false tags). That
  is the careful next step — deliberately not rushed at session tail.

## Decisions made
- Pivoted from Phase A (interprocedural REQUEST taint) to Phase B substrate (object-scope) once
  measuring showed (a) the DI path needs memo-key surgery and (b) SPARDA already resolves the
  full path, making object-scope tractable NOW without engine risk.
- Ship the substrate + the op-completeness fix; hold the BOLA finding until precise. Consistent
  with the whole session: measure first, never ship noise.

## Notes for the next session
- BOLA advisory: compute candidacy inside apocalypse's per-entrypoint loop (it already has
  `reached`); exclude routes whose reachable guards include an admin/role guard; require a
  VERIFIED auth guard on the route (the global-guard work makes this real on Nest apps). Re-run
  the graph probe after each precision fix — the number is the gate.
- The `...OrThrow` lesson generalises: audit every ORM's FULL mutating-method list (a missed
  write is blindness). Mongoose/TypeORM/Sequelize/Drizzle/Kysely tables deserve the same pass.
