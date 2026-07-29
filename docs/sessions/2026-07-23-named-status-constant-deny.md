# 2026-07-23 — The named status constant is a deny signal (ADR-073)

**Scope:** Close a measured false negative — a NestJS guard that denies with a NAMED HTTP status
constant (`StatusCodes.FORBIDDEN` / `HttpStatus.FORBIDDEN`) instead of a numeric `403` read as
`asserted`, capping real apps (ghostfolio + everything on `http-status-codes`/`HttpStatus.*`) at
PARTIAL.
**Commits:** this session · **Branch:** `claude/sparda-mcp-security-audit-nw3kek` · **Tests:** 791
passed / 3 skipped · **Mutants:** 32/32 killed.

## Done
- `src/ubg/extract.js`: added `isDenyStatusArg(a)` — accepts the numeric `401`/`403` OR the named
  member `X.FORBIDDEN` / `X.UNAUTHORIZED` (any object). Wired into all three deny sites: the
  `HttpException`/`HttpError` constructor scan (in `visit`), `res.sendStatus()/.status()`
  (`deniedStatusOf`, replacing the local numeric `isDeny`), and the `{status}`/`{statusCode}` init
  object (`isDenyOptions`). Numeric path unchanged; named path added.
- Fixture `tests/fixtures/ubg-nest-status-const` — a custom guard throwing
  `HttpException(getReasonPhrase(StatusCodes.FORBIDDEN), StatusCodes.FORBIDDEN)`, imported through a
  tsconfig `paths` alias (`@app/*` → `src/*`), over a knex write. Mirrors ghostfolio exactly.
- `tests/nest-status-const.test.js` — asserts the guard reads `verified` (was `asserted`); also
  serves as the alias-hop proof (verified is unreachable unless the alias resolves).
- Killing mutant in `tests/mutation/run.mjs` — drop the named-constant branch → the guard falls back
  to asserted → the test bites.
- ADR-073 in `docs/DECISIONS.md`; HANDOFF Brick #19.

## Not done / deferred
- **The pre-compaction hypothesis was WRONG and I verified it before building.** The prior summary
  said the blocker was "SPARDA can't resolve tsconfig path aliases". It CAN — `resolveAliasedImport`
  (extract.js ~1203) already reads `compilerOptions.paths` + `baseUrl` (JSONC-safe via `stripJsonc`)
  and `resolveWorkspaceImport` handles workspace packages. The new fixture imports the guard by alias
  and it resolves. So the ONLY real gap was named-status-constant recognition — which is what shipped.
- ghostfolio itself is not clonable in this container (no external app checkouts here), so the
  measurement is via the ghostfolio-shaped fixture, not the live repo. Re-measure on the real
  ghostfolio checkout when available (expected: 91 `HasPermissionGuard` asserted → verified →
  PARTIAL→PROVEN if coverage is otherwise clean).

## Decisions made
- Recognize named status constants but ONLY the member form on the two auth-deny codes
  (`.FORBIDDEN`/`.UNAUTHORIZED`). No bare identifier `FORBIDDEN` (too ambiguous), no other status
  names. Honest because the value IS 403/401 by the spec — same soundness as the numeric literal, not
  fuzzy name inference (the thing ADR-060+ removed).

## Bugs hit
- None. Suite green throughout; the uncommitted `isDenyStatusArg` edits from the prior session were
  intact and correct.

## Notes for the next session
- Deny recognition now covers: numeric 401/403, named `X.FORBIDDEN`/`X.UNAUTHORIZED`, `return false`
  in a canActivate, and the auth-library catalogs (passport/express-jwt/@nestjs/passport). The next
  measured gaps to hunt (each needs a real measurement first, per the standing rule): CommonJS
  `require`-form auth guards in `collectAuthGuards`/`collectDbHandles` (the hackathon 0%-verified gap);
  cross-module opaque DB handle (`import { db } from './db'`, ADR-068 V2).
