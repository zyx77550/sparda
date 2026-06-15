# Architecture

## The two pipelines

### `init` — static pipeline (runs once, deterministic)

```
detect.js ──► parser/ ──► sanitize.js ──► generator/ ──► host app
 framework     routes      docstring       router file    marked block
 entry file    params      defense         sparda.json    injected after
 port, module  docstrings                  scan-report    app = express()/
 type (AST)                                               FastAPI()
```

1. **`src/detect.js`** — finds the framework (express dep / fastapi in
   requirements), the entry file (pkg.main, scripts, conventional paths,
   then content check for `express(` / `FastAPI(`), the port (literal,
   `.env`, `PORT = n` patterns; defaults 3000/8000), and the module type
   (ESM/CJS via extension, `pkg.type`, import/require heuristics).
2. **`src/parser/express.js`** — Babel AST walk over the entry file and its
   local imports. Extracts literal-path routes (`app.get('/x', ...)`,
   routers, mounted prefixes), path params, query params from inline handler
   bodies (`req.query.x`, `req.query['x']`, destructuring), leading comments
   as descriptions. Dynamic paths and `/mcp*` paths are *skipped with a
   reason* (written to `.sparda/scan-report.json`). `toolNameFor()` builds
   collision-free snake_case names (≤ 60 chars).
   **`src/parser/fastapi.js`** spawns **`fastapi_extract.py`** (stdlib-only
   `ast` module) and returns the same route shape, plus `entryAppVars`.
3. **`src/security/sanitize.js`** — regex deny-list over any text that could
   reach the AI (docstrings, LLM outputs). Flagged → replaced by fallback.
4. **`src/generator/{express,fastapi}.js`** — renders
   `templates/{express,fastapi}-router.txt` by placeholder substitution
   (`__TOOLS_JSON__`, `__LOCAL_KEY__`, `__PORT__`, and the TS type
   placeholders `__ANY_TYPE__`/`__REQ_TYPE__`/...). Injects a *marked block*
   (`>>> sparda-injection ... <<<`) right after app instantiation — strip
   markers first (idempotence), backup to `.sparda/backup/`, re-parse the
   result, fall back to manual instructions if anything fails. Writes
   `sparda.json` (atomic writes everywhere).
   **`src/generator/manifest.js`** — `carryOverManifest`: re-init preserves
   `localKey`, per-tool `enabled`, `semantic`, `immune`.

### `dev` — runtime pipeline (lives with the app)

```
MCP client (Claude) ◄─ stdio ─► server/stdio.js ◄─ HTTP+localKey ─► injected router
                                  the bridge                       inside the host app
```

**The injected router** (generated from `templates/`) exposes, behind
`x-sparda-key`:
- `GET /mcp/tools` — tool specs (single source of truth for the bridge)
- `POST /mcp/invoke` — proxies `{tool, args}` to the real route on
  `127.0.0.1:<port>`; records telemetry; enforces write-safety, loop
  protection, and **quarantine**
- `GET /mcp/stats` — uptime, per-tool `{calls, errors, totalMs, lastStatus,
  consecutive5xx}`, current quarantine map, the recycling gauge
  `recycle: {servedByCircle, paidFull, ratePct}` (v0.4 — quarantine blocks
  count as served-by-circle: the doomed host call was never paid), and the
  purity map `purity: {<tool>: {class: pure|volatile|erasing|unknown,
  repeats, mismatches}}` (v0.4, R4.2 — observed-only classification,
  ADR-017)
- `GET /mcp/events?since=n` — ring buffer (100) of error/immune events

**The immune system (v0.3)** — all deterministic, in the router:
- *Innate*: per-tool latency baseline; a call slower than
  `max(10 × avg, 200ms)` after ≥ 5 samples emits an `immune` event.
- *Quarantine*: 3 consecutive 5xx → tool returns 503 (`reason`,
  `retryInMs`) without touching the host route. After
  `SPARDA_QUARANTINE_MS` (default 60s) one probe passes (half-open);
  a new 5xx re-quarantines instantly (counter resumes at 2).

**The bridge** (`src/server/stdio.js`):
- neutralizes stray `console.log` (stdout = protocol), waits for the host,
  fetches tool specs, serves MCP `tools/list|call`, `prompts/list|get`.
- built-in tools: `sparda_info`, `sparda_list_disabled_tools`,
  **`sparda_get_context`** (tools + workflows + live stats + recent events +
  quarantine + immune memory, in one call — the session-resume tool).
- *write confirmation*: MCP elicitation before any non-GET, when supported.
- *proof-after-write*: successful write → read-back of the same path.
- *semantic pass* (once, cached): client's LLM rewrites descriptions and
  proposes workflows via sampling → `manifest.semantic`.
- *event polling → adaptive immunity*: each error event is matched against
  `manifest.immune.antibodies` by signature `source|tool|status`. Known →
  cached diagnosis attached, zero tokens. Unknown → one sampling call
  (sanitized, capped at 50 antibodies) → stored in `sparda.json`.
- *idle harvester* (v0.4, `server/idle.js`): every internal job (condenser
  analysis, persistence) runs only when the event loop is quiet — one job
  per tick, bounded queue, starvation guard, synchronous flush on close.
- *sequence condenser* (v0.4, `server/condenser.js`, **Labs, default OFF** —
  `labs.recordSequences: true` in `sparda.json` or `SPARDA_RECORD_SEQUENCES=1`):
  records the session's calls in a 20-entry ring and detects circuits (an
  output value of tool A feeding an argument of tool B — deterministic value
  match, conservative noise floor). Persists **structure only** (tool names,
  arg names, link `fromKey`s, counts — never values: the manifest is committed
  to git), capped at 30 circuits.
- *crystallization* (v0.4, `server/crystallize.js`, R2.2): at 3 observations an
  **enabled-GET-only** circuit with a traceable data flow becomes a composite
  tool — sampling names it (sanitized; deterministic fallback without
  sampling), `tools/list_changed` announces its birth mid-session, and calling
  it runs the chain step by step, auto-feeding each linked arg via `fromKey`
  from the previous step's real response. Write steps are never absorbed
  (their per-call confirmation stands, ADR-004). Composites are re-validated
  against today's tools at every bridge start.
- *recycling gauge, intelligence side* (v0.4): the bridge counts sampling
  calls avoided by cached knowledge (semantic cache at startup, antibody
  hits), exposed with the router's compute counters in `sparda_get_context`
  under `recycling` (lifetime savings derived from antibody `hits`).

### `sync` / `hook` — the sentinel

`sync.js` re-parses, diffs `METHOD path` sets against the manifest, and
regenerates only on change (carry-over keeps user state). `hook.js` installs
a marked `post-commit` git hook running `sparda-mcp sync --quiet`.

## `sparda.json` (the organism's memory — lives in the user's repo)

```jsonc
{
  "version": 1,
  "framework": "express" | "fastapi",
  "entryFile": "src/app.js",
  "moduleType": "esm",            // express only
  "port": 3000,
  "localKey": "<uuid>",            // stable across re-runs
  "generatedFiles": ["src/sparda-router.js"],
  "injectedFiles": ["src/app.js"],
  "createdAt": "...",
  "tools": { "<name>": { "method", "path", "enabled" } },
  "semantic": {                    // written once by the sampling pass
    "enrichedAt", "source", "descriptions": {}, "workflows": []
  },
  "immune": {                      // written by the adaptive immune system
    "antibodies": { "source|tool|status": { "diagnosis", "firstSeen", "lastSeen", "hits" } }
  },
  "labs": {                        // Labs organs (opt-in, default OFF)
    "recordSequences": false,      // user flag: enable the sequence condenser
    "circuits": {                  // observed call circuits — structure only, never values
      "toolA>toolB": {
        "steps": [], "links": [{ "from", "to", "arg", "fromKey" }],
        "seen", "firstSeen", "lastSeen",
        "composite": { "name", "description", "source", "createdAt" }  // once crystallized
      }
    }
  }
}
```

## File map

| Path | Role |
|---|---|
| `src/index.js` | CLI dispatch, error formatting (`code: 'USER'` + `hint`) |
| `src/detect.js` | framework / entry / port / module-type detection |
| `src/parser/express.js` | Babel AST route extraction + `toolNameFor` |
| `src/parser/fastapi.js` + `fastapi_extract.py` | Python AST extraction (stdlib only) |
| `src/generator/express.js` / `fastapi.js` | template render + marked injection + manifest |
| `src/generator/manifest.js` | carry-over across re-init |
| `src/server/stdio.js` | the MCP bridge (see above) |
| `src/server/idle.js` | idle harvester — internal work only on a quiet loop (R4.4) |
| `src/server/condenser.js` | sequence condenser — circuit detection, Labs default-off (R2.1) |
| `src/server/crystallize.js` | crystallization — composite tools from observed circuits (R2.2) |
| `src/security/sanitize.js` | prompt-injection deny-list |
| `src/ui/style.js` | zero-dep ANSI styling (gradient banner, JSON highlight) — human commands only, never the bridge |
| `src/commands/*.js` | init / dev / sync / hook / remove / doctor |
| `templates/*.txt` | the routers, placeholder-rendered (never edited in target apps) |
| `tests/sparda.test.js` + `tests/fixtures/` | the whole suite (see TESTING.md) |
