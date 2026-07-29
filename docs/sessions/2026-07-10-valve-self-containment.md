# 2026-07-10 — Valve gates under-send (self-containment rule)

**Scope:** Act on an external audit of the public mirror that found `apocalypse`
and `heal` crashing with `ERR_MODULE_NOT_FOUND` — the public repo shipped without
`src/ubg/apocalypse.js`, a runtime file both commands import. Close the *class* of
bug (a required file left behind by the HQ→public valve), not just the instance.
**Commits:** _(this branch)_ · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 393/393 Vitest + 10/10 router self-test green

## Done
- Triaged the audit against HQ: the missing file **exists** in HQ, is git-tracked,
  matched by the allowlist's `src/**`, and already in the `npm pack` tarball. So
  the defect is a **public-mirror under-send**, not an HQ regression. Recs #2
  (npm), #4 (bait fixture armed in `tests/apocalypse.test.js`), and #5 (prover
  unit-tested) were already satisfied in HQ.
- Built the missing guard (audit recs #1 + #3) — `tools/publish/self-contained.mjs`:
  every relative import from a published `src/**` JS module must resolve to a file
  ALSO in the published set. AST-based (`@babel/parser` + `@babel/traverse`, both
  already pinned) so a commented-out `import` never counts. Covers static `import`,
  re-`export … from`, dynamic `import()`, `require()`; ignores bare specifiers.
- Wired it as a **hard gate**: `execute-sync.mjs` exits non-zero on any dangling
  import (never stages an incomplete mirror); `publish-public.mjs --dry-run` prints
  a Self-containment verdict beside the secret verdict and factors it into
  BLOCKED/PASS.
- Tests in `tools/publish/publish-gate.test.js`: unit coverage of
  `collectRelativeImports` / `resolveWithinSet` / `checkSelfContained`, plus a
  **non-regression test over the actual published set** (`git ls-files` ∩
  allowlist) asserting zero dangling imports.
- Verified by simulation that the guard flags exactly the audited under-send
  (`src/commands/apocalypse.js` and `src/commands/heal.js` → `../ubg/apocalypse.js`)
  when the file is dropped from the set; clean (0 violations) on the current tree.
- ADR-029 in `docs/DECISIONS.md` (extends ADR-016). HANDOFF updated.

## Not done / deferred
- Audit rec #6 (README honesty): the HQ README is private; the public README ships
  via the `tools/publish/public/` override. No change needed in HQ — but whoever
  re-syncs the public mirror should confirm the missing file lands (the valve now
  refuses to sync without it).
- Pre-existing secret-gate REVIEW marker at `src/flight/box.js:172` (`paid-tier`)
  still blocks a *real* publish — out of scope here, and real publish is stubbed.
- No commit was made to the public repo; the fix is HQ-side (the valve), exactly
  as the audit recommended.

## Decisions made
- Enforce the rule **twice** — as a valve gate (a real publish is blocked) and as a
  CI test (fails the instant a runtime import leaves the public surface). The audit's
  deeper finding was a process gap, so a test alone would repeat the mistake.
- Scope the check to `src/**` JS only (the runtime graph the host executes), not
  `demo-app`/`tests` fixture apps whose imports intentionally reference local files.
- AST over grep: SPARDA is an AST tool, and `parser/nextjs.js` has a commented-out
  `from './impl'` that a regex would false-positive on.

## Bugs hit
- None. (`npm install` was needed first — deps weren't present in a fresh container.)

## Notes for the next session
- The valve's staging/push is still stubbed (`publish-public.mjs` exits 2 outside
  `--dry-run`). When the real HQ→public sync is next run via `execute-sync.mjs`,
  the new gate is live: it will hard-fail if the allowlist ever drops a runtime
  file. That is the intended fix for the audited under-send.
