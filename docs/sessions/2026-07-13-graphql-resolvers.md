# 2026-07-13 — Vague 2a: GraphQL resolvers as first-class entrypoints (0.32.0)

**Scope:** Ingestion breadth. GraphQL-on-NestJS — highest leverage / lowest risk because it
reuses the whole Nest DI machine.
**Commit:** `1c36093` · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 549/549 (3 skipped)

## Done
- nestjs.js: walk admits `@Resolver`; a class is a route source on `@Controller` OR `@Resolver`;
  `graphqlOp` maps `@Query`/`@Subscription` → read (get), `@Mutation` → state change (post),
  under a `graphql/` namespace. Op name = string/`name:` arg else method name. DI, `@UseGuards`,
  effect resolution, coverage all reused unchanged. ADR-053.
- Fixture `ubg-graphql-resolver` + 3 tests; twenty's 6 resolver ops enter the graph; every corpus
  verdict identical.

## Not done / deferred
- The corpus twenty is a SPARSE clone (2 resolver files) so coverage barely moved — capability is
  real but under-shown; full twenty (hundreds of resolvers) is the real unlock.
- `@ResolveField` (nested field resolvers) not an entrypoint; schema-first SDL / standalone Apollo
  is a separate surface. Python depth is Wave 2b — see NEXT-WAVES-PLAYBOOK.md.

## Notes
- Watch the leading slash: entrypoint paths are `/graphql/foo` (joinPath adds it), not `graphql/foo`.
