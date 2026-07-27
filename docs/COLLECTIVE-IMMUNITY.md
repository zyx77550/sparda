# Collective immunity — the world genome (blueprint)

> **Moat. HQ-only. Never allowlisted.** This is the thesis that makes SPARDA
> uncopyable. Referenced by ADR-035. Status: **Bricks 1 + 1.5 + 2 shipped**
> (Brick 2, the signed self-verifying antibody + `sparda genome`, landed 2026-07-12
> as ADR-041); Brick 3 (the public genome backplane / trust policy) designed here.
>
> **Note (2026-07-12):** the *mechanism* of Brick 2 is now real code — antibodies are
> content-addressed, Ed25519-signed, self-verifying, and merge/recall/serialize offline
> with zero infra (git is the backplane). What remains in Brick 3 is the *policy* layer
> (issuer reputation, witness thresholds, revocation) and the curated public repo.

## The one-sentence thesis

SPARDA holds both ends of a loop nobody else can close: the **genotype** (a
deterministic, byte-addressable graph of what code *is*) and the **phenotype** (what
that code actually *does* and how it *fails*, learned at runtime — antibodies, circuits,
grammar). Wire the two ends through a content address and a bug is diagnosed **once on
Earth**, then every app that shares the same behavioral shape inherits the diagnosis —
without sharing a line of source. That is the immune system of all software. It is not
a feature; it is a network effect no fork and no incumbent can reproduce, because they
have at most one end of the loop.

Why nobody else can: CodeQL/Semgrep have a graph but no runtime learning and no
canonical cross-repo address. Sentry/Datadog see failures but no provable structure.
LLM reviewers have neither determinism nor an address. You need **both ends + a
deterministic address in the middle**. SPARDA already has all three primitives
shipped — this blueprint is about connecting them.

## The address (Brick 1 — SHIPPED)

`src/ubg/fingerprint.js`. The UBG's ids are content-derived but repo-local
(`logic:src/index.ts#foo:44`). A **behavior fingerprint** erases file/line/name/path
and keeps only the behavioral *shape* of an entrypoint's reachable subgraph:

```
descriptor = { v, method, pathParams, guards, validated, observable, effects[], writes[] }
behaviorHash = "bh1_" + sha256(canonical(descriptor))[:32]
```

`effects` is the sorted multiset of effect atoms (`db_write:update`, `http_call`,
`entropy:time`…); `writes` carries the **invariant CLASSES** touched (check/unique/
notnull) and tx/member flags — never a table name, an expression, or a literal. It is
deterministic and locale-independent (same contract as the graph — `stableStringify`).

**Proven in practice the day it shipped:** `GET /users/:id` in a fixture and
`GET /user/:id/drafts` in the real 62k★ Prisma repo produce the **same** hash
`bh1_a51c7d3e…` — two unrelated codebases, one behavioral address. The two dangerous
Prisma mutations get distinct addresses. Tests: `tests/fingerprint.test.js` (portability,
divergence, coordinate-freedom, determinism). CLI: `sparda fingerprint [--json]`.

This is the seam. Everything below hangs off `behaviorHash`.

## The middle: a ternary algebra + a 1-byte capsule (SHIPPED — ADR-036/037)

"Two ends isn't enough" — correct. The genotype and phenotype are the ends; the missing
piece is the **operation in the middle** that makes them cheap to connect and compose.
Inspiration: BitNet reduces weights to {-1,0,+1} so matmul → addition. We do the analogue
for *verification*.

- **Polarity (ADR-036, `ubg/polarity.js`).** Each route, against each of the five
  obligations, is one trit: `+1` protected, `0` n/a, `-1` violated — built inside the
  prover so a `-1` *is* a finding. A **verdict is a sign check**, a **review is a
  subtraction** (a removed guard = a negative delta on `auth`), a **posture is a column
  sum** (stack routes → app → fleet). Verification becomes arithmetic over a 3-symbol
  alphabet. `sparda polarity`.
- **The capsule (ADR-037, `ubg/immunity.js`).** Five trits pack into **one byte** (3^5 =
  243 < 256), so an app's whole safety character is one byte per route. `sparda immunize`
  freezes `{ behaviorHash, pol(1B), exposed }` per route into `.sparda/immunity.json` —
  the "mini-intelligence that costs nothing": the expensive proof runs once, the artifact
  is consulted by a pure `judge(behaviorHash)` lookup (no recompile, no LLM, no network).
  The real Prisma app froze to **5 bytes**.

**Why this is the missing middle.** The capsule is the **atom of the genome**: one app's
contribution is its capsule, and capsules *compose by addition* (`mergePosture`: app →
fleet → world). So the global immune matrix (behaviors × obligations) grows and merges at
near-zero cost — BitNet's efficiency argument (collapse the representation, keep the
meaning) applied to collective trust. The address (Brick 1) says *which* behavior; the
polarity byte says *what's true* about it; together they are a genome row you can add.

## The antibody exchange format (Brick 2 — SHIPPED, ADR-041)

**What actually shipped** (`src/ubg/genome.js`, `sparda genome`): the antibody is the
minimal, fully-verifiable atom — `{ v, behaviorHash, pol, prover, key, issuer, id, sig }`.
`pol` is the 1-byte polarity vector (Brick 1.5) — the whole verdict in one byte, so an
antibody is ~250 bytes. `id` is the content address (`ab1_` + sha256 of the claim); `key`
is the issuer's Ed25519 public key carried inline; `issuer` is its fingerprint; `sig` is
the signature over the claim bytes. `verifyAntibody` re-checks all three offline. The
genome is canonical JSONL; `mergeGenome`/`recall` dedup, corroborate, and surface conflicts;
git is the entire backplane. The trust model — the "technology of faith" — is three
offline-checkable guarantees: **integrity** (content-address), **provenance** (signature),
**truth** (reproducibility of a deterministic verdict). See ADR-041 for the full rationale.

**The richer envelope below stays the design target** for the *diagnosis/fix* payload
(Brick 3): the shipped antibody carries the verdict byte; a future `ab2` adds the sanitized
diagnosis and the proven fix, keyed by the same behaviorHash. The shipped `pol` already
encodes `finding`+`severity` per axis, so `ab2` is additive, not a rewrite.

The original design sketch (the diagnosis/fix-carrying antibody), re-keyed by
**behaviorHash** with a portable, signed envelope:

```jsonc
// a "behavioral antibody" — structure + lesson only, never source, never secrets
{
  "v": "ab1",
  "behaviorHash": "bh1_…",          // the address (Brick 1)
  "finding": "UNGUARDED_MUTATION",  // apocalypse rule OR runtime failure class
  "severity": "critical",
  "diagnosis": "<sanitized, human/agent-readable>",  // sanitizeDescription, always (rule #7)
  "fix": { "kind": "add_guard|validate_input|wrap_tx|compensate", "proven": true },
  "evidenceCount": 4200,            // how many independent installs saw this shape fail
  "firstSeen": "2026-…", "lastSeen": "2026-…",
  "sig": "<ed25519 over canonical(body)>"   // provenance, dedup, tamper-evidence
}
```

Rules that are already SPARDA law and must hold here:
- **Structure and lessons only** — `seed.js` already exports exactly this shape of
  knowledge (antibodies, failures, circuits) with *no key, no policy, no value ever
  leaving*. Brick 2 is `seed` re-keyed by address + signed. The privacy model exists.
- **Every diagnosis sanitized** before it is stored or shown (hard rule #7).
- **`fix.proven`** comes from `heal --check` — we only ever share fixes the compiler
  proved correct + regression-free. An unproven fix is a suggestion, never an antibody.
- Content-addressed + signed → dedup and trust are free; the same antibody from a
  thousand installs collapses to one record with `evidenceCount` = its weight.

## The backplane (Brick 3 — designed, zero-infra)

Faithful to hard rule #1 (the host never pays) and the 4-dep constraint: the world
genome v0 is **a public git repo of signed antibody records, content-addressed by
`behaviorHash`**. No servers, no DB, no budget — `sparda.json` + git is already the
storage layer (CLAUDE.md). Flow:

- **Pull (read):** on `apocalypse`/`review`/`init`, SPARDA computes local
  `behaviorHash`es and looks them up in a cached copy of the genome. A hit means:
  *"this exact behavior has a known history — N installs, here's the proven fix."*
  Offline-first: the cache is just files; no network on the request path.
- **Push (contribute), opt-in:** when a local install proves a fix with `heal --check`,
  it can emit a signed antibody (a PR to the genome repo, or a batched export). Opt-in,
  sanitized, structure-only. Never automatic, never silent.
- **Trust:** signatures give provenance; `evidenceCount` gives weight; a review gate on
  the genome repo (or a web-of-trust later) keeps poison out. Start conservative:
  curated merges, exactly like the open-core allowlist discipline.

The v0 can literally begin as `zyx77550/sparda-genome` — a JSON-per-address repo that
every CLI pulls shallowly. Cost: 0.

## Why this is the 10000× (and it's physical, not a slogan)

- **Verification at agent speed.** Human review = minutes. LLM review = seconds + $ +
  nondeterminism. A graph proof + address lookup = **milliseconds, free, and never wrong
  twice the same way.** When millions of agents write code, verification is the
  bottleneck — and this is the only verification that scales at their rhythm.
- **A real network effect.** Each install is a probe that learns for everyone; value
  grows with n. A competitor can fork the code; they cannot fork the corpus.
- **Agent-native by construction.** An agent about to write a handler can ask the genome
  *before compiling*: "this shape you're emitting has 4,200 known failures — here's the
  proven fix." The thing writing the code consults the memory of all code that has lived.

## Install coherence — the conductor (design; the "tout bien câblé" ask)

The organs are many (init, apocalypse, review, mirror, timeless, heal, seed, twin,
grammar, evolve, fingerprint…). The failure mode Zak named: they feel like a pile, not
one thing, and dumping them all at install is worse, not better. The fix is a
**conductor**, not a mega-command:

- **Progressive disclosure, not everything-at-once.** One coherent entry (`sparda`
  with no args, evolving `doctor`) that shows *where you are* and the *single next best
  move*: not yet initialized → `init`; initialized, no baseline → `apocalypse
  --save-baseline`; in CI already → offer the review bot; running live → offer `mirror`/
  `timeless`. Each organ is revealed the moment it becomes useful, never before.
- **One state model.** The conductor reads `sparda.json` + git + `.sparda/` and derives
  a single status ("compiled ✓ · baseline ✓ · bot ✗ · genome 3 hits") so the whole
  organism is legible at a glance. This is the "tout est bien câblé" feeling: one place
  that knows what's wired and what's next.
- **The genome closes the loop visibly:** the conductor surfaces "N of your routes match
  known behavioral antibodies" — the organism's memory made concrete at install.

Implementation note: build it as a thin read-only status/next-step layer over existing
commands (no new behavior in the organs). Scoped as the next brick after Brick 2.

## Honesty ledger (what exists vs what's to build)

- **Exists, shipped:** canonical byte-stable graph (E-020), the behavior fingerprint
  (Brick 1, tests green), antibody keying + `seed` export/germinate (structure-only,
  sanitized), `heal --check` proven fixes, twin/evolve/grammar.
- **To build:** Brick 2 (re-key antibodies by `behaviorHash` + sign the envelope),
  Brick 3 (the git genome repo + pull-on-compile cache + opt-in push), the conductor.
  None is a rewrite; each is a bounded addition on primitives that already ship.
- **Risks to respect:** fingerprint granularity (too coarse → false "same bug"; too fine
  → no sharing — tune with corpus data, versioned as `bh1`, `bh2`…); poison/abuse on the
  genome (mitigate with signatures + curated merges + evidence weight); privacy (only
  ever structure + sanitized lessons leave — this is already law, never relax it).

## Next actions
1. **Brick 2** — antibody envelope re-keyed by `behaviorHash`, signed; extend `seed`.
2. **Corpus at scale** feeds the genome (see `docs/gemini/autopilot-corpus.md`) — the
   scan's product is the genome, not spam.
3. **Brick 3** — `zyx77550/sparda-genome` v0 + pull-on-compile.
4. **The conductor** — progressive-disclosure status layer.
