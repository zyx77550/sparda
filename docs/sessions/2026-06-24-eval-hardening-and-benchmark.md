# 2026-06-24 — Eval-driven hardening (Lot A) + real flywheel benchmark (Lot D)

**Scope:** Act on the external technical eval (`SPARDA_0.5.3_Rapport_Evaluation_Technique.md`): land the two robustness fixes it flagged, with regressions, then replace the phantom "97%" marketing number with a reproducible, no-deps benchmark.
**Commits:** `8605d5b`, `17fd683`, `a80ffb7` (+ this doc) · **Branch:** `harden/eval-fixes` · **Tests:** 230/230 green (was 229; +1 corrupt-manifest regression)

## Done

### Lot A — robustness (2 fixes, symmetric across both frameworks)
- **Manifest parse guard** — `src/server/stdio.js` wrapped the unguarded
  `JSON.parse(sparda.json)` in try/catch. A truncated/corrupt manifest now exits
  with a `USER` error (`sparda.json is unreadable or corrupted: …` + hint to
  restore from git or re-`init`) instead of a raw `SyntaxError` stack. Regression:
  `MCP stdio bridge > rejects a corrupt sparda.json with a USER error`.
- **Request body cap (DoS surface)** — Express generator now renders
  `express.json({ limit: '64kb' })` (`src/generator/express.js`). FastAPI got a
  *symmetric* guard in `templates/fastapi-router.txt`: new `SPARDA_MAX_BODY = 64KB`
  + `sparda_read_json()` helper that checks `content-length`, streams with a
  running byte cap, and returns `413 payload too large` — wired into all three
  POST handlers (gossip, invoke, confirm). Regression: the FastAPI runtime test
  now asserts a 70KB body → `413`.

### Lot D — the benchmark (kills the phantom 97%)
- **`bench/flywheel-bench.mjs`** (~312 lines, **zero new deps** — uses only Node
  built-ins + the existing `express` devDep, so hard rule #8 holds). Drives the
  **real bridge over stdio**, not a synthetic loop. Generates a real router from
  the `express-demo` fixture, mounts it on a live host with a pure route
  (`/api/prospects`, constant) and a volatile route (`/health`, uptime).
  - **Part 1 — proxy overhead:** host-direct vs `/mcp/invoke`, n=3000 sequential.
  - **Part 2 — bridge flywheel:** arm (paced calls through the idle harvester)
    then a 500-call burst, measured ON vs `SPARDA_FLYWHEEL=off`, plus a 1:1
    pure/volatile mix to show hit-rate is workload-shaped.
- **`bench/results.json`** — committed example run (Pentium 2020M, 2 cores).
  Headline numbers, all reproducible:
  - **Proxy overhead:** +**2.7ms p50** (direct 1.61ms → mcp 4.30ms). Honest cost
    of the in-process router on the request path.
  - **Flywheel armed:** **501 reads served from RAM with the host touched zero
    times** (`servedFromMemory: 501`). p50 1.24ms ON vs 14.81ms OFF.
  - **Mixed 1:1 workload:** 50% served from memory — hit-rate follows read purity,
    not a fixed magic %.

## Not done / deferred
- **Lot B** (ESLint+Prettier flat config + `lint` CI job; `vitest --coverage` +
  badge) — offered, not started.
- **Lot C** (git tags/releases on the *public* repo; CONTRIBUTING.md,
  CODE_OF_CONDUCT.md, dependabot.yml) — offered, not started. Note the eval's
  "no tags/releases" finding is an artifact of it inspecting the squashed public
  mirror, not a real gap in HQ.
- **No autocannon / no load-gen dep** — deliberately. The original eval suggested
  `autocannon` against `/mcp/invoke`, but (a) that's a 5th runtime/dev dep against
  hard rule #8's spirit, and (b) it would have measured the *router*, missing the
  flywheel entirely (see Decisions).

## Decisions made
- **The flywheel lives in the BRIDGE, not the injected router.** The eval's
  benchmark premise ("hammer `/mcp/invoke` and watch the cache") was technically
  wrong: `createFlywheel()` runs in `stdio.js`/`engine.js`, serving reads from RAM
  *before* any HTTP call to the host. The router's `servedByCircle` gauge only
  counts quarantine-blocked calls — it is **not** the cache-hit counter. The real
  signal is `engine.snapshot().flywheel.stats.served`, surfaced via
  `sparda_get_context` as `recycling.flywheel.servedFromMemory`. The benchmark was
  redesigned around this: spawn the bridge, pace calls through the idle harvester
  to arm, then burst.
- **Headline = host-call elimination + p50, NOT the speedup multiple.** The
  ON-flywheel p95/p99 tail is noisier than OFF — a weak-machine artifact (faster
  calls ⇒ higher allocation churn/sec ⇒ fatter GC tail on a 2-core Pentium). The
  unarguable, binary claim is `servedFromMemory=501` (host hit zero times); the
  speedup multiple (4.8×–12× across runs) is real but variable, so it is not the
  headline.
- **Symmetric guards.** Any hardening that lands on Express must land on FastAPI
  in the same session, or the two generators drift. Did both for the body cap.

## Bugs hit
- **`ERR_MODULE_NOT_FOUND: 'express'`** on first bench run. The generated router
  `import`s `express`; the temp host dir was under `os.tmpdir()` (outside the repo)
  so Node couldn't resolve `express` from `repo/node_modules`. Fix: put the temp
  dir **inside the repo** (`bench/.tmp/host-*`, gitignored), exactly like the
  existing tests do with `tests/.tmp/`. Worth remembering for any future harness
  that renders a real router.

## Notes for the next session
- `bench/.tmp/` is gitignored; `bench/results.json` is committed as a reference
  run. Re-running on a real machine (not the Pentium) will show a cleaner ON tail
  and a bigger speedup — update `results.json` if you want nicer numbers, but the
  *method* is the deliverable, not any single run.
- When citing the benchmark publicly, lead with "+2.7ms p50 proxy overhead" and
  "501 reads served from memory, host touched zero times" — both are defensible
  and reproducible. Avoid quoting a single speedup multiple as if it were fixed.
- If Lot B lands, the `lint` job is the natural place to also fail CI when
  `bench/flywheel-bench.mjs` can't run (cheap smoke).

> Remember: `docs/HANDOFF.md` rewritten alongside this file.
