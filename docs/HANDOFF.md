# HANDOFF — current state

> Living document. Describes the **present**. Rewritten at the end of every
> session that changes anything (history goes to `sessions/`, not here).

**Last updated:** 2026-07-06 (c) · **OpenAPI, Mirror & Verify SHIPPED & v0.12.0 LIVE.** Includes capabilities, lifetimes, SQL/Prisma state machines, Timeless Flight Recorder, OpenAPI ingestion/emission, Mirror VM simulation, and compiler verification (verify).
**Version:** 0.12.0 live (published on npm + registry).
**Branch state:** main branch. Tests **384/384 Vitest + 10/10 router self-test** green; ESLint 0 errors, Prettier-clean.

## ✅ Done (works, tested)

- **v0.1 core** — detect → AST parse (Express JS/TS/ESM/CJS, FastAPI) →
  sanitize → generate → reversible marked injection → stdio bridge. CI green.
- **v0.2 trust layer** — semantic pass via MCP sampling (cached in
  `sparda.json`), write confirmation (elicitation), proof-after-write,
  live error feed, `sync` + post-commit `hook`, BUSL 1.1, Residual Labs
  branding.
- **v0.3 immune system** — latency baseline + antigen events, quarantine
  (3×5xx → 503, half-open, `SPARDA_QUARANTINE_MS`), adaptive diagnoses via
  `sparda_get_context` session-resume tool, honest `isError`. Full E2E
  through a real MCP client closed 2026-06-11 (32/33 green, all findings
  E-010..E-013 fixed with regressions). **Published as `sparda-mcp@0.3.0`**,
  post-publish smoke test green.
- **v0.4 — the recycling economy + first Labs organ** (complete):
  - **R4.1 recycling economy** — counts servedByCircle vs paidFull and avoided token estimates.
  - **R2.1 sequence condenser & R2.2 crystallization** — GET-only composite tools detection and execution.
  - **R4.2 purity detector** — GET+200 fingerprints classification.
  - Published as `sparda-mcp@0.4.0`.
- **v0.5 — SPARDING Proof v0.1, Hardening & Engine Integration**:
  - **Runtime Proof Engine**: Deterministic `spardaProof` / `sparda_proof` in router templates. Calculates risk, decision, checks, and reasons on `/invoke`.
  - **Compile-time Policies**: Injects user policies statically from `sparda.json`.
  - **Route Fingerprints**: Hashed signatures in `sparda.json` to detect route modifications during sync/init.
  - **Bridge Logging**: Intercepts proofs in `stdio.js` and updates `sparding.events` (bounded max 100) and `sparding.failures` (aggregated structural lessons) in `sparda.json`. Local decline logging for elicitation declines.
  - **Two-phase commit for `require_human` (v0.5.1/v0.5.2)**: Write/delete returns `202 awaiting_confirmation` with a single-use confirm token, preview payload, and readable instructions; executed via `POST /invoke/confirm`. Fully wired for both Express and FastAPI.
  - **JSON Error Envelope (v0.5.1)**: Catching body-parser SyntaxErrors and other router-level exceptions to return clean JSON errors with correlation `errorId` instead of leaking HTML stacks.
  - **Flywheel Organ & Bridge Wiring (slice 5a/5b, R4.3)**: Caches and serves proven-stable reads from memory verbatim (no host call, RAM-only, value-free snapshot). Validated on 3 identical sightings. Synchronous GET-sibling purge on writes, plus invalidation of Bloc D ghost-affected reads. Bridge kill-switch `SPARDA_FLYWHEEL=off`.
  - **Évaluation stratégique & technique (juin 2026)** : Pendant que Claude préparait confidentiellement le split open-core, Gemini et Zak ont collaboré sur des prompts d'évaluation pour interroger deux IA expertes (Claude Opus et Kimi VC). Les rapports détaillés, la synthèse d'analyse croisée, et les propositions techniques de correction (HMAC, SHA-256 salé, validation syntaxe/merge AST) ont été consignés localement (fichiers gitignored) dans [sparda_evaluation_opus_report.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/scratch/sparda_evaluation_opus_report.md), [sparda_evaluation_kimi_report.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/scratch/sparda_evaluation_kimi_report.md), [sparda_evaluation_cross_analysis.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/scratch/sparda_evaluation_cross_analysis.md) et [sparda_evaluation_fixes_proposal.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/scratch/sparda_evaluation_fixes_proposal.md). Les vulnérabilités ont été intégrées dans la roadmap.
  - Tests: 229/229 Vitest tests green (including new `invalidateCache` spine tests, 55 engine tests, 14 persistence tests, 56 sparda tests, 58 context-carrier tests, and 18 publish-gate tests).
- **Public-Split and Hardening (v0.5.3)**:
  - Created public open-core repository `zyx77550/sparda` with clean, squashed Git history.
  - Implemented branch protection on `main` (requires PR, 1 approving review from Code Owner, 4 CI matrix status checks, force-push and deletion disabled).
  - Added CODEOWNERS file for critical paths.
  - Configured repository actions workflow permissions (requires approval for outside PR contributors).
  - Updated `package.json` with repository, homepage, and bugs metadata, and bumped version to `0.5.3`.
  - Updated profile README `zyx77550/zyx77550` to list SPARDA in the Residual Ecosystem.
- **Eval-driven hardening + real benchmark (2026-06-24, unreleased on `main`)** —
  acted on the external technical eval. Session record:
  `sessions/2026-06-24-eval-hardening-and-benchmark.md`.
  - **Lot A robustness** — `stdio.js` guards the `sparda.json` parse (corrupt
    manifest → `USER` error, not a raw `SyntaxError`); both generators cap request
    bodies at 64KB (`express.json({ limit: '64kb' })` and a symmetric
    `sparda_read_json()` streaming guard → `413` in the FastAPI template, wired
    into gossip/invoke/confirm). +1 corrupt-manifest regression and a FastAPI
    `413` assertion → **230/230**.
  - **Lot D benchmark** — `bench/flywheel-bench.mjs`, **no new deps**, drives the
    real stdio bridge. Replaces the phantom "97%" with reproducible numbers
    (`bench/results.json`): **+2.7ms p50 proxy overhead**; armed flywheel served
    **501 reads from RAM with the host touched zero times**; hit-rate is
    workload-shaped (50% on a 1:1 pure/volatile mix). Key finding: the flywheel
    lives in the **bridge**, not the router — the router's `servedByCircle` gauge
    counts quarantine blocks, *not* cache hits.

- **Eval Lot B — lint / format / coverage tooling (2026-06-24, unreleased on
  `main`)** — session record: `sessions/2026-06-24-lint-format-tooling.md`.
  - **ESLint 9 flat config** (`eslint.config.js`, `@eslint/js` recommended,
    `eslint-config-prettier` last) + **Prettier** (`.prettierrc.json`) with
    `lint`/`lint:fix`/`format`/`format:check` scripts. Baseline taken green:
    ESLint 36 → **0 errors** (real fixes — dead imports/vars, not silenced),
    41 owned JS files Prettier-clean, full suite re-run **230/230 + 10/10**.
  - **CI** gained a **separate** optional `lint` job (ubuntu, node 22). The 4
    required `Test Node {18,22} on {ubuntu,windows}` checks are untouched — public
    branch protection keeps passing; promoting `lint` to required is an owner step
    (do with Lot C).
  - **Vitest v8 coverage** (`vitest.config.js` + `npm run coverage`) measures
    `src/**` → gitignored `coverage/`. Reports, does **not** gate (no thresholds).
    Baseline on this machine: ~60% lines, 78% branches, 88% functions. `npm test`
    is byte-identical (instrumentation only under `--coverage`).

- **Eval Lot C — community surface, files (2026-06-24, on `main`)** — session
  record: `sessions/2026-06-24-community-surface-lot-c.md`. Added `CONTRIBUTING.md`
  (dev setup, the 9 hard rules a PR may not break, the check matrix, commit/PR
  conventions, BUSL/open-core note, security-report routing), `CODE_OF_CONDUCT.md`
  (Contributor Covenant 2.1, contact `contact@residual-labs.fr`), and
  `.github/dependabot.yml` (weekly npm + github-actions; dev deps grouped, the 4
  runtime deps left as individual PRs to honour hard rule #8). Markdown/YAML only —
  no code, so the lint/format/test baseline is unchanged.

- **Eval Lot C — public-repo owner actions COMPLETE (2026-06-24)** — session
  record: `sessions/2026-06-24-lot-c-public-actions.md`. The HQ→public sync (run
  by Gemini) landed the community files + the 4 Lot B tooling configs on public
  `main` via PR #2 (squash-merged, all 5 checks green). Then, on public
  `zyx77550/sparda`:
  - **First release tagged** — `v0.5.3` cut against `main`
    (`releases/tag/v0.5.3`). Kills the eval's "no releases" finding.
  - **`Lint & format` promoted to a required check** — branch protection now
    requires **5** contexts (4 test matrix legs + lint), `strict:true` preserved.
  - **Codecov coverage job** added to HQ `.github/workflows/ci.yml` (commit
    `9d296f4`): dedicated job runs `npm run coverage` → lcov, uploads tokenless,
    gated to the public mirror, `fail_ci_if_error:false` (report-only). **Synced to
    public via PR #10** (merge `07b2eb8`, all 7 checks green); the first tokenless
    upload **self-activated** the Codecov repo (`activated:false`→`true`, no manual
    OAuth needed) — `totals`/badge populate once the job runs on `main`.

- **Sandbox Step 1 — pluggable persistence / Chantier 1** (committed, ADR-019):
  - **`src/server/persistence.js`** — one durable writer (temp → **fsync** →
    rename) is now the single source of truth for `sparda.json`; replaced two
    fsync-less `atomicWrite` copies in the Express/FastAPI generators. The
    bridge's `immune`/`sparding`/`semantic`/`labs` merge-writes and the
    condenser route through it too — no raw manifest `fs.writeFileSync` left.
  - **Driver seam** (Memory / LocalFile / lazy-Redis + `createStateDriverFromEnv`)
    for *future* engine state and multi-node — **not** the manifest, which stays
    a local git artifact. Redis is a lazy `import('ioredis')`: no 5th runtime dep.
  - Tests: `tests/persistence.test.js` (11/11). FastAPI byte-for-byte tests got
    explicit 30s timeouts + `verifyPythonSyntax` 2s→5s (Windows py cold-start).
- **The bible** — CLAUDE.md, docs/, ROADMAP.md (4 rounds), pain-first README
  (v0.4 section added), EXPLAINER.md, SPARDA-EXPLIQUE.md (fr).
- **e2e client committed** — `tests/e2e/` (manual-use, real-MCP-client).
- **v0.6.0 — Next.js App Router & Case Study** — Support for Next.js file-based injection (`app/mcp/[...sparda]/route.js`). Case study and blog post written and deployed to `residual-labs.fr`. Published as `sparda-mcp@0.6.0` on npm + MCP Registry.
- **v0.7.0 — doctor --app (Negentropy) & seed (Lite)** — Scan for drift, fingerprints, and stale configs. Export/import semantic context. Published as `sparda-mcp@0.7.0` on npm + MCP Registry.
- **v0.7.1 — R2.4 Re-mapping & doctor timeout** — Re-mapping composite tools on route renames. Increased doctor timeout to 5000ms for Next.js lazy compile. Published as `sparda-mcp@0.7.1` on npm + MCP Registry.
- **v0.8.0 — Round 3 Complete (Twin, Grammar, Evolve, Germinate)** — Real mock server simulation (`twin --learn` / `twin`), syntax grammar graphs (`grammar`), genetic mutations (`evolve`), full germination (`seed import --germinate`). Published as `sparda-mcp@0.8.0` on npm + MCP Registry.
- **v0.8.1 — ADR-022 localKey security backport** — Restricts secret leak by removing the `localKey` from the generated `sparda.json` manifest. It is written dynamically to `.sparda/key` (local, gitignored) and resolved dynamically at runtime (env -> file -> fail-closed 503). Published as `sparda-mcp@0.8.1` on npm + MCP Registry.
- **v0.9.0 — Rebranding & UBG Compiler** — Pivot from generator wrapper to Unified Behavior Graph (UBG/SBIR) compiler. Added passes `DeadPathElimination`, `StateMinimization` and `TypePropagation`. Integrated a static security deployment prover `sparda apocalypse`. Published as `sparda-mcp@0.9.0`.
- **v0.10.1 — FlightBox Singleton & CI Audit Fixes** — Resolved critical FlightBox instantiation duplicate singleton bug, fixed replay middleware overlap with live recording store, added Python-missing guards to Vitest runner, and fixed router-selftest ADR-022 integrations. Published as `sparda-mcp@0.10.1`.
- **v0.11.0 — Prisma State Layer & GitHub Action Integration** — Compiles `schema.prisma` files directly, infers enums as state machines, maps relations, and integrates a GitHub Action to output SARIF reports. Published as `sparda-mcp@0.11.0`.
- **v0.12.0 — OpenAPI Ingestion/Emission, Mirror VM & Verify** — Ingests external API specs (`ubg --openapi`), hosts mock simulated endpoints directly from the graph (`mirror`), generates OpenAPI 3.1 specifications (`openapi`), and verifies compiler correctness invariants (`verify`). Published as `sparda-mcp@0.12.0`.


## ⚠️ Not done / known gaps

- **v0.4 not published to npm** — owner decision (version bumped to 0.4.0
  in package.json + bridge).
- ~~R2.4 (re-mapping condensed tools)~~ **DONE 2026-07-04** — deterministic
  unique-successor re-map at wake-up; dormant-with-lesson otherwise.
- ~~P2 backlog from the E2E~~ **cleared 2026-06-12**: query params now
  AST-detected (`req.query.X` + destructuring, FastAPI already had them);
  MCP `annotations` on every tool (readOnly/destructive/idempotent/openWorld);
  `remove` uninstalls the post-commit hook (created → deleted, appended →
  byte-for-byte restore).
- `localKey` plaintext gap documented in SECURITY.md — decision pending.
- ROADMAP round 3 and Shadow tier: designed, not started.
- **Sandbox integration (`sparda-sandbox/ARCHITECTURE.md`)** — Step 1
  (persistence) done. **Step 2** (FastAPI HFT) — only the part that fits the
  proxy router landed: `memoryview` zero-copy on the purity fingerprint in
  `templates/fastapi-router.txt` (crc32 reads the first 64KB in place, no 64KB
  copy per GET+200). The double-buffer streaming + host-wide `add_middleware`
  wrapper are **deliberately deferred**: they assume SPARDA sits in front of
  every host request (breaks hard rule #1) and import the sandbox neural engine
  (`sparda_unified`) prod doesn't have. They only become relevant once the 4
  core engine blocs (A/B/C/D) are in prod. ThreadPoolExecutor offload was
  already in prod. **Step 3** (Mycélium P2P gossip — JCS + Ed25519, needs its
  own ADR: it changes the 127.0.0.1-only posture) not started.
- **Windows rename hardening on `atomicWriteFileSync` (parked, owner's call
  2026-06-14)** — `fs.renameSync` in `src/server/persistence.js` can transiently
  throw `EPERM` on Windows when Defender/the search indexer briefly locks the
  target (seen as a ~1-in-N flake in the `.gitignore` byte-for-byte test; passes
  on retry). A bounded retry on `EPERM`/`EACCES`/`EBUSY` fixes it. **Do this
  small fix only AFTER the 4 core engine blocs are implemented and the full
  suite is solidly green.**

## 🎯 Adoption roadmap (owner-validated 2026-07-02, paid tier stays parked)

1. ~~npm 0.5.4 + registry~~ **DONE** — then superseded: **0.6.0 published on
   npm AND the MCP registry (2026-07-03, Gemini)**.
2. ~~`sparda report`~~ **DONE 2026-07-02** (shipped in 0.6.0).
3. ~~**Next.js App Router parser**~~ **DONE 2026-07-03**, shipped in 0.6.0 —
   dogfooded on the 4 real Residual Next repos (120 routes, builds green,
   zero code touched; artifacts left UNCOMMITTED on purpose — do not commit
   sparda.json + app/mcp/ into the SaaS repos or Vercel deploys them).
4. ~~**Negentropy `doctor --app`**~~ **DONE 2026-07-03 (b)** (see header) —
   unreleased on npm; next publish carries it.
5. ~~**`sparda seed export/import`**~~ **DONE 2026-07-03 (c)** — the adoption
   roadmap is COMPLETE. Owner publishes 0.7.0 (negentropy + seed), then the
   focus shifts to distribution (posts, dogfood case study) and R2.4/Round 3.

## 🎯 Next steps (in order)

> **Eval response (Lots A–D) is fully closed** and the HQ→public sync is done
> (PR #10): release `v0.5.3`, `Lint & format` required, coverage job live on
> public `main`, Codecov **self-activated**. Nothing operational is pending.

1. **E2E — largely DONE 2026-06-26 (was the biggest blind spot).** New
   `tests/e2e/phase4.mjs` (fixture-based real MCP client) ran **7/7 ALL PASS**:
   protocol (write tools hidden, `/v2/meta` skipped), annotations, live read,
   **flywheel armed** (purity: prospects=pure, health=unknown), **crystallization**
   (composite `circuit_get_api_prospects_then_get_api_users_by_id` at ×3 + ran live),
   stdout discipline. `remove` byte-for-byte clean-diff re-proven (`git diff` empty).
   Step-by-step + one-command guide: `docs/E2E-RUNBOOK.md`.
   - **Still optional (manual, low risk):** §5 write opt-in via a real client's
     *native elicitation* accept/decline — covered today by 10/10 router self-test
     (confirm-token two-phase) + the archived phase3 debrief, not re-driven through
     Claude Desktop. The old `tests/e2e/phase1-3` remain pinned to the deleted
     `sparda-demo-app` (quarantine/antibody regression) — revive only if suspected.
2. **ADOPTION before monetization (owner call 2026-06-26).** No free users yet ⇒
   the paid tier waits. Session: `sessions/2026-06-26-adoption-mcp-registry-prep.md`.
   - **Official MCP registry — metadata PREPPED 2026-06-26.** `package.json` carries
     `mcpName: io.github.zyx77550/sparda-mcp`; `server.json` (schema `2025-12-11`) is
     schema-valid at repo root, points at the **public** repo + npm `sparda-mcp`,
     command `dev`. **Publish gated on the owner** (npm + GitHub auth) AND on npm
     carrying a version with `mcpName` — 4-step runbook in the session note. Honest
     caveat: `npx sparda-mcp dev` cold does nothing (needs `sparda init` + a running
     host) — the listing converts only once `demo` (below) exists, so **hold publish
     until then**.
   - **`npx sparda-mcp demo` — DONE 2026-06-28.** Session:
     `sessions/2026-06-28-demo-standalone-mode.md`. Ships a top-level `demo-app/`
     (in the npm `files` array) and `src/commands/demo.js`; runs the **real**
     pipeline (detect → parse → sanitize → generate → inject → remove) on it in a
     throwaway temp dir, narrating all six guarantees, then proves `remove` is
     byte-for-byte clean. **Deliberately STATIC** (no host, no bridge, no port, no
     express install) — `detect`/`parse`/`generate` are pure AST+file ops, so it
     **cannot fail** on the user's machine and never touches their project. Test
     `tests/demo.test.js` (2/2) pins the contract. **Design note (honest):** this is
     a *terminal* try-it, NOT a registry auto-launch MCP server — running a live
     server needs express, which is a devDependency (absent under `npx`) → rejected
     (hard rule #8). So the registry's `server.json` command stays `dev` (the real
     MCP server, for users who ran `init`); `demo` is what the README/registry
     *description* points at for an instant "see it work". **Registry publish is now
     unblocked** (the listing is no longer a dead end — the description can say
     "run `npx sparda-mcp demo`"), still owner-gated on npm+GitHub auth.
   - **Next.js route-handler parsing** — highest-leverage framework add for reach
     (dominant JS framework, owner dogfoods it). A new parser path.
   - *(Parked until there are free users: **v0.5 Shadow** paid tier — HQ-private per
     ADR-016 — and the **§6 security chantiers**: harden `remove` vs Prettier reformat;
     FNV-1a → salted SHA-256 PII; validate the Gossip CRDT P2P protocol.)*
3. **Dependabot** (public): 7 open PRs incl. 2 **major** runtime-dep bumps
   (`@babel/parser`, `@babel/traverse` 7→8) — review individually per hard rule
   #8 (each runtime bump is its own decision); the dev-dep group can go together.

*(Repo split / ADR-016 — **done**, shipped as v0.5.3: public `sparda` is live
with a squashed history and branch protection; this repo stays HQ.)*

## ❓ Open questions (owner decisions)

- Shadow tier pricing/naming final call; when to start the SaaS phase 2.
  *(still pending per owner, 2026-06-12)*
- `localKey` storage hardening (needs ADR — touches carry-over).
  *(still pending per owner, 2026-06-12)*
- ~~Desktop cleanup~~ **resolved 2026-06-12**: owner killed the leftover
  PID on :3344 and deleted `Desktop/app-demo`.
