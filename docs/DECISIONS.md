# Decisions (ADR log — append-only)

Short records of choices that shape the project. Newest last. Never rewrite
an entry; supersede it with a new one.

## ADR-001 — In-process position, zero infra (founding decision)
SPARDA lives *inside* the host app's process instead of in front of it.
Everything flows from this: warm DB pools and real auth on tool calls,
runtime observation no external tool can match, zero hosting cost.
Trade-off accepted: we are guests — see the survival rule (CLAUDE.md §rules).

## ADR-002 — Business Source License 1.1
MIT allowed commercial clones. BUSL keeps source visible and free to use
(including production) but forbids competing commercial services; each
version converts to Apache 2.0 after 4 years. A license protects the code,
not the idea — the real moat is ADR-009/ADR-010 (accumulated memory).

## ADR-003 — MCP sampling before BYOK
The semantic layer uses the *client's own model* via MCP sampling: zero API
key, zero cost, nothing to steal. BYOK (Groq/Mistral/OpenAI/Ollama…) is the
fallback for headless/CI contexts, later. Credits on our own keys only when
a SaaS exists to hold them (an embedded key in distributed code is stolen).

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

## ADR-012 — Tiering: Free / Shadow stable / Shadow Labs
Free = individual power (init, bridge, sampling semantics, base immunity).
Shadow stable = team trust (shadow writes, signed black box, mesh,
policies). Shadow Labs = the living organs (ROADMAP rounds 2–3) as opt-in,
default-off checkboxes with visible resource gauges and self-disable on
failure. Pipeline: Labs → stable → sometimes free. Full rationale: ROADMAP.md §3.

## ADR-013 — Recycling gauge: measured, never promised (v0.4)
Compute side lives in the router (`/mcp/stats.recycle`), runtime-only like
all stats: `paidFull` increments right before the upstream fetch (the host
route is exercised), `servedByCircle` when SPARDA answers from its own
knowledge without touching the host — today that is quarantine blocks; the
flywheel cache (R4.3) will add to it. Intelligence side lives in the bridge:
avoided sampling calls are counted against the *actual* `maxTokens` budgets
(`DIAGNOSIS_TOKENS`/`SEMANTIC_TOKENS` constants shared with the real calls,
so the estimate cannot drift), and lifetime savings are *derived* from
antibody `hits` — zero new persistent state. Day 1 reads 0% by design.

## ADR-014 — Sequence condenser: Labs, default OFF, structure-only (v0.4)
ROADMAP R2.1. Opt-in via `labs.recordSequences: true` in `sparda.json`
(env `SPARDA_RECORD_SEQUENCES=1` overrides for one session); the `labs`
field joins the sacred carry-over set (ADR-008). Detection is deterministic
value-matching with a conservative noise floor: strings 2–200 chars,
numbers ≥ 10 — single digits only under an id-ish key (`/id$/i`). Persisted
circuits hold tool names, arg names and counts — **never payload values**:
`sparda.json` is committed to git and values can be PII. Everything is
bounded (20-call ring, 50 values/payload, 200-node walk, 5-step chains,
30 circuits — least-observed evicted first) and all analysis runs in the
idle harvester (R4.4), never on the call path. A circuit is announced once,
at 3 observations: an emergent capability is a suggestion, not an action.

## ADR-015 — Crystallization: GET-only composites, fallback-first (v0.4)
ROADMAP R2.2. At the observation threshold a circuit becomes a composite
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

## ADR-017 — Purity detector: observation, never a guess (v0.4, R4.2)
The router classifies each route thermodynamically from real traffic only:
GET + 200 responses are fingerprinted (FNV-1a in JS, crc32 in Python, first
64 KB — a fingerprint, not a checksum) under a canonical argsig (sorted
args, so the AI's argument order never splits a signature). Same argsig →
same hash repeated ≥ 3 times = `pure` (its result pre-exists, recyclable —
the future flywheel R4.3 feeds on this); any mismatch = `volatile` forever
this run; non-GET = `erasing` by definition (Landauer: writes pay the
dime); anything else = `unknown`. Bounded to 20 argsigs/tool, runtime-only
like all stats (purity is re-earned each run — a cache of trust must not
outlive the code it observed). Exposed in `/mcp/stats.purity` and the
`sparda_get_context` hint. Errors (4xx/5xx) teach nothing about purity.

## ADR-016 — Repo split: open-core, designed for the SaaS before it exists
Owner decision, 2026-06-12. The repo stays **private until the current todo
is done**; then SPARDA splits in two, once and for good:
- **`sparda` (public)** — code, templates, tests, README, LICENSE, and the
  technical docs only (ARCHITECTURE, TESTING, SECURITY, ERRORS). Created
  with a **fresh history**: the current history contains strategy documents
  and must never be exposed. The free product is the marketing (ROADMAP §3),
  and `sparda_info`/README links finally stop pointing at a 404.
- **HQ (private — this repo becomes it)** — ROADMAP, HANDOFF, `sessions/`,
  COMPETITION, pricing, business ADRs, and **from day one the home of the
  paid Shadow/SaaS features**. The AI-handoff-via-commits workflow
  continues here unchanged.
Open-core *by design*: paid capabilities are born private, so the public
core never has to be re-closed when the SaaS lands. Free tier keeps
descending from Labs → stable → free (ADR-012) without ever reversing.

## ADR-018 — SPARDING Proof: Local-first safety and audit engine (v0.5, SPARDING)
SPARDING Proof v0.1 introduces a runtime risk/decision calculator built directly inside Express and FastAPI router templates, keeping generated host endpoints isolated from direct filesystem operations on SPARDA files. The bridge intercepts the proof returned by the router and maintains a bounded event log (`sparding.events`, max 100) and aggregated, structure-only failure lessons (`sparding.failures`) inside `sparda.json`. Empreintes structurelles (`toolFingerprints`) are computed at code-generation time, and a change in route signature during `init`/`sync` triggers an audit event. Static policies in `sparda.json` (`sparding.policies`) govern read/write/delete blocks and human confirmation demands. All operations remain entirely local, zero-infra, and fully backward compatible.

## ADR-019 — Durable persistence layer + pluggable state drivers (v0.5, Chantier 1)
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
#1). Ported from `sparda-sandbox/chantier1_persistence.ts`; the neural
`PersistentSPARDA` serializer is intentionally **not** ported — it belongs to
the future engine integration, not to manifest durability.

## ADR-020 — Bloc B preCall flywheel: serving a proven-stable read without paying the host (v0.5, R4.3)
This is the slice where the engine stops only **observing** and starts
**serving**: `preCall(tool, args)` returns a cached response and the host call
is never made (R4.3). Every organ shipped so far (stability, rhythm, myelin,
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
`writeTool === W`). This is the **payoff of slice 4** — ghost dependencies exist
precisely so a write can purge the unrelated reads it silently moves, keeping the
rest of the cache warm instead of nuking it. An un-learned coupling degrades
safely: the stale entry simply lives until TTL, and it only exists at all for a
tool already *proven* not to move.

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
fulfilling ADR-013's note that "the flywheel cache (R4.3) will add to it," and
consuming ADR-017's `pure` classification exactly as ADR-017 anticipated.

**Surface + slicing.** The engine spine gains `preCall(tool, args) → { hit,
value }`; `observe` gains an optional trailing `args` (ignored by the other
organs); `snapshot()` gains a **value-free** `flywheel: { stats }`. Bridge
wiring (`stdio.js`): call `preCall` just before `invoke` (~L312), serve the
payload **verbatim** on a hit (byte-identical to a live read — only latency
differs; provenance lives in stats, never in the payload), populate via the
harvester with `args`, invalidate on observed writes via the ghost map, bump
`recycling.flywheel`, and extend the hint. Land it in two slices as usual —
**5a** the flywheel organ + unit tests (serves nothing in prod yet; a test
proves no value escapes `snapshot()`), **5b** the bridge wiring. **Decision
(locked): on for reads by default**, with an `SPARDA_FLYWHEEL=off` kill-switch.
The strict gate keeps the staleness envelope small and bounded, and serving by
default is what makes R4.3's value — and the learned ghost-dependency
invalidation that drives it — *visible in use* rather than dormant behind a flag
nobody flips; an off-by-default flagship delivers zero value and demos as a dumb
pipe. The kill-switch gates at the **bridge** (5b), so the engine organ stays
env-free.

**Ported from `sparda-sandbox` `BloomGate`/`BlocB.preCall`, with three
corrections.** The sandbox served on the **first** `record` (no purity proof),
keyed on **raw** `JSON.stringify(args)` (order-sensitive — same query, different
key order = a miss), and carried a `bloomSet` that duplicated the `Map`'s own
membership for no gain. We gate on **proven purity**, key on a **canonical** arg
signature, drop the redundant set, and add the value-free `snapshot()` discipline
the sandbox lacked.

## ADR-021 — The twin and the value boundary (v0.8, R3.2–R3.4 + R4.5)

**Decision.** Round 3 needs observed VALUES (example responses) to reconstruct
a living mock. Values cross a line nothing else in SPARDA crosses, so the
boundary is explicit and enforced by construction:

1. **Values live only in `.sparda/twin.json`** — machine-local, inside the
   directory `init` already gitignores. Never in `sparda.json` (committed),
   never in a seed (travels). Capped (16KB per exemplar, GET+200 only).
2. **Learning is explicit** — `sparda twin --learn` calls the live router
   once per eligible enabled GET (no required path params in v0.1) and stores
   sanitized exemplars. No continuous collection, no bridge hook, nothing on
   the request path (hard rule #1 intact).
3. **The twin replaces the host on the same port** — stop the app, run
   `sparda twin`: it serves the same routes AND the `/mcp/*` surface from
   exemplars, so the unchanged bridge (and any agent) exercises a harmless
   clone. Writes against the twin return 202 echoes and touch nothing.
4. **The grammar is derived, never authoritative** — observed edges come from
   Labs circuits; hypothesis edges from exemplar response keys ∩ param names,
   always labelled `hypothesis`. Derived artifacts (`.sparda/grammar.json`)
   are regenerable and never committed.
5. **Evolution only suggests** — `sparda evolve` trials hypothesis chains
   against the TWIN (never the host). Survivors land in `labs.circuits` with
   `seen: 0` and `evolved: true`; crystallization still requires the real
   observation threshold. An emergent capability stays a suggestion until
   reality confirms it (survival rule, §1).
6. **The seed stays value-free** — R4.5-full is germination, not transport:
   `seed import --germinate` rebuilds the derived organs (grammar) from the
   imported structure on the receiving machine.

## ADR-022 — The local key leaves the repo: env → .sparda/key → fail closed (v0.8.x)

**Problem.** The localKey was baked into two committed artifacts: the generated
router file and `sparda.json`. Any public repo, any deploy, any git history
carried the secret. The owner asked for an arbitration (env var vs git hook vs
ephemeral handshake).

**Decision — none of the three; a fourth that keeps every promise:**

1. **The key lives in `.sparda/key`** — the directory `init` already
   gitignores (and whose gitignore edit `remove` reverts byte-for-byte). It is
   generated by `init` if absent and SURVIVES re-init: carry-over (hard rule
   #5) moves from the manifest to the file.
2. **Runtime resolution, fail closed.** Routers and every CLI consumer resolve
   the key as: `SPARDA_LOCAL_KEY` env var → `.sparda/key` file → (legacy)
   `manifest.localKey` → **null = every /mcp endpoint answers 503
   "key not configured"**. No key, no surface — never open.
3. **`sparda.json` carries no key anymore.** New inits write none; the first
   re-init/sync migrates a legacy key into `.sparda/key` and strips it. The
   organism's committed memory is finally secret-free end to end (matching the
   seed's contract).
4. **Deploy accidents die by construction.** `.sparda/` never ships (ignored),
   so a router that reaches production resolves no key and fails closed. An
   operator who WANTS /mcp in prod sets `SPARDA_LOCAL_KEY` explicitly — an
   informed decision instead of a leak.
5. **Why not the alternatives.** Env-only breaks zero-config on Express and
   FastAPI (no native .env loading; dotenv would be a fifth runtime dep —
   hard rule #8). A pre-commit hook leaves the secret in place and hopes.
   An ephemeral handshake breaks bridge/host carry-over and still needs a
   disk or pipe rendezvous — complexity without removing the secret.

**Costs accepted.** The Next.js template loses its "zero imports" purity
(node:fs/node:path builtins — still zero dependencies); routers read one
small file once at module load (off the request path).
