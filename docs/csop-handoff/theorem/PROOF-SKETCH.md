# Proof sketch — sound incremental reuse of cross-service ownership proofs

> **This is an informal sketch, NOT a validated formal proof.** It states the argument to be
> machine-checked or peer-reviewed later. The empirical backing is the property harness in
> `test/theorem.test.js`: 20 000 randomized edits, **zero false-safe found**, and incremental
> results identical to from-scratch recomputation on every case.

## Setup

- Ownership lattice `L`: `OWNER_VERIFIED > CALLER_SUPPLIED`, with `UNKNOWN` a neutral bottom for
  the merge. `merge` = "most suspicious wins" (`CALLER_SUPPLIED` dominates `OWNER_VERIFIED`);
  `UNKNOWN` merged with anything yields the other. `merge` is commutative, associative, idempotent.
- A service `S` compiles to a graph `G_S`. Its **certificate** `cert_S` is a function
  `cert_S : (L^inlets) → (L^sinks × L^outlets)` computed from `G_S` alone: seed inlets, propagate
  dataflow to a fixpoint (downward-only), apply the ownership-check promotion as a final override,
  read sink object-id labels and outlet forwarded labels.

## Claim 1 — `cert_S` is total and monotone

- **Total:** defined for every incoming label vector in `L^inlets` (finite domain). The internal
  dataflow fixpoint terminates because labels only move downward under `merge` on a finite lattice,
  and promotion is a single non-iterated override pass — no up/down oscillation.
- **Monotone:** lowering any incoming label (toward `CALLER_SUPPLIED`) can only lower sink labels
  and outlet labels (never raise them), because `merge` is monotone and the only source of
  `OWNER_VERIFIED` is (a) a promotion by an ownership check *internal to S* — independent of
  incoming labels — or (b) an incoming `OWNER_VERIFIED` that lowering removes. Verified empirically
  by the monotonicity property test.

## Claim 2 — composition is a monotone fixpoint (terminates, unique)

The system state assigns each inlet a label. One round: evaluate every `cert_S` at the current
inlet labels, push each outlet label along its stitched edge into the target inlet via `merge`.
Inlet labels only move downward under `merge` over a finite lattice ⇒ the iteration reaches a
unique least fixpoint in ≤ (#services + constant) rounds. `composeSystem` computes exactly this.
Empirically, `composeSystem` reproduces the frozen CSOP oracle's verdict on 5 000 random systems.

## Claim 3 — content-addressed reuse is sound (the theorem)

Let `D` be a system, `D'` a system after an edit `e`. Let `changed = { S : hash(S) differs in D' }`.

**Key property:** `cert_S` depends *only* on `G_S`. So if `hash(S)` is unchanged, `cert_S` is
**identical** — as a *total function of incoming labels*. It is therefore valid for the NEW
incoming labels that `e` may induce (via a changed neighbour), because it was never specialized to
one incoming vector; it answers correctly for all of them.

**Therefore:** recomputing the composition fixpoint over `{ reused certs for unchanged S } ∪
{ fresh certs for changed S }` yields the same least fixpoint as `full(D')` — the certificate set
is identical function-for-function, and the fixpoint operator is deterministic. In particular, no
sink can be reported `PROVEN_SAFE` by the incremental path unless `full(D')` also reports it safe.

**The tension resolved:** a naive cache that memoized an *absolute verdict* per service would break
here — reusing "S is safe" after a neighbour stops verifying would be a false-safe. Caching the
*total conditional function* instead of a verdict is exactly what makes reuse sound: the function
already accounts for every possible incoming context, including the new one.

## Why the empirical harness is strong evidence

The metamorphic test builds `D`, caches it, applies a random `e` (add/remove service, add/remove
ownership check, flip a forward, change exposure), and asserts `recompute(cache, e) == full(D')`
AND hunts specifically for a sink that incremental calls safe while full calls unsafe. Over 20 000
randomized cases: **zero counterexamples.** A single false-safe would have been reported as the
minimal failing case. This does not replace a formal proof, but it falsifies the theorem hard and
repeatedly, and it survived.

## What remains for a real theorem

1. Machine-check Claims 1–3 (e.g. in Coq/Lean or a paper-grade proof).
2. Extend the lattice/model to richer ownership (group/transitive scopes) and re-verify.
3. Pair with a demonstrated real cross-service vulnerability found by the pipeline (the CVE that
   turns "a proven property" into "a contribution people cite").
