# 2026-07-11 — Corpus bug-hunt: SPARDA on real OSS repos

**Scope:** Verify the 0.14.0 publish/sync landed, then run the first real
corpus bug-hunt — point `sparda apocalypse` at popular public Express repos
(not fixtures) and record verdicts, honesty, and coverage gaps.
**Branch:** `claude/new-session-5yhx6t` (restarted from `origin/main` @ `eca06a0`
after PR #12 merged) · **Tests:** untouched (no product code changed) · **SPARDA:** v0.14.0

## Done
- **Verified the release** end to end: `sparda-mcp@0.14.0` live on npm (latest),
  public repo `zyx77550/sparda@main` on 0.14.0 with the review bot + self-review
  workflow, MCP registry `server.json` at 0.14.0, `apocalypse.js` + `review.js`
  present in public. All aligned.
- **Ran the corpus bug-hunt** on 4 real repos. Headline: **NOT PROVEN, 2 critical
  `UNGUARDED_MUTATION`** on the official Prisma Express example (~62k★), verified
  real in `src/index.ts`; **PROVEN** control on `node-express-boilerplate` (~7k★).
  Determinism byte-identical across runs & locales on real code (E-020 holds).
- **Documented** it all: `docs/audit/2026-07-11-corpus-bughunt.md` (commands,
  outputs, ground-truth source, honesty ledger, reproduce steps).
- **Logged parser-coverage gaps** as `C-001` in `docs/ERRORS.md` (rootpath
  requires; TS DI route-loaders) — two repos compiled to 0 nodes.
- **Responsible-disclosure**: Opened the public issue `#8560` on `prisma/prisma-examples` to report the unauthenticated writes.
- **Built a shareable artifact** of the real verdict for the owner's socials.

## Not done / deferred
- Fixing the two parser-coverage gaps (C-001) — backlog; each unlocks a repo class.
- Running the sweep behind `sparda review` on a live PR to capture the sticky bot
  comment on real code (nice next demo).

## Decisions made
- **"PROVEN over 0 nodes" is vacuous** and must never be presented as a pass —
  it's a coverage miss to log. (Codified in C-001's Rule.)
- **Lead with the pair** (PROVEN-on-good + NOT-PROVEN-on-risky) — a tool that
  flags everything is noise; the credibility is in the contrast.
- **Honest framing of the Prisma finding**: it's an intentional no-auth teaching
  example; SPARDA's value is flagging the risk a dev inherits by copying it, not
  "catching Prisma out". Kept this explicit in the audit doc.

## Bugs hit
- None in product code. Two parser-coverage misses (not bugs — correct
  non-results) logged as C-001.

## Notes for the next session
- The reproducible money-shot: `git clone --depth 1 prisma/prisma-examples &&
  cd orm/express && sparda apocalypse` → NOT PROVEN, 2 critical, deterministic.
- The clone corpus lives in scratch (ephemeral) — not committed; reproduce from
  the audit doc.
- Next high-leverage move stays: widen parser coverage (C-001), then a live-PR
  `review` demo. Both are zero-budget distribution.
