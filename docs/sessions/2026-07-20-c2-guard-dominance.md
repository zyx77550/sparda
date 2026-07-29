# 2026-07-20 — C2 closed: guard-dominance (kill the false PROVEN by non-dominance)

**Scope:** isolate, fix perfectly + safely, test, and integrate the C2 finding from the perfection
audit (`docs/AUDIT-PERFECTION-SPARDA-2026-07-20.md`) — a false PROVEN, the cardinal sin.
**Commits:** (this session) · **Branch:** `claude/current-task-u45a4d` · **Tests:** 692 Vitest green (+5), mutation 16/16 (+2), ESLint/Prettier clean

## Done
- **Reproduced the false PROVEN minimally** on 0.66.0 before touching anything: a Next handler that
  mutates in `if (body.preview) { charge.create(); return }` before `await requireAuth(req)` → SPARDA
  said `✓ PROVEN`. Confirmed it also holes `sparda gate` (arm clean, introduce bypass, gate silent).
- **Fix — guard-dominance at SCAN time (sound by construction):**
  - `extract.js`: a recursive spine walk over each body tracks whether a guard has run ON THE CURRENT
    PATH (a guard in a branch never covers a sibling). Each mutation reached while unguarded is tagged
    `_unguardedPath`, promoted to `bypassesGuard` **only if the same body also holds a guard** (so a
    body guarded cross-procedurally is left to the route model). Barrier = **auth-specific** only
    (`AUTH_GATE_CALL` + `401/403`/auth-exception deny) — deliberately NOT the broad `GUARD_NAME`, NOT
    any throw, NOT any 4xx.
  - `resolve.js mergeScan`: strip `bypassesGuard` from merged sub-scans — a delegated service's
    INTERNAL ordering is not the route's auth gate ("effects merge; guards do not").
  - `translate.js`: carry `bypassesGuard` to the effect node meta.
  - `apocalypse.js`: O1 flags a `bypassesGuard` write as a hard critical (`guardBypass`, never
    softened) even on an otherwise-guarded route; `buildProofObjects` never claims a bypass discharged.
- **Measured to zero.** Catches BOTH shapes (early-return before guard, AND write in a branch a
  sibling guards). First cut = 25 false positives (broad GUARD_NAME + service-internal). After
  tightening the barrier to auth-only + the merge-strip: **0 false positives** on dub (580), immich
  (281), nocodb, medusa, ghostfolio, formbricks, postiz, rallly, papermark. Full suite green.
- **Pinned:** `tests/fixtures/ubg-guard-dominance` (bypass / sibling / ordered / nested-ok routes) +
  `tests/guard-dominance.test.js` (5) + 2 mutation guards (both bite). `docs/ERRORS.md` E-051.

## Not done / deferred
- **C3 (from the same audit): server actions (`'use server'`)** — an unguarded server-action mutation
  is invisible and `blindspots` reports false 100% coverage. Smaller (flag then extract). Next.
- Cross-procedural guard-dominance (a write in a service reached before a guard in the caller) is not
  modeled — the fix is per-handler-body. Sound (never a false PROVEN), just doesn't catch that rarer
  shape. Full CFG dominance across bodies is the eventual generalization.

## Decisions made
- The dominance signal only ever SUBTRACTS guard credit → can turn PROVEN into NOT_PROVEN, never the
  reverse → **cannot fabricate a false PROVEN regardless of heuristic accuracy.** The only variable is
  the false-positive rate, which we measured to zero.
- Barrier detection is auth-specific by design: conflating validation throws / business checks
  (`hasAdmin`, `NcError.badRequest`) with auth is exactly what produced the 25 false positives.

## Notes for the next session
- Adversarial repros live in the scratchpad (`c2-next`, `c2-ok`) + committed as the fixture.
- 0.66.0 is LIVE on npm with the gate; this fix makes the gate's promise real (it now catches the
  subtle bypass, not just brutal guard removal). Worth a 0.67.0 once C3 lands.
