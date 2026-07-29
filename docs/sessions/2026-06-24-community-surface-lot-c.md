# 2026-06-24 — Community surface (eval Lot C, files)

**Scope:** Eval response Lot C — add the open-source community-health surface the
eval flagged as missing: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and
`.github/dependabot.yml`. Files only (Markdown/YAML); the remaining Lot C items
are public-repo owner actions (tag/release, promote the lint check, Codecov badge).
**Commit:** single `chore(community)` commit on `community/lot-c`, merged
`--no-ff` to `main` and pushed to HQ. **Branch:** `community/lot-c` · **Tests:**
unchanged (230/230 vitest + 10/10 router self-test; no code touched).

## Done
- **CONTRIBUTING.md** — dev setup (Node ≥18, Python ≥3.9), the check matrix
  (`npm test` / `test:router` / `test:all` / `lint` / `format:check` / `coverage`),
  the 9 hard rules a PR may not break (incl. #8 — no runtime dep without an ADR),
  commit/PR conventions (feat/fix/docs/chore, 1 review + CI on the public repo),
  the BUSL-1.1 / open-core note, and security-report routing to
  `contact@residual-labs.fr` (not public issues).
- **CODE_OF_CONDUCT.md** — Contributor Covenant 2.1 verbatim; enforcement contact
  `contact@residual-labs.fr`.
- **.github/dependabot.yml** — weekly `npm` + `github-actions`. Dev dependencies
  grouped into one PR to cut noise; the 4 runtime deps deliberately left
  ungrouped so each bump is an individual, reviewable PR (honours hard rule #8).
  `chore` commit prefix to match the repo convention.
- **Baseline intact** — Markdown/YAML only, no JS touched: ESLint, Prettier, and
  the test suite are unaffected (the lint/format scope is `**/*.{js,cjs,mjs}`).
- **Through the publish valve** — added `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md`
  to `tools/publish/allowlist.json` (default-deny: an unlisted file stays private;
  `.github/**` already covered `dependabot.yml`). The secret-gate first **blocked**
  CONTRIBUTING for two HQ-only leaks (a paid-tier mention + a `docs/HANDOFF.md` /
  `docs/sessions/` process reference); scrubbed both (plus a `docs/DECISIONS.md` /
  `CLAUDE.md` link). `node tools/publish/publish-public.mjs --dry-run` is now
  **CLEAN** — a real publish would pass the gate.

## Not done / deferred — owner actions on the PUBLIC repo
- **First tag/release `v0.5.3`** — the eval's "no releases" finding is just the
  squashed public mirror having no tags. Cut it on `zyx77550/sparda`.
- **Promote the optional `lint` check to required** in `main` branch protection
  (carried over from Lot B).
- **Coverage badge + CI upload** — needs Codecov connected to the public repo
  (tokenless for public).
- These reach the public repo on the next owner-run sync; the squash/sync was not
  run from here.

## Decisions made
- **Files on HQ, not the public repo directly.** Lot C files land on `main` here
  and flow to public on the owner's next sync — same posture as every other
  change. No direct public-repo writes, no unprompted squash/sync.
- **Contributor Covenant 2.1** (not a bespoke CoC) — the de-facto standard,
  recognised by GitHub's community-health UI.
- **Dependabot groups dev deps, not runtime deps.** Grouping keeps tooling bumps
  to one weekly PR; leaving the 4 runtime deps individual preserves the "4
  exact-pinned, each consciously chosen" posture (hard rule #8).
- **Contact = `contact@residual-labs.fr`** (brand domain from the package.json
  author / README), not a personal address. Owner should confirm the mailbox or
  forward exists.
- **CONTRIBUTING is written for a public audience** — no links to private
  artifacts (`CLAUDE.md`, `docs/DECISIONS.md`, `docs/HANDOFF.md`, `docs/sessions/`)
  and no paid-tier/roadmap mentions. The valve's secret-gate enforces this, and it
  did: the first draft was blocked until scrubbed.

## Notes for the next session
- When the owner next syncs HQ → public, these three files populate GitHub's
  community-health checklist (CONTRIBUTING shown on issue/PR open, CoC tab,
  Dependabot active).
- `docs/SECURITY.md` exists (threat model) but has **no private reporting
  contact** section yet; CONTRIBUTING now routes vuln reports to
  `contact@residual-labs.fr`. Consider adding a GitHub "Security policy" report
  section if you want the Security tab populated too.

> Remember: `docs/HANDOFF.md` updated alongside this file.
