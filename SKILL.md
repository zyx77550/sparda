---
name: sparda-mcp
description: >-
  Drive a SPARDA compiled Behavior Runtime to its full potential. Use this whenever
  you are connected to a backend running the SPARDA Runtime (compiled into a SPARDA
  Behavior Graph - SBG) — recognizable by the tools `sparda_get_context`, `sparda_info`,
  `sparda_confirm`, or composite tools. It teaches the graph-context-first workflow,
  how to exploit the response-recycling flywheel, the circuit-breaker, crystallized
  circuits, offline Twin simulations, and the two-phase confirm protocol for writes.
---

# Driving a SPARDA Behavior Runtime

A SPARDA server is driven by a compiled **SPARDA Behavior Graph (SBG)**. Instead of exposing raw, disconnected endpoints, SPARDA has compiled the host application's states, transitions, permissions, and side-effects into a deterministic behavioral model. The local **SPARDA Runtime** dynamically executes this graph inside the live host process, powering the MCP interface, the Twin simulation clone, and the Immune system offline.

## Rule 0 — call `sparda_get_context` first, every session

Before anything else, call **`sparda_get_context`** (no params). It returns the *live* state of the SPARDA Behavior Graph:

- the active routes/tools, workflows, and type-propagated schemas;
- `runtime` — current stats (calls, errors, quarantine states, Twin mode active);
- the last ~20 **events** (errors, latency anomalies, immune alerts);
- **immune memory** (cached antibodies and error diagnoses);
- **recycling** metrics (flywheel memory hit rates);
- a `behavior` snapshot of stable variables.

Read it to orient yourself inside the graph. `sparda_info` gives a lighter summary of counts.

## The tools you'll see

- **Per-route tools** — `snake_case` names derived from the app's real routes
  (e.g. `get_users`, `get_users_by_id`). A `[partial schema]` prefix means the
  parameter schema was only partially inferred — pass arguments carefully.
- **Meta-tools** — `sparda_get_context`, `sparda_info`,
  `sparda_list_disabled_tools`, `sparda_confirm`.
- **Composite tools** — labelled `[Labs circuit ×N]`, `readOnly`. One call runs a
  whole proven multi-step chain (see *Crystallized circuits* below).

Only **enabled** tools appear. Write tools are hidden until the user opts in, so a
missing write is a config state, not an error — see *Writing safely*.

## Exploit the intelligence layer (this is the "full potential")

**1. Response-recycling flywheel — make repeated reads free.**
When the *same* read tool returns a byte-identical result for the *same* arguments
**3 times within 30 seconds**, SPARDA serves the next identical call straight from
RAM (`servedByFlywheel: true`) **without touching the host app**. So:
- Don't fear repeating stable GETs — repetition is what *activates* the cache.
- Don't bolt your own client-side cache on top; you'd hide the signal that lets
  SPARDA recycle, and you'd lose freshness control.
- Watch `recycling.flywheel.servedFromMemory` climb in context — that's free work.
- Reads only; writes always hit the host. Operators can disable it (`SPARDA_FLYWHEEL=off`).

**2. Circuit-breaker / quarantine — stop hammering a sick backend.**
After **3 consecutive 5xx** on a tool, SPARDA quarantines it: subsequent calls
return **HTTP 503** with `reason` and `retryInMs` *instead of* hitting the failing
host. Honor `retryInMs` — do not retry-loop. Check `runtime.quarantine` in context
before depending on a tool. After a cooldown (~60s) the tool half-opens for one
probe; one more 5xx re-quarantines it.

**3. Crystallized circuits (Labs) — collapse a chain into one tool.**
If you repeat a **GET→GET** sequence where one call's output feeds the next call's
argument **3 times** (and the operator enabled Labs recording), SPARDA mints a
single **composite tool** for that chain and announces it mid-session via
`tools/list_changed`. Prefer the composite over re-walking the steps — it's one
call and it's marked read-only. (Writes are never absorbed into a circuit.)

**4. Adaptive immunity — read the diagnosis before retrying.**
Repeated, unfamiliar failures trigger a *one-shot* LLM diagnosis that SPARDA caches
as an "antibody" (keyed by `source|tool|status`). Recurrences reuse the cached
diagnosis at zero cost. When an error event carries a diagnosis, **read it** and
adapt — don't blindly retry the same call.

**5. Latency anomalies.** A call far slower than a tool's own baseline surfaces as
an `immune` event in `/mcp/events`. Treat it as a hint to back off or warn the user.

**6. Twin Simulation Mode — practice safely on a clone.**
When `/mcp/stats` or `sparda_get_context.runtime` contains `"twin": true`, you are connected to a safe, in-memory mock clone of the application.
- All GET reads return learned exemplars (observed response shapes and mock values).
- All write tools return simulated `202` echoes but do not write to database or external APIs.
- Use this twin mode to practice multi-step workflows, debug tool sequences, and test your plans without touching the live production backend.

**7. Grammar & Evolution — discover optimal workflows.**
- You can query or contribute to the app's grammar (`.sparda/grammar.json`). The grammar maps valid sequences of tool calls (edges).
- Running `sparda evolve` mutates and runs candidate chains against the twin. The successful evolved sequences are suggested as mid-session workflows.

## Writing safely — the mandatory two-phase protocol

Writes are **disabled by default**. The protocol is not optional:

1. **No write tool listed?** Call `sparda_list_disabled_tools`. Tell the user how
   to enable it: set `"enabled": true` for that tool in `sparda.json`, re-run
   `sparda init`, and restart the bridge. Never try to bypass it.
2. **Calling an enabled write** under the default `require_human` policy returns
   **HTTP 202 `awaiting_confirmation`** — the host was **not** touched. The payload
   carries: `confirm` (a single-use token), `preview`, `instruction`, `expiresInMs`,
   and a `spardingProof` (SPARDA's safety verdict for this action).
3. **Inspect first.** Follow `preview.inspectFirst`: call the matching read tool and
   show the user the current state, so the confirmation is informed.
4. **Commit** by calling **`sparda_confirm`** with `{ "token": "<confirm>" }`. The
   token is single-use and expires (~120s). SPARDA then executes and, because of
   proof-after-write, **re-reads** the resource and returns a `proof` of the new
   state — surface that proof to the user.
5. Never fabricate or reuse a token; never loop a write. If the client supports MCP
   elicitation, SPARDA may also prompt the user directly before the write — let it.

## Read the dashboards to steer

- **`/mcp/stats`** (in `sparda_get_context.runtime`): per-tool `calls`/`errors`;
  `purity.class === 'pure'` marks a tool whose answers are flywheel-recyclable;
  `quarantine` lists tools to avoid right now. Use it to pick hot, healthy tools.
- **`/mcp/events`**: the error / latency / immune stream, delivered as MCP logging
  notifications with any cached diagnosis attached.

## Full-potential plays

1. **Resume cold** → `sparda_get_context`; read `runtime.quarantine`, immune memory,
   and `workflows` before touching anything.
2. **Inspect-before-write** → on a 202, call the same-path read tool, show state,
   then `sparda_confirm`.
3. **Crystallize then call** → repeat a GET→GET id-chain to mint a `[Labs circuit]`
   composite, then call the composite once instead of N times.
4. **Find hot / sick tools** → read `/mcp/stats`: prefer `purity: pure`, skip
   `quarantine`.
5. **Free repeated reads** → repeat a stable GET to trigger flywheel serves; watch
   `servedFromMemory` rise.
6. **Listen** → keep an eye on `/mcp/events`; act on immune diagnoses and latency
   flags instead of retrying blindly.

## Troubleshooting

- **Bridge won't start / "localKey" error** → `sparda.json` is missing its key;
  re-run `sparda init` (the key is preserved across re-inits).
- **A tool you expect is missing** → it's disabled (write-safety) or the route was
  removed; run `sparda sync` after route edits, or `sparda_list_disabled_tools`.
- **General health** → `sparda doctor` checks Node version, framework detection,
  manifest validity, the semantic/immune cache, host reachability, and quarantine;
  it exits non-zero so it can gate CI.
- **Formal Deployment Proof** → `sparda apocalypse` reads the compiled graph (`ubg.json`) and proves five correctness obligations: catches unguarded mutations, non-atomic aggregate writes, unvalidated writes to constrained tables, uncompensated observable effects, and aggregate root bypasses. Run `sparda apocalypse --save-baseline` to store the reference graph; subsequent runs diff against the baseline to catch dropped guards, dropped SQL invariants, or grown blast radiuses.
- **Clone learning / Transfer sémantique** → Use `sparda seed export` to package your app's descriptions, workflows, and antibodies. Then `sparda seed import --germinate` in another clone to import the structure and germinate simulated twin instances.
- **Learn exemplars** → Start your live app and run `sparda twin --learn` to fetch actual response data and construct `.sparda/twin.json` locally.

---
*This skill ships with `sparda-mcp` and is regenerated from SPARDA's capability
surface each release, so it tracks new tools and behaviors. The **live, per-project**
tool list, stats, and workflows always come from `sparda_get_context` at runtime —
trust it over any static list.*
