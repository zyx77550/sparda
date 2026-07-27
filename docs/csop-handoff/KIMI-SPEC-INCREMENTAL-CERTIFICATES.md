# Clean-room spec #2 for Kimi — Incremental conditional certificates (the theorem)

> **This EXTENDS the CSOP algorithm you already built** (the cross-service object-ownership proof,
> 20/20 tests). Keep that as the base. Same rules: TypeScript, Node ≥ 18, ESM, **zero runtime
> dependencies, deterministic, pure** (no network/fs/clock/random inside `src/`). When any choice
> is ambiguous, pick the interpretation that can NEVER declare an unsafe access "safe".

## 0. Why this exists — the one hard thing to solve

Your current CSOP recomputes everything from scratch on every run, and each service yields an
**absolute** verdict. That does not scale, and — more importantly — it hides a real theoretical
problem we want to solve and prove:

> **Incrementality and soundness are in tension.** If you cache a service's proof and reuse it
> after the system changes, you can produce a FALSE SAFE. Example: service `B` was safe only
> because its caller `A` verified ownership before forwarding. `A` changes to stop verifying.
> `B`'s own code (its content hash) did NOT change — so a naive cache reuses "B is safe", which
> is now a lie.

The deliverable resolves this tension **provably** (empirically via a property harness): reuse a
cached proof across a change, and **never** produce a false safe.

## 1. The core idea — conditional certificates (assume-guarantee on the ownership lattice)

A service's proof must NOT be an absolute verdict. It must be a **function** from its incoming
assumptions to its outcome.

- The lattice L (from CSOP): `OWNER_VERIFIED > CALLER_SUPPLIED` with `UNKNOWN` neutral; "most
  suspicious wins" on merge. (Reuse your existing lattice + merge exactly.)
- A service `S` has a set of **inlets**: each `(entrypoint, param)` that can receive a label from
  a stitched inbound call, plus the intrinsic "public direct-attack" inlet for a `public`
  entrypoint.
- The **conditional certificate** of `S` is a pure function:

```
cert_S : (assumed incoming label per inlet)  →  {
    sinkVerdicts:  per object-sink, the verdict GIVEN those incoming labels,
    outlets:       per outbound httpCall+forwarded-param, the label S forwards
                   downstream GIVEN those incoming labels
}
```

`cert_S` is computed from `S`'s graph ALONE (its own entrypoints, checks, sinks, httpCalls) — it
never looks at other services. It is **monotone**: if you lower any incoming label (more
suspicious), no sink verdict gets safer and no outlet gets less suspicious. Prove/enforce this.

## 2. Content addressing + the cache

- `hash(S)` = a deterministic content hash of `S`'s graph (canonicalize the nodes/edges — sort
  keys, stable order — then hash; you may use a small pure hash like FNV-1a written inline, NO
  dependency, or `node:crypto` since that's a builtin, not a dep — prefer inline pure to stay
  fully deterministic/portable).
- Cache key for a certificate = `hash(S)`. Same code ⇒ same certificate, always.
- The **system state** is composed by a fixpoint over the stitched graph, exactly like CSOP, but
  the per-service step is: apply `cert_S` to the current incoming labels to get its outlets;
  iterate to a fixpoint (monotone ⇒ terminates).

## 3. The heart — sound reuse rule (this is the theorem)

When the system changes (some services edited, some added/removed), you want to recompute as
little as possible. The rule that makes reuse sound:

> **A cached certificate `cert_S` may be reused iff `hash(S)` is unchanged.** The certificate is
> a *total function* of incoming labels, so it is valid for ANY incoming labels — including new
> ones caused by a changed neighbor. What you must recompute is only the **fixpoint composition**,
> and only over the services whose incoming labels actually changed (a worklist seeded by the
> edited services and propagated along stitched edges until labels stop changing).

The subtlety to get right (and to TEST hard): the certificate must be a *complete* function over
the whole inlet-label domain — never a verdict memoized for one specific incoming vector. If it
were the latter, reusing it under new incoming labels would be the false-safe bug. Because
`cert_S` is total and monotone, recomposition with new inputs is always sound.

**Soundness theorem (what the harness must fail to break):**
> For any distributed system D and any edit e producing D', the incremental result
> `incr(cache(D), e)` is **identical** to the from-scratch result `full(D')` — in particular it
> never reports `PROVEN_SAFE` for a sink that `full(D')` reports unsafe.

## 4. Deliverables

1. `src/cert.ts` — `certificateOf(service): ConditionalCertificate` (the pure per-service function),
   and `hashService(service): string`.
2. `src/incremental.ts` — `composeSystem(services): Report` (fixpoint over certificates) and
   `recompute(prevState, edit): Report` (worklist-based incremental update reusing cached certs).
3. `src/types.ts` — extend the existing CSOP types with `ConditionalCertificate`, `Inlet`, `Outlet`.
4. Keep the existing `proveCrossServiceOwnership` working — `composeSystem` must return the **same**
   `Report` shape and the same verdicts as CSOP on any static system (regression: your 20 CSOP
   tests must still pass through the new composition path).

## 5. Acceptance — the property harness IS the proof (empirical)

Write `test/soundness-property.test.ts` — a randomized differential + metamorphic harness. This is
the core deliverable; it stands in for a formal proof until one is written.

- **Generator:** produce random valid distributed systems (2–6 services, random entrypoints,
  ownership checks, httpCalls with forwarding, sinks, public/internal exposure) — all schema-valid.
- **Differential test (≥ 5000 random cases):** for each system, assert
  `composeSystem(D)` deep-equals `proveCrossServiceOwnership(D)` (the incremental composition
  agrees with the original CSOP). Any mismatch = fail.
- **Metamorphic soundness test (≥ 5000 random case+edit pairs):** build `D`, cache it, apply a
  random edit `e` (add/remove a service, add/remove an ownership check, flip a forward, change
  exposure) to get `D'`. Assert:
  `recompute(cache(D), e)` deep-equals `full(D')`. **In particular, assert there is no sink that
  incremental marks `PROVEN_SAFE` while `full(D')` marks unsafe.** This is the false-safe hunt —
  it must find ZERO.
- **Monotonicity test:** for random `cert_S`, lowering any incoming label never makes a sink safer
  nor an outlet less suspicious.
- **Determinism + performance:** identical input ⇒ identical output; and demonstrate the point of
  the whole thing — on a 6-service system, editing 1 service, `recompute` touches strictly fewer
  services than `full` (report the count).

**Definition of done:** all property tests green over ≥ 5000 iterations each with a fixed seed
(deterministic PRNG written inline — e.g. mulberry32 — NO dependency), zero false-safe found,
`composeSystem` reproduces all 20 CSOP verdicts. Ship a `PROOF-SKETCH.md`: a 1-page informal
argument for the soundness theorem (why total+monotone certificates make reuse sound) — clearly
labeled as a sketch to be formally checked later, not a validated proof.

## 6. Honesty rules (same discipline as CSOP)

- Advisory framing preserved: never invents a "safe"; uncertainty degrades to suspicious.
- If the harness EVER finds a false-safe, that is the most important output — do not suppress it;
  report the minimal failing case. Finding a counterexample is success (it means the theorem as
  stated is wrong and needs a tighter condition), not failure.
- No dependency, deterministic, pure. A trust theorem proven by a non-deterministic harness is
  worthless.

## One line

Turn each service's proof into a total, monotone function of its incoming ownership labels, cache
it by content hash, recompose incrementally — and prove empirically (≥5000 randomized edits, zero
false-safe) that reusing cached proofs across a changing system never lies. That property IS the
theorem.
