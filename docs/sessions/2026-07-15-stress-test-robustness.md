# 2026-07-15 — the harder stress test: 4 new giants, 2 real foundation bugs fixed (0.37.0)

**Scope:** "are we perfect? test harder than n8n first, then we decide." Ran SPARDA on 4 new
reputedly-hard giants, found it failed on ALL FOUR (differently), fixed the two foundational ones.
**Branch:** `claude/current-task-u45a4d` · **Tests:** 572 ✓ (3 skip), ESLint 0, Prettier clean

## The stress test (the honest answer to "are we perfect?" — no)

| App     | Type                     | Result                                   | Root cause                                                             |
| ------- | ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------- |
| Vendure | Nest + GraphQL           | 312 routes but **PROVEN at 0% coverage** | TypeORM via custom `TransactionalConnection` → 0 writes resolved       |
| Ghost   | Express (custom routing) | **CRASH** (entry not found)              | entry `core/shared/express.js` past the 400-file scan cap (1381 files) |
| Payload | Next/own                 | error "no framework"                     | pointed at a library package (Next-based HTTP elsewhere)               |
| Strapi  | Koa                      | error "no framework"                     | Koa unsupported + monorepo dir defeated the graceful message           |

## Done — the two FOUNDATION fixes

- **E-037 — killed the reads-only hollow PROVEN.** `countProvable` (db_write/http_call/fs_write
  only) now gates `surfaceOnly`; a reads-only app is SURFACE, never PROVEN. Vendure PROVEN → SURFACE.
  Every app with a real write byte-identical. This is the effect-level twin of ADR-034's provability
  guard, and the first concrete piece of the "verdict must be about something" doctrine. Fixture
  `ubg-reads-only` + 2 tests.
- **E-036 — a real Express giant no longer hard-fails.** Entry-named files get their own scan
  budget, found at any depth. Ghost: crash → honest NO_PROOF (entry found; its custom routing layer
  is genuinely unseen). Fixture `ubg-express-buried` + 2 tests.
- Confirmed the CLI already degrades gracefully (index.js catches USER errors → exit 1, no stack
  trace), so Payload/Strapi are honest "can't analyze from here" exits, not crashes.

## Not done / deferred (the honest gaps this test surfaced)

- **Vendure effect depth:** TypeORM repository via a custom `TransactionalConnection` wrapper is not
  resolved → 0 writes. This is the ORM-breadth ceiling (same family as n8n's 21.7%). Real work, own
  session — the ORM import-root provenance increment is the vehicle.
- **Ghost / Payload routing:** custom route-registration frameworks (Ghost's `@tryghost/*`, Payload's
  own layer) — deep walls, correctly scoped out. Ghost now degrades honestly instead of crashing.
- **Koa/Strapi:** still unsupported (the adapter-DSL / structural-recognition path, ADR-055 family).

## Decisions made

- A positive PROVEN requires state-CHANGING observed behavior. Reads and read-only state nodes
  carry no obligation, so they cannot lift SURFACE → PROVEN. (E-037; feeds the PROVEN-COMPLETE
  doctrine.)
- Bounded scans on giants must be prioritized by category, never a flat cap that the bulk can
  starve. (E-036.)

## Notes for the next session

- The stress test VALIDATED the doctrine: Vendure is exactly the "verdict should say partial/blind,
  not proven" case. The next doctrine brick — `PROVEN-COMPLETE` vs `PROVEN-PARTIAL` graded by
  coverage / the decidable-fragment certificate — is the natural continuation of E-037.
- New corpus targets that expose depth gaps: vendure (`packages/core`), ghost (`ghost/core`). Both
  ephemeral — re-clone. n8n remains the decorator-framework success case.
- Order still: doctrine (`docs/DOCTRINE.md` / ADR-056) framing the two fronts, then the
  decidability certificate as the first brick (E-037 is its seed).

## Consolidated stress test — 17 giants, ZERO unhandled crashes (v0.38.0)

Real analysis (routes + effects + coverage):

- directus PROVEN 95% · immich NOT_PROVEN 92% · twenty NOT_PROVEN 47% · open-webui PROVEN 77%
- n8n NOT_PROVEN 22% · novu NOT_PROVEN 59% · nocodb PROVEN 71% · ghostfolio NOT_PROVEN 75%
- cal-web (Next App Router) NOT_PROVEN 86%

Honest degrade (unsupported routing / spec-only / ORM-depth gap — SURFACE/NO_PROOF, not a crash):

- vendure SURFACE (TypeORM custom-connection depth) · ghost NO_PROOF (custom Express routing)
- langflow NO_PROOF · rocketchat NO_PROOF (Meteor) · supabase-studio SURFACE
- Kubernetes OpenAPI: **1094 routes, SURFACE, 0.5s** (any-language path at scale — surface only, honest)

Clean unsupported exits (Koa, deps at monorepo root): outline, strapi, payload — exit 1, no hard crash.

**Speeds:** 0.09–3.4s across all. **The ONE remaining honesty bug:** cal-api-v2 reads PROVEN at
~0% coverage with a single non-read effect → the coverage-graded verdict (PROVEN-COMPLETE vs
PROVEN-PARTIAL) is the validated,next brick. No new failure CLASSES emerged after 17 giants —
the picture is stable: supported frameworks analyze well; everything else degrades honestly.
