# Merge & publish runbook — v0.62.0

> For the session (Gemini) that merges to `main`, and for Zak who runs `npm publish`.
> Verified live on 2026-07-17. Nothing here depends on the ephemeral test corpus — the shipped
> package is self-contained.

## The branch to merge

- **Freshest, most complete branch:** `claude/current-task-u45a4d`
- **HEAD:** `8080189` (feat(stitch): cross-repo proof)
- **State:** 11 commits ahead of `origin/main`, **0 behind, merges cleanly (0 conflict markers)**.
- Restarted from the merged 0.58.0 `main`, so it stacks cleanly. It also folded in the parallel
  session's branch (`docs/strategy-free-first-and-10x`) — do **not** merge that separately.

## Pre-merge verification (all ✓ as of 8080189)

| Check | Result |
|---|---|
| `npm test` | 647 passed, 3 skipped |
| `npm run lint` / `npm run format:check` | clean / clean |
| `npm run mutation` (home-grown mutation testing) | 5/5 mutants killed |
| `tools/publish/publish-gate.test.js` (published set closed under imports) | 23 passed |
| `npm pack --dry-run` | sparda-mcp-0.62.0.tgz · 111 files |
| bench/ · corpus · /tmp · docs/ leak into package | none |
| `package.json` version vs CHANGELOG top | both `0.62.0` |
| branch vs `origin/main` | 11 ahead · 0 behind · 0 conflicts |

## Merge (clean, no conflicts)

```bash
git checkout main && git pull origin main
git merge --no-ff claude/current-task-u45a4d
git push origin main
```

## Publish (Zak)

```bash
git checkout main && git pull
npm test && npm pack --dry-run   # last gate before publish
npm publish                      # publishes sparda-mcp@0.62.0 (public)
git tag v0.62.0 && git push origin v0.62.0
```

`prepublishOnly` runs the full suite and aborts on any failure — you cannot publish a red build.
The `files` whitelist ships `src`, `templates`, `demo-app`, `README.md`, `LICENSE`, `SKILL.md`
only; `bench/`, `tests/`, `docs/` are dev-only and correctly excluded.

## What's in 0.62.0 (the arc since 0.58.0)

- **0.59** — restored the 4-exact-pinned-deps invariant (removed an unused, invalid `js-tokens`);
  per-command `--help`; CI gate `bench:check` (README numbers vs `bench/route-proof.json`);
  `docs/COMPETITION.md` (the honest Semgrep/CodeQL/Snyk answer + SEO note) & `docs/TRUST-LOG.md`.
- **0.60** — **E-046**: parse Prisma's split-schema folder (`prisma/schema/*.prisma`) — dub's
  state layer went 0 → 82 tables; **BolaRay ownership-model enrichment** (the BOLA advisory now
  names the missing scope, "link should be direct-owner (userid)"); `AGGREGATE_MEMBER_BYPASS`
  made advisory. Also `src/ubg/llm-resolve.js` (papers 2+3 verify-before-admit guardrail).
- **0.61** — **lateral inhibition**: `collapseFloods` folds a rule that fires on ≥15%/≥10 routes
  into one summary at full severity (sound + verdict-neutral). directus 97→1, dub 174→1.
- **0.62** — **`sparda stitch`**: cross-repo / cross-service proof (the moat) — joins one service's
  outbound HTTP calls to another's routes, rides a cross-service BOLA advisory no mono-repo tool
  can produce.
- **Discipline (nature's playbook, ADR-060):** home-grown **mutation testing** (`npm run
  mutation`, in CI — DNA-polymerase coupled proofreading) and the corpus oracle's fold-change
  reporting (differential expression) now guard the engine.

## After publish — the remaining work (not blockers)

- Publish the GitHub Action to the Marketplace (tag + release, UI); submit `server.json` to the
  MCP registries; reserve `sparda` on npm (defensive).
- Engine, open: `sparda stitch` real-repo matching quality (HTTP-target extraction); the LLM
  hint-producer for `llm-resolve` (MCP sampling); incremental UBG (predictive coding).
- J6 dogfooding (residual-reach / residual-publish / residual-labs-v2) once repo access works.
