# Session 2026-07-03 (c) — the genome: `seed export/import` (R4.5 lite)

**Agent:** Claude (Fable 5) · **Roadmap slot:** adoption item ⑤ — the last
one. Owner asked for all four adoption features to be in the next publish;
this closes the set (report + Next.js shipped in 0.6.0; negentropy PR #15;
seed here).

## What shipped

`npx sparda-mcp seed export [--out f]` / `seed import <file>` —
`src/commands/seed.js` (pure `buildSeed`/`mergeSeed` + `runSeed`), CLI
dispatch + `--out`.

**Exported (the learning):** semantic descriptions + workflows, immune
antibodies (sig, diagnosis, hits), failure lessons, Labs circuit structure
(steps/links/seen/composite — the condenser's value-free persistence shape).
Everything sanitized on the way out.

**Never exported, never read on import (the security contract):** localKey,
port, sparding policies, per-tool `enabled`, events, generatedFiles,
toolFingerprints. `mergeSeed` simply never touches those keys — a hostile
seed carrying `policies: { writes: 'allow' }` or `tools: { x: { enabled:
true } }` changes nothing, pinned by an explicit hostile-seed test. Hard
rule #3 is not negotiable by file.

**Merge semantics:** local knowledge wins (existing descriptions/diagnoses
kept); antibody hits and failure counts merge as max(); entries whose tool
does not exist in the receiving manifest are skipped (a lesson about a tool
you don't have is noise); same caps as the runtime organs (50 antibodies,
30 circuits, 20 workflows); every imported text re-sanitized (an imported
seed is untrusted input, incl. prompt-injection in descriptions — tested).

## Why it matters (adoption)

Zero-infra network effect: a `sparda-seeds` community repo can host genomes
per stack, and `dev → prod` transplants stop re-paying the semantic pass.
The retention story ("cloning the code does not clone the memory") gains its
counterpart: the memory travels when the OWNER decides, and only the memory.

## State

Suite **274/274** (was 266, +8) · ESLint 0 · Prettier clean · zero new dep.

## Next

- Valve → public PR, then the owner publishes **0.7.0** = negentropy + seed
  (the full adoption set is then on npm).
- Known nuance for later: `seed import` writes the manifest whole; if a
  bridge is running mid-import its next merge-write wins on conflicting keys
  (documented, acceptable for a human-run command).
