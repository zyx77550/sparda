# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Historical note: entries for 0.6–0.13.2 are tracked in the Obsidian journal
> and `docs/HANDOFF.md`; this file resumes structured entries at 0.13.3.

## [0.13.3] - 2026-07-07
### Fixed
- **Flight recorder — per-request entropy suppression.** The Node-18 guards
  that stop `fetch`/`crypto.randomUUID` from recording their internal
  `Date.now()`/`Math.random()` calls lived on the box (a global flag), not the
  request store. Under concurrent recording, one request's fetch window could
  swallow a *concurrent* request's entropy taps and silently corrupt its
  flight (caught fail-loud at replay, but a real determinism hole under load).
  Now scoped to `store.suppressEntropy` — per-request isolation via
  `AsyncLocalStorage`. This is the third audited fix; the first two shipped in
  0.13.2 (see below) but this one landed just after that cut.

## [0.13.2] - 2026-07-06
### Fixed
- **`verify` — the "canonical form is a fixed point" check was vacuous.** It
  compared `canonicalize(g)` against `canonicalize(g)` (trivially equal) and
  proved nothing. Now re-canonicalizes the already-canonical output: a real
  idempotence check. (The module that proves the compiler's laws had a hollow
  one.)
- **`openapi` ingestion — security filter was a no-op.** `opSecurity` filtered
  on `known.includes(s) || active.length`, always truthy, so an undeclared
  security scheme still produced a named guard. Now keeps declared schemes,
  falling back to raw references only when none are declared.

## [Unreleased]
### Added
- **ADR-022 completed for real: the key never touches a committed file.**
  The 0.8.0 backport still baked the localKey into the generated router as a
  fallback (and kept it in the manifest under a test-only flag). Now: the
  generators never substitute the key anywhere; all three router templates
  resolve it at runtime (`SPARDA_LOCAL_KEY` env → gitignored `.sparda/key`)
  and **fail closed** (503 "key not configured") when neither exists — an
  accidental deploy without `.sparda/` exposes nothing, by construction. The
  disk `sparda.json` is stripped of the key unconditionally (no VITEST-gated
  behavior differences between tests and production). ESM/CJS-safe file
  access via a generator-substituted `__FS_IMPORT__` (the old `require('fs')`
  silently threw in ESM apps, breaking file resolution). Tests updated to
  inject the key via env at router import, proving the fail-closed path.
- **Round 3, the predictive organism — the twin, the grammar, evolution —
  plus full germination (R3.2/R3.3/R3.4/R4.5, ADR-021).**
  - **`sparda twin`** (R3.2): a living mock reconstructed from the app's
    boundary. `twin --learn` calls the live router once per eligible GET and
    stores capped exemplars in `.sparda/twin.json` — the ONLY place a value
    ever lives (machine-local, gitignored, never the manifest, never a seed).
    `sparda twin` then serves the ghost: same routes AND the same `/mcp`
    surface, so the unchanged bridge (or any agent) exercises a harmless
    clone; writes are 202 echoes; `/mcp/stats` says `twin: true` — the ghost
    never pretends to be the flesh.
  - **`sparda grammar`** (R3.3): which call sequences MEAN something —
    observed edges from Labs circuits, hypothesis edges from exemplar
    response keys ∩ tool param names, always labelled apart, never acted on
    by themselves. Derived artifact `.sparda/grammar.json`, regenerable.
  - **`sparda evolve`** (R3.4): trials untested hypothesis chains against an
    in-process twin (never the host). Survivors land as SUGGESTIONS —
    `labs.circuits` entries with `seen: 0` and `evolved: true`, no composite:
    crystallization still demands the real observation threshold. Culled
    candidates are reported with their reason.
  - **`seed import --germinate`** (R4.5 full): the derived organs regrow from
    the imported genome on the receiving machine — structure travelled,
    values never did, and the grammar regerminates locally.
  - 10 new tests incl. the twin actually serving over HTTP, evolution
    trialing against it, and an end-to-end value-boundary proof (an exemplar
    value never appears in a seed or a grammar).
- **R2.4 — nothing disappears, x becomes y (composite re-mapping).** Until
  now a composite tool whose step route was renamed silently un-registered at
  bridge start. The wake-up pass now finds the step's **unique deterministic
  successor** (an enabled GET whose name keeps the old segments in order and
  ends on the same resource: `api_users` ⊂ `api_v2_users`) and re-maps the
  circuit — new key, renamed links, identity and observation count intact —
  with an `audit` event recording `x → y`. Ambiguity is never guessed: zero
  or two candidates puts the composite to sleep WITH a recorded lesson in
  `sparding.failures` (structure kept, it can come back). A step the USER
  disabled is respected — dormant, never re-routed around. Round 2 of the
  ROADMAP is now complete. 9 new tests.
- **`npx sparda-mcp seed export|import` — the genome (R4.5 lite).** Distills
  everything the organism LEARNED (semantic descriptions/workflows, immune
  antibodies, failure lessons, Labs circuit structure) into a portable
  `sparda-seed.json` that regerminates elsewhere — dev → prod, or a community
  seed for a popular stack — without re-paying the learning. Structure and
  lessons only, sanitized on export AND on import. **Security contract,
  pinned by tests:** a seed never carries (and import never reads) the
  localKey, the port, the sparding policies, or any per-tool `enabled` flag —
  a hostile seed cannot enable a write, flip a policy, or replace the key.
  Local knowledge always wins on conflicts; antibody hits merge as max();
  entries about tools the receiving app does not have are skipped. Same caps
  as the runtime organs (50 antibodies, 30 circuits). 8 new tests.
- **`npx sparda-mcp doctor --app` — the negentropy scan (R3.1, Maxwell's
  demon).** Deterministic rot detection with a named repair per finding:
  schema **drift** (stale tools the code no longer has, unsynced routes the
  manifest never met, shape drift via the sparding fingerprints), **dead
  current** (enabled tools with zero calls this session — honestly scoped,
  refuses the verdict without enough observation), **sickness** (live
  quarantine, recurring failure signatures, chronic antibodies served ≥3
  times while the wound stays open), **zombie config** (port drift,
  missing/stale router file vs the manifest's localKey). High-severity
  findings fail the doctor's exit code (CI-gateable). Zero LLM, zero new
  deps, works on all three frameworks. 11 new tests incl. an integration
  where rot is injected into the Next.js fixture and the demon smells it.
- **Next.js App Router support — the third framework.** `npx sparda-mcp init`
  now detects Next.js (dep `next` + `app/` or `src/app/`), AST-parses every
  `route.{js,ts}` handler (exported verb functions and `export const VERB =`
  arrows, filesystem-derived paths: `[id]` → `:id`, route groups stripped,
  catch-all/parallel/intercepting segments skipped with reasons, query params
  via `searchParams.get()`), and performs **file-based injection**: one
  generated catch-all handler at `app/mcp/[...sparda]/route.js` — web-standard
  Request/Response, zero imports — carrying the full organ set (proof engine,
  policies, write-safety, two-phase confirm, quarantine, purity, recycling
  gauge, gossip CRDT, 64KB cap, JSON error envelope). No user file is ever
  modified; `remove` deletes the file and prunes its directory chain
  (byte-identical tree, proven by test). 14 new tests including live
  execution of the generated handler without Next installed.
- **`npx sparda-mcp report` — the readable black box.** Renders everything the
  organism remembers (`sparda.json`: proof journal, failure lessons, antibodies,
  circuits/composites, semantic memory) plus live gauges when the host is up
  (`/mcp/stats`: calls, recycling rate, purity, quarantine) as a terminal report,
  a self-contained `--html` file (`.sparda/report.html`, zero external assets,
  hostile values escaped), or `--json`. Deterministic, read-only, zero new deps.
  Honest empty states ("no antibodies yet…") instead of zeros-as-success.
  9 new tests (`tests/report.test.js`).
- **Reproducible flywheel benchmark** (`bench/flywheel-bench.mjs`, zero new deps).
  Drives the real stdio bridge to produce honest, reproducible numbers in
  `bench/results.json`: ~**+2.7ms p50** proxy overhead on the request path, and an
  armed flywheel that served **501 reads from memory with the host touched zero
  times**. Replaces the previously unsubstantiated "97%" figure. Hit-rate is
  workload-shaped (50% on a 1:1 pure/volatile mix), not a fixed magic number.
### Fixed
- **Corrupt `sparda.json` no longer crashes the bridge with a raw `SyntaxError`.**
  `src/server/stdio.js` guards the manifest parse and exits with a `USER` error
  (with a restore/re-init hint) instead.
- **Request bodies are capped at 64KB** on both generators (DoS surface). Express
  renders `express.json({ limit: '64kb' })`; the FastAPI template gains a
  symmetric streaming guard (`sparda_read_json`) returning `413 payload too large`,
  wired into the gossip, invoke, and confirm handlers.
### Tooling (dev only — not shipped in the npm package)
- **ESLint 9 flat config + Prettier** with `lint`, `lint:fix`, `format`, and
  `format:check` scripts, plus a separate optional `lint` CI job. Baseline is
  green (0 ESLint errors, all owned JS Prettier-clean). The 4 required test-matrix
  checks are unchanged. All-new dev dependencies — the 4 exact-pinned **runtime**
  deps are untouched.
- **Vitest v8 coverage** (`npm run coverage`) measuring `src/**` → `coverage/`
  (gitignored). Reporting only, no gate yet. `npm test` is unchanged
  (instrumentation activates only under `--coverage`).

## [0.5.1] - 2026-06-13
### Fixed
- `args: null` (et tout `args` non-objet) renvoie désormais un `400` JSON au lieu de crasher
  le router sur `null[name]` et de fuiter une stack trace HTML.
- Body JSON malformé sur les endpoints SPARDA renvoie un `400` JSON sans stack trace : SPARDA
  parse ses propres endpoints et capture l'erreur localement au lieu de la laisser remonter
  vers la page d'erreur HTML d'Express.
- Verbes non-POST sur `/invoke` et `/invoke/confirm` renvoient un `405` JSON `{error, allow:'POST'}`
  au lieu du HTML Express brut. Toute route non matchée sous le router renvoie un `404` JSON.
- Ajout d'une error-envelope finale : la stack reste côté serveur, corrélée aux `/events` via `errorId`.
### Added
- **Two-phase commit pour `require_human`.** Un write/delete soumis à `require_human` n'est plus
  exécuté sur `/invoke` : le router renvoie `202 awaiting_confirmation` avec un nonce single-use,
  un preview contract et un champ `instruction` lisible par le LLM. La route host n'est pas touchée.
- Endpoint `POST /invoke/confirm` : rejoue le token (usage unique, TTL `SPARDA_CONFIRM_TTL_MS`,
  défaut 120s), re-juge la décision au moment du commit (un tool quarantainé entre-temps est refusé),
  puis exécute via le même chemin que l'allow-path.
- Variable d'env `SPARDA_CONFIRM_TTL_MS` (TTL des tokens de confirmation).
### Note
- Cas limite connu : si l'app host monte un `express.json()` GLOBAL avant le router SPARDA, le body
  malformé est levé en amont du router et reste à la charge du host (monter SPARDA avant le parser
  global, ou ajouter un error-handler app-level scoping `/mcp`).
