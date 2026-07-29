# 2026-07-11 — Bot e2e proven + 0.14.0 release prep

**Scope:** Owner gave carte blanche ("fait ce qui te semble le meilleur"). Judgment
call: before anything new, prove the PR bot's full flow end to end (the part no unit
test covered), then prepare — not publish — the release that makes the bot live.
**Branch:** `claude/new-session-5yhx6t` · **Tests:** 419 ✓ Vitest + 10/10 router self-test

## Done
- **`tests/pr-comment-e2e.test.js`** — the whole Action flow, wired exactly as
  `action.yml` wires it: a real git repo with a guard-removing "PR" →
  `sparda review --base HEAD --markdown` as a subprocess → body file → the comment
  script as a subprocess against a mock GitHub HTTP server (in-process). Asserts:
  review output contains GUARD_REMOVED; first script run POSTs one comment carrying
  the `<!-- sparda-review -->` marker; second run PATCHes comment 101 and POSTs
  nothing — the sticky contract, proven, 793ms.
- **Release prep 0.14.0** (no publish): `package.json` 0.13.3 → 0.14.0; lockfile
  version fields fixed (they were stale at 0.10.0); CHANGELOG entry covering the
  session's shippables — Added: `sparda review` (ADR-030), the PR review bot
  (ADR-032), the stateful mirror (ADR-031); Fixed: E-017, E-018, E-019/E-021,
  E-020, E-022; Security: valve under-send gate (ADR-029). `npm pack --dry-run`
  confirms `review.js` / `mirror.js` / `injection.js` in the tarball at 0.14.0.

## Bugs hit
- **Self-inflicted test deadlock.** First e2e draft ran the comment script with
  `spawnSync` while the mock GitHub server lived in the same vitest process:
  `spawnSync` blocks the event loop, the server can never accept, the child's fetch
  waits forever. Diagnosed by isolating each piece (both fine standalone), fixed
  with an async `spawnAsync` helper — the comment explains the trap for the next
  reader. The `sparda review` step stays `spawnSync` (no server needed during it).

## Not done / deferred (owner actions)
- **`npm publish` of 0.14.0** — irreversible, owner's call. Until then the Action's
  `mode: review` resolves no `review` command on npm.
- Merge PR #12 to main so `zyx77550/sparda@main` serves the new `action.yml`, then
  run the HQ→public sync (the valve now hard-fails on under-send, so
  `src/ubg/apocalypse.js` and friends will land).

## Notes for the next session
- After publish: smoke `npx sparda-mcp@0.14.0 review --help` from an empty dir, and
  open a test PR on the public repo with the review workflow to see the first real
  sticky comment.
