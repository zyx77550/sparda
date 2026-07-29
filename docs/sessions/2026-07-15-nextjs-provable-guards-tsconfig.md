# 2026-07-15 — Next.js provable-deny guards + the tsconfig-alias bug (dub)

**Scope:** attack the biggest giant everyone fails on (dub, Next `apps/web`) — kill its
152 UNGUARDED_MUTATION findings (147 false), honestly.
**Commits:** `<hash>` · **Branch:** `claude/current-task-u45a4d` · **Tests:** 589/589 green (3 skip)

## Done
- **E-039 — tsconfig JSONC bug fixed (the real giant-killer).** `readTsconfig` stripped
  comments with a regex; a `paths` glob (`["pages/*"]` → `/*`, `["**/*.ts"]` → `*/`) made
  the block-comment regex delete the whole `paths` block → `JSON.parse` threw → every `@/…`
  alias resolved to null. Replaced with `stripJsonc` (string-aware scan; trailing-comma
  drop). Corpus-wide: any monorepo with a glob in tsconfig had every alias hop dead.
- **Next guards that provably DENY recognized** (`src/ubg/nextjs.js`): HOC wrappers
  (`withWorkspace(h)`), in-body bare verifiers (`await verifyQstashSignature(req)`), verb
  aliases (`export const PUT = PATCH`). Each resolved through ESM barrel re-exports
  (`export * from './workspace'`), deep-scanned (into the returned inner fn and bare helper
  calls) for a proven 401/403 / auth-exception / `{ code: "unauthorized"|"forbidden" }`
  deny. In-body recognition double-gated (verifier-shaped name AND proven deny).
- **New helpers:** `resolveExportedFunction`, `stripJsonc` (extract.js); `wrapperGuardScan`,
  `bodyGuardScan`, `provesDeny`, `wrapperNamesOf`, `calleeNameOf`, `localConstInit`
  (nextjs.js). ESM re-export tracking in `parseModule` (`reexports` named + `starReexports`).
- **Fixture** `ubg-nextjs-hoc-guard` (wrapper-guarded / open / in-body-verifier / verb-alias)
  + 5 tests. `ubg-nextjs-wrapped` kept as the unresolvable-wrapper case.
- **Result:** dub **152 → 5 UNGUARDED** (guards 1 → 514, verified 513). No regressions:
  cal.com PROVEN (more verified guards from restored aliases), twenty (156 verified) /
  immich unchanged.

## Not done / deferred
- The 5 surviving dub findings are honest true-positives — left flagged on purpose:
  pre-auth `reset-password`; two OAuth callbacks gated by soft `getSession()` (redirect,
  not a hard 401); `track/application` under a non-auth `withAxiom` wrapper;
  `notification-preferences` behind `verifyUnsubscribeToken` (returns null, not a 401).
  Recognizing soft-`getSession` auth would need modeling "reads session → conditionally
  proceeds" — weak, and a false-negative risk (E-029). Not worth it.
- Global-guard / `@Authenticated` verified guards (immich) and req.body→write taint (ADR-P1)
  remain the next depth arcs, unchanged.

## Decisions made
- Recorded as **ADR-046/ADR-055 continuation + E-039**, no new ADR (Zak's ADR-fatigue note).
- Guard recognition suppresses a finding ONLY on a PROVEN deny; an unresolvable or
  non-denying wrapper is left out, so a genuinely open route still flags. Discipline over
  reach (E-029).

## Bugs hit
- **E-039** (see ERRORS.md) — the tsconfig comment-strip regex. The lesson: never strip
  comments from a string-bearing grammar with a regex; a broken config must be loud, not
  silently empty (the `catch → { paths: {} }` fallback hid this for the whole corpus).

## Notes for the next session
- `provesDeny` (nextjs.js) follows BOTH bare and `mod.method()` imported calls, guard-only
  (never touches the app effect graph) — that's why it can go where the shared effect engine
  deliberately won't. If a future need arises to follow bare imported calls for EFFECTS, do
  it in resolve.js behind a measured corpus check (byte-identity risk).
- dub's remaining verdict is NOT_PROVEN on 5 real holes + 4 IRREVERSIBLE_OBSERVABLE — that's
  the honest floor, a good demo target ("here are the 5 routes that actually need a look").
