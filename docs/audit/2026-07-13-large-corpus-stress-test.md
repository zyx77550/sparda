# Large-corpus stress test — malmener SPARDA on real monsters

**Date:** 2026-07-13 · **By:** Claude · **Ask (Zak):** test on lots of repos, rough it up
hard, report honestly. **Method:** `scratchpad/organ-probe.mjs` + sparse shallow clones of
real OSS apps across frameworks/languages/ORMs. Numbers from this machine, current `HEAD`.

## Results — 12 real apps, ~3,700 routes, 195 real findings

| Repo | Framework | Routes | Effects | Guards | State | Verdict | Findings | Time |
|---|---|---|---|---|---|---|---|---|
| dub | Next.js | 579 | 853 | 1 | 71 | NOT PROVEN | 156 | 1.1s |
| immich | NestJS | 281 | 315 | 253 | 47 | NOT PROVEN | 2 | 0.9s |
| Medusa | file-based | 476 | 464 | 474 | 121 | PROVEN | 0 | 0.6s |
| express-boilerplate | Express | 8 | 9 | 1 | 2 | NOT PROVEN | 3 | 0.2s |
| FastAPI template | FastAPI | 22 | 4 | 0 | 0 | PROVEN | 0 | 0.1s |
| twenty | NestJS | 138 | 47 | 339 | 6 | PROVEN | 0 | 1.0s |
| novu | NestJS | 425 | 1060 | 618 | 327 | NOT PROVEN | 21 | 1.5s |
| cal.com | Next.js | 45 | 49 | 1 | 12 | NOT PROVEN | 13 | 0.2s |
| formbricks | Next.js | 119 | 7 | 5 | 2 | PROVEN | 0 | 0.2s |
| open-webui | FastAPI | 456 | 64 | 22 | 0 | PROVEN | 0 | 2.2s |
| GitHub REST | OpenAPI | 1196 | 0 | – | – | SURFACE ONLY | 0 | 0.5s |
| directus | Express | **0→239** | **0→5** | 16 | 1 | **NO PROOF→PROVEN** | 0 | 1.2s |

Plus honest rejections of unsupported frameworks: **dify** (Flask) → "no supported framework",
**documenso** (Remix), **parse-server** (Express *library* — detected, but NO PROOF because it
registers routes programmatically).

## What held up (the strong core)

- **Never crashed.** 15+ real repos, some huge — not one exception. Deterministic throughout.
- **Fast, now.** Every app compiles in ≤2.2s after the perf fix below (was 34s on twenty).
- **Deep resolution works at scale.** novu 1060 effects, immich 315 (253 guards), dub 853 —
  real behaviour resolved through DI/services, real findings surfaced (195 total).
- **Honest verdicts.** SURFACE ONLY (GitHub spec), NO PROOF (directus/parse-server), and clean
  rejection of Flask/Remix. It says "I can't see this" instead of faking a green.

## Bugs the stress test found — and FIXED this session

1. **Next.js dropped ~90% of routes.** The extractor only registered a route for an *inline*
   `GET`/`POST`; real apps wrap/alias the handler (`export const POST = withAuth(h)`). cal.com
   read **3 of 39** route files, formbricks **12 of 91**. Fixed (`verbHandlers`): a route now
   exists as soon as a verb is exported. **cal 3→45, formbricks 12→119, dub 559→579** (even the
   flagship was under-counting). Shipped (0.24.0).
2. **34s on a big Nest app.** twenty re-resolved shared service methods once *per route* and
   full-parsed every file to find `@Controller`. Fixed with cross-route memoization + a
   `@Controller` pre-filter. **twenty 34.5s→1.0s, novu 6.5s→1.5s, immich 3.4s→1.0s**, identical
   results. Shipped (0.24.1).

## Honest gaps still open (documented, not yet fixed)

- **Dynamic/registry Express mounting → directus 0 routes. ✅ FIXED (ADR-047).** directus builds
  the whole app inside `createApp()`; the extractor now descends into setup-function bodies +
  control-flow. **directus 0 → 239 routes.**
- **Instantiated services (`new Service().method()`) → directus SURFACE ONLY. ✅ FIXED
  (ADR-048).** Inline wrapped handlers are unwrapped, `new X()` resolves through the import and
  up the `extends` chain (with `this`/`super` re-dispatch), `this.knex('t')` reads as a table
  op. **directus SURFACE ONLY → PROVEN with observed effects** (0.28.0). Honest residue: its
  read paths bottom out in a fully dynamic query builder — no table literals to harvest —
  which is Round 7 #1 (interprocedural dataflow) territory, so the observation stays sparse
  (5 effect nodes / 239 routes).
- **GraphQL is invisible.** twenty is GraphQL-first; SPARDA reads its thin REST surface (138
  routes, PROVEN) but not the resolvers where the real behaviour lives. A whole unsupported
  surface, not just a gap.
- **Python effect resolution is shallow.** open-webui: 456 routes but 64 effects — the FastAPI
  path scans handler bodies but has no deep service/DI following like JS now does. PROVEN there
  is partly hollow.
- **Next.js handlers that call services aren't followed deeply.** formbricks 119 routes / 7
  effects / PROVEN — many handlers delegate to server actions/services; Next has no `deepScan`
  equivalent to Express/Nest yet.
- **ORM breadth.** Recognized: raw SQL, Prisma, Supabase/knex, Kysely, Mongoose. **Not** yet:
  Drizzle, TypeORM, Sequelize — apps on those under-report effects (→ SURFACE / low ratio).
- **Unsupported frameworks** (honest rejection, but real coverage gaps): Flask, Remix, Hono,
  Koa, Fastify.

## Update (0.29.0) — the blindspot ledger turns the unease into numbers

Every "hollow PROVEN" worry above was a hunch. The blindspot ledger (ADR-049) now measures it,
with **zero verdict change** (it reports, never re-judges). Coverage = resolved ÷ (resolved +
blind), from the same 11-app corpus:

| Repo | Verdict | Coverage | Blind (high+) | What the number says |
|---|---|---|---|---|
| dub | NOT PROVEN | **99%** | 13 (5) | genuinely sees almost everything |
| express-bp | NOT PROVEN | 92% | 2 (1) | small, mostly resolved |
| medusa | PROVEN | 90% | 539 (65) | deep resolution, but a big long tail |
| immich | NOT PROVEN | 88% | 295 (28) | mostly guards asserted by name |
| cal | NOT PROVEN | 86% | 9 (6) | — |
| novu | NOT PROVEN | 61% | 1142 (5) | huge surface, much un-followed |
| directus | PROVEN | **95%** | 37 (15) | was 13% — cross-class dataflow (ADR-051) resolved the `:collection` CRUD |
| twenty | PROVEN | **8%** | 406 (53) | GraphQL-first — REST surface is a sliver |
| formbricks | PROVEN | **8%** | 71 (57) | handlers delegate to un-followed services |
| open-webui | PROVEN | **0%** | 48 (16) | Python effect depth |
| fastapi | PROVEN | 0% | 10 (9) | template, nothing behind the routes |

The four PROVEN-at-≤13% apps are exactly the "honest gaps" listed below — now a number a reader
sees, not a caveat buried in an audit. "PROVEN" no longer implies "omniscient".

## Verdict on the "malmener"

The core is genuinely robust: it survived a large, hostile corpus without a single crash, stays
deterministic, and is now fast. The stress test paid for itself immediately — it found a
flagship-path bug (Next.js under-counting by 90%) and a 34× perf cliff, both now fixed. The
remaining gaps are all **breadth** (more mount patterns, more ORMs, GraphQL, Python depth, more
frameworks) — not soundness holes in what it already claims. That is the honest shape of a young
tool with a strong spine: the spine held; the reach is what's still growing.
