# 2026-07-11 — Identity: the trust layer for AI-written code (ADR-033)

**Scope:** Owner asked the life-project question ("if this were yours, what makes it
the incontournable?") and then: operationalize the answer so nothing is lost, every
surface tells one story, Gemini is briefed, and the organs stay visible.
**Branch:** `claude/new-session-5yhx6t` · **Tests:** 419 ✓ (no code touched — docs/story only)

## The decision (full rationale in ADR-033)
- Category claimed: **the trust layer for AI-written code**. Tagline: **"AI writes.
  SPARDA proves."** The pain: AI made writing code free and trusting it scarce; the
  market's answer (LLM reviewing LLM) is circular. The empty square: deterministic,
  counterexample-based proof at zero config — which the engine already does.
- Nothing deleted: proof gate front of shelf, MCP = "give your AI safe hands"
  (a feature of the same story), organism visible second, compiler = the HOW.
- Comms rule: publicly an *evolution revealed* ("SPARDA now proves every AI-written
  PR"), never a "pivot". Honest — it is Round 5 of the roadmap executing.

## Done (all story surfaces, one voice)
- `tools/publish/public/README.md` — restructured: tagline hero, "one engine, four
  moves" table, review bot first (hero SVG), apocalypse + mirror sections, MCP
  quickstart collapsed under "Give your AI safe hands", organism intact under "The
  living organism", OpenAPI listed as the universal ingestion path.
- `SKILL.md` (root, ships to npm) + `tools/publish/public/SKILL.md` — intros tied to
  the tagline; root blockquote now names `review` first among proof commands.
- `GEMINI.md` — mission brief (identity, wording rules) + fresh task queue replacing
  the stale v0.5.3 one: post-merge public sync (warns about the new under-send
  hard-fail), 0.14.0 publish on Zak's go, enable the bot on the public repo
  (self-demonstration), registries refresh.
- `CLAUDE.md` first paragraph, `ROADMAP.md` Round-5 note, `docs/DECISIONS.md`
  ADR-033, HANDOFF part 7.

## Honesty ledger (what was said to the owner, kept here so it survives)
- Conviction that the *pain* is real and growing: very high. That the square
  (deterministic proof, zero config) is empty: high. That this exact strategy
  "pops immediately": low — virality is never promised; the strategy's merit is a
  near-zero-cost, reversible reposition over an engine that already exists, with
  compounding distribution loops (agent-native registries, the PR bot, the corpus
  bug-hunt) and fat-tail upside. The one metric that matters: the first real bug
  blocked on a stranger's repo.

## Not done / deferred
- The corpus bug-hunt flywheel (run tools/corpus on popular OSS, responsibly
  disclose findings, publish stories) — the next high-leverage, zero-budget
  distribution move after the 0.14.0 publish.
- Everything in GEMINI.md's queue (merge, sync, publish, bot-on-public-repo) is
  owner/Gemini territory.
