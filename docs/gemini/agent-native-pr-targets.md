# To Gemini — agent-native distribution: inclusion PRs (you open them via `gh`)

**From:** Claude · **Date:** 2026-07-11 (pitch refreshed 2026-07-19) · Claude can't reach
third-party repos; you can (`gh fork` → commit → `gh pr create`). These are **curated index**
submissions — legitimate inclusion, not spam. SPARDA genuinely _is_ an MCP server, so it belongs on
MCP lists; the Action/skill belong on Claude-ecosystem lists.

> **This doc = the awesome-list PR mechanics (rows 8–9).** The master inventory of ALL listings
> (registries, directories, marketplaces) + the standing "keep it current" duty lives in
> `docs/gemini/REGISTRY-INVENTORY.md`. Use the canonical pitch from there — it is the current one.

## Hard rules (read before touching anything)

1. **One entry per list. No duplicates, no reposts.** If a maintainer declines, accept
   it — do not re-submit.
2. **Follow each repo's `CONTRIBUTING`/README format exactly** — alphabetical order,
   the right category, the list's own emoji legend (language/scope/OS), a working
   link. A malformed or mis-categorized PR gets closed and burns goodwill.
3. **Space them out** (a few per day, not a burst) — a wave of identical PRs across
   lists on the same hour reads as spam and can get us blocklisted.
4. **The entry is the whole pitch.** No extra marketing in the PR body — maintainers
   hate that. Honest one-liner, correct category, done.
5. If a list is dead (no merges in ~6+ months) or its CONTRIBUTING forbids self-
   submission, **skip it** and note that in your report.
6. Verify each repo still exists and still accepts entries before forking — these are
   from Claude's Jan-2026 knowledge; the ecosystem moves.

## The canonical entry (keep this constant across lists; adapt only the FORMAT)

- **Link:** `[zyx77550/sparda](https://github.com/zyx77550/sparda)`
- **Language/scope/OS:** JavaScript/Node · Local · cross-platform (map to each list's
  legend — pick the JS/TS marker the list actually uses; 🏠 local; 🍎 🪟 🐧).
- **Description (MCP lists) — current pitch:**
  > AI writes. SPARDA proves. A deterministic, offline gate that catches when an AI edit removes a
  > guard, exposes a route, or breaks an invariant — no API key, in the agent's edit loop. (Also
  > proves deploys & PRs: `apocalypse` / `review`.)
- **Description (Claude-ecosystem / Action lists):**
  > GitHub Action that posts a deterministic behavior proof — unguarded mutations,
  > removed guards, broken invariants — as a sticky comment on every PR.

## Targets — MCP server directories

| Repo                              | Notes                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `punkpeye/awesome-mcp-servers`    | The big one. Read its ToC; best-fit category is likely a "Developer Tools" / "Code Analysis" / "Security" section. Uses the language/scope/OS emoji legend above. |
| `wong2/awesome-mcp-servers`       | Simpler format. Check its categories.                                                                                                                             |
| `appcypher/awesome-mcp-servers`   | Another active list.                                                                                                                                              |
| `TensorBlock/awesome-mcp-servers` | Large aggregator; verify it's still maintained.                                                                                                                   |
| `alexei-led/awesome-mcp-servers`  | Agentic DevOps focused, DevOps contexts.                                                                                                                          |
| `PipedreamHQ/awesome-mcp-servers` | Common awesome list for MCP servers.                                                                                                                              |
| `ever-works/awesome-mcp-servers`  | Common awesome list for MCP servers.                                                                                                                              |
| `habitoai/awesome-mcp-servers`    | Common awesome list for MCP servers.                                                                                                                              |
| `subratadasGit/awesome-mcp-servers`| Common awesome list for MCP servers.                                                                                                                              |

**MCP directories with a submit flow (use the browser subagent, not a PR):**

- `glama.ai/mcp` · `smithery.ai` · `mcp.so` — several auto-index from the **official
  MCP registry**, where we already publish `server.json`, so we may appear
  automatically. Check each: if we're listed, done; if there's a claim/submit form and
  no CAPTCHA, submit; if CAPTCHA, STOP and hand Zak the link.

## Targets — Claude ecosystem

| Repo                                                              | Notes                                                                                                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hesreallyhim/awesome-claude-code`                                | Fits the **GitHub Action** (PR review bot) and the **skill** (`SKILL.md`). Category likely "Tooling"/"Workflows"/"CI". Use the Action description above. |
| (search first) `awesome-claude` / `awesome-ai-agents` style lists | Only if genuinely relevant to a proof/CI tool — don't force-fit.                                                                                         |

## PR title (adapt per repo)

`Add SPARDA (sparda-mcp) — MCP server for Express/FastAPI/Next.js with behavior proofs`

## PR body template (keep it short and honest)

```
Adds SPARDA to the <category> section.

SPARDA is a deterministic, offline gate for AI-written code: it catches when an edit
removes a guard, exposes a route, or breaks an invariant — no API key, in the agent's
edit loop — and also proves deploys and PRs from a compiled behavior graph. Open-core,
on npm as `sparda-mcp`, in the official MCP registry.

- Repo: https://github.com/zyx77550/sparda
- Entry added in alphabetical order, following CONTRIBUTING.
```

## After you submit

- Log each PR/submission URL and its state in a new `docs/sessions/` record and ping
  Zak. If a maintainer asks a question on a PR, **relay it to Zak** — do not argue or
  re-submit. Update `docs/HANDOFF.md` with where we're listed once any merge lands.
