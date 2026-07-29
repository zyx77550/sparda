# docs/ — the project bible

Single source of truth for how SPARDA works, why it is the way it is, and
where it is going. The repo is the RAG: every doc is small, factual, and
named for retrieval. If a fact lives in a conversation but not here, it
does not exist.

## Map

| Doc | What it answers | Update when |
|---|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | "I'm an AI session — where do I start, what are the rules?" | A hard rule or convention changes |
| [`../README.md`](../README.md) | "What is SPARDA?" (public pitch) | A user-visible feature ships |
| [`EXPLAINER.md`](EXPLAINER.md) | "Explain SPARDA fully: pain, mechanics, safety, FAQ" | The product story changes |
| [`SPARDA-EXPLIQUE.md`](SPARDA-EXPLIQUE.md) | Founder's French summary — the whole project in 10 min | Major shifts only |
| [`../ROADMAP.md`](../ROADMAP.md) | "What's the vision, the tiers, the build order?" | A round/tier decision changes |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | "How does the system work, file by file?" | Code structure or data flow changes |
| [`DECISIONS.md`](DECISIONS.md) | "Why is it built this way?" (ADR log) | Any significant choice is made — **append-only** |
| [`SOUNDNESS.md`](SOUNDNESS.md) | "What must every analysis feature never break?" (the safe-direction contract) | A new analysis feature ships — check it against the contract |
| [`ERRORS.md`](ERRORS.md) | "Has this failure been seen before?" | Any non-trivial bug is fixed — **append-only** |
| [`SECURITY.md`](SECURITY.md) | "What's the threat model and the defenses?" | A defense or known gap changes |
| [`COMPETITION.md`](COMPETITION.md) | "Who else plays here, what do we adopt/ignore?" | Every serious competitor scan |
| [`TESTING.md`](TESTING.md) | "How do I run/write tests?" | The suite structure changes |
| [`MASTER-PLAN-RELEASE.md`](MASTER-PLAN-RELEASE.md) | "I'm publishing — what is the exact order, and what has already gone wrong?" | **Read in full before ANY release**; update when the procedure or tooling changes |
| [`HANDOFF.md`](HANDOFF.md) | "What's the current state: done / not done / next?" | **Every session that changes anything** |
| [`sessions/`](sessions/) | "What happened in each work session?" | One file per session — **append-only** |

## The handoff protocol (non-negotiable)

The project is built across many AI sessions that share no memory. The chain
of context is maintained by hand:

1. **Session start** — read `HANDOFF.md`, then the docs your task touches.
2. **During** — when you fix a real bug, add it to `ERRORS.md`; when you make
   a real choice, add it to `DECISIONS.md`. Two minutes now saves a session later.
3. **Session end** — rewrite `HANDOFF.md` (it describes the *present*, not
   history) and add `sessions/YYYY-MM-DD-<slug>.md` from `sessions/TEMPLATE.md`
   (history, append-only). Commit docs with the code they describe.

## Style

Docs are in English (code language). `ROADMAP.md` is in French — it is the
founder's vision document and stays in the founder's voice. Keep entries
short: a doc nobody reads protects nobody.
