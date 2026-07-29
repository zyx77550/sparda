# 2026-07-10 — The PR review bot (R5/M3+M5, the growth loop)

**Scope:** After M2, the owner asked me to judge what actually drives adoption and only
pursue it if it genuinely sells. I judged that more compiler depth (M1 taint, M4) is
invisible to new users, and picked the growth loop instead: ship `sparda review` as a
GitHub Action that comments the behavior diff on every PR.
**Branch:** `claude/new-session-5yhx6t` · **Tests:** 418 ✓ Vitest + 10/10 router self-test

## Done
- **CI robustness (E-022, earlier in the day):** the stateful mirror hung Node 18's
  undici (stale keep-alive to a recycled ephemeral port). Fixed by sending
  `Connection: close`. Full matrix (Node 18/22 × ubuntu/windows + lint + coverage) green.
- **The PR review bot (R5/M3+M5):**
  - `action.yml` — added `mode: review` beside `mode: apocalypse`. On a pull_request it
    fetches the base branch, runs `sparda review --markdown`, prints it, and posts a
    sticky comment. `fail-on-severity` (default `none`) controls gating — comment-only by
    default so it never blocks a merge and is safe to add on day one.
  - `.github/sparda-pr-comment.mjs` — dependency-free (node:fs + global fetch) sticky
    comment poster. Finds the bot's prior comment by a hidden `<!-- sparda-review -->`
    marker and edits it in place (one comment per PR, not a wall). Pure helpers
    (`withMarker`, `chooseCommentAction`, `postSticky`) exported and tested. NEVER fails
    the job — a comment that can't post (fork PR read-only token, API hiccup) stays a
    non-event.
  - Public README (`tools/publish/public/README.md`) — a "Review every PR's behavior —
    one file, zero config" section with the copy-paste workflow and example comment.
  - `action.yml` added to the publish allowlist (was tracked but unlisted). `.github/**`
    already ships, so the poster script syncs.
  - `tests/pr-comment.test.js` — 5 tests (pure decision logic + postSticky over a mocked
    GitHub API). ADR-032; ROADMAP M5 growth-loop marked ✅.
  - Verified end to end locally: `review --markdown` → body file → poster safe-skips
    without a token (exit 0); valve dry-run shows action.yml + the script in PUBLIC,
    self-containment CLOSED, no new secret-gate hit.

## Not done / deferred
- The Action runs `npx sparda-mcp@<version> review`, so it goes live once a release
  carrying `review` is published to npm (this whole branch is pre-release).
- Can't run a real GitHub Action in CI here; validated each piece (shell logic, review
  output, poster with mocked API, safe-skip) but the true integration test is the first
  real PR on a released version.
- Next M5 cran: a design partner enabling it on a real repo. Then M1 (taint) / M4
  (cross-service) once there's a user pulling for depth.

## Decisions made
- Adoption over depth (owner-aligned): make an existing capability continuously visible
  and shareable at zero user effort, rather than build invisible moat.
- Comment-only default: the bot must never block a merge on day one, or nobody adds it.
  Gating is opt-in. And the poster never fails the job — a comment is not a gate.
- Sticky-by-marker: one PR, one comment that updates — the Codecov/Snyk/Vercel pattern.

## Notes for the next session
- When cutting the next release, confirm `sparda review` is in the published package so
  `zyx77550/sparda@main` (the Action) resolves it.
- Optional polish: a tiny landing/GIF of the bot commenting, for the README top — the
  single most shareable artifact for M5.
