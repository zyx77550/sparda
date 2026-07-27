# 🧬 Task for Gemini — mine public history to feed the genome (no users needed)

> **From Claude, for Gemini.** This is an OPS task: run a bench script across public repos, collect
> results, write an honest summary. You do NOT write or change behavioral code here — the tool
> (`bench/cve-replay.mjs`) is already built, tested, and committed. Read‑only mining of PUBLIC
> repos; nothing is pushed to them.

## Why

SPARDA's moat is the "genome" (shared, behaviorHash‑addressed antibodies) — but it has ~no users,
so no organic antibodies. The compiler doesn't need users: **the antibodies already exist in public
git history**, waiting to be mined. Every real commit where a maintainer *added an auth guard* is a
labelled before/after pair. Running SPARDA's `diffGraphs` on `{parent → fix}` tells us, deterministic
and offline, whether SPARDA re‑derives that exact protection. This simultaneously (a) seeds the
genome, (b) measures SPARDA's **real‑world recall** (ground truth we otherwise lack), and (c) points
at the next coverage brick to build.

## The tool (already committed)

`bench/cve-replay.mjs --mine <owner/repo> [--cap N] [--app <subpath>]`

- Clones the repo's full history (blob‑filtered — cheap), finds auth/guard/permission FIX commits
  whose diff actually adds a guard, and replays each `{parent → fix}` through compile + `diffGraphs`.
- `--cap N` — max commits to test (default 12; use 15–20 for a fuller pass).
- `--app <subpath>` — for monorepos, the analyzable sub‑app (e.g. `packages/twenty-server`).
- Writes `bench/mined-<owner>-<repo>.json`; prints a per‑commit line + a summary.

**Honest scoring (do not "fix" this to look better):**

- `✓ re-derived` = `diffGraphs` flags `GUARD_REMOVED` or `INVARIANT_REMOVED` — the parent provably
  lacks a protection the fix added. **This is the only number that counts as re‑derivation.**
- `~ flagged-weak` = only a static risk flag (`UNGUARDED_MUTATION` / `OBJECT_SCOPE_UNPROVEN`) — SPARDA
  flags the route as worth review but did NOT re‑derive the specific fix. Report separately.
- `· missed` / `○ no-routes` — SPARDA didn't see it / couldn't compile the app (a coverage gap —
  log it, it's data).

## Run this

```bash
# baseline already measured by Claude: ghostfolio → 1/8 re-derived, 6/8 weak, 1/8 missed.
node bench/cve-replay.mjs --mine nocodb/nocodb            --cap 15
node bench/cve-replay.mjs --mine immich-app/immich        --cap 15 --app server
node bench/cve-replay.mjs --mine dubinc/dub               --cap 15 --app apps/web
node bench/cve-replay.mjs --mine twentyhq/twenty          --cap 15 --app packages/twenty-server
node bench/cve-replay.mjs --mine novuhq/novu              --cap 15 --app apps/api
node bench/cve-replay.mjs --mine calcom/cal.com           --cap 15
node bench/cve-replay.mjs --mine medusajs/medusa          --cap 15 --app packages/medusa
node bench/cve-replay.mjs --mine directus/directus        --cap 15
node bench/cve-replay.mjs --mine strapi/strapi            --cap 15
```

Disk is a fixed allowance — the script cleans its own clone, but if you get "no space left", run the
list in smaller batches. If a repo reports mostly `no-routes`, the `--app` sub‑path is probably wrong
— try the app that holds the routes, or skip it and note it.

## Deliverable

1. Keep the per‑repo `bench/mined-*.json` results (commit them under `bench/` — they are public SHAs,
   safe to commit; they are the seed genome + the evidence).
2. Write `docs/gemini/GENOME-MINING-RESULTS.md`: a table `repo · fixes tested · re-derived · weak ·
   missed · no-routes`, the **aggregate recall** (`Σ re-derived / Σ tested`), and 3–5 example
   `GUARD_REMOVED` hits (repo + commit + subject) as the shareable "SPARDA re‑derives real fixes"
   proof.
3. **Be honest about the number.** Claude's ghostfolio pass was 1/8 — expect a low aggregate today.
   That is the true state and it is valuable; do not spin it.

## The finding to flag for Claude (the next brick)

The dominant reason for `missed` / `weak` on ghostfolio: real guards are **custom permission
decorators** (`@HasPermission`, `@HasRole`, app‑specific `@Roles(...)`) that SPARDA does not yet
model as `guard` nodes — so a fix that adds `@HasPermission('watchlist:create')` to a route isn't
seen as a guard delta. **Report the count of `missed`/`weak` commits whose fix added a custom
permission decorator** — that number is the business case for the next coverage brick (model custom
permission/role decorators as guards), and this same pipeline will re‑measure the lift.

## Constraints

- Read‑only. Never push to a mined repo. This is not a publish blocker — run it when budget allows,
  after the 0.67.0 publish + registry refresh (`REGISTRY-INVENTORY.md`).
- If a repo won't clone or compile, skip and note it — don't burn the session on one giant.
