# 2026-06-11 — First real-machine E2E (partial): HTTP layer validated, MCP bridge still open

**Scope:** Owner ran SPARDA v0.3.0 against a Gemini-generated Express demo app
on his Windows desktop (`C:/Users/zakwi/Desktop/sparda-user-test`), following
the 6-point checklist. Results reported via a third-party debrief
(`debrief_tests.md`); this record separates what that debrief actually proves
from what it does not.

**Commits:** docs-only · **Branch:** `claude/sparda-e2e-desktop-test-bkhfaj` · **Tests:** not run (no code change)

## Done

- **HTTP layer of the injected router: 9/9 direct tests pass on a real app**
  (Windows, nvm4w Node). Verified live: init parses routes (incl. a
  non-English path `/santer`) and injects on port 3344; path params
  substituted and encoded (`/api/products/:id`); upstream 404/500 propagated
  honestly as `{ upstreamStatus, data }`; **write-safety blocks POST with 403
  + hint**; **localKey auth rejects invalid key with 401**. These were
  exercised via a hand-written `test-tools.js` hitting `/mcp/*` directly.
- **stdio bridge boots under the MCP Inspector proxy**: connection request
  received, client/server transports instantiated, session messages flow
  without runtime errors (Inspector `task-247.log`).
- **`GEMINI-BRIEF.md` (ephemeral, repo root)**: full agent-to-agent test
  campaign for the desktop tester — Phase 1 closes the MCP-protocol checklist
  (publish blocker), Phase 2 hardens the demo app (sub-routers, docstring
  injection, latency antigen, naming collisions, CJS variant…), Phase 3
  covers lifecycle (sync, carry-over, write opt-in + elicitation, hook,
  doctor, final remove). Ends with an npm-publish runbook addressed to the
  owner. Delete the file after publish.

## Not done / deferred

- **The actual top validation gap is still open.** The Inspector UI was
  blocked by its own session-token auth (red "unauthorized" banner), so
  nothing was validated *through* the MCP protocol: no Tools-tab listing, no
  `sparda_get_context` call, no sampling/semantic pass, no elicitation.
  HANDOFF's "never exercised against a real MCP client" stands.
- **Quarantine 3-strike behavior untested.** The broken route was called
  once (counts 1× toward `consecutive5xx`); the 3×5xx → 503, half-open probe
  and recovery were never triggered.
- **`sparda remove` clean diff untested** on the demo app (promise #2 / hard
  rule #4).

## Decisions made

- None durable. (Inspector auth workaround is operational, not a product
  decision.)

## Bugs hit

- **Inspector "unauthorized" red banner** — not a SPARDA bug. The Inspector
  generates a one-time session token; opening bare `localhost:6274` (or a
  browser blocking local storage) drops it. Fix: open the URL the Inspector
  prints **with `?MCP_PROXY_AUTH_TOKEN=…` included**, or set
  `DANGEROUSLY_OMIT_AUTH=true` (local dev only).

## Notes for the next session

- Cosmetic: the write-safety 403 hint says `npx sparda-mcp init` — package
  not on npm yet, so the hint is a dead end for pre-publish testers. Harmless
  after publish; revisit only if publish is delayed.
- Remaining desktop checklist (give to owner verbatim):
  1. Reopen Inspector via its token URL → Connect → Tools tab: routes +
     `sparda_get_context` listed, `get_health` returns live data.
  2. Sampling tab: bridge requests appear (answer by hand = play Claude).
  3. With `broken` file present: call `get_api_flaky` 3× → 4th call must be
     503 `quarantined` with `retryInMs`; delete file, wait 60 s (default
     `SPARDA_QUARANTINE_MS`), call again → recovery via half-open probe.
  4. `node <sparda>/src/index.js remove` → demo app file byte-for-byte
     identical to pre-init.

> Remember: rewrite `docs/HANDOFF.md` before committing this file. (Done.)
