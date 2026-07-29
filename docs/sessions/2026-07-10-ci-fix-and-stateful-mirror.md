# 2026-07-10 — CI fix (Node 18) + stateful mirror (R5/M2)

**Scope:** The PR's Node 18 CI cell went red on the E-019 crypto change; fix it, then
continue the roadmap with M2 — make `sparda mirror` reflect the inferred state machines.
**Branch:** `claude/new-session-5yhx6t` · **Tests:** 413 ✓ Vitest + 10/10 router self-test

## Done
- **E-021 — Node 18 CI red.** `globalThis.crypto` only became a default global in Node
  19; the Node 18 matrix cell had it undefined, so the E-019 confirm-nonce threw in the
  generated Express router and the standalone Next route. Fix, split by runtime:
  - Express router → `node:crypto` via a new `__CRYPTO_IMPORT__` placeholder (rendered in
    `generator/express.js` + `router-selftest.cjs`); `spardaNonce` → `spardaCrypto.randomUUID()`.
  - Next route stays web-standard (`globalThis.crypto`), which every Next runtime
    provides; `tests/nextjs.test.js` polyfills `globalThis.crypto = webcrypto` on Node < 19.
  Verified generated CJS+ESM routers use node:crypto; Node 18 CI (ubuntu) green.
- **R5/M2 — the stateful mirror.** `src/ubg/mirror.js` now reads
  `state.meta.stateMachine` and serves the lifecycle: create seeds the initial state and
  mints an id; a transition route advances the state but only from the declared source
  (illegal moves → **409** naming the legal source); a read reflects the current value
  (unknown resource → lazy initial). Read↔machine link is structural (same collection
  base + the machine's field in the return schema). Per-instance RAM store, dies with the
  process. `req.resume()` drains bodies so keep-alive clients never hang. CLI shows the
  derived lifecycle per route (`⟳ status:pending→paid`, `↩ reflects status`). New fixture
  `tests/fixtures/ubg-lifecycle`; `tests/mirror-stateful.test.js` (7 tests, fetch-driven).
  ADR-031; ROADMAP M2 ✅.

## Not done / deferred
- `rawRequest` (the raw-socket test helper) hangs on rapid sequential keep-alive reuse —
  a harness artifact, not a mirror bug (fetch and curl work perfectly; verified curl
  `201 200 200 200 409 200` on one keep-alive connection). Left as-is; new tests use fetch.
- Multi-field / multi-machine routes: the mirror drives the first transition per route
  (sufficient for the status-lifecycle case). Multi-node shared state is out of scope for
  a mock.
- Next R5 moves: M1 (interprocedural taint), M4 (cross-service proof), M5 (first user —
  e.g. wire `sparda review --markdown` into `action.yml`).

## Decisions made
- Split crypto by runtime: the Express router can't assume a global (arbitrary host Node
  ≥18) → node:crypto; the Next route runs only in Next (Web Crypto guaranteed) → keep the
  global, polyfill in the bypass test. Node-19+ globals are banned unguarded (engines=18).
- Mirror statefulness is derived, not configured: no flag, on whenever a machine exists,
  off (stateless, unchanged) otherwise. Enforcing 409 on illegal transitions is the
  differentiator a hand-maintained mock can't keep truthful.

## Bugs hit
- `req.resume()` did not fix the `rawRequest` keep-alive race (it's the helper's global
  agent reusing a closed socket) — confirmed harmless via curl/fetch. Kept `req.resume()`
  anyway: draining the body is correct server hygiene.

## Notes for the next session
- The `rawRequest` helper could set `Connection: close` (or use an explicit agent) to be
  robust under rapid sequential calls — a small test-infra hardening if it bites again.
- M5 quick win: a `sparda review --markdown` step in `action.yml` that posts the behavior
  diff as a PR comment — directly leverages M3 + M2 and is the "visible at each PR" hook.
