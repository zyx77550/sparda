# Multi-repo organ stress test — where SPARDA excels, where it fails

**Date:** 2026-07-12 · **By:** Claude · **Ask (Zak):** test every organ with absolute
rigor, on any code/language, on big monstrous repos, across several repos, and score them.

**Method:** a harness (`scratchpad/organ-probe.mjs`) runs *all* organs on one app and
records status + numbers. Ran it on 7 real targets across 6 ingestion paths. Sparse shallow
clones; effect counts read from the canonical graph. Numbers are from this machine.

## The corpus (real repos, not fixtures)

| Repo | Path / lang | Routes | **Effects resolved** | Skipped | Compile | Verdict | Findings |
|---|---|---|---|---|---|---|---|
| **dub** (dubinc/dub) | Next.js app-router, TS | **559** | **827** (244 write / 420 read) | 7 | 712 ms | NOT PROVEN | **149** (145 crit) |
| **Medusa** (medusajs) | file-based, TS | **476** | **464** (435 write) | 0 | ~600 ms | PROVEN | 0 |
| **immich** (immich-app) | NestJS + DI, TS | **281** | **1** ⚠ | 3 | 3 921 ms | PROVEN ⚠ | 0 |
| **GitHub REST API** | OpenAPI 3.1, any lang | **1196** | **0** ⚠ | 0 | 500 ms | PROVEN ⚠ | 0 |
| **FastAPI template** | FastAPI, Python | 22 | 4 | 6 | 75 ms | PROVEN | 0 |
| **express-boilerplate** | Express, JS | 8 | **0** ⚠ | 0 | 55 ms | PROVEN ⚠ | 0 |
| **parse-server** | Express lib, TS | **DETECT FAIL** | — | — | — | — | — |

The ⚠ rows are the story: **hundreds/thousands of routes, ~0 effects, yet a green PROVEN.**

## The headline finding — "hollow PROVEN"

SPARDA's verdict conflates two states that must not be equal:

1. **Real PROVEN** — SPARDA saw behavior (effects, state) and discharged every obligation.
   *dub* (827 effects → 149 real findings), *Medusa* (464 effects, all guarded → clean),
   *FastAPI* (4 effects → clean). These are trustworthy.
2. **Hollow PROVEN** — SPARDA saw routes but resolved **~0 effects**, so there were no
   obligations to fault, and "clean" is vacuous. *immich* (281 routes, **1** effect),
   *GitHub OpenAPI* (1196 routes, **0** effects), *express-boilerplate* (8 routes, 0 effects).

Both print the same green **PROVEN** today. That is the single biggest honesty gap in the
product: a 1196-route "app" cannot be truthfully "proven safe" when SPARDA never saw a single
state-touching effect. This is the effect-level analogue of the existing NO-PROOF guard
(which already refuses to bless a 0-*route* graph, ADR/E-series). **Recommendation:** a graph
with routes but zero state-touching effects must report **"SURFACE ONLY / NO BEHAVIOR
OBSERVED — a coverage gap, not a clean bill"**, never PROVEN. (For `--openapi`, this is
*inherent*: a spec has no bodies, so it can only ever be surface-only — say so.)

## Why effects are lost (root cause, per path)

- **Inline effects → resolved (10/10).** Next.js/dub, Medusa (workflow-verb synthesis), and
  FastAPI put the DB call in (or one hop from) the handler body, so `scanFunction` sees it.
- **DI/service effects → lost (NestJS).** immich's controllers delegate to injected
  services/repositories through a pattern our `nestjs.js` DI resolver doesn't follow (real
  immich uses abstract repository interfaces + custom providers, not the constructor-type
  `this.svc.method()` shape the fixture proved). Result: routes found, effects not.
- **External controllers → lost (Express).** express-boilerplate wires
  `router.post('/', validate(x), controller.create)` where `controller.create` lives in
  another file; our Express extractor doesn't follow that import to scan the real body.
- **Spec → structurally none (OpenAPI).** No code, no effects — expected; the verdict just
  needs to say "surface only".

## Scorecard — per organ, graded on the evidence

| Organ | Grade | Evidence |
|---|---|---|
| **route ingestion** (detect→parser→extract→translate) | **10/10** | Never crashed. 8→1196 routes across Express, Next, NestJS, Medusa, FastAPI, OpenAPI. Deterministic. Fast (dub 559 in 712 ms). |
| **effect extraction** (the depth behind routes) | **6/10** | Excellent inline (dub 827, Medusa 464); **fails on DI (immich: 1) and external Express controllers (0).** The real ceiling on proof quality. |
| **apocalypse — engine** | **10/10** | 2–5 ms to check *all* obligations even at 1196 routes; found 149 true findings on dub. |
| **apocalypse — verdict honesty** | **6/10** | Blesses hollow PROVEN when effects = 0. The #1 fix. |
| **fingerprint** | **8/10** | Hashes 100% of routes, coordinate-free, deterministic. Over-collapses when effects are absent (1196→39 distinct) — a symptom of the effect gap, but the "distinct behaviors" number misleads. |
| **polarity** | **10/10** | Ran on every repo; ternary, deterministic. |
| **immunize** (capsule) | **9/10** | 1 byte/route everywhere; inherits the hollow-PROVEN flag. |
| **speculate** | **10/10** | 100 % self-consistency on all 7 (settled by lookup, 0 novel). |
| **genome** (mint/verify/index) | **10/10** | Every antibody valid on every repo; O(1) index built. |
| **openapi-emit** | **9/10** | Round-trips GitHub's 790 paths; emits 3.1 from every graph. |
| **dossier** | **10/10** | Rendered valid self-contained HTML for all. |
| **mirror** | **9/10** | Built an executable mock from every graph (incl. 1196 routes). |
| **verify** (self-laws) | **10/10** | 6 compiler laws held on every repo. |
| **detect** | **8/10** | Correct on 6 frameworks; **filename-based Express entry** → parse-server (`ParseServer.ts`, a lib) not detected. |

**SPARDA in one line:** *world-class at seeing and judging the route surface universally and
fast; the ceiling is how deeply it resolves the effects behind each route, and how honestly
it labels the verdict when it can't.*

## Prioritized fixes to get to "10/10 everywhere"

1. **Hollow-PROVEN guard (verdict honesty). ✅ SHIPPED (ADR-042).** Routes > 0 but zero
   state-touching effects → `SURFACE ONLY`, not PROVEN. immich and GitHub-OpenAPI flipped from
   hollow PROVEN → SURFACE ONLY; dub/Medusa unchanged. A new `ubg-proven` fixture is the
   suite's first *genuine* PROVEN (the old "clean app" test ran on an effect-less echo app).
2. **NestJS effect depth. ✅ SHIPPED (ADR-043).** tsconfig `baseUrl`/`paths` imports +
   multi-hop DI + inherited (`extends BaseService`) DI + Kysely + guard-by-decorator-name.
   immich: **1 → 310 effects, 45 state tables, 253 guards**, hollow PROVEN → NOT PROVEN with
   **2 genuine** OAuth findings (no false-positive noise). *(biggest proof-quality win — done.)*
   Still open: string-token providers (`@Inject('TOKEN')`) — no static type to follow.
3. **Express external-controller resolution. ✅ SHIPPED (ADR-044).** Recursive module-member
   deep scan (controller → service → model) + barrel re-exports + Mongoose. express-boilerplate:
   **0 → 9 effects, 2 state tables**, SURFACE ONLY → NOT PROVEN with 3 genuine findings.
4. **Express detect robustness. ✅ SHIPPED (ADR-045).** Bounded tree-scan fallback for the
   `express()` app-factory when no named candidate matches; ranks a `.listen()`ing server
   first. parse-server now detects (`src/ParseServer.ts`) instead of hard-failing.
5. **Enumerate parser skips.** dub 7, FastAPI 6, immich 3 — list what/why; each is a small
   coverage rung.
6. **NestJS compile speed.** immich 281 routes took 3.9 s (vs dub 559 in 0.7 s) — the DI
   import-following is the cost; cache parsed service modules.

None of this needs Rust or a daemon: the engine is already microseconds; the wins are in
*effect resolution depth* and *verdict honesty*, which are pure static-analysis work.
