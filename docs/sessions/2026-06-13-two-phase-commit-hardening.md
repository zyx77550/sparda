# 2026-06-13 — Two-Phase Commit Hardening & JSON Error Envelope

**Scope:** Harden SPARDING Proof on Express template with two-phase commit gating for require_human operations and JSON error envelopes.
**Commits:** `8691b9a521b9357256cde58a08159a46f7fddcc1` · **Branch:** `main` · **Tests:** 54/54 Vitest unit tests + 10/10 custom router smoke-tests green.

## Done
- **Two-phase commit for `require_human`**: Injected router now returns `202 awaiting_confirmation` with a single-use token, preview payload, and readable instructions instead of executing the route immediately.
- **Endpoint `POST /invoke/confirm`**: Replays the token to execute the gated write/delete, re-judging policies at commit-time (e.g. if tool was quarantined in the meantime).
- **JSON Error Envelope**: Caught all router-level thrown syntax/parsing errors (like malformed JSON bodies) and turned them into structured JSON 400/500 responses with an `errorId` correlating to `/events` logs, avoiding Express HTML stack leaks.
- **Strict Parameter Checking**: `args: null` or non-object arguments on `/invoke` are rejected with JSON 400.
- **Method Checking**: Non-POST verbs on `/invoke` and `/invoke/confirm` return JSON 405.
- **Self-contained Smoke Tests**: Built `tests/router-selftest.cjs` to run 10/10 regression tests validating these behaviors.

## Not done / deferred
- FastAPI equivalent for the two-phase commit confirm endpoint and error envelope (FastAPI has some built-in JSON error styling, but the two-phase commit confirmation logic is only fully implemented on the Express template in this increment).

## Decisions made
- Single-use confirm tokens should expire within a configurable TTL (`SPARDA_CONFIRM_TTL_MS`, default 120s) and be consumed immediately upon evaluation to prevent replay attacks.
- Re-check safety policies (disabled tools, quarantine status) at the confirmation phase.

## Notes for the next session
- Align FastAPI router template with Express's two-phase commit confirm endpoint and token replay.
