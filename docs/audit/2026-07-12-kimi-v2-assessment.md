# Assessment — Kimi/Gemini "V2 Ligue 1" architecture (3 pillars)

**Doc reviewed:** `docs/KIMI_V2_ARCHITECTURE_MASTER.md` (Gemini, on `main`).
**Reviewer:** Claude · **Date:** 2026-07-12 · **Method:** read the proposal, measured
SPARDA's real hot path, reproduced the failure modes. Numbers below are from this repo.

## TL;DR

The doc is enthusiastic and shows real craft (the binary serializer especially). But of
the three "genius pillars validated 10/10", **one re-derives what SPARDA already ships
(less correctly), one solves a problem SPARDA doesn't have, and one directly violates
SPARDA's #1 hard rule.** The "10/10 crash tests" validated a *simulation* (`this.progress
+= 100`), not real SPARDA work. I did **not** adopt the pillars as a foundation — that
would regress us against our own thesis. Instead I extracted the single legitimate kernel
and shipped it *properly*: an O(1) indexed recall (the honest "bitmask engine"),
**1387× faster per lookup at 50k-antibody scale, results byte-identical**, zero infra.

## Pillar-by-pillar

### Pillar 1 — the "Bitmask Engine" (compress obligations into a `Uint32Array`)
**Claim:** Apocalypse iterating 25 000 objects took **4 s**; a bitmask drops it to
**0.00067 ms**.

**Measured (real 476-route Medusa app, this repo):**
- full compile (parse → graph): **908 ms**
- `checkGraph` — *all* obligations, the "apocalypse" step: **2.05 ms**
- the obligation check is **443× cheaper than the parse it follows.**

So the 4 s was never the obligation check — it's the **AST parse**. Compressing a 2 ms
step to microseconds saves ~0.2% of runtime. Worse: a plain binary bitmask is
**less expressive** than what SPARDA already runs. Our polarity byte (ADR-036) is
*ternary* — `+1` protected / `0` n/a / `−1` exposed — because "the obligation doesn't
apply" must never read as "the obligation is satisfied" (that distinction is the whole
honesty of the proof). A `Uint32Array` bit is binary and loses it. **We already shipped
the good version of this idea** (polarity + capsule + speculative lookup, ADR-036/037/038).

**Verdict:** already ours, and a binary bitmask would be a downgrade. Not adopted.

### Pillar 2 — async Worker I/O (offload `fs.writeFileSync` of ~10 000 files to a worker)
**Claim:** writing thousands of files freezes the main thread; a worker fixes it.

**Reality:** SPARDA writes a *handful* of files — one router, one marked injection block,
`sparda.json`, and ephemeral `.sparda/` artifacts. Minimal file surface is a **design
pillar**, and hard rule #4 ("`sparda remove` must leave a byte-for-byte clean diff")
depends on that injection being small, marked, and idempotent. "10 000 files" is not a
SPARDA workload. Adding worker threads + async writes would complicate the byte-for-byte
guarantee and the determinism for a bottleneck that doesn't exist.

**Verdict:** solves a problem we don't have; adds risk against hard rule #4. Not adopted.

### Pillar 3 — the "Circadian Core" (permanent Worker + `SharedArrayBuffer` daemon)
**Claim:** a resident worker watches CPU load via a 64-byte `SharedArrayBuffer`, sleeps
when the host is busy, works when it's idle, and checkpoints to `genome.bin` on crash.
"Perfection absolue."

**This is antithetical to SPARDA.** Hard rule #1 and the product thesis (ADR-033, CLAUDE.md)
are explicit: *"The host never pays for SPARDA's intelligence. Nothing heavy on the request
path… compute from the host process."* A permanent background thread polling CPU every
100–500 ms **is the host paying** — a resident daemon holding a thread, a shared buffer, and
wake cycles forever. It turns SPARDA from "a trust compiler that runs and exits" into "an
always-on metabolism". Ironically, an always-on observable side effect is exactly the kind
of thing SPARDA's own `apocalypse` flags as `IRREVERSIBLE_OBSERVABLE`.

And the "validated" code has a **real bug**: it stores `process.cpuUsage().user`
(microseconds, cumulative) into a `Uint32Array`. That overflows at 2³² µs — **~71.6 min of
CPU time** — after which the sleep/wake delta math corrupts, on the exact long-running dev
server it targets. (Reproduced in this repo.) The crash-tests also drove a **stub**
(`step()` does `this.progress += 100`, commented "Simulation simple"), so "100% success"
was a scheduler moving fake work, not SPARDA proving anything.

**Verdict:** breaks the core promise, and the reference code has a latent overflow bug.
Not adopted. The *legitimate* wish behind it — "resume instantly after a restart without
redoing work" — we already satisfy with frozen artifacts (the capsule and the signed JSONL
genome, ADR-037/041). An unsigned `genome.bin` checkpoint would be redundant *and* weaker
(no integrity, no provenance, not git-diffable) than the signed genome we already ship.

## What I built instead (the honest kernel, done right)

The one real idea across the pillars is *amortize the proof and make re-lookup instant at
scale.* SPARDA already amortizes (polarity/capsule/speculative). What was genuinely missing
was **O(1) recall over a large genome**: `recall()` was an O(n) scan, fine for one lookup but
not for an agent asking per-route across a big shared genome.

Shipped in `src/ubg/genome.js`: **`indexGenome(genome)` → `Map<behaviorHash, verdict>`**
(built once, O(n)) and **`recallIndexed(index, hash)`** (O(1) per lookup). This is the
honest "bitmask engine": SPARDA's addresses are *content hashes* (sparse strings, not dense
integers), so the correct O(1) structure is a **hash index, not a bit array** — and the
ternary compression the sandbox reached for already lives in our 1-byte `pol`.

**Measured (this repo, 50 000-antibody genome, 2 000 lookups):**
- linear recall: **866 µs/lookup**
- indexed recall: **0.62 µs/lookup** → **~1387× faster**, index built once in ~172 ms
- results **byte-identical** to linear recall (proven in `tests/genome.test.js`).

Zero new dependency, zero infra, no worker, no daemon — consistent with every hard rule.

## Recommendation for V2

Keep the *spirit* (amortize; instant re-verification; survive restarts) — we already embody
it. **Reject the daemon.** SPARDA's edge is that it costs the host nothing precisely because
it is *not* resident. If we ever want "always warm", the correct shape is the **speculative
capsule + indexed genome loaded on demand**, not a background metabolism. The binary
serializer's craft can be recycled as an *optional local cache* of the already-signed
genome — never as a replacement for it, and never as a reason to run a daemon.

> One process note: keep architecture proposals in HQ docs and let this repo's own tests be
> the "torture machine." A pillar isn't validated until it runs real SPARDA work and passes
> `npm test` here — a sandbox simulation reaching 10/10 is a hypothesis, not a proof.
