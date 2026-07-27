# Decisions (ADR log — append-only)

Short records of choices that shape SPARDA. Newest last. Never rewrite an
entry; supersede it with a new one. This is the technical decision log for the
open core; numbering is stable and append-only, and a few numbers are reserved
for decisions outside the open core.

## ADR-001 — In-process position, zero infra (founding decision)
SPARDA lives *inside* the host app's process instead of in front of it.
Everything flows from this: warm DB pools and real auth on tool calls,
runtime observation no external tool can match, zero hosting cost.
Trade-off accepted: we are guests — see the hard rules (README).

## ADR-002 — Business Source License 1.1
MIT allowed commercial clones. BUSL keeps source visible and free to use
(including production) but forbids competing commercial services; each
version converts to Apache 2.0 after 4 years. A license protects the code,
not the idea — the real moat is ADR-009/ADR-010 (accumulated memory).

## ADR-003 — MCP sampling before BYOK
The semantic layer uses the *client's own model* via MCP sampling: zero API
key, zero cost, nothing to steal. BYOK (Groq/Mistral/OpenAI/Ollama…) is the
fallback for headless/CI contexts, later. Embedding a key in distributed code
is the same as publishing it, so keys only ever live where a service can hold
them — never in the open core.

## ADR-004 — Write-safety: mutating tools off by default
POST/PUT/DELETE tools generate `enabled: false`. The user opts in per tool
in `sparda.json`. On top: MCP elicitation confirmation per write (when the
client supports it) and proof-after-write read-back. Kills dev fear #1.

## ADR-005 — stdout is the MCP protocol
All human logs go to stderr; the bridge rebinds `console.log` → stderr to
neutralize stray dependency logs. One stray line on stdout corrupts the
JSON-RPC stream (hardest-to-debug class of MCP failure).

## ADR-006 — One template per framework, placeholder-rendered
`templates/*.txt` with `__PLACEHOLDERS__` covers JS/TS × ESM/CJS (Express)
and Python (FastAPI) from a single source. TS type placeholders
(`__ANY_TYPE__`…) render empty for JS. Alternative (4 template copies)
rejected: drift risk.

## ADR-007 — Marked, idempotent, reversible injection
The entry-file edit is a marked block, AST-positioned, backed up, stripped
before re-inject, re-parsed after every modification, with manual-fallback
instead of risky writes. `sparda remove` must restore byte-for-byte.
This is the adoption-critical promise: trying SPARDA costs nothing.

## ADR-008 — Stable `localKey` + carry-over across re-init
Re-running init preserves `localKey` (a running bridge/host pair never
desyncs), per-tool `enabled`, `semantic`, and `immune`. Regenerating any of
these silently destroys user state or accumulated intelligence.

## ADR-009 — Immune thresholds (v0.3)
Quarantine: 3 *consecutive* 5xx (4xx neither counts nor resets; only
success resets), cooldown `SPARDA_QUARANTINE_MS` = 60s default, half-open
single probe, counter resumes at 2 so one new 5xx re-quarantines.
Latency antigen: ≥ 5 samples and `ms > max(10 × baseline, 200ms)` — the
200ms floor avoids flagging noise around near-zero baselines. Chosen for
zero false-positive cost (an event, not a block) and bounded memory.

## ADR-010 — Antibodies: bounded, sanitized, persisted
Adaptive diagnoses are capped at 50 signatures, pass `sanitizeDescription`
before storage (an LLM output is untrusted input), and persist in
`sparda.json` so they survive restarts and re-init, and version via git.
Signature = `source|tool|status` — coarse on purpose: stable across runs.

## ADR-011 — Vitest pinned to ^3
Vitest 4 requires Node 20+; the project promises Node 18. Re-evaluate when
Node 18 support is dropped (decision required here when that happens).

## ADR-013 — Recycling gauge: measured, never promised (v0.4)
Compute side lives in the router (`/mcp/stats.recycle`), runtime-only like
all stats: `paidFull` increments right before the upstream fetch (the host
route is exercised), `servedByCircle` when SPARDA answers from its own
knowledge without touching the host — today that is quarantine blocks; the
flywheel cache (ADR-020) will add to it. Intelligence side lives in the bridge:
avoided sampling calls are counted against the *actual* `maxTokens` budgets
(`DIAGNOSIS_TOKENS`/`SEMANTIC_TOKENS` constants shared with the real calls,
so the estimate cannot drift), and lifetime savings are *derived* from
antibody `hits` — zero new persistent state. Day 1 reads 0% by design.

## ADR-014 — Sequence condenser: Labs, default OFF, structure-only (v0.4)
Opt-in via `labs.recordSequences: true` in `sparda.json`
(env `SPARDA_RECORD_SEQUENCES=1` overrides for one session); the `labs`
field joins the sacred carry-over set (ADR-008). Detection is deterministic
value-matching with a conservative noise floor: strings 2–200 chars,
numbers ≥ 10 — single digits only under an id-ish key (`/id$/i`). Persisted
circuits hold tool names, arg names and counts — **never payload values**:
`sparda.json` is committed to git and values can be PII. Everything is
bounded (20-call ring, 50 values/payload, 200-node walk, 5-step chains,
30 circuits — least-observed evicted first) and all analysis runs in the
idle harvester, never on the call path. A circuit is announced once,
at 3 observations: an emergent capability is a suggestion, not an action.

## ADR-015 — Crystallization: GET-only composites, fallback-first (v0.4)
At the observation threshold a circuit becomes a composite
MCP tool only if every step is an **enabled GET** and every link carries a
`fromKey` (the output key the matched value lived under — recorded at
observation, structure-only). Writes are never absorbed: their per-call
elicitation (ADR-004) must not be bypassable through a composite. Naming:
one sampling call per circuit ever (`CRYSTAL_TOKENS`), output normalized
hard + `sanitizeDescription`; without sampling (or on any failure) a
deterministic `circuit_a_then_b` identity ships instead — the organ works
without an LLM (survival rule). Execution replays the chain through the
router (the truth is always the real call), auto-feeding linked args via
`fromKey`, stopping honestly at the first failure with a step trace.
Composites are re-validated against the live tool specs at bridge start —
a route that changed or was disabled silently un-registers its composite.

## ADR-017 — Purity detector: observation, never a guess (v0.4)
The router classifies each route thermodynamically from real traffic only:
GET + 200 responses are fingerprinted (FNV-1a in JS, crc32 in Python, first
64 KB — a fingerprint, not a checksum) under a canonical argsig (sorted
args, so the AI's argument order never splits a signature). Same argsig →
same hash repeated ≥ 3 times = `pure` (its result pre-exists, recyclable —
the flywheel (ADR-020) feeds on this); any mismatch = `volatile` forever
this run; non-GET = `erasing` by definition (Landauer: writes pay the
dime); anything else = `unknown`. Bounded to 20 argsigs/tool, runtime-only
like all stats (purity is re-earned each run — a cache of trust must not
outlive the code it observed). Exposed in `/mcp/stats.purity` and the
`sparda_get_context` hint. Errors (4xx/5xx) teach nothing about purity.

## ADR-018 — SPARDING Proof: Local-first safety and audit engine (v0.5, SPARDING)
SPARDING Proof v0.1 introduces a runtime risk/decision calculator built directly inside Express and FastAPI router templates, keeping generated host endpoints isolated from direct filesystem operations on SPARDA files. The bridge intercepts the proof returned by the router and maintains a bounded event log (`sparding.events`, max 100) and aggregated, structure-only failure lessons (`sparding.failures`) inside `sparda.json`. Empreintes structurelles (`toolFingerprints`) are computed at code-generation time, and a change in route signature during `init`/`sync` triggers an audit event. Static policies in `sparda.json` (`sparding.policies`) govern read/write/delete blocks and human confirmation demands. All operations remain entirely local, zero-infra, and fully backward compatible.

## ADR-019 — Durable persistence layer + pluggable state drivers (v0.5)
`src/server/persistence.js` becomes the single source of truth for writing
`sparda.json`. `atomicWriteFileSync` (temp → **fsync** → rename) replaces two
fsync-less `atomicWrite` copies that lived in the Express and FastAPI
generators: without the fsync, rename could land before the data flush and a
power loss left a zero-length manifest. `sparda.json` stays a **local git
artifact** — read by `remove`/`sync`/`doctor` and carry-over, committed, never
moved to a remote store; durability was the gap, not relocation. The bridge's
merge-writes (`immune`, `sparding`, `semantic`, `labs`) route through
`mergeManifestKeySync`/`writeManifestSync` so they keep the same atomic+fsync
guarantee. The module also ships an engine-agnostic, by-`instanceId` driver
seam (Memory / LocalFile / Redis) reserved for *future* living-engine state
(the bounded brain snapshot) and multi-node deployments — **not** for the
manifest. Redis is a **lazy `import('ioredis')`**, never a package dependency:
selecting `SPARDA_DRIVER=redis` without it throws a clear `code:'USER'` error,
so the 4 exact-pinned runtime deps (hard rule #8) stay 4 — the seam is opt-in
and the count is unchanged. Nothing here sits on the request path (hard rule
#1). An earlier prototype's neural serializer is intentionally **not** ported —
it belongs to future engine work, not to manifest durability.

## ADR-020 — Bloc B preCall flywheel: serving a proven-stable read without paying the host (v0.5)
This is the slice where the engine stops only **observing** and starts
**serving**: `preCall(tool, args)` returns a cached response and the host call
is never made. Every organ shipped so far (stability, rhythm, myelin,
Bloc D) is passive — it watches and reports. The flywheel is the first to *act*
on that knowledge, so it earns the strictest contract in the engine.

**What may be served (the cacheability gate).** A call is short-circuited only
when **all** hold: (a) it is a **read** — `isWrite === false`; writes always
reach the host (and still pass write-confirmation), which *reinforces* hard rule
#3 rather than touching it; (b) the tool is **proven pure** — the whole-response
FNV-1a fingerprint has come back **identical ≥ `FLYWHEEL_MIN_HITS` (3) times**
for *this exact* canonical arg signature, the same ≥3 bar ADR-017's purity
detector uses; SPARDA never serves a response it has not watched repeat — the
opposite of speculation; (c) the entry is **within TTL**. The cache key is
`tool` + a **canonical (key-sorted) arg signature** — note `safeStringify` in
`engine.js` does *not* sort keys, so the flywheel needs its own
`canonicalArgSig` so `{a,b}` and `{b,a}` collide correctly; different args are
different queries and never share a cached answer.

**Value-free, reconciled (the crux vs ADR-014).** This is the first organ that
retains result **values** — it must, to serve them back. That is **not** an
ADR-014 violation: ADR-014 forbids payload values in **persisted** state
(`sparda.json` is git-committed; values can be PII). The flywheel cache lives in
**RAM only** — runtime-only (hard rule #5: nothing to carry over), never
serialized, and absent from `snapshot()`, which stays names + counts + hashes.
The values it holds are the *same bytes the host already holds in RAM* before
replying, merely memoized for one TTL window, and they die with the process. The
discipline that keeps this honest: a cached value is reachable **only** through
`preCall` serving it back to the very client that would have received it from
the host anyway — never through the stats/hint/snapshot surface.

**Two independent staleness guards.** (1) **TTL** is the primary guard
(`FLYWHEEL_TTL_MS`, default 30 s, `SPARDA_FLYWHEEL_TTL_MS`): it bounds worst-case
staleness for *any* cause, including a mutation through a channel SPARDA cannot
see (another client, a cron, the app itself). Freshness is measured from the
**last real host fetch**, and a cache hit **never extends it** — so a hammered
endpoint still re-fetches once per TTL, never serves indefinitely-old bytes.
(2) **Write-invalidation** is the precision guard for mutations SPARDA *does*
observe: on any `isWrite` call we drop the write's **same-path GET sibling**
(structural, always known) **plus every ghost-affected read** the Bloc D
gravitational lens has learned (`deps.snapshot().ghosts` where
`writeTool === W`). This is the **payoff of the ghost-dependency layer** — ghost
dependencies exist precisely so a write can purge the unrelated reads it silently
moves, keeping the rest of the cache warm instead of nuking it. An un-learned
coupling degrades safely: the stale entry simply lives until TTL, and it only
exists at all for a tool already *proven* not to move.

**Hard-rule compatibility.** Rule #1 (host never pays): `preCall` is one
canonical-stringify + one FNV-1a + a `Map.get` + a TTL compare — microseconds
that **replace** a network round-trip and host compute, so the host pays *less*;
population happens **off** the hot path (the idle harvester, via `observe`
gaining an `args` param), which makes the cache *eventually*-populated — a
near-simultaneous repeat may miss and pay the host, which is just today's
behavior. We never serve wrong; we occasionally pay when we could have saved.
Bounded (`FLYWHEEL_MAX_ENTRIES`, 256, oldest-evicted) since value-bearing
entries are heavier than fingerprints. Rule #8: pure JS `Map` + existing
FNV-1a — **zero** new dependency.

**Recycling gauge (ADR-013).** Each hit is a host call avoided, which the router
**cannot** count (it never sees the avoided call), so the bridge adds a new
`recycling.flywheel` category — distinct from `recycling.compute` (router-side
`servedByCircle`/`paidFull`) and `recycling.intelligence` (sampling avoided) —
fulfilling ADR-013's note that "the flywheel cache will add to it," and
consuming ADR-017's `pure` classification exactly as ADR-017 anticipated.

**Surface + slicing.** The engine spine gains `preCall(tool, args) → { hit,
value }`; `observe` gains an optional trailing `args` (ignored by the other
organs); `snapshot()` gains a **value-free** `flywheel: { stats }`. Bridge
wiring (`stdio.js`): call `preCall` just before `invoke`, serve the
payload **verbatim** on a hit (byte-identical to a live read — only latency
differs; provenance lives in stats, never in the payload), populate via the
harvester with `args`, invalidate on observed writes via the ghost map, bump
`recycling.flywheel`, and extend the hint. **Decision (locked): on for reads by
default**, with an `SPARDA_FLYWHEEL=off` kill-switch. The strict gate keeps the
staleness envelope small and bounded, and serving by default is what makes the
flywheel's value — and the learned ghost-dependency invalidation that drives
it — *visible in use* rather than dormant behind a flag nobody flips; an
off-by-default flagship delivers zero value and demos as a dumb pipe. The
kill-switch gates at the **bridge**, so the engine organ stays env-free.

**Adapted from an earlier prototype's `BloomGate`/`preCall`, with three
corrections.** That prototype served on the **first** `record` (no purity proof),
keyed on **raw** `JSON.stringify(args)` (order-sensitive — same query, different
key order = a miss), and carried a `bloomSet` that duplicated the `Map`'s own
membership for no gain. We gate on **proven purity**, key on a **canonical** arg
signature, drop the redundant set, and add the value-free `snapshot()` discipline
the prototype lacked.
