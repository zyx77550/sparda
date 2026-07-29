# debrief_phase2 — demo app hardened, re-validated through a real MCP client

**Date:** 2026-06-11 · **Agent:** local Claude Code session on Zak's Windows
desktop · **Branch:** `main` (forge clone) · **SPARDA:** v0.3.0 · **Node:**
v24.5.0 · **Apps:** ESM `Desktop/sparda-demo-app` (git baseline `7ddee2d`),
CJS `Desktop/sparda-demo-cjs` (git baseline `aa692f2`).

## What this phase does

Phase 1 proved the protocol works on a small clean app. Phase 2 deliberately
makes the app *hard*: nested path params, a forwarded query, a mounted
sub-router, four write verbs, a prompt-injection JSDoc, a latency outlier vs a
uniformly-slow route, a 2 MB payload, 20-way concurrency, a tool-name
collision, a CommonJS variant, and a malformed call. Each was re-validated over
the **real MCP wire** with the same scripted JSON-RPC client as Phase 1
(`Desktop/sparda-e2e/phase2.mjs` + `harness.mjs`). ESM and CJS run sequentially
(both mis-detect to port 3000 — see P1).

The 16 tools generated from the hardened ESM app:

```
get_health · get_api_products · get_api_products_by_id · get_api_products_by_id_2
get_api_users_by_userid_orders_by_orderid · get_api_timed · get_api_slow
get_api_big · get_api_injection · get_api_flaky · get_api_v2_status
get_api_v2_widgets_by_widgetid       (+ put/patch/delete/post = OFF, write-safety)
```

## Results — 12/12 green

| # | Channel | Expected | Observed | Verdict |
|---|---|---|---|---|
| 2.1 schema | [MCP] | multi-param tool lists `userId`+`orderId` as required string path params | props `userId,orderId`; required `[userId,orderId]` | PASS |
| 2.1 encoding | [MCP] | accent/space path param, `/`→`%2F`, and a forwarded query round-trip intact | `userId="José Día"`, `orderId="a/b"`, `query.status="shipped & paid"` | PASS |
| 2.2 sub-router | [MCP] | `app.use('/api/v2', router)` followed, paths prefixed, tools invoke | `get_api_v2_status`→`{version:v2}`, `get_api_v2_widgets_by_widgetid` w/ `widgetId` | PASS |
| 2.3 write-safety | [MCP]+[HTTP] | PUT/PATCH/DELETE/POST absent from `tools/list`, named in `sparda_list_disabled_tools`, 403 on direct invoke | leaked `[]`; all 4 listed disabled; direct DELETE = 403 `tool disabled (write-safety)` | PASS |
| 2.4 docstring defense | [MCP] | prompt-injection JSDoc sanitized; shown description carries none of the payload | `init` purged 1 docstring; description = `"GET /api/injection"`, `containsPayload=false` | PASS |
| 2.5 latency antigen | [MCP]+[HTTP] | slow outlier on a fast-baseline route fires an immune latency event; a uniformly-slow route does NOT | `get_api_timed`: `latency anomaly: 466ms vs ~6ms baseline`; `get_api_slow`: none (correct) | PASS |
| 2.6 big payload | [MCP]+[HTTP] | ~2 MB ×31: MCP text truncated, events bounded ≤100, host alive, stats counts calls | `truncated=true`, `eventsLen=1`, `hostAlive=true`, `big.calls=31` | PASS |
| 2.7 concurrency | [MCP]+[HTTP] | 20 parallel `tools/call` all succeed; stats increments by exactly 20 | `allOk=true`; calls `0 → 20` (Δ20) | PASS |
| 2.8 collision | [MCP] | colliding names disambiguated (`_2`); both distinct tools invoke their own route | literal→`{collisionRoute:true}`; param→`{name:Espresso}` | PASS |
| 2.9 CJS variant | [MCP] | CommonJS app generates a CJS router and serves tools over MCP | `serverInfo=sparda-sparda-demo-cjs`, `runtime:cjs`, `get_api_items_by_id`→`{label:alpha}` | PASS |
| 2.9 stdout | [MCP] | CJS bridge stdout stays pure JSON-RPC (no `require()` noise) | clean — 0 violations | PASS |
| 2.10 invalid input | [MCP] | missing required path param → `isError` with `missing path param` | `isError=true`, body `{error:"missing path param: orderId"}` | PASS |

## Bugs / findings

### P0
- none.

### P1
- **Port mis-detection on env-fallback ports — confirmed framework-wide, not
  ESM-specific.** ESM app `Number(process.env.PORT ?? 4477)` and CJS app
  `Number(process.env.PORT || 4488)` **both** wrote `port: 3000` to
  `sparda.json`. `detect.js` does not extract the fallback literal from either
  `??` or `||`. Same root cause flagged in Phase 1; Phase 2 widens it: any app
  whose only port hint is an env fallback will mis-detect. Workaround used here:
  the harness aligns the host to the detected port (3000). Fix direction:
  `detect.js` should read the right-hand literal of a `??`/`||` on a
  `process.env.PORT` expression.

### P2 / product observation
- **Query parameters are not represented in the tool `inputSchema`.** The
  parser only extracts path params (`:name`) and a `body` object for writes
  (`src/parser/express.js:126`). The router *does* forward any extra arg as a
  query string (`templates/express-router.txt:69-74`), and that path works
  (2.1 passed `status` and it round-tripped). But an MCP client reading only the
  schema has no signal that `status` is accepted — it must already know. Not a
  spec violation (statically inferring query usage from a handler body is hard),
  but a discoverability gap. Fix direction (optional): let the semantic pass
  surface common query params, or detect `req.query.X` reads in the handler AST
  and add them as optional schema properties.

### Notes (not bugs)
- 2.6's `eventsLen` stayed at 1 because 200-status calls emit no events — the
  ring-buffer **cap (100)** is enforced by construction
  (`templates/express-router.txt:20`) and SPARDA never retains response bodies
  (only status + latency in `stats`), which is the actual hard-rule-#1 property
  under test. The 31×2 MB calls left the host alive with no memory growth path.
- The injection JSDoc was multi-line; the parser joins leading comments, slices
  to 400 chars, and `sanitizeDescription` flags + blanks it, so the tool falls
  back to `${METHOD} ${path}`. The payload never reaches `sparda.json`, the
  router, or the client.

## Appendix — raw

### Disabled-tools listing (write-safety, via `sparda_list_disabled_tools`)
```
Disabled (write-safety):
- put_api_products_by_id (PUT /api/products/:id)
- patch_api_products_by_id (PATCH /api/products/:id)
- delete_api_products_by_id (DELETE /api/products/:id)
- post_api_products (POST /api/products)
```

### Latency antigen event (`[HTTP direct]` /mcp/events)
```json
{ "source": "immune", "tool": "get_api_timed", "status": 200,
  "message": "latency anomaly: 466ms vs ~6ms baseline" }
```

### CJS bridge stderr (clean stdout, human logs on stderr)
```
[sparda] MCP bridge running. 3 tools enabled, 0 disabled (write-safety). Host: http://127.0.0.1:3000
[sparda] semantic pass done: 3 descriptions, 1 workflows (cached in sparda.json)
```

## Verdict

**Phase 2: 12/12 green through a real MCP client, across ESM and CJS.** Every
hardening surface (nested params + encoding, sub-router, write-safety,
injection defense, immune latency baseline, large payloads, concurrency,
name collisions, module variants, invalid input) behaves as specified. No P0/P1
regressions beyond the already-known port-detection limitation, now confirmed to
affect any env-fallback port pattern. One P2 discoverability observation
(query params absent from `inputSchema`) for the backlog.
