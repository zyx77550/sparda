# Session 2026-07-04 (b) — Round 3: the twin, the grammar, evolution + full germination

**Agent:** Claude (Fable 5), autonomous — the owner granted a one-time blanket
GO for R3.2, R3.3, R3.4 and R4.5 ("je te donne une autorisation une fois et tu
fais directement"). Context: 0.7.1 live on npm + registry, truth session on
Reach green (drift caught, sync repaired, seed transplanted, doctor timeout
hardened to 5s by Gemini).

## ADR-021 first — the value boundary

Round 3 needs observed VALUES. The boundary is explicit (see DECISIONS.md):
values live ONLY in `.sparda/twin.json` (machine-local, gitignored); learning
is an explicit command, never continuous, never on the request path; the twin
is the only arena for trials; evolution only suggests; the seed stays
value-free — R4.5 is germination, not transport.

## What shipped

- **R3.2 `sparda twin [--learn] [--port n]`** — `src/commands/twin.js`.
  Learn: one `/mcp/invoke` per enabled GET without required path params
  (writes and parameterized reads skipped WITH reasons), 16KB cap per
  exemplar, refuses politely when the host is down ("the twin learns from
  the living"). Serve: `node:http`, zero deps — plain routes answered from
  exemplars, writes → 202 echo, `/mcp/tools|invoke|stats|events` surface so
  the unchanged bridge drives the ghost; stats carry `twin: true`; EADDRINUSE
  explains that the twin REPLACES the host on its port.
- **R3.3 `sparda grammar`** — `src/commands/grammar.js`. `buildGrammar`
  (pure): observed edges from circuit links, hypothesis edges from
  `responseKeysOf(exemplar) ∩ params` (bounded 50, dedup: an observed flow is
  never duplicated as a guess). Phrases = the circuits, with seen counts and
  crystallized/evolved flags. Writes `.sparda/grammar.json`.
- **R3.4 `sparda evolve`** — `src/commands/evolve.js`. `candidateChains`
  (pure, cap 10/run) → `trialCandidate` against an in-process twin on an
  ephemeral port (A answers, linked key exists and is scalar, B accepts the
  fed value). Survivors persisted via `mergeManifestKeySync` as `seen: 0,
  evolved: true` circuits — the Baldwin effect: heredity without
  confirmation; the condenser's real observations must still crystallize.
- **R4.5 `seed import --germinate`** — seed.js: after the merge, the grammar
  regrows locally from the imported structure (+ local exemplars if any).
- CLI: `twin`/`grammar`/`evolve` dispatch, `--learn`/`--germinate` flags,
  help updated.

## State

Suite **293/293** (was 283, +10 round3) · ESLint 0 (also fixed a leftover
unused import in negentropy.test.js) · Prettier clean · zero new runtime
dep · nothing on any request path. **Round 3 v0.1 and R4.5-full are DONE —
every round of the ROADMAP now has a living v1.**

## Honest v0.1 limits

- Twin learns only GETs without required path params (chained learning via
  grammar edges is the natural v0.2).
- Evolution trials 2-step chains only; N-step comes with a smarter arena.
- The grammar's hypothesis space is exemplar-driven: no twin memory, no
  guesses (stated in the CLI output).

## Next

1. Valve → public PR (owner or Gemini merges; next publish = **0.8.0**,
   a new organ set is a minor bump).
2. Truth-test Round 3 on Reach: `twin --learn` → stop app → `twin` →
   drive it from Claude Desktop; then `grammar` + `evolve`.
3. Remaining after this: §6 security chantiers, localKey ADR, Mycélium ADR,
   R3.3-full (protocol translation) and R3.4-full (idle-time evolution) as
   the next horizon.
