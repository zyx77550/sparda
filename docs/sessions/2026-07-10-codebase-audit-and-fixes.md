# 2026-07-10 — Full codebase audit + fixes

**Scope:** Second pass after the external HQ→public sync audit — sweep the whole
codebase for faults/bugs/illogic/improvement axes, then fix them impeccably with
tests and full documentation.
**Commits:** _(this branch)_ · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 399 ✓ Vitest + 10/10 router self-test

## Done
- **S1 (security)** — `cfm_` write-confirmation nonce was minted with
  `Math.random()` in the Express + Next.js router templates (FastAPI already used
  uuid4). Switched to `globalThis.crypto.randomUUID()` in both. No new dep, no new
  placeholder (avoided touching the self-test's leftover-placeholder assertion).
- **B1 (data loss)** — `sparda remove` deleted `.sparda/` (incl. `backup/`) even
  when an injection couldn't be cleanly reverted, right after telling the operator
  to restore from that backup. Now it stops before any destructive cleanup and
  preserves everything, `exitCode=1`. (E-017)
- **B2 + I1 (reversibility + de-dup)** — new `src/generator/injection.js` holds
  the ONE marked-block contract (`makeInjectionMarkers`, `stripForReinit`,
  `stripForRemoval`). Express + FastAPI generators now share it; the duplicated
  markers/regex/`escapeRx` are gone. `stripForRemoval` is the byte-exact inverse
  of a line splice, fixing the stray blank line when the block is top-anchored.
  Verified byte-identical for mid-file / top-of-file / CRLF. (E-018)
- **T1 (tests)** — `tests/command-smoke.test.js` drives the previously-untested
  wrappers `runApocalypse` (clean→PROVEN/0, bait→NOT-PROVEN/1, `--json`),
  `runVerify`, `runUbg`, `runOpenapi` on real fixtures; harness isolates
  `process.exitCode` and captures `console.log`.
- **T2** — MCP server version read from `package.json` instead of the stale
  hardcoded `'0.5.2'` (`stdio.js`).
- **Docs** — full findings + fixes in `docs/audit/2026-07-10-codebase-audit-and-fixes.md`;
  ERRORS.md E-017/E-018/E-019; this session record; HANDOFF updated.

## Not done / deferred (documented in the audit §4, on purpose)
- **D1** flywheel serves reads up to 30 s stale by default — product decision
  (opt-in vs document the window), not changed without the owner.
- **D2** `sanitizeDescription` is best-effort (slice-before-check, regex
  bypassable) — hardening deserves its own chantier (Unicode normalization).
- **D3** `heal --agent` uses `spawnSync(..., {shell:true})` — legitimate
  (user-supplied command), just flagged to document in help.
- Wrapper smoke tests for `init`/`dev`/`mirror`/`timeless`/`heal` need a live-host
  integration harness — deferred rather than half-tested.

## Decisions made
- Web Crypto (`globalThis.crypto.randomUUID()`) over an added `node:crypto`
  import/placeholder: cryptographically secure, Node ≥18 + Next global, zero churn
  to the generator/self-test placeholder machinery.
- On unclean `remove`, preserve over proceed: never destroy a recovery artifact.
- One inject/inverse definition (a module), not two regexes — the divergence that
  caused B2 can't recur.

## Bugs hit
- My new `injection.js` (untracked) made PR #12's self-containment guard fail
  until staged — the guard correctly flagged a runtime import that would be left
  behind by the valve. Working as designed; resolved by `git add`.

## Notes for the next session
- The three router templates duplicate a lot of logic (spardaNonce, two-phase
  commit, error envelope). A shared template partial would prevent parity bugs
  like E-019 at the source — candidate refactor.
- If D1 is taken up: the staleness window belongs in the `sparda_get_context`
  hint, and/or flip `SPARDA_FLYWHEEL` default to opt-in.
