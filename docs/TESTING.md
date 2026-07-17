# Testing

```bash
npm test                         # full suite (vitest run)
npx vitest run -t "quarantine"   # filter by test name
SPARDA_CORPUS=/path/to/clones npm run corpus   # regression check vs real giants
```

The **corpus oracle** (`scripts/corpus-oracle.mjs`) diffs SPARDA's verdict/finding
metrics on 7 real giants against a committed baseline (`corpus.snapshot.json`) — it
catches the class of silent regression `npm test` can't (the tsconfig bug that took
dub's guards 514 → 1). The giants aren't committed; point `SPARDA_CORPUS` at your
clones. Apps not present are skipped, never failed; with no `SPARDA_CORPUS` it is a
no-op. Re-baseline with `npm run corpus:update` ONLY when a metric change is intended.

Requirements: Node ≥ 18, Python ≥ 3.9 on PATH (`python3`/`python`/`py -3`
auto-detected — see E-004). CI: `.github/workflows/` runs the suite with
`setup-python`.

## Suite map (`tests/sparda.test.js`)

| Section | Covers | Style |
|---|---|---|
| 1. Express Parser | route extraction on 5 fixtures (ESM/CJS/TS×2/hostile) | pure, on `tests/fixtures/` |
| 2. Sanitizer | 10 hostile + 10 legitimate descriptions | table-driven |
| 3. Tool Naming | snake_case, 60-char cap, collision suffixing | pure |
| 4. Injection & Remove | inject → idempotent re-inject → remove, **byte-for-byte** restore, post-inject re-parse | filesystem, all Express fixtures |
| 5. FastAPI Parser & Injection | same as 1+4 for Python, plus `ast.parse` syntax check of the generated router | spawns python |
| 6. Router runtime | real Express app + generated router: auth, telemetry, events, **quarantine/half-open/latency-anomaly**, **recycling gauge**, **purity classification** (pure/volatile/erasing/unknown), carry-over on re-init (incl. `labs`) | ephemeral port, real HTTP |
| 7. Sentinel sync | no-op detection, regeneration on route add, stable localKey | filesystem |
| 7d2. Query param discovery | `req.query.X` + `['x']` + destructuring on inline handlers, custom req names, dedupe vs path params | temp app |
| 7d3. Sentinel hook uninstall | created → deleted, appended → byte-for-byte restore, no-marker no-op | temp `.git/hooks` |
| 7e. Idle harvester | quiet-loop drip, job order, throwing job survival, bounded queue, sync flush | timers |
| 7f. Sequence condenser | default-off gate, value-link circuits, 3-step chains, noise floor, **structure-only persistence**, 30-cap eviction, threshold announce | pure + tmp manifest, sync harvester |
| 7g. Crystallization | GET-only eligibility, fallback identity, sampled-name normalization, schema minus auto-fed args, chain run with `fromKey` re-feed, honest stop-at-failure | pure + stub invoke |
| 7h. CLI styling | plain passthrough when colors off (NO_COLOR/non-TTY), truecolor gradient, 256-color fallback, strip-ANSI = exact original text | pure, env-guarded |
| 8. MCP stdio bridge | full JSON-RPC session against a spawned bridge + mock host: tools/list+call, prompts, write confirm path, proof-after-write, live error notifications **with cached antibody diagnosis**, `sparda_get_context`, **circuit detection + crystallization end-to-end** (`SPARDA_RECORD_SEQUENCES=1`: composite born via `tools/list_changed`, then executed) | child process, raw protocol |

## Conventions & traps

- **Fixtures are restored byte-for-byte** — every test that touches a
  fixture copies it to `tests/.tmp/` or cleans up everything it generated
  (router file, `sparda.json`, `.sparda/`, `.gitignore` line). Leaving
  residue breaks the *next* run, not yours.
- **Ports are ephemeral**: grab a free port via `net.createServer().listen(0)`.
- **Router env knobs** are read at import time — set `process.env` *before*
  the dynamic `import()` of a generated router (see the quarantine test),
  and cache-bust with `?t=${Date.now()}`.
- **The bridge test's mock host counts `/mcp/events` polls** to stage
  baseline-then-live-event. Any bridge feature that also reads
  `/mcp/events` shifts that sequence — keep polling assertions before
  context-tool calls (E-005).
- **Timing-sensitive tests** (quarantine cooldown 400ms, latency antigen
  1000ms vs the `max(10×, 200ms)` floor) have margins chosen to be safe on
  slow CI; don't tighten them to make the suite faster.

## Adding coverage

- New framework → add a minimal fixture project + parser section + an
  injection/remove byte-for-byte test. That trio is the acceptance bar.
- New bridge behavior → extend section 8 (raw JSON-RPC `request()` helper);
  new router behavior → extend section 6 against a real server.
- Every entry in `ERRORS.md` should be pinned by a test when feasible.
