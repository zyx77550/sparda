# Session 2026-07-05 — ADR-022 completed: the key really leaves the repo

**Agent:** Claude (Fable 5). Owner asked for an arbitration between three key
options (env var / git hook / ephemeral handshake); the decision was a fourth
design (ADR-022, recorded 2026-07-04). Gemini backported a first pass while
Claude was rate-limited; this session audited it and closed the real gap.

## What the audit found

The backport kept two leaks the ADR forbids:
1. **The router fallback still baked the key**: generators substituted
   `__LOCAL_KEY__` with the real key, so the committed router carried the
   secret exactly as before — the env/file resolver was dead code on top.
2. **`require('fs')` in ESM templates silently threw** (caught), so file
   resolution never actually worked in ESM apps / the Next runtime.
3. **`process.env.VITEST` gates in production templates and generators**
   made tests exercise a different reality than production (manifest kept the
   key under vitest, dropped it otherwise).

## What shipped

- Templates ×3: runtime resolution `SPARDA_LOCAL_KEY` env → `.sparda/key`
  (three relative depths) → **null = fail closed** (503 "key not configured",
  guards already present at every entry point). No baked fallback, no VITEST
  branch. Express gets `__FS_IMPORT__` substituted per moduleType (ESM
  `import` / CJS `require`); Next uses a static `node:fs` import; FastAPI
  uses os/open.
- Generators ×3: `__LOCAL_KEY__` substitution deleted; the disk manifest is
  stripped of `localKey` unconditionally (in-memory return keeps it for the
  calling process only). `ensureSpardaKey` still creates/persists
  `.sparda/key` (carry-over of hard rule #5 lives in the file now).
- Tests: routers under vitest now receive the key via env at dynamic-import
  time (gossip already had `importRouterWithEnv`); assertions flipped to the
  new contract — the router must NOT contain the key, the disk manifest must
  not either, stability is asserted on `.sparda/key`. Deleted a stale
  `templates/express-router.txt.bak` that still carried the old baked-key
  line (would have crossed the valve via `templates/**`).

## State

Suite **293/293** · ESLint 0 · Prettier clean · zero new dep. The chain is
now consistent end to end: committed router (no key) → gitignored key file →
CLI/bridge resolve env→file→legacy-manifest → fail closed everywhere.

## Next

- Valve → public PR; owner publishes **0.8.1** (security patch).
- README already updated by Gemini for 0.8.0; add one line on
  `SPARDA_LOCAL_KEY` env override for prod-deliberate setups at next sync.
