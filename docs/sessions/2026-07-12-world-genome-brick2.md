# 2026-07-12 — the world immune memory: signed antibodies, zero infra (Brick 2)

**Scope:** Build the "Fable 5 of tools" world memory Zak asked for — a collective genome
that costs nothing in infra and has a "technology of faith" (cryptographic trust). This is
Brick 2 of collective immunity (ADR-035), on top of the behaviorHash (Brick 1) and the
1-byte polarity capsule (Brick 1.5).
**Commits:** (this session) · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 507/507 green (3 skip)

## Done
- **`src/ubg/genome.js`** — the antibody + genome. An antibody is
  `{ v, behaviorHash, pol, prover, key, issuer, id, sig }` (~250 B). Trust = three
  offline-checkable guarantees: **integrity** (`id` = sha256 content address of the claim),
  **provenance** (Ed25519 sig + inline public key; `issuer` = key fingerprint), **truth**
  (verdict is a deterministic function of the behavior → re-derivable). Functions:
  `generateIdentity`, `issuerOf`, `mintAntibody`/`mintGenome`, `verifyAntibody`,
  `mergeGenome` (dedup + corroboration + reject), `recall` (consensus + witnesses +
  conflict), `serializeGenome`/`parseGenome` (canonical JSONL, degrades a poisoned file).
- **`src/commands/genome.js` + `sparda genome`** — compile → capsule → mint signed
  antibodies with a stable local identity (`.sparda/genome.key`, gitignored), merge into a
  committable `sparda-genome.jsonl`, report new/corroborated/conflicts. Ensures `.sparda/`
  is git-ignored *before* writing the private key.
- **Zero new dependency** (Node `node:crypto`), **zero infra** (git is the backplane).
  Crypto only at mint/merge, never the request path.
- **Tests:** `tests/genome.test.js` (15) pins every guarantee incl. tamper/relabel/forge
  rejection, idempotent mint, conflict/corroboration, poisoned-file degradation, byte-stable
  round-trip. `tests/command-smoke.test.js` (+3) covers the CLI (key isolation, gitignore
  guard, idempotent re-run, `--json`). Dogfood: demo-app 5 routes → 4 antibodies (two share
  a behaviorHash — the fingerprint collapsing equivalent behavior).
- Docs: ADR-041, HANDOFF part 18, CHANGELOG 0.19.0, COLLECTIVE-IMMUNITY.md (Brick 2 marked
  shipped, `ab2` diagnosis/fix payload noted as the additive Brick-3 target). Version → 0.19.0.

## Not done / deferred
- **Brick 3 — the trust/policy layer:** issuer reputation, witness thresholds ("believe a
  verdict at N independent witnesses"), key rotation/revocation, and a curated public genome
  repo (`zyx77550/sparda-genome`). The *mechanism* is shipped; the *policy* is next.
- **`ab2` antibody** carrying the sanitized diagnosis + proven fix (from `heal --check`),
  keyed by the same behaviorHash — additive to `ab1`, not a rewrite.
- A `recall`/lookup command (an agent asking the genome "is this shape known-bad?" before
  writing a handler) — the `recall()` function exists; no CLI seam yet.

## Decisions made
- **Antibodies are timestamp-free.** The content address is over `{ behaviorHash, pol,
  prover, key }` only — the same prover+key asserting the same verdict IS the same antibody,
  so minting is idempotent and dedup is perfect. A safety verdict about a fixed behavior
  shape does not expire, so no `issuedAt` in the identity.
- **The public key travels inside the antibody** (self-contained verification, no key
  directory needed) — maximizes zero-infra. `issuer` is a fingerprint of that key, re-checked
  on verify so it can't be relabelled.
- **Conflicts are surfaced, never resolved silently.** Two provers disagreeing about one
  behavior is load-bearing signal; `recall` reports it rather than picking a winner quietly.

## Bugs hit
- None in the code. One wrong test expectation (I asserted `content-address` where the real
  reason is `signature` — swapping a valid sig for a different claim passes the address check
  and fails at the signature). Fixed the test; the code was correct.

## Notes for the next session
- The genome file lives at repo root (`sparda-genome.jsonl`, committable); the key at
  `.sparda/genome.key` (gitignored). Do NOT commit a real `sparda-genome.jsonl` into HQ from
  dogfood runs — dogfood in a scratch copy.
- `pol` range is 0..242 (5 trits packed, 3^5). `verifyAntibody` enforces it. If polarity
  gains an axis, the range and `PROVER` id both change (bump `PROVER` so old antibodies stay
  distinguishable from new-prover ones).
- Next rung on ingestion (unrelated to genome): Medusa DML parsing to unlock O2 on Medusa.
