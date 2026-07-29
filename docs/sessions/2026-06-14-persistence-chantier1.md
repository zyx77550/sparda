# 2026-06-14 — Pluggable Persistence (Chantier 1, sandbox Step 1)

**Scope:** Port the sandbox's durable persistence layer into production: one atomic+fsync writer for `sparda.json` (replacing two fsync-less copies) plus an opt-in, engine-agnostic state-driver seam — without adding a runtime dependency.
**Commits:** uncommitted (owner commits) · **Branch:** `main` · **Tests:** 65/67 Vitest green + 2 skipped (FastAPI live-server tests skip without a local fastapi/uvicorn runtime) + 10/10 router smoke. New: `tests/persistence.test.js` (11).

## Done
- **`src/server/persistence.js` (new)** — single source of truth for manifest durability. `atomicWriteFileSync` does temp → **fsync** → rename (the fsync the old `atomicWrite` lacked: rename could otherwise land before the data flush and a power loss left a zero-length `sparda.json`). `writeManifestSync` keeps the exact pretty-JSON + trailing-newline byte shape the generators emit. `mergeManifestKeySync` re-reads, sets one top-level key, writes atomically — for the bridge's concurrent merge-writers.
- **Generators de-duplicated** — `src/generator/express.js` and `src/generator/fastapi.js` each had their own fsync-less `atomicWrite`; both now import `atomicWriteFileSync as atomicWrite` from `persistence.js`. Two copies → one, all now durable.
- **Bridge & condenser rewired** — `src/server/stdio.js` routes `immune` / `sparding` / `semantic` through `mergeManifestKeySync` and `labs` through `writeManifestSync`; `src/server/condenser.js` `persist()` uses `writeManifestSync`. Every `sparda.json` write now flows through the atomic+fsync path; no raw `fs.writeFileSync(manifestPath, …)` remains in `src/`.
- **Pluggable driver seam** — `MemoryDriver` / `LocalFileDriver` / `RedisDriver` + `createStateDriverFromEnv` (engine-agnostic, by `instanceId`). Reserved for *future* living-engine state and multi-node, **not** the manifest. Redis is a lazy `import('ioredis')` that throws a `code:'USER'` error if absent — no 5th dep (hard rule #8 intact).
- **Tests** — `tests/persistence.test.js`: atomic round-trip + no temp-file residue, manifest byte shape, merge-without-clobber, Memory/LocalFile round-trips + hashed filenames, lazy-Redis fail-soft when ioredis is absent, env→driver mapping. 11/11 green.
- **ADR-019** added to `docs/DECISIONS.md`.

## Not done / deferred
- Sandbox **Step 2** (FastAPI HFT middleware → `templates/fastapi-router.txt`) and **Step 3** (Mycélium P2P gossip) — not started. Step 3 needs its own ADR: it changes the 127.0.0.1-only posture.
- The async drivers are wired as a seam only; nothing in production *uses* a non-file driver yet (the manifest deliberately stays a local git artifact).
- Version not bumped — this is internal durability hardening on top of 0.5.2; owner decides whether it ships as 0.5.3.

## Decisions made
- **`sparda.json` stays a local git artifact**, made atomic+fsync — deliberately *not* routed through `LocalFileDriver` (which hashes filenames into a baseDir and would break `remove`/`sync`/`doctor`/carry-over). The roadmap's literal `driver.save('sparda.json', manifest)` was adapted for this reason. (ADR-019.)
- **`verifyPythonSyntax` timeout 2s → 5s** (`src/generator/fastapi.js`): a 2s budget falsely failed clean removals (hard rule #4) and post-injection checks when py_compile cold-started under load on Windows. Only bounds the worst case; happy path never waits. Matches the test-side 5s syntax budget.

## Bugs hit
- **Two FastAPI byte-for-byte tests flaked in the full run** (one timed out at the 5000ms vitest default, one got `removed[0].ok === false`). Root cause: each spawns `python -m py_compile` ~8× and sits on the default-timeout cliff; under full-suite load python cold-starts tip them over. Proven independent of the persistence change — `ok:false` is set *before* `atomicWrite` is ever reached, and both pass in isolation. Fix: explicit `30_000` timeouts on the three FastAPI byte-for-byte `it()`s (matching the E-013 convention already used elsewhere) + the production `verifyPythonSyntax` bump above. Full suite reliably green after.

## Notes for the next session
- The 2 "skipped" in a full run are the `describe.skipIf(!hasFastAPIRuntime)` live-server FastAPI tests — they skip when the one-time `import fastapi, uvicorn` probe (10s) flakes under load. Run `npx vitest run -t "Generated FastAPI router"` with python warm to see them pass (16–18s each).
- Working tree entangles this Step-1 work with the owner's uncommitted 0.5.2 `/invoke/confirm` changes — owner decides commit grouping.
- Step 2 is the natural next move: extract the double-buffer / ThreadPoolExecutor / memoryview optimizations from `sparda-sandbox/fastapi_async_hft.py` into the FastAPI router template.
