# 📇 Registry & listings — canonical inventory + standing maintenance (Gemini owns this)

> The **single source of truth** for every place SPARDA is listed. A listing that drifts behind the
> current version/pitch is worse than no listing — it recruits the wrong visitors on our only active
> channel (that is exactly how the official MCP entry rotted to v0.10.1 with the pre-pivot pitch).
> **Standing duty (Gemini): keep every row current.** This file is content (Claude writes the pitch);
> the mechanical refresh/submit/PR is Gemini's. Update the "State / last checked" column each pass.

## Standing rule — when to act

1. **Every release** (right after `npm publish`): walk this whole table and refresh EVERY row to the
   new version + the current pitch below. Not just npm. A release isn't done until this table is green.
2. **Cadence sweep** — roughly monthly even with no release: re-open each listing, confirm it still
   shows the current version + pitch and the repo/link still resolves; the MCP ecosystem moves fast
   and directories re-scrape or die. Log the date in the table.
3. **Never let a description go stale.** If the canonical pitch below changes, every row is due.
4. **Honesty guardrail (hard):** never "revolutionary / only one in the world / the king." Sanctioned
   line: _"the only deterministic, offline, <2 s, zero-key gate in the agent's edit loop."_

## Enforcement — what is now automatic (so it can't be forgotten)

- **Version sync is test-gated.** `tests/release-sync.test.js` fails `npm test` if `package.json`,
  `server.json` (top-level **and** `packages[0].version`) or `glama.json` disagree, or if the MCP
  identity (`server.json.name` / `packages[0].identifier`) drifts from the npm identity. So a
  release can never ship a manifest whose version lags the package — the old rot-to-v0.10.1 failure
  is now impossible. Bump all version files together (helper: keep them in one commit).
- **Runtime-dep sync is test-gated.** `tests/packaging.test.js` fails if `src/` imports a package
  that is not a declared runtime `dependency` (this is what shipped the broken 0.66.2 — E-059).
- **Still manual (this file's job):** the *pitch/description* refresh (rows below), the PR-based
  listings (rows 8–11), and the **skills-repo sync** (row S). A release isn't done until this whole
  table is green — enforcement only covers the numbers, not the words.

## The canonical pitch (keep constant across ALL listings — Claude owns the wording)

- **Tagline:** `AI writes. SPARDA proves.`
- **One-liner (registries / npm / MCP dirs, EN — global reach, do NOT translate the registry fields):**
  > AI writes. SPARDA proves. A deterministic, offline gate that catches when an AI edit removes a
  > guard, exposes a route, or breaks an invariant — no API key, right in the agent edit loop.
- **Action / Claude-ecosystem lists (EN):**
  > GitHub Action that posts a deterministic behavior proof — removed guards, unguarded mutations,
  > broken invariants — as a sticky comment on every PR.
- **Keywords:** `mcp, model-context-protocol, claude, claude-code, ai-code-review, code-review,
guardrails, static-analysis, security, authorization, bola, ai-agents, trust-layer`.

## Inventory — every listing (refresh all on each release)

| #   | Listing                                                                   | URL / how                                                  | Type                  | State / last checked                                                                                              |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | **Official MCP registry**                                                 | `registry.modelcontextprotocol.io` ← publish `server.json` | push (manifest)       | ✅ Published v0.68.0 manifest                                                                                     |
| 2   | **npm**                                                                   | `npmjs.com/package/sparda-mcp`                             | auto on `npm publish` | ✅ LIVE at **0.68.0** (Zak published 2026-07-25; new pitch + keywords confirmed on the npm page)                  |
| 3   | **glama.ai/mcp**                                                          | auto-indexes from the official registry                    | auto (verify)         | ⏳ Waiting for auto-index from v0.68.0                                                                            |
| 4   | **smithery.ai**                                                           | auto-index / submit form                                   | auto or form          | ⏳ Waiting for auto-index from v0.68.0                                                                            |
| 5   | **mcp.so**                                                                | auto-index / submit                                        | auto or form          | ⏳ Waiting for auto-index from v0.68.0                                                                            |
| 6   | **PulseMCP**                                                              | `pulsemcp.com` — auto-index                                | auto (verify)         | ⏳ Waiting for auto-index from v0.68.0                                                                            |
| 7   | **GitHub Action Marketplace**                                             | refreshes from tag `v0.68.0`                               | auto on tag           | confirm the Marketplace blurb matches the tagline (no `action.yml` change)                                        |
| 8   | **awesome-mcp-servers** (`punkpeye`, `wong2`, `appcypher`, `TensorBlock`) | fork → PR                                                  | PR (Gemini)           | punkpeye PR #10480, TensorBlock PR #1301, wong2 skips PRs, appcypher rejected.                                    |
| 9   | **More awesome-mcp-servers** (`alexei-led`, `PipedreamHQ`, `ever-works`)  | fork → PR                                                  | PR (Gemini)           | Pending PR creation                                                                                               |
| 10  | **More awesome-mcp-servers** (`habitoai`, `subratadasGit`)                | fork → PR                                                  | PR (Gemini)           | Pending PR creation                                                                                               |
| 11  | **awesome-claude-code** (`hesreallyhim`)                                  | fork → PR                                                  | PR (Gemini)           | ⚠️ PR creation failed (repository restricts external PRs)                                                         |

### Row S — Skills repo (separate public repo; sync on every release)

The published skill (`SKILL.md` here — the runtime "drive the SPARDA graph" guide) is mirrored to a
**separate skills repository**. It drifts silently because nothing in this repo points at it — so it
lives here as a first-class release row.

| Field | Value |
| --- | --- |
| Repo / URL | **`github.com/zyx77550/sparda-skills`** |
| What to sync | keep it aligned with this release (e.g. `SKILL.md` + skill assets, version/pitch) |
| How | Gemini already knows the mechanism — **this row is just the reminder not to skip it** |
| Trigger | every `npm publish` (same cadence as rows 1–11) |
| State / last checked | ✅ synced at v0.68.0 |

> The point of this row is purely the reminder: nothing else in HQ points at `sparda-skills`, so it
> gets forgotten. On every release, update it to match — Gemini knows how.

> **Directories that auto-index the official registry (3–6):** publishing row 1 correctly usually
> propagates to them within a scrape cycle — so **fix row 1 first**, then verify 3–6 caught up before
> submitting anything by hand. Rows 8–9 are curated lists: honest one-entry PRs, per each repo's
> `CONTRIBUTING`, spaced out (details + hard rules in `agent-native-pr-targets.md`).

## Verify-before-you-act

The ecosystem moves; these names are from earlier knowledge. Before forking/submitting, confirm the
repo/directory still exists and still accepts entries. If a list is dead (~6+ months no merges) or
forbids self-submission, **skip it and note that here** — don't burn goodwill.
