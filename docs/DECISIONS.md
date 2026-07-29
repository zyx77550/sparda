# Decisions (ADR log — append-only)

Short records of choices that shape the project. Newest last. Never rewrite
an entry; supersede it with a new one.

## ADR-001 — In-process position, zero infra (founding decision)

SPARDA lives _inside_ the host app's process instead of in front of it.
Everything flows from this: warm DB pools and real auth on tool calls,
runtime observation no external tool can match, zero hosting cost.
Trade-off accepted: we are guests — see the survival rule (CLAUDE.md §rules).

## ADR-002 — Business Source License 1.1

MIT allowed commercial clones. BUSL keeps source visible and free to use
(including production) but forbids competing commercial services; each
version converts to Apache 2.0 after 4 years. A license protects the code,
not the idea — the real moat is ADR-009/ADR-010 (accumulated memory).

## ADR-003 — MCP sampling before BYOK

The semantic layer uses the _client's own model_ via MCP sampling: zero API
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

Quarantine: 3 _consecutive_ 5xx (4xx neither counts nor resets; only
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
avoided sampling calls are counted against the _actual_ `maxTokens` budgets
(`DIAGNOSIS_TOKENS`/`SEMANTIC_TOKENS` constants shared with the real calls,
so the estimate cannot drift), and lifetime savings are _derived_ from
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
  Open-core _by design_: paid capabilities are born private, so the public
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
seam (Memory / LocalFile / Redis) reserved for _future_ living-engine state
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
Bloc D) is passive — it watches and reports. The flywheel is the first to _act_
on that knowledge, so it earns the strictest contract in the engine.

**What may be served (the cacheability gate).** A call is short-circuited only
when **all** hold: (a) it is a **read** — `isWrite === false`; writes always
reach the host (and still pass write-confirmation), which _reinforces_ hard rule
#3 rather than touching it; (b) the tool is **proven pure** — the whole-response
FNV-1a fingerprint has come back **identical ≥ `FLYWHEEL_MIN_HITS` (3) times**
for _this exact_ canonical arg signature, the same ≥3 bar ADR-017's purity
detector uses; SPARDA never serves a response it has not watched repeat — the
opposite of speculation; (c) the entry is **within TTL**. The cache key is
`tool` + a **canonical (key-sorted) arg signature** — note `safeStringify` in
`engine.js` does _not_ sort keys, so the flywheel needs its own
`canonicalArgSig` so `{a,b}` and `{b,a}` collide correctly; different args are
different queries and never share a cached answer.

**Value-free, reconciled (the crux vs ADR-014).** This is the first organ that
retains result **values** — it must, to serve them back. That is **not** an
ADR-014 violation: ADR-014 forbids payload values in **persisted** state
(`sparda.json` is git-committed; values can be PII). The flywheel cache lives in
**RAM only** — runtime-only (hard rule #5: nothing to carry over), never
serialized, and absent from `snapshot()`, which stays names + counts + hashes.
The values it holds are the _same bytes the host already holds in RAM_ before
replying, merely memoized for one TTL window, and they die with the process. The
discipline that keeps this honest: a cached value is reachable **only** through
`preCall` serving it back to the very client that would have received it from
the host anyway — never through the stats/hint/snapshot surface.

**Two independent staleness guards.** (1) **TTL** is the primary guard
(`FLYWHEEL_TTL_MS`, default 30 s, `SPARDA_FLYWHEEL_TTL_MS`): it bounds worst-case
staleness for _any_ cause, including a mutation through a channel SPARDA cannot
see (another client, a cron, the app itself). Freshness is measured from the
**last real host fetch**, and a cache hit **never extends it** — so a hammered
endpoint still re-fetches once per TTL, never serves indefinitely-old bytes.
(2) **Write-invalidation** is the precision guard for mutations SPARDA _does_
observe: on any `isWrite` call we drop the write's **same-path GET sibling**
(structural, always known) **plus every ghost-affected read** the Bloc D
gravitational lens has learned (`deps.snapshot().ghosts` where
`writeTool === W`). This is the **payoff of slice 4** — ghost dependencies exist
precisely so a write can purge the unrelated reads it silently moves, keeping the
rest of the cache warm instead of nuking it. An un-learned coupling degrades
safely: the stale entry simply lives until TTL, and it only exists at all for a
tool already _proven_ not to move.

**Hard-rule compatibility.** Rule #1 (host never pays): `preCall` is one
canonical-stringify + one FNV-1a + a `Map.get` + a TTL compare — microseconds
that **replace** a network round-trip and host compute, so the host pays _less_;
population happens **off** the hot path (the idle harvester, via `observe`
gaining an `args` param), which makes the cache _eventually_-populated — a
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
invalidation that drives it — _visible in use_ rather than dormant behind a flag
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

## ADR-023 — SBIR: a deterministic IR, separate from the products (v0.9–v0.13)

**Problem.** Every new capability (deploy prover, time-travel debugger, mock
server) re-parsed the codebase its own way. That path multiplies parsers,
diverges on edge cases, and makes "deterministic" unprovable across tools.

**Decision — compile once to one IR; every tool is a pass over it.** The
**Unified Behavior Graph (UBG)**, specified by **SBIR** ([SBIR_SPEC](SBIR_SPEC_V1.1.md)),
is the single intermediate representation: five node kinds (`entrypoint`,
`logic`, `state`, `effect`, `guard`) and six edge kinds (`control_flow`,
`data_flow`, `mutation`, `gate`, `ownership`, `compensation`). Framework
extractors (Express/FastAPI/Next.js) lower syntax to _facts_; a translator
lowers facts to the graph; passes refine it. Identity is content: node ids are
derived from source location, the artifact is canonicalized (sorted nodes,
edges, keys), and `sourceHash` is a sha256 of the inputs — same tree, same
bytes (SBIR §3.3). Additive-compatibility is a contract: v1.1/v1.2 only _add_
metadata and edge kinds; a v1 reader stays correct on a v1.2 artifact.

**Why not the alternatives.** A parser-per-product is what everyone else does
and is exactly the divergence we refuse. A database/AST dump is not
language-agnostic — "Express" would leak into every consumer. Emitting to an
existing IR (LLVM, WASM) throws away the web-semantic layer (routes, guards,
tables) that is the whole point.

**Costs accepted.** A translation layer to maintain; static analysis
over-approximates (unresolved handlers become blind nodes) — but everything the
static eye cannot see goes to a `skipped[]` report with a reason, never guessed.

## ADR-024 — Apocalypse: proof obligations, structural reachability (v1.1)

**Problem.** "Is this safe to deploy?" is usually answered by tests (absence of
evidence) or static-analysis vibes. We wanted a _proof_ a project can run on
its own graph.

**Decision — discharge named obligations over the UBG, fail-closed in CI.**
`apocalypse` reads `ubg.json` (zero source parsing at runtime) and proves five
static obligations (unguarded mutation, non-atomic aggregate write, unvalidated
constrained write, irreversible observable effect, aggregate-member bypass) plus
baseline-diff obligations (guard removed, invariant dropped, blast radius grew).
Each finding is a counterexample path, never a heuristic. Exit 1 on any
critical/high; SARIF output feeds GitHub code scanning; a composite Action ships
it. The **Law of Completeness is stated in its decidable form**: a node is dead
only if no path of edges from any entrypoint reaches it (structural
reachability — a sound over-approximation). Semantic unreachability is
undecidable (Rice); a spec demanding it demands a non-existent compiler.

**The name for this discipline is _soundiness_** (Livshits et al., "In Defense of
Soundiness: A Manifesto", _CACM_ 58(2), 2015 — co-signed by the authors of WALA,
Doop, Chord). Their thesis: no analysis is 100% sound on real code (reflection,
dynamic dispatch, DI, callbacks); the credible ones are _soundy_ — sound over
everything they can resolve, with a **deliberately, explicitly documented**
under-approximated subset. SPARDA is soundy by construction: effects are
over-approximated, guards under-approximated, and the under-approximated subset
is not hidden — it is enumerated for the user by the blind-spot ledger
(`src/ubg/blindspots.js`) and folded into the verdict (`SURFACE`/`PARTIAL`). We
apply the manifesto's prescribed methodology; naming it here makes the alignment
legible to anyone who knows the term.

**Why not the alternatives.** Runtime enforcement (a WAF, a policy engine) pays
per request and only catches what executes. Symbolic execution is unsound at
scale and non-deterministic. Both break the "host never pays / same bytes"
contract.

**Costs accepted.** The prover is exactly as strong as what the code and DDL
_declare_ — it proves the absence of whole bug classes, not of all bugs. Stated
in the command's honesty banner, not hidden.

## ADR-025 — Timeless: effect-derived record/replay, fail-loud (v0.10)

**Problem.** Reproducing a production bug exactly is the debugging holy grail
everyone abandoned: instruction-level recorders (huge overhead, Linux-only,
unusable in prod) are _blind_ to where nondeterminism lives.

**Decision — the compiler already knows where nondeterminism is: the `effect`
nodes.** A backend is deterministic _between_ its effects, so we tap only those
(db, http, clock, random, uuid) — a few KB per request — and replay the request
against the real code with each tap virtualized from the recording. Replay is
**fail-loud**: strict FIFO per kind, label-checked; any structural mismatch is a
`FlightDivergence`, never a silent fuzzy match. Flight identity is content
(sha256). Production hygiene is built in: deterministic sampling (a counter,
never `Math.random` — Law 3 applies to the recorder too) and GDPR redaction of
sensitive body keys _before_ the flight touches disk.

**Why not the alternatives.** Blind syscall/instruction recording carries
prohibitive overhead and has no semantic tap list. Tracing (OpenTelemetry) gives
_traces_, not _re-execution_: you see the failure, you cannot re-run it.

**Costs accepted.** Replay is per-request; concurrent-race capture is out of
v1 scope — stated in the README, not hidden. The recorder must be mounted (two
lines) — explicit beats magic.

## ADR-026 — OpenAPI is an adapter, not our format (v0.11)

**Problem.** "Only Express and FastAPI" caps the addressable market; but writing
a parser per language (Go, Java, Rails, .NET) is the parser-sprawl ADR-023
rejects.

**Decision — ingest AND emit the standard the industry already agreed on, but
own the graph.** `ubg --openapi` lowers a spec into the same route facts the AST
extractors produce (security schemes → guards, response schemas → typed returns,
declared bodies → validated input) — any backend with a spec compiles.
`openapi` inverts it: the graph _emits_ an OpenAPI 3.1 document, richer than most
hand-written specs. OpenAPI is the on-ramp; **SBIR is the format**. We sit
_above_ OpenAPI in the stack (LLVM emits assembly; nobody calls LLVM an
assembler), so a spec-only backend still gets apocalypse-diff and mirror, and
upgrades in place the day a native lowering lands.

**Why not the alternatives.** Making OpenAPI our native format caps us at what a
spec can say (no effects, no transactions, no state machines — the moat).
Bundling a YAML parser adds a runtime dep (hard rule #8); we refuse to
half-parse YAML and point users at a one-line convert instead.

**Costs accepted.** A spec declares less than code — effect/state/transaction
layers stay absent unless paired with `.sql`/`schema.prisma`. Said plainly in
`openapi.js`.

## ADR-027 — Mirror executes the graph; verify proves the compiler's laws (v0.11–v0.12)

**Problem.** A graph that only describes is a diagram format. And a compiler that
merely _asserts_ "deterministic/sound" in a README is marketing.

**Decision — make both executable.** `mirror` boots an HTTP server from
`ubg.json` alone — no framework, no source: guards actually deny (401),
responses render the compiled return schemas, unknown paths 404 with the route
table. It is the existence proof that SBIR is an _executable_ IR (front-ends
develop against a backend that isn't deployed — or written). `verify` runs the
SBIR compiler laws mechanically on any input (two compiles byte-identical;
canonical form a fixed point; no dangling edges; every surviving node
entrypoint-reachable; OpenAPI emit→ingest preserves the entrypoint set). A claim
a project can check on its own inputs is a promise; a claim in a README is
marketing.

**Why not the alternatives.** Shipping a static mock throws away the guard/type
semantics the graph carries. Trusting the laws by code review alone is how the
shared-guard reachability bug (which `verify` caught on first run) would have
shipped.

**Costs accepted.** The mirror serves _declared_ behavior — typed placeholders,
never invented business values (every response carries `x-sparda-mirror: true`).

## ADR-028 — Heal: the gate is the product, the agent is replaceable (v0.13)

**Problem.** An AI that writes plausible code is not the same as a system that
_proves_ the code is correct — the trust layer the agent era is missing. And
Timeless's exported test asserts the PAST (the bug); healing needs the opposite.

**Decision — SPARDA orchestrates and judges; whoever writes the fix, the machine
gates it.** `heal <id>` builds a fix brief _from the graph_ (handler file:line,
capabilities that must not grow, guards that must not be removed). The **gate**
is the product, and it proves three axes at once: (1) **behavior** — a _lenient_
replay of the recorded flight (same deterministic taps) meets the EXPECTATION,
not the recorded bug; a fix may reformulate a query (the tap is relabeled,
reported) but may not change effect order or kinds; (2) **compiler laws** —
`verify` still passes; (3) **no regression** — `apocalypse` diff against the
frozen pre-fix graph finds no new critical/high and no removed guard. Without an
explicit `--expect`, heal accepts exactly one honest default (a 5xx that no
longer 5xxs) and refuses to guess intent otherwise.

**Why not the alternatives.** Trusting the AI's own "I fixed it" is the failure
mode. Reusing the strict flight test rejects every legitimate fix (it asserts
the bug). A fuzzy behavior match would let a fix that silently drops a guard
pass — the gate must be honest in both directions (an unfixed bug keeps it
closed, exit 1).

**Costs accepted.** Heal replays one flight; multi-request healing and the
agent-in-the-loop runner (`--agent`) are thin orchestration over this gate, kept
optional so the proof — not the model — is the product.

## ADR-029 — The sync valve gates under-send, not just over-send (v0.13, extends ADR-016)

**Problem.** ADR-016's valve was built around one direction of leak: nothing
PRIVATE may cross HQ→public (the secret-gate + default-deny allowlist). It was
blind to the _opposite_ failure — something REQUIRED left BEHIND. An external
audit of the public mirror found exactly this: `src/commands/apocalypse.js` and
`src/commands/heal.js` import `../ubg/apocalypse.js`, but that runtime file never
made it into the public repo, so the flagship `apocalypse`/`heal` commands (and
the GitHub Action that runs them) crashed with `ERR_MODULE_NOT_FOUND`. The
secret-gate could never see it — a missing file has no secret to flag — and no
test resolved the published import graph, so CI stayed green over a broken
product.

**Decision — the valve refuses to publish an incomplete runtime graph.**
`tools/publish/self-contained.mjs` adds a second gate beside the secret-gate:
every RELATIVE import from a published `src/**` JS module must resolve to a file
that is ALSO in the published set. It is AST-based on purpose (SPARDA is an AST
tool — a commented-out `import` must not count, and a grep would false-positive
on `parser/nextjs.js`'s comment). It covers static `import`, re-`export … from`,
dynamic `import()`, and `require()`; bare specifiers (packages, `node:` builtins)
are the host's concern via `package.json`, not the valve's. `execute-sync.mjs`
runs it before copying and **exits non-zero on any dangling import** — an
incomplete mirror is never staged. `publish-public.mjs --dry-run` prints a
Self-containment verdict alongside the secret verdict and factors it into the
BLOCKED/PASS result.

**Why here and not only a test.** The audit's deeper finding was a _process_ gap:
"every word is backed by a test in CI" was false for the most important command
because nothing exercised its module graph. So the rule is enforced twice — as a
hard gate in the valve (a real publish is blocked) and as a non-regression test
over the _actual_ published set (`git ls-files` ∩ allowlist) that fails the
instant any runtime import leaves the public surface. The check that would have
caught the original bug in < 1s now runs on every suite.

**Costs accepted.** The gate inspects only `src/**` JS — the runtime graph the
host executes — not `demo-app`/`tests` fixture apps (whose imports are their own
and intentionally reference local files). No new dependency: `@babel/parser` and
`@babel/traverse` are already pinned (hard rule #8 holds — still 4 runtime deps).

## ADR-030 — `sparda review`: the semantic PR diff, baseline is git (v0.13.x, R5/M3)

**Problem.** Roadmap R5/M3, priority 1: nobody diffs a PR's _behavior_ — every tool
diffs its text. `apocalypse --save-baseline` already proves a deploy against a saved
graph, but it needs someone to have saved that baseline earlier. A PR reviewer has no
saved baseline; they have a base ref.

**Decision — `apocalypse` made relative, with git as the baseline.** `sparda review`
compiles the base ref and the working tree to the UBG and answers, zero-config: which
endpoints were added/removed, which guard/invariant/transaction protection was dropped,
and which _new_ provable risk the diff introduces. The base ref is compiled in a
detached git worktree (`git worktree add --detach`), which is a **static** compile — no
`npm install`, no running the app — then removed. It composes the existing prover
(roadmap principle #2 — composable, not isolated): `diffGraphs(base, candidate)` for
removed protections, plus `checkGraph(candidate)` minus `checkGraph(base)` for risks the
PR _introduces_ (a pre-existing sin is never blamed on the diff), de-duped by
(rule, entrypoint). Output: human, `--json`, or `--markdown` (PR-comment-ready). Exit 1
on any critical/high, so it drops into CI between "tests pass" and "merge".

**Why this over the alternatives.** A textual diff (everyone) can't see that a moved
middleware dropped a guard. A saved-baseline diff (apocalypse) needs prior ceremony a PR
author never did. Re-running the full static check and eyeballing the delta is what a
human can't do reliably — so the tool computes the delta and gates on it. The core is a
pure function `reviewGraphs(base, candidate)` (two graphs in, a review out) with the git
orchestration around it, so the semantics are unit-tested without git and the worktree
plumbing is integration-tested once.

**Costs accepted.** The base-ref compile assumes a static-analyzable tree at that ref
(true for Express/Next; a FastAPI extractor that imports the app would need its deps —
documented limitation). Cross-service review (M4) is out of scope here — this is
single-graph, one repo. The default base resolution walks
`origin/HEAD → origin/main → main → HEAD~1`; CI should pass `--base` explicitly.

## ADR-031 — The stateful mirror: enforce the inferred lifecycle (v0.13.x, R5/M2)

**Problem.** The Mirror VM (ADR: mirror) served the graph as _stateless_ typed
placeholders — a `GET /orders/:id` always returned `status: "mirror"`. But the
compiler already infers state machines (`StateMachineInference`, SBIR v1.2 §2.7):
`orders.status` is `pending→paid→refunded`, derived from the CHECK constraint and the
INSERT/UPDATE literals. A stateless mock throws that knowledge away; a hand-written
stateful mock (WireMock) drifts from the backend it imitates.

**Decision — the mirror LIVES the machine.** `createMirrorServer` reads
`state.meta.stateMachine` and wires three behaviors, all structural (no guessing):

- **create** (a transition from `∅`): seeds the resource at the initial state and mints
  an id when the route carries none (`POST /orders` → `201 {id, status:"pending"}`);
- **transition**: a route whose entrypoint is a machine's `via` advances the state —
  but only from the declared source; an illegal move (`pay` an already-`paid` order)
  is refused **409** with the legal source named. This is the standout: a mock that
  _enforces_ the lifecycle, impossible to keep truthful by hand at scale;
- **reflect**: a read that targets the resource's collection AND declares the machine's
  field in its return shape returns the current value; an unknown resource reads as the
  initial state (lazy seed).

State is a per-instance RAM map keyed `${stateId}#${id}` — a mock has no durable store
and says so (dies with the process). The read↔machine link is two structural facts
(same collection base + field present in the declared return schema), never a heuristic
guess, keeping the honesty contract intact. Apps with no inferred machine are served
exactly as before (stateless), so the change is backward-compatible.

**Why this over the alternatives.** Feature-parity with WireMock is a losing game
(they have years of features). The one axis they _structurally_ cannot occupy is
**guaranteed freshness**: our lifecycle is derived from the code+schema, so it can never
drift. Enforcing illegal transitions (409) falls out for free from the same declared
machine, and is something a hand-maintained mock realistically never does.

**Costs accepted.** In-memory only, single process (no multi-node shared state — a mock
doesn't need it). One status field per route in practice (the code handles the first
transition per route). The mirror does not read request bodies (`req.resume()` drains
them) — state ids come from the path, not the body, matching how the routes are keyed.

## ADR-032 — The PR review bot: the behavior diff as a sticky comment (v0.13.x, R5/M3+M5)

**Problem.** M3 shipped `sparda review` (the semantic PR diff), but a CLI a founder runs
locally converts nobody. The roadmap's M5 is explicit: _the first external user matters
more than ten features_. Adoption needs the value to be **visible, social, and
zero-config at the exact place developers already are** — the pull request.

**Decision — ship `sparda review` as a GitHub Action that posts ONE sticky PR comment.**
The root `action.yml` gains a `mode: review` alongside the existing `mode: apocalypse`.
On a `pull_request`, it fetches the base branch, runs `sparda review --markdown`, and
posts/updates a single comment (found by a hidden `<!-- sparda-review -->` marker) via
the GitHub API — so a PR carries one comment that updates on every push, never a wall of
duplicates. A user adopts by dropping ONE workflow file (`mode: review`, `permissions:
pull-requests: write`). The comment poster (`.github/sparda-pr-comment.mjs`) is
dependency-free (node:fs + global fetch) and **never fails the job**: a comment that
can't be posted (fork PR with a read-only token, API hiccup) must not turn a green review
red. Gating is separate and opt-in via `fail-on-severity` (default `none` — comment-only,
so the bot never blocks a merge and is safe to add on day one).

This is the growth loop: every PR shows the whole team a behavior diff nobody else
produces — "this PR removes a guard on /pay, grows the blast radius on Billing" — and
every finding is a counterexample from the code+schema, not a pattern-match, so there is
no false-positive noise to train the team to ignore it.

**Why this over more compiler depth.** M1 (interprocedural taint) and M4 (cross-service
proof) deepen a moat nobody is using yet — invisible to a new user. The review bot makes
an _existing_ capability (M3) continuously visible and shareable, at zero user effort. It
is the bridge from "technically ahead" to "someone else's CI caught a real bug with it."

**Costs accepted.** The Action runs `npx sparda-mcp@<version> review`, so it lights up
once a version carrying `review` is published. Base-ref compile assumes a
static-analyzable tree (Express/Next; FastAPI whose extractor imports the app needs its
deps). `action.yml` was added to the publish allowlist so the valve ships it. The comment
uses the workflow's `GITHUB_TOKEN` — no SPARDA account or key, consistent with the
zero-infra rule.

## ADR-033 — Identity: the trust layer for AI-written code (owner + Claude, 2026-07-11)

**Problem.** SPARDA tells twenty stories at once (MCP generator, immune system,
flywheel, condenser, compiler, prover, twin, seeds…). Each is real; together they
dilute to zero for a solo founder with no distribution budget. A product gets ONE
sentence in a stranger's head.

**Decision — one category, one tagline, nothing deleted.** SPARDA's public identity is
**the trust layer for AI-written code**, tagline **"AI writes. SPARDA proves."**

- **Front of shelf (the proof gate):** `review` (the PR bot), `apocalypse`,
  `mirror`, `timeless`/`heal`. Deterministic, counterexample-based — positioned
  explicitly against LLM-judges-of-LLM-code (an opinion grading an opinion).
- **The MCP layer is a feature of the same story** — "give your AI safe hands" —
  not a second identity. Runtime trust (write-gating, quarantine, proof-after-write)
  IS the same promise extended to what AI _does_, not just what it writes.
- **The organism (rounds 1–4) stays visible, badged, second** — "the living
  organism" section: real, tested, opt-in where experimental. Frozen for new
  features until the proof gate has external users; never removed (it is the
  runtime half of the trust story and the future paid tier's substrate).
- **The compiler is the HOW, not the pitch** (like Docker sells "ship anywhere",
  not cgroups).

**Comms rule.** Publicly this is an _evolution revealed_, never a pivot: "SPARDA now
proves every AI-written PR" — which is honest, it is roadmap Round 5 executing. The
name, the package (`sparda-mcp`), the code, the license: unchanged.

**Why this bet.** The pain (nobody can trust AI-volume code) is the structural
bottleneck of the agent era; the empty square is _deterministic proof at zero
config_ — competitors are LLM wrappers (can't pivot to proof) or rule engines
(config + false positives). The move costs ~zero (a story change over an engine that
already exists, v0.14.0) and is reversible, with fat-tail upside (CI-sticky trust
infrastructure is what platforms acquire). Distribution without budget leans on:
agent-native channels (MCP/skill registries — be the answer agents give), the PR
bot's sticky comments (every PR advertises to a team), and the corpus flywheel (real
bugs found in OSS = stories that write themselves).

**Costs accepted.** The organism's R&D pace pauses; `sparda-mcp` as a package name
under-sells the proof gate (revisit only with evidence, renames are expensive);
"prove" must stay honest — it proves the absence of declared-invariant violations
under structural reachability, not the absence of all bugs (the README says so).

## ADR-034 — The provability guard: NO PROOF, never a vacuous PROVEN (v0.14.1, 2026-07-11)

**Context.** The first real-repo corpus run (`docs/audit/2026-07-11-corpus-bughunt.md`)
exposed a soundness hole in the _product's own promise_: when the parser could not see
a repo's route surface, `compileUBG` produced a graph with zero entrypoints, and
`apocalypse` printed **"✓ PROVEN over 0 nodes" and exited 0**. A parser-coverage miss
read as a green proof — the one thing a trust layer must never do. Two real repos hit
it (a TS DI loader, an inline-require mount).

**Decision.** Provability is a first-class property of a verdict, enforced at the
verdict, not per-command. `verdictOf(findings, graph)` computes `entrypoints` and
`provable = entrypoints > 0`; `safe` and `clean` both fold `provable` in. A
zero-entrypoint compile can therefore never be `safe`/`clean`, so **apocalypse and
review print `✗ NO PROOF` and exit 1** (both already gate CI on `!safe`, so the guard
costs no new wiring). The message names it honestly: _"SPARDA could not see this app's
surface (a parser-coverage gap) — an empty graph proves nothing. This is NOT a pass."_

**Why at the verdict layer.** A guard duplicated in each command drifts (rule #4's
spirit). One provability rule in `verdictOf` covers every present and future
verdict-emitting command by construction. `verdictOf(findings)` with no graph keeps
the old semantics for `heal` (its input is a regression _delta_, not a whole-app
proof), so provability is asserted only where a whole graph is the subject.

**Consequence.** Parser coverage is inherently open-ended — SPARDA cannot promise
every repo on earth parses. What it CAN promise, and now does, is that it will never
_lie_ about coverage: an unseen surface is loud (NO PROOF, exit 1), never a silent
green. Widening coverage (e.g. C-001a's inline-require mounts, shipped alongside this)
reduces how often NO PROOF fires; the guard makes every remaining gap safe. The
"prove" claim stays honest — this closes the gap between what the word implies and
what the tool did.

## ADR-035 — Collective immunity: behavior fingerprints as the world genome (2026-07-11)

**Context.** Zak's "what does SPARDA have that nobody has, and can 10000×?" The honest
answer isn't any single organ — it's that SPARDA holds **both ends of a loop nobody else
can close**: the genotype (a deterministic, byte-addressable graph of what code _is_) and
the phenotype (what it _does_ and how it _fails_, learned at runtime). Connect them with a
content address and a bug is diagnosed once on Earth, inherited everywhere the same
behavioral shape occurs. Full thesis + design: `docs/COLLECTIVE-IMMUNITY.md`.

**Decision.** Build toward the world genome in bounded bricks on primitives that already
ship — no rewrite, faithful to the 4-dep / host-never-pays / privacy laws:

- **Brick 1 (SHIPPED):** `src/ubg/fingerprint.js` — a portable, coordinate-free
  `behaviorHash` per entrypoint. Same behavioral shape in different repos → same hash
  (proven: a fixture route and a real Prisma route share `bh1_a51c7d3e…`). Deterministic,
  locale-independent, tested. CLI `sparda fingerprint`.
- **Brick 2 (designed):** re-key shareable antibodies by `behaviorHash` and wrap them in a
  signed, sanitized, structure-only envelope — `seed.js` already exports exactly this
  shape of knowledge; this addresses + signs it. Only `heal --check`-proven fixes ship.
- **Brick 3 (designed):** the genome as a public git repo of signed, content-addressed
  antibody records (`zyx77550/sparda-genome` v0) — pull-on-compile cache (offline-first,
  nothing on the request path), opt-in push. Zero infra, git is already the storage layer.
- **The conductor (designed):** install coherence via progressive disclosure — one status/
  next-step layer over existing commands, revealing each organ when it becomes useful,
  never all at once. (Zak's "tout bien câblé à l'installation".)

**Why this is the moat.** A competitor forks the code; they cannot fork the corpus. Value
grows with n (each install is a probe learning for all). And it is the only verification
that runs at _agent_ speed — a graph proof + address lookup is milliseconds, free, and
never wrong twice the same way — which is exactly the bottleneck when millions of agents
write code. The PR verdict is the first visible symptom of the immune system, not the point.

**Costs / risks accepted.** Fingerprint granularity must be tuned with corpus data (versioned
`bh1`, `bh2`…); the genome needs signatures + curated merges + evidence-weighting against
poison; privacy is non-negotiable — only structure + sanitized lessons ever leave (already
law, hard rule #7 + `seed`'s contract). The corpus that feeds the genome is built by a
disciplined scanner whose product is knowledge, never spam (`docs/gemini/autopilot-corpus.md`).

## ADR-036 — Behavior polarity: proof as ternary arithmetic (BitNet-inspired, 2026-07-11)

**Context.** "Two ends (genotype + phenotype) isn't enough." Right. The missing piece is
the OPERATION in the middle — a representation so reduced that verifying and composing
behavior becomes cheap and closed. Inspiration: **BitNet b1.58** reduces every neural
weight to {-1, 0, +1} so matrix _multiplication_ collapses into _addition_. The analogue
for a proof engine: reduce "does this behavior uphold this safety obligation" to one
ternary digit — **+1** protection present, **0** not applicable, **-1** violated.

**Decision.** Every entrypoint gets a **behavior polarity vector** over the five
obligations apocalypse already discharges (auth, atomicity, reversibility, validation,
aggregate). It is built _inside_ `checkGraph` from the exact conditions that produce the
findings — a `-1` **is** a finding, one source of truth, zero drift (proven by test:
findings ⇄ -1s are the same set on every fixture). The algebra lives in
`src/ubg/polarity.js`; CLI `sparda polarity`.

Three closures fall out, and they are the point:

- **Verdict = a sign check.** PROVEN ⇔ no gating axis (critical/high) is `-1`. The
  arithmetic twin of `verdictOf.safe`.
- **Review = a subtraction.** `candidate − base` per shared entrypoint, per axis. A
  negative delta on an axis means the change _removed_ a protection — the same thing
  `diffGraphs` reports in prose, now as arithmetic (test: a removed guard → `auth` delta
  −2, `regressed: [auth]`).
- **Composition = a column sum.** An app's posture is the count of `-1/+1/0` per axis;
  stack routes → app, stack apps → fleet. The world genome (ADR-035) becomes a **sparse
  ternary matrix** (behaviors × obligations): merging knowledge is _adding ternary
  columns_, not re-running proofs. That is what makes collective immunity fluid at scale.

**Why this makes SPARDA stronger than the field.** Nobody else can express verification as
a closed, composable algebra, because nobody else has a deterministic behavior graph to
reduce. Detection tools output lists; SPARDA outputs a _number system_ over safety. It is
the same efficiency logic that made BitNet possible — collapse the representation, keep the
meaning — applied to trust instead of inference.

**Costs / honesty.** The ternary is a _projection_ of the full proof, not a replacement:
it says which obligation classes hold, not the counterexample path (that stays in
`findings`/apocalypse). Severity gating (which axes flip a verdict) is a policy choice,
kept identical to the findings' severities so the arithmetic verdict never disagrees with
the worded one. Axes are versioned with the obligations; adding an obligation adds an axis.

## ADR-037 — The immunity capsule: frozen safety, ~1 byte per route (2026-07-11)

**Context.** Zak: we need a _tiny artifact that costs almost nothing and does great things
by itself_ — the BitNet lineage taken further (a frozen model runs cheap; can a frozen
PROOF run cheap?). It can. SPARDA already does the expensive reasoning statically; the
insight is to **freeze the result** into a self-contained object a few bytes per route.

**Decision.** `sparda immunize` emits an **immunity capsule** (`.sparda/immunity.json`):
per route, `{ behaviorHash (16B), pol (1B), exposed }`, plus the app posture and an
arithmetic verdict. The polarity byte is the ADR-036 vector trit-packed: five axes ×
{-1,0,+1} = 3^5 = 243 states < 256, so a route's **entire safety character is one byte**
(`packVector`/`unpackVector`, exhaustively round-trip-tested over all 243). On the real
Prisma example the whole app froze to **5 bytes** (`[121,121,12,121,12]`; 121 = all-safe,
12 = the unguarded-mutation shape).

The capsule needs nothing to "run": `judge(capsule, behaviorHash)` is a pure lookup —
no recompile, no LLM, no network. That is the "mini-intelligence": the thinking is
amortized to compile time; what ships is a cheap representation that acts on its own.
Consumers: CI gates without recompiling; an agent asks "is the shape I'm about to write
known-bad?"; the runtime can annotate/gate at request time; another install merges it.

**Why it matters (the moat, made physical).** The capsule is the **atom of the world
genome** (ADR-035): one app's contribution is its capsule; capsules **compose** because
posture is a column sum (`mergePosture`: app → fleet → world, by addition). So the global
immune memory is a sparse ternary matrix that grows and merges at near-zero cost — the
BitNet efficiency argument (collapse the representation, keep the meaning) applied to
collective trust. Nobody else can freeze verification this small because nobody else has a
deterministic behavior graph + a portable address to freeze.

**Costs / honesty.** The capsule is a _projection_: it carries the verdict per obligation
class + the address, not the counterexample path (that stays in apocalypse's findings). It
is only as current as its last `immunize` — it is a cache of a proof, regenerated on change
(the `sourceHash` already tells you when it's stale). Privacy holds: a capsule is structure

- verdict only — no source, no secrets, no literals (same law as `seed`/fingerprint).

## ADR-038 — Speculative verification: proof at agent-loop speed (2026-07-11)

**Context.** Gemini stress-tested the compiler on Dub.co (~4200 files, 559 routes) — it
proved the whole thing in ~4 s. Impressive, but ~4 s per check is far too slow to sit
inside an AI agent's inner loop, where a proposed change must be verified thousands of
times. Yet most agent edits touch behavioral shapes SPARDA has ALREADY proven.

**Decision.** Apply the **speculative-decoding** pattern to verification. Speculative
decoding pairs a cheap draft with an expensive verifier and pays full cost only on the
residual. Here the frozen immunity capsule (ADR-037) is the cheap oracle and the
full compiler+prover is the expensive path. `speculativeVerify(capsule, candidateGraph)`
fingerprints each candidate route and looks its `behaviorHash` up in the capsule:

- **accepted** — shape known & safe (0 prover work)
- **rejected** — shape known & exposed (0 prover work; verdict mirrors apocalypse)
- **novel** — shape unseen → the only routes that pay the full prover

`sparda speculate` runs this against `.sparda/immunity.json`. On an unchanged tree the
acceptance rate is 100 % — re-verification costs nothing; only genuinely new shapes are
recompiled.

**Stronger than the analogy.** In speculative decoding the draft can be wrong and the
verifier overrides it. Here a capsule hit is **exact**: identical `behaviorHash` ⇒
identical behavioral shape ⇒ identical obligations ⇒ the same verdict the full prover
would give (proven by test — `speculate`'s per-route safe/exposed equals `checkGraph`'s
for every settled route). We skip the compute, never the correctness.

**Why it matters.** This is the primitive that makes SPARDA fast enough to be the
verifier in every agent's tightest loop, even on a 559-route monster: the agent proposes
a change, SPARDA answers accept/reject in nanoseconds for known shapes and only pays for
novelty. Zero infra — a hash lookup over a few bytes per route + a fallback to the
existing compiler. It composes the whole stack: `fingerprint` (the address) → `immunize`
(the frozen oracle) → `speculate` (pay only on the residual).

**Costs / honesty.** `speculate` is only as complete as the capsule it's given — novel
shapes MUST still go through the full prover (it reports them, never hides them). It
verifies behavioral _shape_ equivalence, not that two routes with the same shape are the
same code (they needn't be — that's the point). The capsule is a cache of a prior proof;
regenerate it (`immunize`) when the baseline moves.

## ADR-039 — Universal ingestion: NestJS/DI extraction, the wall-breaker (2026-07-11)

**Context.** Gemini's stress tests found the real ceiling: on **Medusa** (and any
NestJS / Inversify / Awilix app) `detect.js` literally threw "not supported" and even
where it didn't, the parser saw **0 routes** — routes are `@Get()` decorators on
controller methods, and the actual DB write lives in a **service wired by dependency
injection**, not in the controller. The whole immunity stack (fingerprint → polarity →
immunize → speculate) is worthless if SPARDA can't read the app at all. This was the
biggest wall between SPARDA and "works on any code."

**Decision.** Add a NestJS/DI extractor (`src/ubg/nestjs.js`) built on the insight that
makes DI **statically** tractable: in TypeScript, dependency injection is expressed as
**constructor parameter types** — `constructor(private svc: CatsService)` — which are
right there in the AST. So:

- read `@Controller('prefix')` + `@Get/@Post/...('path')` decorators for the route table;
- read `@UseGuards(X)` (class- and method-level) as guard nodes;
- read the constructor for the DI map (`prop → ServiceType`), then follow
  `this.<prop>.<m>(...)` calls to the resolved **service method** and scan ITS body for
  the real effects — merging them into the handler's scan.
  It emits the exact same route/chain shape `extractExpress` does, so the whole compiler
  and every downstream command work unchanged. Two supporting fixes shipped with it:
- `extract.js` now reads effects off `this.<field>` access (e.g. `this.prisma.cat.create`),
  not just bare identifiers — class-based code was previously invisible (general win).
- the parser switched to the **`decorators-legacy`** Babel plugin = TypeScript's
  `experimentalDecorators`, the only one that accepts NestJS **parameter** decorators
  (`@Body()`, `@Param()`); without it every Nest controller was a parse error.

**Proof.** A Nest fixture (controller delegating to a Prisma-backed service) that used to
be "not supported / 0 routes" now compiles to **3 routes / 10 nodes / 1 guard** and
yields a real **critical UNGUARDED_MUTATION on `POST /cats`** — the unguarded write,
found two DI hops deep (controller → `CatsService.create` → `this.prisma.cat.create`).
The guarded `@UseGuards` route is correctly not flagged. `tests/nestjs.test.js`.

**Honesty / the remaining walls (the path to truly universal).** This resolves the
_type-annotated_ DI case (Nest, and Medusa v2's module services where types are declared).
Still walls, tracked as next rungs: (a) **runtime-container DI with no type annotation**
(string tokens: `container.resolve('userService')`) — needs token→provider mapping;
(b) **file-based routing** (Next app-router already handled; Medusa's file conventions,
Remix, SvelteKit — a per-convention resolver); (c) **non-JS languages** — already served
by the OpenAPI lowering (`--openapi`), the universal escape hatch for Go/Java/Rails/.NET.
The honest promise: SPARDA is not "any code by magic"; it's an **ingestion ladder** that
keeps growing rungs, and no single missing signal is a hard wall — where a static reading
exists we take it, and the spec lowering catches the rest.

---

## ADR-040 — The third route pattern: Medusa file-based routing (`src/ubg/medusa.js`)

**Status.** Accepted, shipped. Rung 3 on the ingestion ladder (ADR-039).

**Context.** ADR-039 named Medusa as a "next rung" and half-solved it: Medusa v2's
_services_ are type-annotated (so DI resolves), but its _routes are not decorators at
all_. They are a **filesystem convention** — `src/api/<segments>/route.ts` IS a route
whose path is its own directory, exporting one const/function per HTTP verb
(`export const POST = async (req, res) => …`). The NestJS extractor looks for
`@Controller` classes and found **none**, so a real Medusa checkout was still **0 routes
→ NO PROOF** — the exact wall Gemini re-hit. Medusa is the biggest commerce app in JS;
"universal on any code" is hollow if SPARDA is blind to it.

**Decision.** Add a dedicated file-based extractor (`src/ubg/medusa.js`), detected from
`@medusajs/*` deps + a `src/api` dir (`detect.js`, checked before Nest since Medusa may
transitively pull Nest deps). It reads three conventions and emits the standard
`extractExpress` route/chain shape, so the whole compiler + immunity stack work unchanged:

1. **Path** — the directory under the api root is the route path; `[id]` → `:id`,
   `[...rest]` → `:rest` (catch-all). `route.ts` itself contributes nothing to the path.
2. **Auth (INVERTED)** — Medusa authenticates by default; a file opts _out_ with
   `export const AUTHENTICATE = false`. So every route gets a synthetic `authenticate`
   guard node **unless** it declares the literal `false`. This is the opposite polarity
   of Express (where a route is unguarded until middleware is added), and getting the
   inversion right is the whole correctness of the extractor.
3. **Effect** — the mutation lives in a **workflow**, not an ORM call:
   `createProductWorkflow(req.scope).run({ input })`. `scanFunction` sees no db op there,
   so we walk the handler body for `*Workflow`/`*Step` callees and **synthesize** a
   `db_write`/`db_read` from the verb (`create*`→insert, `delete*`→delete, `list*`→read),
   with a table name derived from the workflow name (`createProductWorkflow`→`product`),
   merged into the scan in source order.

**Proof.** The `ubg-medusa` fixture (admin products GET/POST, products/[id] DELETE, store
carts POST with `AUTHENTICATE = false`) compiles to **4 routes**, synthesizes the
create/delete `db_write`s with no ORM in the body, and yields exactly one **critical
UNGUARDED_MUTATION on `POST /store/carts`** — the public (opted-out) mutation — while the
authenticated admin mutations are correctly clean. `tests/medusa.test.js` (6).

Run on the **real `medusajs/medusa`** `develop` checkout (319 `route.ts` files):
**0 → 476 routes**, 0 skipped, ~0.5s. The graph carries **435 `db_write`s, 26 `db_read`s,
121 inferred state tables, 474 guards**. Verdict: **provable & clean** — an _honest_
result, not a blind one: Medusa is a mature codebase where nearly every mutation is
authenticated, and the two `AUTHENTICATE = false` files are a read-only feature-flags
route and an invite-accept route that carries its own `res.status(401)` deny-guard.

**Honesty / limits.** Without a DDL/Prisma schema (Medusa declares models in its own DML,
which SPARDA does not yet parse), the field-level validation obligation **O2** has no
constraint set to check against — so `UNVALIDATED_CONSTRAINED_WRITE` cannot fire on
Medusa. The route surface, guard posture, atomicity and reversibility obligations all
apply. The workflow-verb heuristic is a _naming_ inference (like SPARDA's SQL/Prisma
literal harvesting): a workflow whose name lies about its effect would be mis-typed — the
same trade-off documented for every static reading. Medusa DML parsing is the next rung.

---

## ADR-041 — The world immune memory: signed, self-verifying antibodies (`src/ubg/genome.js`)

**Status.** Accepted, shipped. Brick 2 of collective immunity (ADR-035), on top of the
capsule (ADR-037) and behaviorHash (fingerprint, ADR-034).

**Context.** The capsule froze one app's judgment into bytes; the behaviorHash gave every
behavior a coordinate-free address. What was missing is the part that makes it _collective_:
a way for one SPARDA's proof to travel to a stranger's machine and be **trusted without
trusting the sender** — and without standing up any server, database, CA, or chain (hard
rules #1 zero host cost, #8 no new dependency). Zak's ask: "cette mémoire doit rien coûter
en infra du tout. Elle doit avoir une techno de foi" — a _technology of faith_.

**Decision.** The unit is an **antibody**: a portable claim `{ behaviorHash, pol, prover }`
wrapped in a self-certifying envelope `{ key, issuer, id, sig }`. Its trust rests on three
guarantees, each checkable **offline** from the antibody's own bytes:

1. **Integrity by content-addressing** — `id = ab1_ + sha256(claim).slice(0,32)`. Alter one
   bit of the claim and the id no longer matches. The artifact proves its own wholeness
   (git objects / IPFS CIDs). Verify recomputes the address; a tampered `pol` → `content-address` reject.
2. **Provenance by Ed25519 signature** — the public key travels _inside_ the antibody
   (`key`), and `issuer = gk1_ + sha256(key).slice(0,16)` is its fingerprint. `sig` signs
   the same claim bytes the id commits to. You know exactly which prover vouched; relabelling
   the issuer → `issuer-mismatch`, a forged signature → `signature`. Reputation accrues to
   **keys, not a database**. Node's built-in `node:crypto` — no new dependency.
3. **Truth by reproducibility** — the one only a _prover_ can offer: `pol` is a
   deterministic function of the behaviorHash's shape, so an antibody is not merely
   "believed because signed" — it is **re-derivable**. Recompile the behavior, get the same
   byte. Signature says _who_, content-address says _intact_, reproducibility says _true_.

The **genome** is a verified, deduplicated corpus of antibodies, serialized as canonical
**JSONL** — one antibody per line, deterministically ordered. That file IS the entire
database: commit it, `git push`/`pull` is the replication, there is **no server anywhere**.
`mergeGenome` admits only antibodies that verify, collapses exact duplicates by id, counts
**corroboration** (a second independent issuer asserting the same verdict), and `recall`
reports the consensus verdict, the witness count, and — critically — **conflict**: two
provers disagreeing about one behavior is surfaced, never silently overwritten.

**The command.** `sparda genome` compiles the app → capsule → mints signed antibodies with a
local Ed25519 identity (created once at `.sparda/genome.key`, reused forever so the issuer is
stable), merges them into a committable `sparda-genome.jsonl`, and reports new/corroborated/
conflicts. The private key lives only under `.sparda/`, and the command **ensures `.sparda/`
is git-ignored before writing the key** — a leaked signing key would let anyone forge
antibodies under that issuer.

**Proof.** `tests/genome.test.js` (15) pins each guarantee: idempotent minting (byte-identical),
tamper → `content-address`, relabel → `issuer-mismatch`, forged sig → `signature`,
order-independent canonical merge, corroboration counting, conflict surfacing in `recall`,
byte-stable JSONL round-trip, and a **poisoned file degrading** to only the lines that still
verify (a forged or garbage line never poisons the memory). `tests/command-smoke.test.js` (+3)
covers the CLI: committable genome + gitignored key + `.gitignore` guard, idempotent re-run,
`--json` self-verifying antibodies. Dogfood on SPARDA's own demo-app: 5 routes → 4 antibodies
(two routes share a behaviorHash — the coordinate-free fingerprint collapsing equivalent
behavior, which is exactly the collective-immunity mechanism working).

**Honesty / limits.** An antibody proves _who signed a re-derivable verdict about a behavior_;
it does not prove the signer ran an unmodified prover — a hostile fork could sign a _false_
`pol` for a real behaviorHash. Three things bound that: the verdict is reproducible (anyone can
recompute and expose the lie), conflicts are surfaced (one honest issuer's disagreement flags
it), and trust is per-key (a caught issuer is discardable). What we deliberately do **not**
ship yet: a trust/reputation policy over issuers (how many witnesses to believe a verdict),
key rotation/revocation, and a curated public genome. Those are policy layers on top of this
mechanism — the mechanism (self-verifying, zero-infra, git-backed) is what ADR-041 establishes.

**Addendum (2026-07-12) — indexed recall (O(1) at scale).** Reviewing Gemini's proposed
"Bitmask Engine" (see `docs/audit/2026-07-12-kimi-v2-assessment.md`) surfaced one real,
SPARDA-correct kernel: `recall()` was an O(n) scan, fine for one lookup but slow for an
agent querying per-route across a large shared genome. Added `indexGenome(genome)` →
`Map<behaviorHash, verdict>` (built once) and `recallIndexed(index, hash)` (O(1)). SPARDA's
addresses are content hashes (sparse), so the right O(1) structure is a hash index, not a
bit array — and the ternary compression already lives in the 1-byte `pol`. Measured: at a
50 000-antibody genome, **~1387× faster per lookup**, results byte-identical to linear
recall (`tests/genome.test.js`). Zero new dep, zero infra, no worker/daemon. The daemon,
async-I/O, and binary-checkpoint pillars were assessed and **not** adopted (they re-derive
shipped work, target a non-existent workload, or violate hard rule #1 respectively).

---

## ADR-042 — The behavior guard: no hollow PROVEN (SURFACE ONLY)

**Status.** Accepted, shipped. Found by the multi-repo organ stress test
(`docs/audit/2026-07-12-multi-repo-organ-stress-test.md`).

**Context.** Running every organ on 7 real monster repos surfaced the single biggest
honesty gap in the product: SPARDA blessed a green **PROVEN** on apps where it had resolved
**zero behavior**. immich (281 NestJS routes, 1 effect), GitHub's OpenAPI (1196 routes, 0
effects), a stock Express boilerplate (8 routes, 0 effects) — all read PROVEN. "No
obligations to fault" was being reported as "safe", when the truth was "SPARDA saw the route
surface but not what the code does" (a spec has no bodies; a DI/external-controller app hides
its effects behind a hop the extractor didn't follow). A behavior compiler that proves
nothing must not print the same green as one that proved everything.

**Decision.** Add the **behavior guard**, the effect-level analogue of the provability guard
(which already refuses to bless a 0-_route_ graph). A single source of truth,
`countObserved(graph)` in `apocalypse.js`, counts state-touching behavior: `state` nodes +
`db_write`/`db_read`/`http_call`/`fs_write` effects (`entropy` — a bare `new Date()` — is not
safety-relevant, so it doesn't count). A whole-app graph with routes but `observed === 0` is
**`surfaceOnly`**. Semantics, chosen carefully:

- **`clean` (the PROVEN claim) requires `!surfaceOnly`** — a hollow "everything's fine" can
  never read as PROVEN.
- **`safe` (the CI gate, exit 1) does NOT fold in `surfaceOnly`** — a surface-only app has no
  critical/high findings and is not _risky_; blocking it would false-alarm a genuinely
  trivial service. It is unprovable, not unsafe.
- The same guard flows through `buildCapsule` (`immunity.js` imports `countObserved`, so the
  capsule's `proven` and the verdict's `clean` never disagree) and is rendered as a distinct
  third state — **`● SURFACE ONLY`** — by `apocalypse`, `immunize`, and the `dossier` (amber,
  not green, not red).

**Proof.** Verified on the real corpus: immich and GitHub-OpenAPI flipped from hollow PROVEN
→ **SURFACE ONLY**; dub (747 effects → NOT PROVEN) and Medusa (582 effects, all guarded →
PROVEN) are unchanged. A new fixture `tests/fixtures/ubg-proven` (a guarded, zod-validated,
single-row write) is the first genuine **PROVEN** in the suite — the old "clean app" test ran
on an effect-less echo app, i.e. it had been asserting a _hollow_ proven all along. Tests:
`tests/apocalypse.test.js` (behavior-guard block), `tests/command-smoke.test.js` (apocalypse

- immunize, both PROVEN_APP and the surface-only demo-app). 512 green.

**Honesty / limits.** SURFACE ONLY is the _honest_ label for two different situations it
cannot yet distinguish: (a) a spec/`--openapi` source that inherently has no bodies (nothing
to resolve), and (b) an app whose effects exist but the extractor missed (NestJS DI, external
Express controllers — see the stress-test report's fixes #2/#3). Both are "we didn't see
behavior", which is the truthful thing to say; deepening effect resolution (turning immich's
0 into real effects) is the follow-up that moves those apps from SURFACE ONLY to a real verdict.

---

## ADR-043 — Deep NestJS effect resolution: reading the immich monster

**Status.** Accepted, shipped. Fix #2 from the multi-repo stress-test report; the biggest
proof-quality win found there.

**Context.** The stress test caught immich (a 281-route NestJS app) resolving **1 effect** →
hollow PROVEN (ADR-042). The route surface was read, but the behavior behind it was invisible
because real Nest monsters stack four things the first Nest extractor (ADR-039) couldn't follow:

1. **tsconfig `baseUrl`/`paths` imports** — immich imports `src/services/x`, not `../../x`, so
   every cross-module hop dead-ended at `resolveRelImport` (which only handled `.`-relative).
2. **Multi-hop DI** — the DB write is _two_ hops down: controller → service → repository. The
   old resolver did one hop (controller → service) and stopped.
3. **Inherited DI** — the repository is injected in a `BaseService` the service `extends`; its
   _type_ is imported in the base module, not the subclass, so the type couldn't be resolved
   from where the call appeared.
4. **Kysely + custom guard decorators** — the effect is `db.insertInto('t')` (Kysely, which
   the extractor didn't recognise), and the routes are guarded by `@Authenticated()`, not
   `@UseGuards()` (so once effects appeared, every guarded mutation flagged as UNGUARDED).

**Decision.** Close all four, as _general_ capabilities (not immich hacks):

- `resolveRelImport` now resolves **tsconfig `baseUrl` + `paths`** (nearest-ancestor project,
  cached; explicit `paths` patterns plus the near-universal `baseUrl:"."` + `src/` fallback). A
  bare npm package resolves to nothing, which is correct — we never follow into `node_modules`.
- DI resolution is **recursive and bounded** (`followDI`, depth 6, cycle-guarded): each resolved
  method's own `this.<dep>.<m>()` calls are followed in turn.
- The DI map is built **up the `extends` chain** (`diMapWithMod`), and each entry carries the
  **module that declared it**, so an inherited `protected xRepository: XRepository` resolves
  against the base class's imports.
- `extract.js` recognises **Kysely** (`insertInto`/`updateTable`/`deleteFrom`/`selectFrom` →
  db_write/db_read), and guard detection accepts any decorator **named** like an auth gate
  (`@Authenticated`, `@Auth`, `@RequirePermission`, …), not only `@UseGuards`.

**Proof.** Real immich: **1 → 310 effects** (131 write / 147 read), **0 → 45 state tables**,
**253 guards** recognised, verdict **hollow PROVEN → NOT PROVEN** with exactly **2** critical
findings — both genuine: `POST /oauth/backchannel-logout` and `POST /oauth/callback` are public
OAuth endpoints that really do mutate state with no auth guard on the path. No false-positive
noise (the 253 `@Authenticated` routes are correctly clean), no blindness. dub / Medusa / the
OpenAPI corpus are unchanged. Fixture `tests/fixtures/ubg-nestjs-deep` mirrors the exact shape
(controller → service `extends BaseService` → repository → Kysely, via `src/` imports);
`tests/nestjs-deep.test.js` (4) locks all four capabilities. 516 green.

**Honesty / limits.** DI resolution is bounded (depth 6) and follows constructor-type and
inherited-constructor-type wiring; it does not yet resolve **string-token providers**
(`@Inject('TOKEN')` / `container.resolve('userService')`) — that has no static type to follow
and remains the next rung. The guard-by-name heuristic trusts a decorator's _name_: a decorator
called `@Authenticated` that doesn't actually authenticate would be over-credited (the same
naming trade-off as the rest of the static reading).

---

## ADR-044 — Deep Express (CommonJS) effect resolution: the controller→service→model chain

**Status.** Accepted, shipped. Fix #3 from the multi-repo stress-test report.

**Context.** The stress test caught a stock Express boilerplate resolving **0 effects** →
SURFACE ONLY. Express is the flagship framework, so this mattered. Real Express apps hide the
DB write the same way Nest does, but through **CommonJS module objects** instead of `this.`
DI: `router.post('/x', auth(), thingController.create)`, the controller does
`thingService.createThing(req.body)`, the service does `Thing.create(body)`. Three things the
extractor couldn't follow: (1) it resolved the `controller.method` handler but not the
`service.method()` calls _inside_ it; (2) services are imported through a **barrel**
(`const { thingService } = require('./services')`, where `services/index.js` re-exports each
sub-module); (3) the leaf effect is **Mongoose** (`Thing.create()`), which the scanner didn't
recognise.

**Decision.** Close all three, mirroring the Nest work (ADR-043) for the CommonJS shape:

- **Recursive module-member deep scan** (`deepScan`/`followMembers` in `express.js`): a
  resolved handler's effects = its own body PLUS every `importedObject.method()` call it makes,
  followed recursively (bounded depth 6, cycle-guarded), merged into one precomputed scan —
  the CommonJS analogue of the Nest DI hop.
- **Barrel re-export resolution** (`extract.js`): `parseModule` records
  `module.exports.x = require('./x')` as a re-export, and a destructured
  `const { x } = require('./barrel')` now resolves `x` to the sub-module it re-exports, not the
  barrel index.
- **Mongoose recognition** (`extract.js`): a Capitalized model receiver with a known document
  op (`create`/`findById`/`updateOne`/`deleteOne`/`paginate`/…) → db_write/db_read. Capitalization
  is Mongoose's own convention and keeps it from firing on `Math.random()`-style calls.

**Proof.** Real express-boilerplate: **0 → 9 effects** (6 read / 3 write), **0 → 2 state
tables**, SURFACE ONLY → **NOT PROVEN with 3 genuine findings** — `register`, `reset-password`,
`verify-email` are public auth endpoints that mutate with only a body-token (no auth
middleware); the `auth()`-guarded routes are correctly clean. immich / dub / Medusa unchanged.
Fixture `tests/fixtures/ubg-express-deep` (route → catchAsync controller → barrel service →
Mongoose model); `tests/express-deep.test.js` (3). 519 green.

**Honesty / limits.** The deep scan follows `importedObject.method()` where the object is a
resolvable import; it does not follow calls off values returned from _other_ calls
(`getService().doThing()`), nor dynamic dispatch. Mongoose recognition is a naming heuristic
(Capitalized receiver + known op) — a Capitalized non-model with a colliding method name would
be a false effect, the same trade-off as every other static reading here.

---

## ADR-045 — Robust Express entry detection (the tree-scan fallback)

**Status.** Accepted, shipped. Fix #4 from the multi-repo stress-test report — the last
detection wall.

**Context.** `findExpressEntry` only tried a fixed list of filenames (`app.ts`, `server.ts`,
`index.ts`, `main.ts`, …). A real Express app whose entry is named anything else —
`ParseServer.ts`, `bootstrap.ts`, `application.ts`, `www.js` — **hard-failed** with "could
not locate your Express entry", before any analysis could run. parse-server tripped this in
the stress test.

**Decision.** When no named candidate matches, fall back to a **bounded source-tree scan**
for the file that actually creates the app — a bare `express()` call (the `(?<![.\w])express
\s*\(\s*\)` app factory, which excludes `express.Router()` / `express.static()`). This is the
same fallback FastAPI detection already uses (`searchPyFiles`). Candidates are ranked
deterministically: a file that also `.listen()`s (a real server entry) beats a library file;
then shallower path; then alphabetical. The scan excludes `node_modules`/`dist`/`test`/`examples`/…
and caps at 400 files read so a giant repo can't stall detection.

**Proof.** parse-server (`src/ParseServer.ts`, no standard name) now detects as
`express @ src/ParseServer.ts` instead of hard-failing — and honestly compiles to NO PROOF
(it is a middleware _library_ that registers routes programmatically, so its route surface is
not statically visible; the provability guard reports that truthfully rather than crashing).
A weird-entry fixture (`ubg-express-weird-entry`, entry `src/bootstrap.ts`) is detected AND
yields 2 real routes with a resolved effect — the value case: a normal app that merely names
its entry unconventionally. Standard apps are unaffected (the named-candidate path still wins
first, so the scan never runs for them). `tests/express-entry.test.js` (2). 521 green.

**Honesty / limits.** The fallback finds _an_ app-creation file; if a repo has several
(a monorepo with multiple Express apps) it picks the highest-ranked one, which may not be the
one the user meant — a `--entry` override is the eventual answer. And detection finding the
entry does not guarantee a readable route surface: a library like parse-server is correctly
detected yet still NO PROOF, because its routes aren't declared statically at the entry.

---

## ADR-046 — Guard semantics: a guard must be able to deny (Round 7 #3, first cut)

**Status.** Accepted, shipped. First cut of Round 7 #3 (the full dominator/dataflow version
— proving a deny path _dominates_ the effect — remains ahead).

**Context.** Until now a chain step counted as a guard if its _name_ matched an auth pattern
(`auth`, `@Authenticated`, …) or its body denied. That means a middleware named like a guard
whose body is a pure `(req,res,next) => next()` — a **disabled/stubbed auth** — was credited
as a real guard, and a mutation behind it read as safe. The stress test's honesty push (#3)
demands: a guard must actually be _able_ to refuse.

**Decision.** Two safe, non-regressive changes:

- **No-op downgrade.** When a guard's body is _visible_ and is a pure unconditional `next()`
  pass-through (`isNoOpGuard`), it is downgraded to a logic node — it guards nothing, so the
  route correctly reads as unguarded. Deliberately narrow: any conditional, throw, deny, or
  other call means it is NOT a no-op (a real or delegating guard stays a guard). Opaque
  middleware/decorators (body unreadable, `fn: null`) are untouched — never downgraded.
- **Provenance.** Every guard node carries `verified`: `true` when SPARDA saw an auth deny
  path in the body (`res.status(401|403)` / `res.sendStatus(401|403)`), `false` when it is
  trusted purely by name. The verdict exposes `guards` / `guardsVerified`, and the dossier
  renders "N/M guards verified" — an honest measure of how much of the auth posture rests on
  proof vs trust, _without_ changing the verdict (so real opaque guards never false-positive).

**Guardrail learned (E-029).** The first attempt also treated a bare `throw` and `next(err)`
as deny signals. That backfired: `isGuardLike` reads `deniesWithStatus` as a guard signal, so
_business logic that throws_ (a service throwing `ApiError` on bad input) got misclassified as
a guard — hiding real unguarded mutations (express-boilerplate flipped NOT PROVEN→PROVEN, dub
156→152 findings). Reverted to auth-specific status codes only. Deny recognition must stay
auth-specific, or it turns validation into fake guards.

**Proof.** `tests/fixtures/ubg-noop-guard`: a disabled `requireAuth(){ next() }` and a real
`realAuth` (denies with 401). SPARDA downgrades the no-op → `POST /leaky` flags
`UNGUARDED_MUTATION`; `realAuth` is `verified`; `POST /safe` is clean. Zero regression on the
corpus (immich 253 guards / 2 findings, medusa 474 / PROVEN, dub 156, express-bp 3 — all
unchanged). `tests/guard-semantics.test.js` (3). 526 green.

---

**Addendum (0.41.0) — verified by resolution.** ADR-046 marked a guard `verified` when its VISIBLE
body showed a deny. Extended: a `@UseGuards(X)` guard whose class is resolvable now has its
`canActivate` RESOLVED and scanned for a deny (401/403 status, an auth exception, or `return false`
read as a deny only inside a canActivate). This turns brand guards from asserted → verified where
provable (twenty: 0 → 156 of 365). Still additive — verification never changes guarded/unguarded,
so no verdict moves; the blindspot ledger simply has one fewer opaque guard. An unresolvable or
non-denying guard stays honestly asserted (no false "verified", the E-029 discipline).

## ADR-047 — Express routes built inside a setup function (Round 7 #2, first cut)

**Status.** Accepted, shipped. First cut of Round 7 #2 (the full symbolic partial-evaluator
for loop-based route registries remains ahead; this handles the dominant _function-wrapped_
case, which is most of it).

**Context.** The stress test found directus (a real Express monster) reading **0 routes →
NO PROOF**. Root cause: the entire app is built inside `export default async function
createApp() { const app = express(); … app.use('/activity', activityRouter); … return app; }`
— the near-universal production shape. The Express extractor walked only the module TOP
LEVEL, so `const app = express()` and every mount lived one level down, invisible → no
app var, no routes.

**Decision.** Before the route walk, flatten the module's statements into a stream that
includes the module top level PLUS the bodies of setup functions and the control-flow blocks
inside them (`flattenSetup`): function declarations, default-exported functions, top-level
`const f = () => {…}`, and the `if`/`for`/`try`/`while`/block bodies within them, in source
order, bounded (depth 6, ≤8000 statements). It deliberately does **not** descend into a
function passed as a call ARGUMENT — a route handler is an argument, so handler bodies are
never mistaken for setup. `collectAppVars`, `collectRouteArrays`, and the route walk all run
over the flattened stream, so `const app = express()` and `app.use(...)` inside `createApp`
are read exactly as if they were top-level.

**Proof.** directus: **0 → 239 real routes** (`/access/:pk`, `/collections/:collection`,
`/files/tus/:id`, … — its actual REST surface), no regression on the 85 Express-related tests.
A bonus improvement fell out: node-express-boilerplate went 8 → 9 routes — the extra is
`GET /v1/docs`, a real Swagger route mounted inside an `if (config.env === 'development')`
block that the old top-level walk skipped. Fixture `ubg-express-factory` (app built in a
factory, one mount inside an `if`) + `express-factory.test.js` (3). 532 green.

**Honesty / limits.** This recovers the route _surface_ of function-wrapped apps; it does not
by itself resolve effects behind `new Service().method()` (directus instantiates services with
`new`, so it reads SURFACE ONLY until instantiated-service resolution lands — a separate gap).
And it is not yet the full partial evaluator: a route table built by a genuine runtime loop
over a data structure (`for (const r of registry) app.use(r.path, r.handler)`) with computed
paths is still out of reach — that is the deeper Round 7 #2. Function-wrapping was the 80%.

## ADR-048 — Instantiated-service resolution: `new Service().method()` (Round 7, one thing done well)

**Status.** Accepted, shipped (0.28.0).

**Context.** ADR-047 recovered directus's 239 routes, but the app still read **SURFACE ONLY**:
every handler does `const service = new ItemsService(req.collection, {…}); await
service.createOne(req.body)` — and the actual DB call lives on a class the service _extends_
(`ActivityService extends ItemsService`, where `this.knex` is wired). The deep scanner followed
module-member calls (`userService.createUser()`) and Nest DI (`this.svc.m()`), but a `new`-
instantiated class instance was invisible. This is the dominant idiom of class-service Express
apps — a whole app class, not a directus quirk.

**Decision.** Four capabilities, shipped together because each alone leaves the app blind:

1. **Wrapped inline handlers.** `asyncHandler(async (req, res) => {…})` in route position is
   unwrapped to the function argument and deep-scanned (route-position analogue of the existing
   top-level `const h = catchAsync(…)` idiom). Factory middleware without a function argument
   (`validate(schema)`) stays a blind node, as before.
2. **Instance tracking.** `collectInstances` maps `const svc = new X(…)` / `svc = new X(…)`
   (and the direct `new X(…).method()` chain) to class names inside the scanned function.
3. **Class-method resolution.** `svc.method()` resolves through the import to class X and up
   its `extends` chain (`classInModule`/`baseClassOf`/`methodInClassChain`, moved to
   `extract.js` and shared with the Nest DI follower). Inside a resolved method, `this.<m>()`
   re-dispatches from the _instantiated_ class — so an override (ActivityService.readByQuery)
   wins over the base method it shadows — and `super.<m>()` resolves from the declaring class's
   base. Module-member calls and nested `new` inside class methods keep being followed.
4. **`this.knex('table')`.** The class-field query-builder call now yields the table op
   (builderTableOf accepts a `this.<field>` callee), so base-class knex effects are real.

Bundles are memoized per (instantiated class, method) across the extract with their own dedup
domain (never caching a partial), same rationale as the Nest bundleCache (E-027's 34s lesson);
recursion is cycle-guarded and depth-bounded by MAX_HANDLER_DEPTH.

**Proof.** directus: SURFACE ONLY → **real verdict, observed effects** (the `createOne` insert
chain and entropy points resolve; compile ~1.2s for 239 routes). Fixture `ubg-express-instance`
(wrapped inline handlers + `new` + `extends` + `this`/`super` hops + `this.knex`) with 4 tests,
including the UNGUARDED_MUTATION finding on the unguarded write. Full corpus re-run: dub,
immich, medusa, express-boilerplate, fastapi, twenty, novu, cal, formbricks, open-webui —
byte-identical verdicts and findings, no perf cliff. 536 green.

**Honesty / limits.** directus's _read_ paths stay thin: `readByQuery` bottoms out in a fully
dynamic query builder (`runAst` → `getDBQuery` with a runtime `collection` string), so there is
no table literal to harvest — that is interprocedural-dataflow territory (Round 7 #1), not a
missing hop. Bare _imported-function_ calls inside method bodies (`runAst(ast)`) are still not
followed by the deep scanner — deliberate scope hold, same reason. And `PROVEN` here means "no
rule violated among observed behavior": with 5 effect nodes over 239 routes the observation is
real but sparse; the effect-ratio honesty signal is Round 7 #4 (differential validation).

## ADR-049 — The blindspot ledger: SPARDA measures its own Unknown Behavior Surface (UBS)

**Status.** Accepted, shipped (0.29.0). New organ + command `sparda blindspots`.

**Context.** The large-corpus stress test kept surfacing the same discomfort: an app reads
PROVEN, but SPARDA resolved only a fraction of it (twenty PROVEN yet GraphQL-first; formbricks
PROVEN yet its handlers delegate to un-followed services; directus PROVEN yet dynamic query
builders). "PROVEN" was quietly standing in for "omniscient". A static tool that silently drops
the part it can't resolve reads green and lies by omission. The seed for the fix came from Zak's
own side project (Reyna Provocateur), whose core idea is a measurable _Unknown Behavior Surface_ —
the system knows exactly where it does not know. We take that idea but derive it from SPARDA's
REAL graph and skip log, not Reyna's hand-authored regions (nothing invented, nothing guessed).

**Decision.** `src/ubg/blindspots.js` → `surveyBlindspots(graph, report)` enumerates four kinds
of blindness, each computable without guessing, and ranks each by what it could be _hiding_
(not by its name — E-029's lesson):

- **opaque-target** — an effect SPARDA saw but whose target it could not name (db op with no
  table; http/fs with a computed path). Writes/external = high, reads = medium.
- **blind-mutation** — a MUTATING entrypoint that resolved to zero behavior AND whose handler
  body was genuinely unreadable (`meta.opaque`, set in translate when fn:null with no scan).
  High. The opacity gate is what stops a real no-op POST (SPARDA read it, nothing there) from
  being cried as blindness — a false-positive that would have made the whole ledger noise.
- **unverified-guard** — a guard trusted only by name, never seen to deny. Low (the
  auth-on-faith signal, promoted from the existing guardsVerified count).
- **skipped-surface** — a route/mount/handler the extractor could not graph at all (from
  `report.skipped`). High if the reason names a mutating verb, else medium.

It also reports a **coverage ratio** (CBS/UBS): resolved behavior ÷ (resolved + blind behavior).
Wired as an honesty companion into `apocalypse` (a one-line "◐ blind spots: N · coverage X%"
under every verdict), into the `dossier` ("Where the proof stops" section), and as a standalone
command that exits 1 on any high-or-worse blind spot (CI can gate on "don't ship blind writes").

**Proof.** The ledger turns the stress test's vague unease into numbers, with ZERO verdict
change on the 11-app corpus (it only _reports_, never re-judges): twenty PROVEN **coverage 8%**
(406 blind — the GraphQL surface, now measured); formbricks PROVEN **8%**; open-webui/fastapi
PROVEN **0%** (Python depth); directus PROVEN **coverage 13%, 15 high** (the honest picture of
its dynamic query builders); dub NOT PROVEN yet **99%** resolved (it genuinely sees almost
everything). Fixture `ubg-blindspots` packs one of each kind + the no-op that must NOT flag;
`blindspots.test.js` (7). 543 green.

**Honesty / limits.** The ledger is a static over-approximation of blindness: it flags every
place the _static_ eye stops, which is the point — but "coverage 100%" means "nothing SPARDA
saw was left unresolved", not "the app has no behavior SPARDA can't reach at all" (a handler it
never even entered because a mount was dynamic shows up as skipped-surface, but a whole
framework SPARDA doesn't support wouldn't compile in the first place). The natural next step is
Reyna's actual loop: drive the executable `mirror` at the high-risk blind spots and fold what it
observes back as resolved behavior (Round 7 #4). This ADR ships the _measurement_; the
_reduction-by-execution_ is the arc it opens.

## ADR-050 — Symbolic table resolution: a request-derived target is a rule, not an unknown

**Status.** Accepted, shipped (0.29.0). First cut of interprocedural dataflow (Round 7 #1).

**Context.** Generic CRUD endpoints name their table from the request: `knex(req.params.table)`,
`supabase.from(collection)`, `db.insertInto(req.params.type)`. The effect scanner required a
string literal, so these read as `table: null` → opaque-target blind spots. But the table is not
unknown — it is _precisely_ "the value the caller supplies here". That is a symbolic answer, and
saying "table unknown" where the truth is "table = :collection (from the URL)" is under-reporting.

**Decision.** In `scanFunction`, a one-shot pass (`collectReqDerived`) maps local vars assigned
straight from a request member (`const c = req.params.collection` → `c ↦ :collection`).
`reqParamName` resolves a table argument that is a request member (`req.params.X`, `req.query.X`,
`req.body.X`, `req.X`, roots req/request/ctx/context/event) or such a var to `:X`. The knex/
supabase/kysely table readers fall back to it when the arg isn't a literal, emitting
`table: ':X', symbolic: true`. The flag rides into the effect node's meta; the blindspot ledger
excludes symbolic targets from opaque-target (a rule is resolved, not blind).

**Proof.** Fixture `ubg-blindspots`: `GET/POST /items/:collection` → db ops on `:collection`,
marked symbolic, NOT flagged opaque. Corpus: zero verdict change; sym=0 across all 11 apps —
none of them use the _within-handler_ dynamic-table shape, so this is proven on the fixture and
correctly inert elsewhere.

**Honesty / limits.** This is the WITHIN-HANDLER case only. directus — the app that motivated
the whole thread — resolves its table across a class boundary (`new ItemsService(req.params
.collection, …)` → constructor stores `this.collection` → methods call `this.knex(this
.collection)`), which needs constructor-argument dataflow through the class-method bundle. That
is the genuine Round 7 #1 (interprocedural) and is deliberately NOT attempted here: it is
cross-class, invasive to the scanner's per-function contract, and rushing it risks regressing the
corpus this session proved clean. The blindspot ledger already tells the honest truth in the
meantime — directus reads "PROVEN, coverage 13%", so its residual dynamic-table blindness is
visible and measured rather than hidden.

## ADR-051 — Cross-class symbolic dataflow: `new Service(req.x)` → `this.knex(this.field)` → `:collection`

**Status.** Accepted, shipped (0.30.0). The real Round 7 #1 (interprocedural table dataflow),
and the piece that makes directus a genuine verdict instead of a measured blind spot.

**Context.** ADR-050 resolved request-derived tables WITHIN a handler; directus (and the whole
class-service pattern) resolves them ACROSS a class boundary: the route chooses the table
(`new ItemsService(req.collection, …)`), the constructor stores it (`this.collection = collection`),
and inherited methods query it (`this.knex(this.collection)`, `.from(this.collection)`) two hops
down. The blindspot ledger had measured the cost honestly: directus PROVEN at **13% coverage**.

**Decision.** Three composing capabilities:

1. **A symbolic `this`-environment** (`computeThisSymbols` in extract.js). At a `new X(args)` site,
   bind each `this.<field>` to the table VALUE of the constructor argument that feeds it —
   request-derived → `:collection` (symbolic), a string literal (incl. `super('directus_activity')`)
   → a concrete table. Handles TS parameter properties, `this.f = param` assignments, and the
   `super(...)` chain (a literal super-arg yields a fixed table, not a symbol). Threaded through the
   express class-method bundle (`scanFunction(fn, { thisSymbols })`), memo-keyed by the binding so a
   `:collection` scan and a plain scan of the same method never collide, and carried across
   `this.<m>()` / `super.<m>()` hops (same instance → same bindings).
2. **Both knex builder orders.** `this.knex(this.collection).insert()` (table before verb, via
   builderTableOf) AND `this.knex.select().from(this.collection)` / `.into(this.collection)` (table
   AFTER the verb) — the latter resolved by `chainVerbOp`, which reads the verb from the receiver
   chain and requires a db-ish root so `Array.from` never fires. Request access via dot OR bracket
   (`req.params['collection']`) with TS `!`/`as` unwrapped.
3. **Effects from middleware-slot handlers.** The dominant directus/Express shape is
   `router.get(path, …, businessHandler, respond)` — the real work is a middleware and a formatter
   is last. The translator now attaches effects from EVERY chain step with a body, not only the
   terminal one (all are control-flow-reachable, so the prover sees them regardless of slot).
   Effect node ids became collision-aware: the same method line under two bindings (`:collection`
   vs `directus_activity`) coexists instead of the second silently overwriting the first.

**Proof.** Fixture `ubg-crossclass-table` (symbolic + literal-super + both builder orders + the
id-collision case), `crossclass-table.test.js` (3). Real directus: **coverage 13% → 95%**, db
effects 11 → 344, `:collection` symbolic tables resolving on the main `/items` CRUD, verdict
still PROVEN with **zero finding change**. Full 11-app corpus re-run: **every verdict and finding
count identical to baseline** (dub 156, immich 2, medusa/twenty/formbricks/open-webui/fastapi
PROVEN, novu 21, cal 13, express-bp 3) — the middleware-effect attach only ADDED resolved effects
on already-clean paths, it moved no verdict. 546 green.

**Honesty / limits.** `chainVerbOp` needs a recognizable db root name — an exotically-aliased
builder still slips through (→ a blind spot, correctly). The `this`-environment tracks table-shaped
fields only, not arbitrary value flow, and one bogus pre-existing resolution remains
(`trx.insert(payloadWithoutAliases)` reads the variable name as a table via the Drizzle path — a
narrow false table on directus's write path, not introduced here). And 95% is "of what SPARDA saw
signal for" — the blindspot ledger still reports directus's residual 5%, as it should.

## ADR-052 — Coverage as a first-class signal (Vague 1 of "every organ toward 10")

**Status.** Accepted, shipped (0.31.0).

**Context.** The blindspot ledger (ADR-049) measures how much of an app SPARDA actually
resolved, but it lived only in `blindspots`/`apocalypse`. The other organs kept presenting a
verdict with no confidence attached — an immunity capsule, a genome antibody, a PR review could
all read "PROVEN" whether SPARDA saw 100% or 8%. A proof's confidence has to travel WITH the
proof, everywhere it goes, or "PROVEN" quietly overclaims again (E-032, one layer out).

**Decision.** Thread the coverage ratio (and high-risk blind count) through the artifacts that
carry a verdict:

- **Capsule** (`buildCapsule`) now includes `coverage` + `blindHigh`. Because the capsule is the
  atom of the genome, the world memory now records "proven over how much", not just "proven".
- **`immunize`** prints the coverage line under the verdict.
- **`dossier`** promotes coverage to a hero stat (next to routes), alongside the existing
  "Where the proof stops" section.
- **`review`** computes coverage for BOTH the base and the working tree and reports the DELTA —
  a PR that makes the app harder to see (coverage ▼) is flagged even when its findings are clean.
- **Blindspot risk sharpened**: an unreadable mutation with NO guard on its path escalates from
  `high` to `critical` (unseen AND unprotected is the worst case); behind a guard it stays high.

**Proof.** directus `immunize` now reads "coverage 98%"; the dossier hero shows it; review shows a
signed delta vs base. Verdicts and finding counts unchanged across the corpus — coverage reports,
it never re-judges. 546 green; capsule/genome/review/dossier/immunity tests all pass with the new
field. `blindspots` exit behavior unchanged (critical ⊂ high+).

**Honesty / limits.** The capsule's coverage is computed without the compile `report`, so it omits
`skipped-surface` spots — it is therefore a slight over-estimate vs the full `blindspots` number
(directus 98% capsule vs 95% ledger). Documented, and the full ledger remains the ground truth.

## ADR-053 — GraphQL resolvers as first-class entrypoints (Vague 2a — ingestion breadth)

**Status.** Accepted, shipped (0.32.0).

**Context.** The blindspot ledger measured twenty (a GraphQL-first Nest app) at 8% coverage: SPARDA
read its thin REST surface but not the resolvers where the behavior lives — a whole unsupported
surface, the single biggest coverage gap in the corpus. But GraphQL in NestJS is not a new
runtime: a `@Resolver()` class wires its methods and constructor DI exactly like a `@Controller()`,
guards with the same `@UseGuards`. So the fix reuses the entire Nest DI machine.

**Decision.** In the Nest extractor: the walk pre-filter now also admits `@Resolver`; a class is a
route source if it carries `@Controller` OR `@Resolver`; and a method is an entrypoint if it carries
an HTTP verb decorator OR a GraphQL op decorator. `graphqlOp` maps the operation onto the graph's
existing verbs so nothing downstream changes: **@Query/@Subscription → a read (get), @Mutation → a
state change (post)**. The operation name is the GraphQL field (a string/`name:` option arg, else
the method name), namespaced under `graphql/` so an op and a REST route with the same word never
collide. DI resolution, guard proof, blast radius, polarity, coverage — all reused unchanged,
because after `graphqlOp` a resolver method IS just a route.

**Proof.** Fixture `ubg-graphql-resolver` (@Query/@Mutation, @UseGuards, DI to a service with a db
effect), `graphql-resolver.test.js` (3): verb mapping, DI effect resolution, and the unguarded
mutation flagged (not the guarded one). Real twenty: its 6 resolver operations now enter the graph
(GET/POST `/graphql/*`), verdict unchanged. Full corpus: every verdict + finding count identical.
549 green.

**Honesty / limits.** The corpus twenty is a SPARSE clone with only 2 resolver files, so coverage
barely moved (8%) even though the capability is real — on full twenty (hundreds of resolvers) this
is a large unlock. `@ResolveField` (nested field resolvers) is not yet an entrypoint (it is a
sub-field of a parent type, not a top-level op) — a deliberate scope hold. And this is the NestJS
GraphQL shape (code-first decorators); schema-first SDL + standalone Apollo resolvers are a separate
surface. Python effect depth (open-webui, 0%) remains Vague 2b.

## ADR-054 — One interprocedural resolution engine (`ubg/resolve.js`), frameworks as configurations

**Status.** Accepted (owner Go, 2026-07-15 — promotes the external audit's ADR-P2,
`docs/audit/2026-07-14-dossier-fable5-organes.md` §11). Phase 1 shipped.

**Context.** Call-following existed three times: the Nest DI follower (`methodBundle` /
`forEachThisCall` / `diMapWithMod` in nestjs.js), the Express module/instance follower
(`deepScan` / `followCalls` / `classMethodBundle` in express.js), and nothing for Next/Python.
Each copy re-implemented the same machine — 6-hop bound, cycle guard, memoization, scan merging
(`mergeScan` was duplicated line-for-line) — and each future framework or ORM would have paid for
depth separately, with divergence guaranteed (the audit's key verdict: most Round-7 "walls" are
duplication debts; one resolution engine removes four gaps at once). It is also the technical
prerequisite of ADR-P1 (dataflow edges in the IR): taint edges must be emitted by ONE resolver,
not three.

**Decision.** `src/ubg/resolve.js` owns the machinery once: `mergeScan`, `EMPTY_BUNDLE`,
`MAX_RESOLVE_DEPTH`, the AST walkers, and `createResolver({ cwd, scannedFiles, helpers })`
returning the two resolution strategies (`deepScan` for member/instance/this/super following,
`handlerScan` for constructor-type DI following) with their memo caches scoped to the run.
`express.js` and `nestjs.js` are now route-table adapters that configure the engine. Delivery in
two hard-gated steps, exactly as the audit prescribed:

- **Phase 1 (this ADR's shipped scope): extraction at byte-identity.** The canonical graph of
  every fixture must hash identically before/after — proven on all 30 fixtures, plus real-corpus
  confirmation: directus (Express class services) byte-exact at its v0.32.0 baseline
  (239r / PROVEN / 344 db effects / 95%), twenty and immich canonical-graph SHA-identical
  old-vs-new via forced Nest lowering, ~1s each (memoization intact).
- **Phase 2 (next): converge and extend.** Align the two strategies' deliberate divergences
  (bounding: depth counter vs stack size; traversal: raw AST walk vs @babel/traverse — each feeds
  effect order, hence canonical bytes, so alignment is gated on the corpus oracle, not free),
  then plug Next/Python/GraphQL depth and an ORM import-root table (name-pattern matches degrade
  to `asserted` provenance, never deleted) into the ONE engine.

**Consequences.** Adding a framework's depth stops costing a re-implementation; every effect can
carry its resolved import root as evidence (phase 2); ADR-P1's dataflow edges get a single home.
Cost accepted: until phase 2, the engine hosts two strategies side by side — honest, documented
in the module header, and cheaper than a premature merge that would break byte-identity blind.

**Proof.** Fixture oracle (30/30 canonical hashes identical), real-corpus probes above, 549
Vitest green (the ADR-029 self-containment gate caught the unpublished new module immediately —
the valve working as designed), ESLint/Prettier clean.

## ADR-054 addendum — phase 2 convergence shipped (0.33.0)

The two strategies are now ONE walk: constructor-type DI became a receiver kind inside
`followCalls` (`this.<prop>.<m>()` where `<prop>` is in the class's inherited DI map), and the
separate DI machine (`methodBundle`/`resolveMethod`/`forEachThisCall`, the @babel/traverse
traversal, the stack-size bound) was deleted. One memo, one bound, one traversal. The convergence
is what pays: every DI framework inherits the full member-call capability set — instantiated
classes, imported module calls, `this.<m>()` sibling dispatch — in one move. Gate held: all 31
fixtures byte-identical AND verdict/finding-set identical; directus byte-exact; on twenty/immich
the new visibility surfaced findings each verified genuine against upstream source (one is a real
missing `@Authenticated` on an alpha immich admin endpoint — every sibling method carries it).
Corpus baselines updated in the playbook. Remaining phase-2 scope: Python (Wave 2b, the engine
contract), ORM import-root table.

## ADR-054 addendum 2 — Wave 2b shipped (0.34.0); remaining scope = ORM import-root

`fastapi_extract.py` now implements the engine's contract (depth 6, memo per (file, qualname),
cycle guard, mergeScan semantics, deterministic ordering) — module-level singletons, imported
classes/aliases, bare imported functions, `self.<m>()` dispatch, DI-bound params, deep-scanned
`Depends()` providers, SQLAlchemy 2.0 shapes. open-webui: 456r, 0 → 1353 db effects, coverage
0% → 77%, verdict unchanged, 3.3s. The ORM import-root provenance table is the last ADR-054
increment — deliberately deferred to its own session (spec in NEXT-WAVES-PLAYBOOK; part-25
precedent: recorded, not rushed).

## ADR-055 — Recognize the protocol (HTTP), not the framework brand; infer the auth posture

**Status.** Accepted, shipped (0.36.0). Prompted by a real stress test: n8n (packages/cli), a
reputedly-unanalyzable giant, compiled to 0 routes / NO_PROOF because its routes live on a
home-made `@RestController` decorator framework the Nest extractor didn't recognize by name.

**Context.** Route recognition matched framework BRAND names (`@Controller`, `@Resolver`). That is
a treadmill: every framework — and every home-made one — invents its own decorator names, so each
is a wall until someone adds its vocabulary. A per-framework table does not scale.

**Decision — recognize what does NOT change: the HTTP protocol.**

1. **Routes by verb, not brand.** A class is a route source if a method carries an HTTP-verb-shaped
   decorator (`/^(?:http)?(get|post|put|patch|delete)(?:mapping)?$/i` — `@Get`, `@HttpGet`,
   `@GetMapping`), or it is a `@Resolver`, or it carries a path-prefix controller decorator (name
   ends in `Controller`, or a `'/…'`-shaped string arg). HTTP verbs are a closed, universal set; no
   framework can escape them, so this generalizes to the next home-made one for free.
2. **Auth posture by inference, not name.** A framework whose base auth is applied in its
   registry/bootstrap (n8n's `controller.registry.ts` authenticates every route unless `skipAuth`)
   is invisible to a per-decorator scan → naively, hundreds of false "unguarded" findings. The
   general, structural signal: the EXISTENCE of an auth opt-out flag in the app (`{ skipAuth:
true }`, `{ authenticate: false }`, `{ public: true }`) proves the app is guarded-by-default.
   Under that posture, every non-opt-out route gets a synthetic ASSERTED guard, and only the
   opt-out routes are evaluated as public — the Medusa inverted-auth pattern, generalized. Absent
   any opt-out flag, the posture is not inferred (plain Nest apps unchanged).
3. **Detection.** `express` + `reflect-metadata` (the near-universal decorator-metadata dep) + ≥3
   HTTP-verb-decorator-on-class files → the decorator extractor. Gated on `reflect-metadata` so
   classic-express detection pays no scan cost (directus has none).

**Consequences.** n8n: 0 → 494 routes, NOT PROVEN with 4 true-positive unguarded public writes
(`skipAuth` routes), 429 asserted guards, coverage 21.7%, 2.5s. Corpus (directus/immich/twenty/
open-webui) + all fixtures byte-identical. The honest ceiling is explicit: guards are ASSERTED
(the registry auth is trusted, not verified — surfaced by the blindspot ledger), and effect depth
still bottoms out on some ORM indirection (n8n coverage 21.7%). What is NOT achievable, and we do
not fake: a fully runtime-dynamic router, or an auth default with no opt-out flag to signal it,
stay honest blindspots — never a false PROVEN.

**Cadre.** **C**: reuses the whole converged engine (ADR-054) — recognition, not a new organ.
**P**: the protocol is stable where brand names are not — the decade-proof layer. **R**: the corpus
oracle (byte-identity) bounds every broadening; guarded-by-default only activates on an opt-out
signal. **D**: transparent — a giant that used to error now compiles. **A**: every asserted guard
is marked unverified; coverage reports how much of the posture rests on inference.

## ADR-056 — Coverage-graded verdict: PROVEN must be a proof about SOMETHING (the doctrine's first brick)

**Status.** Accepted, shipped (0.39.0). The first concrete brick of the two-front doctrine — on the
undecidable side, be maximally honest; on the decidable side, prove completely.

**Context.** ADR-034 refused a PROVEN over 0 routes; E-037 refused a PROVEN over reads-only. A harder
stress test found the residue: cal-api-v2 (175 routes) resolved a SINGLE effect and read **PROVEN**
at ~0% coverage. "No obligation violated" is vacuous when SPARDA resolved almost none of the
behavior — a proof about nothing.

**Decision.** `verdictOf(findings, graph, { coverage })` takes the blindspot coverage ratio. A CLEAN
app (findings.length === 0) below a 5% coverage floor is `surfaceOnly` → SURFACE, not PROVEN. The
floor is measured, not arbitrary: real PROVEN apps sit at 60%+ (fixtures) / 71%+ (corpus); the
hollow cases are ~0%; 5% separates them with headroom. Gated on `findings.length === 0` so it ONLY
ever downgrades a would-be-PROVEN app — coverage can never mask a NOT_PROVEN behind SURFACE
(surfaceOnly outranks NOT_PROVEN in the verdict word). Threaded from apocalypse/dossier/review, which
already compute coverage; heal's delta (no graph) keeps the old semantics.

**Consequences.** cal-api-v2 PROVEN → SURFACE; vendure stays SURFACE; every genuine PROVEN
unaffected; all pre-existing fixtures byte-identical. This is the seed of PROVEN-COMPLETE vs
PROVEN-PARTIAL: today a binary floor (PROVEN needs real coverage, else SURFACE); the richer grading
(a decidable-fragment certificate that says PROVEN-COMPLETE when the app is in the class where the
graph is provably exact) is the next increment. **Honesty contract intact:** SPARDA never claims a
proof it cannot back with resolved behavior.

**Cadre.** **C**: reuses the blindspot organ + the existing SURFACE state, no new verdict word.
**P**: coverage-as-verdict-gate is the durable expression of the doctrine. **R**: findings-guarded,
corpus-oracle-verified, measured floor. **D**: transparent (a hollow green becomes an honest amber).
**A**: the coverage % that drove the verdict is already printed next to it.

## ADR-058 — The provenance engine: value dataflow (request/session → sink), the foundation for taint and BOLA

**Status.** Proposed (design). The unlock for the real-bug frontier — object-level authorization
(BOLA/IDOR, OWASP API #1) and injection/mass-assignment — neither of which the current LOCAL lens can
prove.

**Context.** Two measure-first probes killed the naive versions of both lenses, for the SAME reason:

- **Taint at the write-site** (v0.44 measurement): request data reaches `create({ data: req.body })`
  on 1–7% of writes, but the "unvalidated" claim is false — validation lives in a service layer a
  per-function scan can't see. Shipped only as an under-approximated enrichment.
- **BOLA by where-clause** (this session's probe): dub had **1019 "candidates"** (an id-scoped query
  with no ownership key in the same `where`). Eyeballing: nearly all safe — the id is already-owned
  (`where: { id: user.id }`), or scoped by the wrapper (`withWorkspace`), or by a fetch-then-act
  upstream. The local `where` is far too small a window; ownership is enforced elsewhere on the path.

The common root: SPARDA sees effects and guards, but not **where a value came from**. It cannot answer,
at a sink, "did this flow from a REQUEST source, and did it pass a validator / an ownership scope on the
way?" That question is interprocedural — it needs the value's provenance carried across calls.

**Decision (the design).** Add a **provenance layer** to the UBG, computed by the ONE resolver
(ADR-054), analysis-time only, zero new deps.

1. **Provenance labels on values.** As the resolver walks a handler and everything it resolves, it
   tags bindings/expressions with a label: `REQUEST` (req.body/params/query/headers), `SESSION`
   (the authenticated user/session), `CONSTANT`, `DERIVED` (from a DB read), `UNKNOWN`. Plus two
   accumulating modifiers: `VALIDATED` (flowed through a validator — zod/Pydantic/class-validator) and
   `SCOPED` (a `SESSION` value was joined to the query as an ownership predicate).

2. **`data_flow` edges source → sink.** The UBG already carries `data_flow` edges (entrypoint →
   handler). Extend them to run from a provenance SOURCE to a SINK (an effect's write payload, or a
   read/write's `where` id), labelled with the provenance carried. The graph itself then records
   "req.body → this db_write" and "req.params.id → this where, unscoped".

3. **Interprocedural propagation.** Provenance rides the resolver's existing call-following: a
   `REQUEST` local passed as a call arg propagates to the callee's parameter; a validator on the path
   sets `VALIDATED`; an ownership predicate binding a `SESSION` value sets `SCOPED`. Bounded, memoised,
   cycle-guarded — the same widening the engine already uses (charged to coverage past the depth cap).

**Soundness posture (the crux — provenance is a DUAL analysis, per SOUNDNESS.md).**

- **Taint is a MAY-analysis** (over-approximate): a value MAY be request-derived → the safe error is to
  flag more. Powers the taint enrichment, now cross-function.
- **Scoping is a MUST-analysis** (under-approximate): `SCOPED` is set ONLY when an ownership join is
  proven on the path. So "not scoped" is the default, and BOLA fires when scoping is _not proven_.
- **Therefore BOLA is ADVISORY, never a hard verdict.** A scoped prisma client, row-level security, or
  a scope in an unresolved layer is invisible — so "ownership not proven on this path" is the honest
  claim, not "vulnerable." It points a human at the exact routes to review (SPARDA's whole value on a
  giant), at info severity, never flipping PROVEN → NOT_PROVEN on the absence alone.

**Phasing (each phase measurable on the corpus, each gated by the contract).**

- **A — provenance + edges.** Labels + `data_flow` source→sink edges for REQUEST, interprocedural.
  Immediately upgrades the taint enrichment from local to cross-function. Measure the tainted-write
  surface with real provenance.
- **B — SCOPED + BOLA advisory.** Detect `SESSION`-value ownership joins; emit a BOLA advisory for an
  id-scoped, request-sourced, verified-guarded access that is _not proven scoped_ anywhere on the path.
  Re-run the BOLA probe with path-wide scoping — the 1019 must collapse to a small, eyeball-clean set,
  or B does not ship.
- **C — VALIDATED cross-function.** Kills the false "unvalidated" on taint by seeing the service-layer
  validator; sharpens both.

**Consequences.** A real dataflow IR — the thing ADR-054's convergence was a prerequisite for (the
note there: "ADR-P1's dataflow edges get a single home"). It is additive: no existing verdict moves
until a consumer reads the new edges, and each consumer ships behind its own corpus measurement and the
soundness test. The honest limit stays named: provenance cannot see through a scoped client / RLS, so
BOLA is advisory forever — which is correct, not a shortfall. This is the socle for the acquisition
proof-point (a real IDOR on a famous repo), reached the only sound way: by proving flow, not guessing
from a local window.

**Cadre.** **C**: one provenance pass on the existing resolver, reusing `data_flow` edges — no second
walk, no new dep. **P**: value provenance is the durable substrate both remaining lenses need; building
it once is the leverage. **R**: phased, each phase corpus-measured before shipping (the taint/BOLA
probes are the gate), MAY/MUST posture pinned to SOUNDNESS. **D**: advisory BOLA says "scope not
proven here," never a false "vulnerable." **A**: the `data_flow` edge is the evidence — the source, the
sink, and what it did (or didn't) pass through, all on the graph.

**Progress — Phase B substrate shipped (0.47.0).** The object-scope provenance is in the IR:
`idScoped` (a query targets a bare `id`) and `ownerScoped` (it filters by an ownership key or a
session value) tag prisma read/write effects (`whereOwnerScoped` / `whereHasIdKey`, extract.js). A
route's BOLA candidacy = an idScoped access with NO ownerScoped access anywhere on its **resolved**
path (apocalypse's leak-free `reachOf`). Measured, measure-first: file-local heuristic = **1019 false
candidates on dub**; resolved-graph + the E-041 op-completeness fix + admin/cron excluded = **~71** —
tractable, still too noisy for a hard finding (admin routes are privileged, not object-BOLA; some
scopes are still invisible), so it stays a substrate until the advisory is precise. The measurement
also surfaced E-041 (missing `...OrThrow` reads were hiding the authorization fetch). Not done: the
BOLA advisory finding itself (proper admin-guard exclusion via the graph, more scope-detection), and
Phase A/C interprocedural REQUEST/VALIDATED provenance — the DI path is memoised, so taint must join
the bundle memo key (like `symSig(thisSymbols)`), the careful next step.

## ADR-060 — two natural-systems techniques, reproduced (quality & change-safety)

Two recurring engineering problems, each solved by a mechanism nature already perfected, now
reproduced in this repo (source: a design discussion, 2026-07-17):

1. **A guarded line shipped without a test → mutation testing.** DNA polymerase proofreads each
   base _coupled_ to synthesis (3′→5′ exonuclease), then mismatch repair does a second pass — a
   change is verified by an independent mechanism before it is committed. Mutation testing
   (Lipton & DeMillo, 1970s — an explicitly genetic metaphor) reproduces this: introduce a
   mutation into a critical line and require a test to KILL it; a surviving mutant is a line with
   no guardian. Ours is home-grown (`tests/mutation/run.mjs`, `npm run mutation`, in CI) — zero
   new dependency, fits the 4-dep ethos. The rule: add a mutant when you add a soundness-/
   correctness-critical line. Verification coupled to the change, not bolted on later.

2. **A correct change that shifts behavior for existing users → differential expression.** Biology
   never reports an absolute state — it reports change _relative to a baseline_ (gene-expression
   fold-change), and buffers big changes (canalization). Reproduced by the corpus oracle
   (`scripts/corpus-oracle.mjs`): every metric is diffed against a committed snapshot and drift is
   printed as `metric: before → after`. This is how E-046 landed safely — the oracle showed only
   dub moved (`findings: 9 → 96`), so a correct-but-large change was read as _newly-visible_
   posture, not a regression. The user-facing twin is `apocalypse --save-baseline` + diff mode.

## ADR-061 — Extraction coverage as PERCEPTION: recognize effects & repositories by ORIGIN

**Context.** An independent adversarial audit (`SPARDA_AUDIT_REPORT.md`, 2026-07-22) confirmed the
prover is sound but that its blind spots are all _perception_ failures — the compiler does not
_see_ an effect, so a whole handler reads `SURFACE` and proves nothing. None were false `PROVEN`;
they were missing behavior. Seven were closed this session (bricks #1–#7). The through-line: you
cannot enumerate every SDK/ORM shape by method name, so recognize behavior the way living systems
recognize signals under uncertainty — by a small combinatorial code, and by an identity acquired
at the SOURCE and carried by contact.

**Decision.** Two reproduced natural-systems techniques, both under one hard invariant.

1. **Innate immunity / olfactory combinatorial coding (bricks #1, #5).** A small PAMP catalog of
   CONSERVED, highly-specific vendor call SHAPES — `stripe.charges.create`, `client.send(new
PutObjectCommand())` — recognized directly, like the ~400 olfactory receptors that identify a
   trillion odorants combinatorially rather than one receptor per molecule. Deterministic, zero
   LLM, zero network. `EFFECT_SDK_PATHS` / `EFFECT_SDK_COMMANDS` in `extract.js`.

2. **Import provenance / ant cuticular-hydrocarbon "colony odor" (brick #6).** A binding IMPORTED
   from an effect package (`@sendgrid/mail`, `stripe`, aws-sdk, kafkajs…) or built from one (`new
S3Client()`, `Stripe(key)` factory, alias) carries an effect LABEL acquired at its source, and
   the label propagates by contact. Thereafter ANY call on a labeled binding is an effect —
   recognized by ORIGIN, not by guessing the method name — which is what the bare `.send()` tail
   needs. The SAME mechanism, pointed at ORM repositories (brick #7): a field from
   `@InjectRepository(User)` / `Repository<User>` or a `getRepository(User)` var is labeled with
   its entity table, so `this.repo.save(dto)` resolves to a `db_write` on `user`. `collectEffect
Clients` / `collectRepoFields` / `collectRepoVars`, threaded via `scanFunction(env)` → `ctx`.

   This is the standard static technique (def-use / lightweight abstract interpretation, as CodeQL
   / Infer / TS control-flow do) — the biology is the memorable name, never the engineering. Test:
   remove the metaphor and each technique still stands (olfaction = combinatorial catalog,
   colony-odor = origin-tagging, prion (ADR-tx) = alias templating).

**The invariant that makes this safe (non-negotiable).** Every recognizer is ADDITIVE and, for the
SDK layer, WRITE-shaped by default: it can only ever RAISE a finding (surface an `http_call` /
`db_write`), never fabricate a false `PROVEN`. A stale catalog under-detects; it never lies. Two
guards keep precision: (a) a read-shaped method on an effect client stays a GET (not observable),
so tagging a client never turns a `.retrieve` into a false irreversibility finding; (b) a write
verb fires only on a receiver PROVEN to be a repository/effect-client, so a generic `.save()` on
an unknown object never trips. This is the same direction-of-error discipline as the prover: when
SPARDA cannot see, it says `SURFACE`, never green.

**Consequence for the corpus (differential expression, ADR-060).** These recognizers make SPARDA
see MORE — a payment/mail/queue SDK next to a write now raises `IRREVERSIBLE_OBSERVABLE`; a
NestJS+TypeORM app that read `SURFACE` now resolves its mutations. `corpus-oracle` WILL report
drift on the giants (effect counts, verdict flips). That is newly-visible posture, not regression;
re-baseline with `--update` on purpose, noting why. Not observable in ephemeral CI (giants absent
→ oracle skips).

**Also decided (same session).** (i) Inline arrow route handlers are now `deepScan`ned like every
other callable branch — they previously followed no service calls and carried no provenance; a
pre-existing under-resolution, fixed. (ii) O2 (`UNVALIDATED_CONSTRAINED_WRITE`) skips DELETE — a
delete cannot violate a value constraint. (iii) `corpus-oracle` now shares the CLI's `verdictState`
(incl. the PARTIAL rung + `blindHigh`) so the oracle and `sparda apocalypse` can never disagree on
the verdict word. No new runtime dependency (still 4). Detail + measured results:
`docs/sessions/2026-07-22-innate-immunity-sdk-effects.md`; root causes: E-054…E-058.

## ADR-062 — Bootstrap the genome by MINING public git history (feed it without users)

**Context.** The genome (R6 — shared, behaviorHash‑addressed antibodies) is the only path to a
non‑reproducible moat (a data/network effect a well‑resourced team cannot copy), but it has a
cold‑start problem: antibodies normally come from USERS hitting bugs, and SPARDA has ~none. My own
harsh evaluation (session 2026‑07‑22) was: "IP reproducible, no traction" — precisely because the
moat is design‑only, zero users.

**Decision.** Feed the genome WITHOUT users by turning the compiler on the world's frozen code. The
insight: SPARDA is a COMPILER, not a runtime‑only immune system, so the antibodies users would
eventually produce **already exist in public git history** — every commit where a maintainer _added
an auth guard / ownership scope / DB invariant_ is a labelled before/after pair, waiting to be
extracted. `bench/cve-replay.mjs --mine <owner/repo>` clones a repo's history, finds those fix
commits, and replays each `{parent → fix}` through `diffGraphs` — offline, no key. A `GUARD_REMOVED`
on the parent (vs the patched commit as baseline) = SPARDA re‑derives, from source alone, the exact
protection a real maintainer restored. That pair is a real antibody; users only ADD private‑repo
antibodies later. This single pipeline yields three assets at once: (a) the seed genome, (b) SPARDA's
**real‑world recall** measured against ground truth we otherwise lack, and (c) the next coverage
brick, quantified.

**The honest‑metric discipline (the load‑bearing part).** The first naive scoring counted a generic
`UNVALIDATED_CONSTRAINED_WRITE` (fires on nearly every write) and `ENTRYPOINT_REMOVED` (the fix
merely ADDED a route — a feature) as re‑derivation, inflating ghostfolio to a false **8/8**. That is
exactly the vanity number this whole project exists to refuse. Corrected: **only** a diff
`GUARD_REMOVED` / `INVARIANT_REMOVED` counts as "re‑derived the protection"; a static risk flag is a
separate, weaker signal, never conflated. Honest re‑run: **1/8** genuine re‑derivation on ghostfolio
(6/8 weak, 1/8 missed). A tool that reports "1/8 today" is worth more than one that claims 8/8 — same
soundness doctrine as the prover (`SURFACE` over a false green).

**What the honest number revealed (the next brick).** Most `missed`/`weak` fixes added a **custom
permission decorator** (`@HasPermission`, `@HasRole`, app‑specific `@Roles(...)`) that SPARDA does
not yet model as a `guard` node — so a fix adding `@HasPermission('watchlist:create')` isn't seen as
a guard delta. Modeling custom permission/role decorators as guards is the next coverage brick; this
same pipeline re‑measures the lift. (The three unbuilt genome‑feeding sources — synthetic mutation of
real apps, compile‑at‑scale for shape census, and textbook OWASP/CWE antigens — remain in reserve;
history‑mining is the one built because it is labelled and real.)

**Also decided.** The miner is **self‑sufficient via git** — the research‑agent path was tried and
abandoned: the GitHub MCP is scoped to the session repo (can't query arbitrary public repos) and the
agents hit the session limit. `git` needs neither. Read‑only (never pushes to a mined repo), offline,
disk‑cleaning. Execution is handed to Gemini (`docs/gemini/GENOME-MINING-TASK.md`) as an ops task —
Claude built and tested the tool; Gemini runs it at scale and writes the honest results table. No new
runtime dependency (bench‑only). Tool: `bench/cve-replay.mjs` (`--mine` / `--manifest` / `--selftest`).

## ADR-063 — Model custom principal-injection PARAM decorators as asserted guards

**Context (the measured bottleneck).** ADR-062 named the next brick — "model custom permission/role
decorators as guards" — and Gemini's genome run (`docs/gemini/GENOME-MINING-RESULTS.md`, 9 repos,
**0/83 genuine re-derived**) localized it. The single largest blind spot is not `@UseGuards` and not
even auth-named METHOD decorators (`@Authenticated`, `@Acl`, `@RequirePermissions` already read as
guards via `GUARD_DECORATOR`/`GUARD_NAME`). It is the custom **parameter** decorator that injects the
authenticated principal — twenty's `@AuthWorkspace()`, `@AuthUser()`, `@AuthUserWorkspaceId()`, and
the ubiquitous `@CurrentUser()`/`@GetUser()` idiom. These live on the handler's PARAMETERS
(`createUser(@AuthWorkspace() ws, …)`), which `useGuards()` never scanned — so every such mutation
read as a FALSE `UNGUARDED_MUTATION` (the immich "253 guards, 0 verified" disease, one layer deeper).

**Decision.** The extractor now reads route-method parameter decorators. A parameter whose decorator
matches the principal-injection idiom (`PARAM_AUTH_DECORATOR` in `nestjs.js`) contributes an
**asserted** guard node to the route's chain — exactly the ADR-055 treatment already given to
auth-named method decorators. Its presence means the framework resolved `request.user`/`workspace`
from an authenticated request; the route runs behind auth. Two honesty rails, load-bearing:

1. **Asserted, never verified.** A param decorator carries no resolvable deny body, so it can only
   read `asserted` (surfaced unverified in the blindspot ledger) — never `verified`. It downgrades a
   false positive; it can never buy a `PROVEN`. The ONLY upgrade path is a separately-PROVEN global
   guard (`GLOBAL_GUARD_SCAN`), which genuinely does gate the route.
2. **Never suppresses a real hole.** A mutation with NO auth param is STILL flagged
   `UNGUARDED_MUTATION` — proven by the negative case in `tests/param-auth-decorator.test.js`
   (`wipeAllUsers`). Adding asserted guards is a false-POSITIVE reduction, never a false-negative.

**Mechanism (why it needed one new line in `isGuardLike`).** A chain step becomes a `guard` node only
if `isGuardLike(name)` matches `GUARD_NAME`. Auth/session-named decorators (`@AuthUser`,
`@UserSession`) already match; bare-principal names (`@GetUser`, `@Principal`) do not. Rather than
widen the broad `GUARD_NAME` regex globally — which would misclassify a plain `getUser` Express
middleware as a guard and risk a real false-negative — `isGuardLike` now also honors an explicit
`scan.assertedGuard` flag. Only the param-decorator path sets it, so the effect is surgical: a
principal-injection param decorator gates its route; nothing else changes.

**The compass (deterministic, not the noisy clone).** The genome miner's twenty sample is
noise-dominated — its `FIX_MSG`/`GUARD_ADD` candidate filter catches dependency bumps and refactors
whose subjects merely say "security"/"auth" (`bench/mined-twentyhq-twenty.json`: 15/15 `missed`, none
actually a param-guard-on-route addition), so a re-mine cannot cleanly attribute a lift. The recall
lift is instead proven at the miner's CORE computation: removing `@AuthWorkspace()` from the fixture
now yields a `diffGraphs → GUARD_REMOVED` — the exact `re-derived` verdict — where before the
decorator was invisible and the diff was empty (`missed`). Locked as a permanent, network-free test
(`tests/param-auth-decorator.test.js`, "miner recall lift"). No new runtime dependency (still 4).
Detail: `docs/sessions/2026-07-22-innate-immunity-sdk-effects.md` (Task 1 handoff from Fable).

## ADR-064 — Value-flow taint follows destructuring/aliases; O2 becomes proof-grade

**Context (Attack-Plan Task 2, taint half).** SPARDA already had a per-write taint tag
(`valueTainted` → a write whose value is request-derived), used to decorate `UNGUARDED_MUTATION`
with "request data flows straight into the write" and (newly) to make O2 proof-grade. But its reach
was one statement deep: `collectReqDerived` only tracked `const c = req.body.x` (a direct member
binding). It missed the two shapes real handlers actually use — **object destructuring**
(`const { title } = req.body`, the dominant idiom) and **identifier aliasing** (`const b = req.body;
const c = b`). So on the most common code shape, the flagship taint evidence never fired, and O2
could not tell "unvalidated input reaches this constrained column" from "constrained table, no zod
on the route."

**Decision.** `collectReqDerived` now follows request taint through (a) object-pattern destructuring
— each named binding carries its key as the symbolic leaf (`{ title } → :title`, `{ title: t } → t
= :title`, `{ ...rest } → the whole source`), and (b) identifier aliases of a tracked binding — in
one source-order pass (an earlier binding is in the map when a later one references it). And O2
(`UNVALIDATED_CONSTRAINED_WRITE`) gains a **proof-grade tier**: when the taint pass PROVES request
data reaches a constrained column, the finding names the demonstrated source→sink and carries
`tainted: true`; otherwise the conservative flag fires unchanged.

**The honesty rail (why this is additive, not a soundness risk).** Taint UNDER-approximates by
design — a missed alias is a false-negative on an _advisory tag_, never a hidden write. Two
consequences kept intact: (1) the taint tag only ever DECORATES an already-emitted finding, so a
richer taint reach can only sharpen a true finding, never invent one; (2) O2 still fires on a
constrained unvalidated write even when taint sees no flow (the server-controlled `data: { title:
'published' }` case) — the proof-grade tier is a strict ADDITION on top, so improving taint precision
never drops an O2. Proven by `tests/taint-flow.test.js` (the `/publish` server-controlled case still
flags, un-tagged) and the negative case carries a killing mutant.

**Measured lift.** On a destructured unguarded write (`const { title } = req.body;
posts.create({ title })`), `UNGUARDED_MUTATION` now carries "…and request data flows straight into
the write" — where before, on the dominant idiom, that clause was silent. O2 on a proven flow reads
"lets unvalidated request data flow straight into posts.title" instead of the speculative "no
validation on this route." (O2 is deliberately NOT a miner `STATIC_HIT` — ADR-062 — so this does not
move the recall number; the lift is finding _quality_ on the flagship rule, which is the credibility
surface.) `tests/taint-flow.test.js`, fixture `ubg-taint-flow`; suite 761, 22/22 mutants. No new
runtime dependency (still 4). Deeper interprocedural taint (through a helper call boundary) and the
full ADR-061 origin-recognition merge into ONE value-flow pass remain the continued depth of Task 2.

## ADR-065 — Strapi extraction: partial evaluation of the declarative route table

**Context (Attack-Plan Task 3, the "no-routes" gap).** Gemini's genome run read Strapi and directus
as **no-routes** — the compiler built no graph at all, so the whole app was SURFACE. Root cause for
Strapi: its routes are neither `app.get()` (Express), nor `@Get()` decorators (Nest), nor a
`route.ts` file convention (Medusa). They are a **data structure the framework reads at boot** —
`module.exports = { routes: [ { method, path, handler } ] }` and, dominantly, `createCoreRouter(uid)`
which _stands for_ a 5-row CRUD table. An AST scan for route CALLS sees nothing.

**Decision.** A fourth extractor (`src/ubg/strapi.js`) that PARTIALLY EVALUATES the registry instead
of executing it: read the `routes:` array as data, unroll `createCoreRouter(uid)` to its CRUD table
(pathed from the content-type's `pluralName`), resolve each `handler:'controller.action'` string to
the controller method cross-file, and scan its effects. Same `{ routes, … }` contract as every other
extractor, so apocalypse/polarity/coverage work unchanged — an app that read 0 routes now reads its
real entrypoints. Detection is dep-based (`@strapi/strapi`) OR structural (a `src/api/*/routes/*`
file whose export is a route table / core router), checked before Express so Strapi's transitive
koa/express never misroutes it (E-043 discipline). Effects are the Strapi ORM vocabulary —
`strapi.entityService.<verb>(uid,…)`, `strapi.db.query(uid).<verb>(…)`, `strapi.documents(uid)` —
synthesized locally (the medusa.js pattern), so the shared hot path is untouched; a core-default
action (absent from the controller) has its write synthesized from verb + uid.

**The honesty rail (reused, not reinvented).** Strapi's permission layer lives in admin config, not
code — so asserting a guard on every route would fabricate protection, and flagging every route
unguarded would cry wolf. The ADR-055 posture resolves it exactly: a route's `config.auth === false`
is a PUBLIC opt-out; the _existence_ of any opt-out means the app is guarded-by-default, so every
non-opt-out route earns an **asserted** `framework-default-auth` guard (surfaced unverified in the
blindspot ledger), while an `auth:false` mutation is genuinely public and DOES flag
`UNGUARDED_MUTATION`. `config.policies` / `config.middlewares` become asserted guards named by their
policy. No synthetic guard ever reads `verified` — no false PROVEN. Proven by `tests/strapi.test.js`
(the `auth:false` publish route flags; the guarded-by-default core routes do not) and a killing
mutant on the posture (giving a public route the default-auth guard fails the suite).

**Scope (honest).** This closes Strapi (the declarative route-table pattern). directus and
parse-server use a different shape — a class/registry loop mounting Express routers
(`for (const c of controllers) app.use(c.path, c.router)`) — whose partial evaluation is the same
technique on a different structure, and remains the next Task-3 brick. No new runtime dependency
(still 4 — `strapi.js` uses only `@babel/parser` via `parseModule` + node stdlib). `tests/strapi.test.js`,
fixture `ubg-strapi`; suite 767, 24/24 mutants.

## ADR-066 — Interprocedural taint across the helper-call boundary (Task 2 depth)

**Context.** ADR-064 made taint follow destructuring/aliases WITHIN a function, but it still stopped
at the call boundary: `app.post('/x', (req,res) => { saveItem(req.body) })` where `saveItem(data)`
does the write lost the taint — `data` inside `saveItem` was not known to be request-derived, so the
write read untainted and O2 dropped to its conservative tier. The write-in-a-helper pattern is
pervasive (controllers delegate to services), so this was the biggest remaining taint gap.

**Decision.** When the resolver follows a bare helper call (`followCalls`, the same hop that already
merges the helper's effects), it now BINDS the helper's parameters the caller proved request-derived
and seeds them into the helper's taint scan — the exact analog of `computeThisSymbols`, which already
binds constructor params to request-derived args for table resolution. `seedTaint(fn, args,
callerReq)` maps param i → a request marker when arg i resolves to a request member in the caller
(`reqParamName` non-null); `scanFunction` merges the seed into the callee's `reqDerived`. The seed
threads through the recursion across chained BARE calls.

**Scope correction (self-audit, E-060 — the original text overstated this).** This covers BARE
function calls (`saveItem(req.body)`), NOT DI / instance METHOD calls (`this.svc.save(req.body)`,
`svc.save(req.body)`) — which is the Nest/Strapi-dominant shape. The method path routes through
`classBundle`/`classMethodBundle`, whose memoization key does not include a taint seed, so seeding it
there would risk cache poisoning (a method scanned once untainted, cached, reused where taint
applies). DI/method-call taint (with a seed-aware bundle key) is therefore its own follow-on brick,
NOT part of this change. So today: taint crosses `handler → bare helper → bare helper`, but stops at
the first `this.service.method()` hop.

**The honesty rail.** MUST-analysis: a param is seeded ONLY when the caller PROVED the arg tainted, so
the pass can only add a _true_ taint tag — it never fabricates a finding (taint only decorates an
already-emitted finding / lifts O2 to proof-grade; the write flags on its own merits regardless).
Identifier params only; a destructured helper signature is left to the callee's own body scan
(under-approximation, the safe direction). Proven end-to-end by `tests/taint-flow.test.js`
(`/via-helper`: `const { title } = req.body; applyTitle(id, title)` → the constrained write inside
`applyTitle` is proof-grade) with a killing mutant on the seed.

**Known imprecision (documented, not hidden).** Effect nodes are deduped by source location, so a
helper's write reached from BOTH a tainting and a non-tainting call site carries a single tag — "some
caller taints this write." This is an over-approximation on an ADVISORY evidence tag (it can make an
O2 message read proof-grade on a route that passed a literal), never on a hard finding and never a
hidden hole. Acceptable within taint's decorate-only contract; a per-call-site effect identity is the
follow-on if it ever matters. No new runtime dependency (still 4). `tests/taint-flow.test.js`; suite
768, 25/25 mutants.

## ADR-067 — Prove the principal, don't name it: behavioral resolution of param decorators

**Context (Zak: "on peut pas faire mieux que des regex?").** After E-060 (a name-regex read
`@Author` as auth), the honest observation: SPARDA's whole thesis is "behaviour, not names", yet the
custom-param-decorator path was pure name-guessing (`PARAM_AUTH_DECORATOR` matched `/^auth/i`, and the
E-060 fix was itself just a less-wrong regex). Name-substring matching has false positives (`@Author`
→ hides a hole) AND false negatives (a principal decorator whose name lacks an auth token → cries
wolf). The fix is not a smarter regex — it is to stop guessing from the name.

**Decision (two rungs, behaviour first).** A custom param decorator is `createParamDecorator(fn)`; its
body reads a request field. So RESOLVE the definition (same-file or through its import) and PROVE what
it reads:

1. **Body visible → behaviour is FINAL.** It injects the principal iff it reads a PRINCIPAL_FIELD
   (`.user`/`.workspace`/`.session`/…) whose object chain does NOT pass through a user-input field
   (`req.body.user` is caller-controlled, not the principal). `@AuthWorkspace` → `getRequest().workspace`
   → guard; `@Author` → `getRequest().body.author` → NOT a guard. The name is irrelevant when the body
   is visible — this is the E-060 class killed at the root, not by a name list.
2. **Body opaque (library import) → tokenized-name fallback.** Split the identifier into whole tokens
   (`Author` → [author], `AuthUser` → [auth, user]) and match a principal lexicon on tokens, never
   substrings. Strictly better than the old regex, and honestly labelled as a guess (asserted).

**Two-directional gain (why it's worth it, not just cleaner).**

- **Soundness (fewer hidden holes):** ANY auth-named decorator that actually reads user input is now
  rejected — not just the two names E-060 hard-coded. Proven by the `@Author` decoy.
- **Recall (fewer false alarms / twenty credibility):** a decorator whose NAME carries no auth token
  but whose BODY reads `request.user` is now caught — impossible for any name-match. Proven by the
  `@Whoami` case (`whoamiWrite` no longer flags UNGUARDED though "whoami" is not in any lexicon).

**Honesty rail unchanged.** Reading the principal proves the route CONSUMES auth, never that it
DENIES — so it stays an ASSERTED guard (ADR-063), never `verified` on its own. `tests/param-auth-
decorator.test.js` (8 tests incl. decoy + recall); suite 770, 25/25 mutants. No new runtime dependency.

**Scope + generalization.** Applied to param decorators (where it bit us). The same principle —
behaviour over name, with `splitIdent` tokenization as the honest fallback — is the template for the
other name-substring regexes (`GUARD_NAME` for method decorators, `WRITE_VERB`, `OWNERSHIP_KEY`); the
STRUCTURAL regexes (HTTP verbs, file conventions — closed vocabularies) are correct as-is and stay.
Folding the name-semantic regexes onto the tokenizer is a follow-on consistency pass, not done here.

## ADR-068 — Effect-bias inversion: an opaque write on a proven DB handle is a write, not nothing

**Context (from the tri-AI research on "faire mieux que des regex").** Three independent AIs answered
the semantic-inference brief; they converged on abstract interpretation + effect systems + provenance
(which is what SPARDA already IS — a validation, not a pivot). One of them (the sharpest) surfaced a
concrete, LIVE soundness hole, confirmed by probe: `db.nukeEverything(req.body.confirm)` on a proven
knex handle produced **0 effects, 0 findings** — an unguarded custom write passed completely
invisible. That is the dangerous direction (a hidden hole), in production.

**The insight (unique to that response).** For effect classification the safe bias INVERTS versus
every other obligation. Everywhere else, "unknown → abstain" is safe. Here it is not: a missed write
is a hidden hole, while an over-classified read is only a surfaceable false positive. So an UNKNOWN
method on a PROVEN persistence handle must be treated as a WRITE.

**Decision.** (1) Track DB-handle provenance the same way as SDK effect-clients — `collectDbHandles`
labels a binding imported from a persistence package (`knex`, `pg`, `@prisma/client`, `mongoose`,
`typeorm`, `drizzle-orm`, …) or built/aliased from one. Provenance, never a name test (a handle named
`store` still counts; `const db = notARealDb` does not). (2) In `inspectCall`, AFTER every known
ORM/SDK/HTTP/fs handler declines, an unknown method called DIRECTLY on a handle identifier — that is
neither a known read nor plumbing — emits a `db_write` marked `opaque` with a **null table**. (3)
apocalypse counts an opaque write toward the guard obligation (O1) with a null state, so O2/O3/O5
skip it for lack of columns/invariants/domain. It fires ONLY "unguarded mutation", never fabricates
value/atomicity/aggregate precision.

**Honesty rails (why it can't backfire).** Additive and one-directional: it can only RAISE the O1
finding, never lower one, never touch PROVEN. Gated hard against a flood — provenance-only receiver,
direct-identifier receiver (builder continuations sit on a call receiver; ORM verbs are handled
above), known reads and plumbing excluded (`db.select`, `db.then`, `db.transaction` never fire). The
full suite (775) and the flood fixture confirm zero spurious writes on real read/plumbing patterns.
Tested: `tests/opaque-write.test.js` (unguarded opaque write flags; guarded one doesn't; a read
doesn't; O2/O3 never attach) + two killing mutants (emit + count).

**Scope — honest (V1).** This closes the hole for a handle declared in the ROUTE's own module
(`const db = knex(...)` beside the routes, or in the entry file). The common shared-module pattern
(`import { db } from './db'` into many route files) needs cross-module handle resolution — deferred
to V2 because doing it inside `collectDbHandles` (which runs during `parseModule`) risks import-cycle
recursion; V2 will resolve imported handles cycle-safely in the resolver. The provenance
infrastructure (`dbHandles`, threaded like `effectClients`) is exactly what V2 builds on. Also
deferred: literal-vs-dynamic split for `raw`/`query`/`execute` (parked in `DB_NON_EFFECT` so they
never flood). No new runtime dependency (still 4).

## ADR-069 — Auth-library deny catalog: teach SPARDA to read the opaque guards (verified, not asserted)

**Context (the type-lock groundwork).** Audit of the verdict found a systemic honesty hole: guard
provenance (verified vs asserted) is computed but the code says it _"does not change the verdict"_ —
cosmetic. Probe: a mutation guarded ONLY by an opaque `requireAuth` reads **PROVEN** with
`guardsVerified = 0`. To close that hole HONESTLY (the coming strict lock: PROVEN requires verified
guards), most real apps would drop to PARTIAL — because their auth is an opaque npm middleware
(`passport`, `express-jwt`, `next-auth`) whose body lives in `node_modules`, so SPARDA reads it
`asserted`. Zak's insight: don't lower the bar — **learn to read them**. And the mechanism already
exists (the SDK-effect / DB-handle provenance catalogs — ADR-068). So: teach the common auth libs
FIRST (this ADR), flip the strict lock SECOND, so the green wall re-props on solid ground.

**Decision.** A curated `AUTH_GUARD_PACKAGES` catalog + `authDenyCall` recognizer: a middleware built
from a known auth package (`passport.authenticate()`, `expressjwt({…})`, …) earns a synthetic
deny-scan → the guard reads **verified**, not asserted, so its app can legitimately reach PROVEN. This
is NOT a name test (that was E-060): it is a VERIFIED published fact ("passport.authenticate denies
with 401"), checkable by anyone reading passport once — versioned and auditable, the innate-immunity
pattern. Provenance-based: `collectAuthGuards` reads the import map (localName → package) and the
local consts bound to a deny-form call. Wired into `express.js` `resolveCallable` for both the inline
(`passport.authenticate(…)`) and aliased (`const requireAuth = passport.authenticate(…)`) forms.

**The honesty rail — deny-FORM precision (the load-bearing part).** The catalog abstains rather than
over-verify, because these libs have non-denying forms: `passport.authenticate(strategy, cb)` with a
custom callback does NOT auto-deny (the deny is the user's callback), and `expressjwt({
credentialsRequired: false })` lets anonymous through. `authDenyCall` returns false (→ stays asserted,
the safe direction) for those forms — a broken precision would falsely VERIFY a guard that passes
anyone (a false PROVEN). Proven by `tests/auth-catalog.test.js` (deny-form verifies; callback-form and
credentialsRequired:false do not) + a killing mutant on the express-jwt precision.

**Scope + honesty note.** Express V1 (passport, express-jwt). NestJS `@UseGuards(AuthGuard('jwt'))`
from `@nestjs/passport`, and cross-module imported middleware, are follow-ups (same catalog, other
extractors). Deliberately: the passport `!hasCallback` precision is redundant in the current forms
(the inline callback is caught by the wrapped-handler branch, the aliased one by `mod.functions`
scanning the callback body — both already assert it), so it carries no mutant — it is defensive
documentation of intent. No new runtime dependency (still 4). `tests/auth-catalog.test.js`, fixture
`ubg-auth-catalog`; suite 780, 28/28 mutants. **Next: the strict lock (PROVEN requires verified),
now safe to flip because the common opaque guards read verified.**

## ADR-070 — The honesty type-lock: PROVEN requires VERIFIED protection, by construction

**Context.** The audit (ADR-069 groundwork) found the flagship hole: guard provenance (verified vs
asserted) was computed but _"does not change the verdict"_ — cosmetic. Probe: a mutation guarded only
by an opaque `requireAuth` read **PROVEN** with `guardsVerified = 0`. That is a false PROVEN — the
exact thing the product exists to never do — and it rested on CONVENTION (every signal author must
remember "asserted ≠ PROVEN"), which is precisely how E-060 slipped. The tri-AI research named the
fix: make honesty a TYPE-LOCK — structurally impossible for an unproven signal to buy PROVEN — not a
discipline.

**Decision.** `verdictOf` now downgrades PROVEN→PARTIAL whenever any CLEAN mutation route rests on an
ASSERTED-only guard: a route that mutates state, is guarded (so no UNGUARDED_MUTATION fires), but
where NO guard is `verified` (SPARDA never saw a deny). `assertedOnlyMutations(graph)` computes it
per-route from the graph. Crucially, the rule lives in ONE chokepoint — `verdictOf` itself, computed
from the graph, NOT threaded through the five callers — so no caller can forget it and no future
signal can route around it. That single-place enforcement IS the "by construction": the honesty
invariant is a property of the verdict function, not of every author's vigilance.

**Sequencing (why it's safe now, not a green-wall collapse).** Shipped AFTER the auth-library catalog
(ADR-069): passport/express-jwt now read `verified`, so real apps on them stay PROVEN — proven end to
end (verified app → PROVEN; opaque-guard app → PARTIAL). The lock only bites genuinely-unprovable
protection. Full suite: ZERO existing fixtures flipped — their PROVEN rests on in-repo verified
guards, exactly as it should.

**Honesty rails.** Sound and one-directional: only ever SOFTENS PROVEN→PARTIAL (same safe direction
as the coverage/blind-spot rungs), never masks a finding, never touches the CI gate (`safe` is
unchanged — an asserted-guarded mutation is not a critical/high finding, so it does not fail CI; it
just isn't a positive PROOF). The CLI now names the real reason ("N guarded mutation(s) rest on a
guard SPARDA could not verify — the deny is not proven"), so PARTIAL-at-100%-coverage is legible, not
mysterious. `tests/type-lock.test.js` (asserted→PARTIAL; verified→PROVEN; still `safe`) + fixtures
`ubg-typelock-asserted`/`ubg-typelock-verified` + a killing mutant (make the lock cosmetic → false
PROVEN → test bites). No new runtime dependency (still 4). Suite 783, 29/29 mutants.

**What this means for the product.** PROVEN now means what it says — SPARDA saw the deny. Most apps
will read PARTIAL until their auth library is in the catalog (ADR-069) or their guard is in-repo. That
is not a regression: it is the promise made structural. The catalog is the engine that turns PARTIAL
back into PROVEN, honestly, one library at a time (next: NestJS `@nestjs/passport`).

## ADR-071 — Auth-library catalog, NestJS half: @nestjs/passport AuthGuard as verified

**Context.** ADR-069 taught the express auth libs; ADR-070 made verified/asserted load-bearing (PROVEN
requires verified). So a Nest app whose auth is `@UseGuards(AuthGuard('jwt'))` — the dominant Nest
idiom — read PARTIAL, because passport's deny lives in `node_modules` (opaque) → asserted. This is the
catalog's Nest half: turn that back into PROVEN, honestly.

**Decision.** `nestPassportGuard(name, mod)` recognizes a `@UseGuards(...)` guard built on
`@nestjs/passport`'s `AuthGuard`, in two forms — inline `AuthGuard('jwt')` (the guard name imported
from @nestjs/passport) and a subclass `class JwtAuthGuard extends AuthGuard('jwt') {}` (resolved
same-file or through its import; the superclass's provenance is checked in ITS module). Recognized →
the guard earns the deny-scan → `verified`. Wired into `guardStepScan` after `guardScan` (a subclass
with a real in-repo `canActivate` still verifies through the normal path first). Provenance-based (the
import package), never a name test.

**Deny-FORM precision (the honesty rail).** A subclass that OVERRIDES `canActivate`/`handleRequest`
may swallow the 401 (a custom `handleRequest(err, user) { return user }` passes anonymous through), so
`nestPassportGuard` abstains on it → stays asserted (the safe direction), never falsely verifies.
Proven by `tests/nest-passport.test.js` (inline + plain subclass verify; the handleRequest-override
subclass stays asserted) + a killing mutant. End-to-end: a clean Nest app on `AuthGuard('jwt')` now
reads PROVEN (guardsVerified 1/1); without the catalog it was PARTIAL.

**Scope.** @nestjs/passport (the overwhelming majority of Nest auth). Custom Nest guard classes with
an in-repo `canActivate` deny already verified via `guardScan` (unchanged). Cross-module resolution
reuses the existing import-follow. No new runtime dependency (still 4). `tests/nest-passport.test.js`,
fixture `ubg-nest-passport`; suite 786, 30/30 mutants. The catalog now covers the two dominant JS auth
stacks (express passport/express-jwt + Nest passport) — the green wall re-props broadly on proof.

## ADR-072 — Innate immunity for O4: attack the known pathogen, tolerate the unknown

**Context (breaking THEIR limit in THEIR domain).** The competitors' domain is whole-app static
analysis, and its unbreakable weakness — the reason devs abandon SAST tools — is FALSE POSITIVES
(crying wolf). We attacked it with a cross-domain lens instead of an analyst's: how does the immune
system avoid attacking the body? Measured first: on immich (a real 281-route Nest app, 100% guards
verified), the ONLY two hard findings were both `IRREVERSIBLE_OBSERVABLE` on GENERIC external calls —
`/search/smart` (a search hitting an embedding API) and `/oauth/callback` (a token handshake).
Neither is a dangerous irreversible mutation; both are wolf-cries, and they alone blocked a fully-
guarded app off PROVEN.

**Decision.** O4 (IRREVERSIBLE_OBSERVABLE) now discriminates like innate immunity. A KNOWN-dangerous
observable — a recognized payment / mail / SMS / push effect from the SDK PAMP catalog
(`target: sdk:…`, the conserved danger signal SPARDA already curates) — is a HARD finding: you
genuinely cannot un-send an email or un-charge a card, so an email+write with no compensation is a
real saga hole. A GENERIC external call (`target: dynamic` — an unknown fetch, in the wild almost
always a READ) is TOLERATED as an ADVISORY, not cried-wolf. This is the immune principle exactly:
attack the known pathogen (innate PAMP recognition), tolerate the unfamiliar — because attacking
everything unfamiliar IS autoimmunity, which is the false positive itself.

**Why it's sound (kills the wolf-cry WITHOUT hiding a hole).** The unknown call is downgraded, not
silenced — it stays surfaced as an advisory ("review if this is irreversible; a generic fetch/read is
fine"), at the honest confidence level (we cannot PROVE a generic fetch is irreversible, so we don't
assert it). A real irreversible effect still hard-flags — proven by the soundness test:
`stripe.charges.create` + write with no compensation stays a HARD finding. Advisory findings are
review-flags, not proven violations, so they are exempt from the polarity ⇄ findings invariant
(refined accordingly), consistent with how BOLA advisories already work.

**Measured gain.** immich: 2 hard findings → 0 hard (2 advisory) → verdict **NOT_PROVEN → PROVEN**. A
real 281-route app now reads green, HONESTLY — its guards were already 100% verified; the only thing
standing between it and PROVEN was our own wolf-cry. This is the template for breaking the
competitors' limit repeatedly: for each of their walls, find the domain of the living world that
already crossed it, and port it to real tested code. `tests/immune-observable.test.js` + fixture
`ubg-immune-observable` + a killing mutant (make it autoimmune → the wolf-cry returns). Suite 789,
31/31 mutants. No new runtime dependency (still 4).

## ADR-073 — The named status constant is a deny signal (StatusCodes.FORBIDDEN)

**Context (a measured false negative on the biggest kind of real app).** ghostfolio is a real 90+
route NestJS/Nx app that guards writes with `HasPermissionGuard` — 91 uses. Its `canActivate` denies
by `throw new HttpException(getReasonPhrase(StatusCodes.FORBIDDEN), StatusCodes.FORBIDDEN)`. SPARDA
resolved the guard class fine (the tsconfig `paths` alias `@ghostfolio/api/*` already resolves via
`resolveAliasedImport`), reached its `canActivate`, and still read it **asserted** — because the deny
recognizer (`deniedStatusOf` / the `HttpException` scan / `isDenyOptions`) matched ONLY a numeric
literal `401`/`403`. A guard that spells its status as a named constant looked like it never denied.
That capped ghostfolio (and every app using `http-status-codes` or Nest's `HttpStatus.*`, i.e. most
of them) at PARTIAL. It is a false negative of the _verification_, not of soundness — but it made
`verified` unreachable for the single most common professional deny idiom.

**Decision.** One shared helper `isDenyStatusArg(a)` recognizes a deny status argument as EITHER the
numeric `401`/`403` OR the named member `X.FORBIDDEN` / `X.UNAUTHORIZED` (any object: `StatusCodes`,
`HttpStatus`, `HTTP_STATUS`, …). It is wired into all three deny sites — the `HttpException`/`HttpError`
constructor scan, `res.sendStatus()/.status()` (`deniedStatusOf`), and the `{ status }`/`{ statusCode }`
init object (`isDenyOptions`). The numeric path is unchanged; the named path is added.

**Why it's honest (not name-matching).** `FORBIDDEN` _is_ 403 and `UNAUTHORIZED` _is_ 401 — by the
HTTP spec and by every status-code library's definition. This is not fuzzy name inference (the thing
ADR-060+ removed); it reads a value that is 403 by definition, exactly as sound as reading the literal
`403`. We deliberately do NOT accept a bare identifier `FORBIDDEN` with no object, nor other status
names — only the member form on the two auth-deny codes, the conserved denial signal.

**Measured gain.** New fixture `ubg-nest-status-const` mirrors ghostfolio precisely: a custom guard
throwing `HttpException(_, StatusCodes.FORBIDDEN)`, imported through a `paths` alias, over a knex
write. Before: guard `asserted` → app PARTIAL. After: guard **VERIFIED** → the write's guard obligation
is met by construction. The test doubles as an alias-hop proof (verified is unreachable unless the
`@app/*` alias resolves to the real file). `tests/nest-status-const.test.js` + a killing mutant (drop
the named-constant branch → the guard falls back to asserted → the test bites). Suite 791, 32/32
mutants. No new runtime dependency (still 4).

## ADR-074 — Generate-and-check: an untrusted witness, a deterministic verifier (BOLA half)

**Context (the real wall, named).** Rice's theorem caps what ANY tool can PROVE by observation — the
reason SAST giants must choose between false positives and false negatives, and why our own sound
verdict leaves real code at "not proven". The escape is the P-vs-NP / proof-carrying-code asymmetry
(Necula–Lee 1996): FINDING a proof on arbitrary code is undecidable, but CHECKING a proposed proof is
cheap and decidable. Five domains converge on the same architecture — cryptography (untrusted Prover /
trusted Verifier), the immune system (random antibodies / affinity selection), evolution (mutation /
selection), mathematics (conjecture / proof), negative selection (random T-cells / self-test). All:
**untrusted generator + cheap trusted verifier.** So: stop trying to synthesize proofs (the wall);
CHECK witnesses proposed by an untrusted generator (the code's AI author, or the client's LLM via MCP
sampling). Recall comes from the generator; soundness never does.

**Decision (the deterministic CHECKER half, shipped now).** O7 (BOLA/IDOR, OWASP API #1) is the one
class that survives on authenticated apps, and it false-positives on the commonest hand-rolled
ownership check: FETCH-THEN-COMPARE — `const row = await find({where:{id}}); if (row.ownerId !==
req.user.id) return res.sendStatus(403)`. The scope lives in a value comparison + deny, not a `where`
clause, so `whereOwnerScoped` abstains. `ifAssertsOwnership(node)` is the deterministic verifier for
that witness: an `IfStatement` whose branch DENIES (throw / 401 / 403) and whose test compares a
fetched member field against the caller's VERIFIED identity (`valueIsIdentity`, order-agnostic) proves
caller-ownership → clears O7, exactly like the existing `callAssertsOwnership` (G1). Reuses the
`ownerAsserted` clearing path; no new plumbing, no new dep.

**Why it's sound both ways (adversarially tested).** The honesty gate is `valueIsIdentity`: request
input (`req.body.ownerId`, `req.params.*`) is NEVER identity, even when named like an owner — so a
spoofable compare is rejected. And the branch must actually DENY — a compare that only logs proves
nothing. Fixture `ubg-bola-witness` has one safe route (cleared) and THREE controls that must stay
flagged: a real leak (no compare), a spoof (compare vs `req.body`), a no-deny (compare vs principal
but only logs). The verifier discharges ONLY the safe one. The blast radius is honest-safe regardless:
O7 is advisory (never gates the verdict), so a mis-clear can only drop a non-gating advisory — it can
NEVER create a false PROVEN. Killing mutant: drop the identity gate → the spoof-compare clears a real
BOLA → the control test bites.

**Measured gain.** `ubg-bola-witness`: O7 advisories 4 → 3 — the fetch-then-compare false positive is
killed soundly, the real hole and both adversarial decoys stay. This is _the_ most common ownership
idiom in hand-rolled Express/Nest handlers, so the recall gain on real apps is broad.

**Honest boundary (what is NOT shipped).** (1) This is the CHECKER; the LLM GENERATOR that proposes
witnesses for patterns we did not hand-code (policy calls `can(user,'read',doc)`, tenant-scoped
clients, RLS) — the actual recall multiplier that turns one verifier into an open-ended sound engine —
is the next layer, riding this same verifier via MCP sampling (offline in tests via a deterministic
stub). (2) Only the SAME-SCOPE (inline) compare is recognized; the interprocedural helper form
(`assertOwner(id, req.user.id)` where the compare lives in the helper) needs the call-site
principal-binding hop and is V2. `tests/bola-witness.test.js` (4 cases) + a killing mutant. Suite 795,
33/33 mutants. No new runtime dependency (still 4).

## ADR-075 — The generate-and-check loop, closed: interprocedural witness + the MCP generator

**Context.** ADR-074 shipped the CHECKER half on the one BOLA idiom it could see inline
(fetch-then-compare in the handler's own body) and named its two open edges: (1) the
interprocedural helper form (`assertOwner(id, req.user.id)` — the compare+deny lives in the
helper, needs the call-site principal-binding hop), and (2) the GENERATOR — the untrusted
proposer that turns one verifier into an open-ended sound engine.

**Decision A — the interprocedural witness (checker V2).** `callBindsOwnershipWitness(call, fn)`
classifies each argument AT THE CALL SITE (the caller's verified identity via `valueIsIdentity`
— the same honesty gate as inline, `req.body.*` is never identity — vs a fetched value), binds
each argument to the helper parameter it feeds, and requires the RESOLVED helper body to deny
behind a compare of exactly those bound params (bare or member-off-param, so
`assertOwnerOf(row, req.user)` comparing `row.ownerId !== user.id` resolves too, including
through an import). Wired into `followCalls`' bare-call branch — per CALL SITE, before the
`seen` dedup — feeding `ownerAsserted` (O7 advisory only, never a guard: E-042 discipline).
Recall needs the call site, soundness needs the helper body; NEITHER alone clears. Adversarial
fixture `ubg-bola-witness-helper`: 2 safe routes discharged, 3 controls stay (spoof identity
from `req.body`; helper that only logs; helper that denies without consulting the
identity-bound param). Corpus: zero drift, zero verdict flips (dub 43 O7 / ghostfolio 2 O7,
measured before/after).

**Decision B — the generator, closed over MCP (`sparda_witness`).** The untrusted generator is
whoever proposes `{route, file, line}` for an O7 advisory: the CALLING AGENT itself (call 1
returns the target list — the prompt material; call 2 carries its hints), or the CLIENT's own
LLM via MCP sampling when the tool is called hintless and the capability exists (bounded
`WITNESS_TOKENS`, the host never pays — Law 1). A proposal buys NOTHING until
`verifyWitnessAt` re-derives the witness from the parsed module at the hinted location with
the very verifiers the static pass trusts (`ifAssertsOwnership` inline,
`callBindsOwnershipWitness` helper form). Three rails make the generator adversarial-proof,
each with a killing mutant:

- **verify-before-admit** (the llm-resolve.js contract, E-022/E-025/E-026 discipline): a
  fabricated location is rejected — `no-witness-at-location`;
- **the attribution TETHER**: the hinted file must be the route's own file or a direct import
  of it — a structurally-real check the route never reaches clears nothing (kills the
  point-every-route-at-the-one-genuine-check move); one-hop by design, an honest
  under-approximation;
- **fail-closed containment**: lexical `../` rejection before any fs access, then realpath on
  both sides (a symlink inside the app cannot smuggle a foreign file), every fs error →
  rejected.
  Every admitted discharge carries `witnessVia: 'generator+verified'` — an LLM-guided clear is
  always auditable and never indistinguishable from a native static clear (same provenance
  posture as `verifiedVia: 'llm-guided'`, ADR-P1/llm-resolve).

**Why the blast radius stays honest-safe.** The whole loop feeds ONLY the O7 advisory — never
a hard rule, never a guard, never the verdict. Even a verifier bug could only drop a
non-gating advisory; it can NEVER make a false PROVEN. And the recall direction is real:
fixture `ubg-bola-generator` holds a route whose genuine check sits behind a variable
indirection the static resolver does not follow — statically flagged forever, discharged in
one generate-and-check round.

**Honest boundary.** The tether is reachability-shaped, not reachability-proven (one hop of
imports, not the resolved call graph); a deeper-but-real witness is rejected (under-approx,
the safe direction). Only the two hand-coded witness FORMS are verifiable — policy calls
(`can(user, 'read', doc)`), tenant-scoped clients, and RLS remain generator targets with no
verifier yet; each new verifier multiplies the same loop. `tests/bola-witness-helper.test.js`
(5) + `tests/witness.test.js` (9); suite 824, 37/37 mutants. No new runtime dependency
(still 4).

## ADR-076 — `sparda enforce`: synthesis under the court (the PROVEN-ENFORCED tier)

**Context.** The type-lock (ADR-070) made PROVEN honest: a clean mutation route whose only
protection is an ASSERTED guard (an opaque middleware SPARDA cannot read) caps the app at
PARTIAL — proved-but-on-trust. The auth catalogs (ADR-069/071/073) shrink that set, but a tail
always remains: home-grown or exotic auth SPARDA will never have a published fact for. Every
other tool stops here ("we cannot verify your middleware"). The Brick #20 spike validated the
third leg: don't just OBSERVE the missing proof — SYNTHESIZE it. SAST observes, RASP imposes;
SPARDA imposes _and proves what it imposed_.

**Decision.** `sparda enforce` (dry-run by default; `--apply` writes; `--revert` undoes;
Express V1). For each type-lock route (`assertedOnlyMutationRoutes` — the SAME walk as the
verdict chokepoint, so enforce can never target a route the lock would not have counted), it
inserts a minimal boundary check into the route's middleware chain, positioned after every
existing middleware and before the handler. The insertion point is the conceptual move: the
Express chain is a dominance spine BY CONSTRUCTION — every chain step dominates the handler
(exactly what `statementSetsBarrier`/guard-dominance already trusts) — so no dominator-tree
computation is needed; we inject where domination is syntactically free. The check itself
(`spardaProvenAuth`) denies with 401 when the authenticated principal is ABSENT (`req.user`
by convention, `--principal` to override; validated against a member-path grammar so the flag
cannot inject code). Legitimate traffic through a working auth middleware is untouched; a
removed or broken auth middleware now fails CLOSED instead of open — the enforcement is a real
security improvement, not verdict cosmetics.

**The court (the invention's core).** After writing, enforce RECOMPILES the app and keeps the
edit ONLY if: the verdict is PROVEN, zero asserted-only mutations remain, and no new findings
appeared. Otherwise every file is rolled back byte-for-byte and the command fails. The
synthesized proof passes the exact same verifier that demanded a proof in the first place —
enforcement that cannot prove itself does not persist. Adversarially pinned: a counterfeit
non-denying shim is rejected by the court and rolled back (test + killing mutant "dissolve the
court"); the shim's own guard node reads VERIFIED because its BODY provably denies, never
because of its name (E-060 discipline — the deny scan does the verifying).

**Reversibility (hard rule #4).** Two edits only: a marker-fenced block (one per file) and a
single unique identifier per route chain. `.sparda/enforce.json` records pre/post content
hashes; `--revert` strips both edits and verifies the result hash equals the pre-enforce hash
— byte-for-byte, tested. `sparda remove` reverts enforcement before deleting `.sparda/` (the
rule-#4 contract extends to synthesized code).

**Disclosure, never upgrade.** `prove` reads the manifest and reports **PROVEN (ENFORCED)** —
strictly MORE information than PROVEN, never less. The manifest can only qualify; it cannot
upgrade: soundness never rests on it. Hand-strip the injected shim and (a) the manifest claim
dies (hash check — killing mutant), and (b) independently, the type-lock drops the app back to
PARTIAL because the verified guard is gone. Two independent honesty rails.

**Honest boundary.** V1 is Express chain-form only (`<app>.<verb>(path, mw…, handler)` with at
least one middleware present — the asserted guard to anchor after); Nest/Next/Python are
follow-ons (same court, different injection grammar). The `--principal` convention must match
the app's auth middleware (documented in the dry-run output; wrong principal = legitimate 401s,
which is why dry-run is the default and the court + revert exist). `tests/enforce.test.js` (8)

- 3 killing mutants; suite 832, 40/40 mutants. No new runtime dependency (still 4).

## ADR-077 — `sparda falsify`: the proof, challenged (Popper as a command)

**Context (the failure mode nobody instruments).** Every sound checker shares one silent
failure mode: the VACUOUS proof — a green verdict that would still be green if the protection
it names vanished, because the checker went blind to that route. E-022/E-025/E-026 (the false
PROVEN, the cardinal sin) were exactly this class, and each was found by accident or by
hand-crafted probe. Fixtures test the blindness we already imagined; nothing tested the
blindness we didn't. Science has a name for the missing instrument: falsifiability. A verdict
you cannot falsify is dogma.

**Decision.** `falsifyGraph` (src/ubg/falsify.js) runs the counterfactual world: every guard
node is ABLATED from the canonical graph in memory and the verifier must re-derive an
UNGUARDED_MUTATION on every route whose green depended on protection — dP/dGuard ≠ 0, route
by route, or the route is a HOLE ("its verdict does not depend on its guards; do not trust
the green there"). Three precision decisions make it an obligation rather than a heuristic:

- **Contraction, never deletion.** A mid-chain guard is contracted (control-flow predecessors
  rewired to successors, carrying the predecessor's route meta), because deleting it would
  disconnect the handler — "unreachable" would masquerade as "clean" and mask a real hole.
  Killing mutant: ablate by deletion → healthy fixtures stop flipping → bites.
- **O1-exact obligations.** A route is a counterfactual obligation iff it reaches a write in
  exactly O1's sense (mutation-edge effect, or opaque db_write — ADR-068) and holds ≥1 guard.
  An http_call-only route belongs to O4's jurisdiction; expecting O1 to fire there would be a
  false hole in the falsifier, not a real one in the checker (measured: the first giant run's
  13 "holes" on dub were exactly this mismatch).
- **Flood-aware attribution.** Ablating every guard at once makes UNGUARDED_MUTATION
  pervasive, so checkGraph collapses it into one codebase-wide row; the falsifier unfolds the
  row's `evidence` back to per-route entrypoints. (The very first giant run read score 0.000
  because of this — the counterfactual HAD fired, on every route at once. The falsifier's
  development falsified itself first; the instrument works.)

**Cost: O(graph), not O(routes × graph).** ONE ablated world, ONE extra checkGraph pass.
Measured: dub (580 routes, 2 829 nodes) — 169 obligations, 169 flipped, **105 ms**;
ghostfolio — 31/31, **8 ms**. 200 counterfactuals on two real apps, 100% falsifiable, in a
tenth of a second, offline, deterministic, zero recompile.

**Direction (honest).** Falsify never upgrades anything: a 100% score adds no PROVEN-ness; a
hole SUBTRACTS trust and exits 1. The suite now carries the healthy-fixture scores as a
PERMANENT negative control: any future refactor that silently makes O1 insensitive to guard
absence (the E-022 class, mechanically) drops those scores below 1 and bites — the meta-
guardian the soundness invariant never had. Adversarially pinned: a frozen (blind) checker
scores 0 (test + killing mutant "report every control as flipped").

**Boundary.** V1 falsifies O1 (the guard obligation) — the verdict-gating rule. The same
surgery generalizes: ablate `where` scopes to challenge O7, validators to challenge O2 —
follow-ons ride the same two-world engine. `tests/falsify.test.js` (6) + 3 killing mutants;
suite 838, 43/43 mutants. No new runtime dependency (still 4).

## ADR-078 — Sequential/conditional rigor: uncertainty breeds caution, never certainty

**Context (a quality audit of the control-graph approximations).** Four approximations let the
engine convert uncertainty into certainty: (1) `app.use()` middlewares were credited with NO
notion of declaration order, though the framework reads setup top-to-bottom — protection could
be fabricated for routes declared before it (false-PROVEN direction); (2) `flattenSetup` erased
control-flow bifurcations — an if-gated registration read 100% active; (3) resource caps
(mount depth 2, flatten depth 6 / 8000 statements) abandoned silently, inflating coverage;
(4) a 0/0 coverage denominator read as 100%.

**Decision — one principle, four mechanisms.** Everything the engine cannot model, order or
read with certainty must DEGRADE the claim and bar PROVEN — through the existing honest
channels, never through new findings (no fabricated criticals, no lost findings):

- **Sequential scope (E-061 + corollary Y1).** Every statement in the flattened setup stream
  carries a formal declaration `order`; routes/mounts/middlewares are stamped; nested mounts
  inherit the TOP mount's position at every depth. `middlewareAppliesTo` refuses credit when
  the middleware is declared after the route — monotone in the safe direction (can only
  WITHHOLD credit).
- **Conditional surface (E-062 + corollary Y2).** Statements reached through a bifurcation
  (if/else, loop body, switch case, catch, ternary branch, `&&`/`||` operand) are marked
  conditional; a conditional registration stays analyzed but raises a HIGH-risk skipped-surface
  blind spot → blindHigh bars PROVEN (PARTIAL at best). Ternary/short-circuit registrations,
  previously invisible, are now discovered.
- **Declared limits + UnknownHandler (E-063/E-065/E-066 + corollary Y3, P3).** Every resource
  cap (mount depth, flatten caps, NEW: 120 s time budget, 5 MB per-file cap) surfaces as a
  skipped entry that enters the coverage denominator; dynamic registrations (computed verb,
  Reflect.apply, .apply/.call) yield structured `UnknownHandler`s + high-risk skips; an
  unparseable entry stays a clean refusal (NO_PROOF).
- **Unknown ≠ 100% (E-064).** Coverage 0/0 is `ratio: null` (measured-but-unknown);
  `verdictOf` bars complete PROVEN on it (`coverageUnknown`), and `coveragePct()` is the one
  formatter every surface uses so "unknown" is said, never a coerced number.

**Why blind spots and not findings.** A conditional guard credited nowhere would fabricate
false UNGUARDED criticals (the adoption-killing direction, G2/Class-1 work); a conditional
guard credited everywhere fabricates false PROVEN (the cardinal sin). The blind-spot channel is
the architecture's existing third way: the element keeps its analyzed behavior, the DOUBT
becomes a first-class high-risk artifact, and the verdict word carries it (blindHigh → never a
bare PROVEN). Skipped entries may now carry an explicit `risk` which `surveyBlindspots` honors.

Suite 868 (+30), mutants 47/47 (+4 killing mutants: order check, if-marking, 0/0, computed
silence). No new runtime dependency (still 4).

## ADR-079 — The registration invariant: an unmodelled member is DECLARED, never dropped

**Context (an adversarial audit).** A red-team pass produced four independent ways to earn a
false `PROVEN` — `app.all` / `app.route()` unmodelled (E-067), an app alias (E-068), a lost
file scored medium (E-069), a computed ORM member (E-070) — plus a fifth found by following the
pattern (a path-scoped middleware credited globally, E-071). They were not four bugs. They were
one defect wearing four masks, and the auditor named it exactly:

> SPARDA measured what it understood, divided by what it understood.

The coverage denominator is built from resolved effects PLUS the failures the extractor
**declared**. A failure it never declared enters neither term — so it does not exist, and the
blinder the engine got, the better its coverage read. An app whose admin surface was invisible
reported 100%.

The previous robustness pass (ADR-078) had already established "every limit reached must emit a
`skipped-surface`" — but it wired that discipline only to RESOURCE limits (depth, statement caps,
time budget). The leak was in the **vocabulary**: a verb we do not model, a variable we do not
follow, a member we cannot name.

**Decision — the registration invariant.** In the Express registration dispatch, a call on an
app/router object is either MODELLED (a route, a mount, a middleware) or DECLARED (an
`UnknownHandler` plus a high-risk blind spot). **There is no silent third option.** Concretely:
no `continue` may leave that loop without registering something or emitting an `UnknownHandler`.
`NON_ROUTE_METHODS` is the single escape hatch, and adding a name to it is a deliberate,
reviewable claim that the member cannot register a route — not an accident of omission.

The invariant is enforced by `tests/registration-invariant.test.js`, which pins both directions:
seven unmodelled shapes each produce exactly one declared unknown, known plumbing produces zero,
an unknown forbids `PROVEN` — and a clean app acquires no phantom unknowns (without that half,
"declare everything" degenerates into "declare noise" and the blind-spot channel stops meaning
anything). A killing mutant removes the declaration and the test bites.

**Two corollaries applied at the same time.**

- **Modelling reality beats inventing a token.** `app.all` is EXPANDED into the modelled verbs
  rather than given an `all` pseudo-verb, because Express really does answer every verb — and
  because a pseudo-verb would silently degrade two downstream organs (`openapi-emit` would write
  an invalid operation, `mirror` would never match a real request).
- **Effect blindness is registration blindness.** A route that is visible but whose WRITE is not
  looks like a harmless no-op, which reaches the same false green by a different door (E-070).
  The opaque-write net is therefore extended to computed members, rooted at a proven handle.

**Z5 rides along (E-072).** The same audit measured reachability at O(routes²) with THREE
hand-written copies of one BFS. Consolidated into `ubg/reach.js` with a route-partitioned index,
a cursor queue and topology-stamped memoisation: 16 010 000 → 14 000 edge visits at 4 000 routes,
byte-identical output (successor order is preserved by rank-merge, so the index is a speed change
and never a semantic one).

Suite **898** (+30), mutants **54/54** (+7), 4 deps, no new runtime dependency.

## ADR-080 — The sealing certificate: the invariant, swept over the corpus

**Context.** ADR-079 stated the registration invariant and pinned it with one synthetic
fixture. That proves the rule holds where it was written down; it does not prove there is
no OTHER place the extractor loses something. The final audit pass went looking, and found
seven more silent losses — five of them composable into a false PROVEN:

| shape | what was lost |
|---|---|
| `app.use('/admin/wipe', handler)` | the endpoint (C3, E-073) |
| the same inside a mounted router | the endpoint, gated behind `depth === 0` |
| `prisma?.note?.deleteMany()` | the write (optional member, E-074) |
| `prisma.note.deleteMany?.()` | the write (optional call) |
| `` prisma.$executeRaw`DELETE …` `` | the write (tagged template is not a call node) |
| `(cond ? a : b).deleteMany()` | the write (unnameable receiver) |
| `app?.post(…)` / `app.post?.(…)` | the registration (E-075) |

**Decision — three rules, applied uniformly.**

1. **Known semantics are MODELLED, not declared.** Optional chaining is the same call
   whenever the object exists; `app.all` really does answer every verb; a pathed callable
   that never references its continuation really is terminal. Declaring an `UnknownHandler`
   where the semantics are known would be a cop-out that trades a silent loss for a loud
   one — the blind-spot channel is for genuine uncertainty, not for work not done.
2. **Uncertainty is DECLARED.** An opaque body at a path, a dynamic route path, a computed
   member, a lost file: each raises an `UnknownHandler` and a high-risk blind spot.
3. **Recall on a GUARD requires a matching rail.** Making `router.use(auth)` visible is a
   false-positive fix, but crediting a guard is the dangerous direction — so it shipped
   with `orderIn` (intra-file position) and a fixture that pins the route ABOVE the guard
   still flagging. A fix that manufactures a PROVEN is worse than the bug it removes.

**The certificate (`tests/no-silent-loss.test.js`).** The invariant is now swept over
EVERY Express fixture in the repo by an INDEPENDENT enumeration: its own Babel walk, its
own app/router-variable detection, its own plumbing allowlist — deliberately a second
implementation, because checking the extractor against itself is a tautology. For each
fixture, every call on an app/router object must be a modelled verb, known plumbing, or
carry a declared `UnknownHandler` at that line. It also asserts the sweep is non-vacuous
(≥ 15 fixtures found) and that the canonical clean fixtures declare ZERO unknowns —
without that second half, "declare everything" is trivially satisfiable by declaring
everything, which would drown the channel that makes the verdict honest.

**Honest scope of the claim.** The certificate proves no silent loss over the *known*
Express and Prisma/SQL shapes present in the corpus, enforced structurally rather than by
review. It does not prove the absence of shapes nobody has written down yet — no static
tool can. What changed is the failure mode: a shape SPARDA does not model now shows up as
a declared blind spot that bars PROVEN, instead of vanishing into a green verdict.

Suite **972** (+74 over the audit baseline), mutants **61/61** (+14), 4 deps.

## ADR-081 — The premise verifier: checking the given, not only the proof

**Context — a diagnosis before a decision.** Grading our own claims produced an
uncomfortable measurement: SPARDA had a verifier for the PROOF and none for the PREMISE.
Guard dominance, the type lock, the blind-spot ledger, `falsify` — every one of them
reasons over the graph, so every one of them is blind to the same thing: a route that is
not in the graph. `falsify`, the instrument built precisely to challenge a green verdict,
could not have caught a single one of the five false PROVEN verdicts this audit found,
because you cannot ablate the guard of a route that does not exist.

The premise is the claim made before any proof: *these are the app's entrypoints*.
Nothing checked it. It was faith.

**Decision.** Check it against an oracle that is not the analyser: the application itself,
booted, reporting the route table the framework really built. `src/probe/` had held that
oracle all along — and had captured `app.all` since long before the extractor modelled it,
which is to say the runtime knew what the static eye did not, and nobody asked it. It fed
route GENERATION and never the verdict. `src/ubg/premise.js` makes it the gate.

A gap — a route the framework serves that the compiler never saw — is not a blind spot
inside the analysis. It is measured evidence that the analysis had the wrong subject. So:

- it enters the blind-spot ledger at CRITICAL risk (coverage denominator, ranked map — one
  channel, no special case);
- it yields a new verdict state, `PREMISE_GAP`. Not PROVEN, and deliberately not
  PROVEN (PARTIAL) either: both claim something about an app whose surface we
  demonstrably did not have. PARTIAL means "proved what was seen"; a premise gap means
  "what was seen was not the app";
- it fails the CI gate. A green over routes nobody analysed is precisely the failure mode
  three sessions of this audit were spent removing.

**Three rails, each with a killing mutant.** The oracle is OPT-IN (`--probe`), because it
executes the target's code and that is the user's call, never a silent side effect. An
oracle that could not run leaves the verdict exactly as it was — SPARDA never demands what
it could not measure, and never rewards a failure to measure. And an EMPTY probe result is
reported as *unavailable*, never as "no gaps": `probeRoutes` returns `[]` on internal
failure, so reading that as a clean bill of health would let a BROKEN oracle silently
confirm every proof — the worst possible direction.

**What this does and does not buy.** It closes the absence class for probeable frameworks:
a route the app serves can no longer be missing from the verdict without the verdict
saying so. It buys nothing for frameworks the probe cannot boot (Nest, Next, Medusa,
Strapi report `available:false`), and it proves nothing positive — a probe that finds no
gaps has removed one way of being wrong, not established correctness.

**Shipped alongside (E-077/E-078):** the ghost-verb class closed on the other four
lowerings, and NestJS given the `unknownHandlers` channel — the registration invariant
(ADR-079) reaching its second framework. Modelling OPTIONS/HEAD/TRACE forced a correctness
fix in the same commit: mutation is now decided by the RFC 9110 safe-method set, not by
`method !== 'get'`, or every CORS pre-flight handler would have become a false critical.

Suite **991** (+19), mutants **66/66** (+5), 4 deps.

## ADR-082 — Two oracles for one premise: the boot-free one runs unasked

**Context.** ADR-081 gave SPARDA a premise verifier: before asking whether the proof holds,
ask whether the proof was about the whole app. Its oracle was the running app, which is the
strongest one available — and unavailable for four of seven lowerings. Next, Medusa, Strapi
and Nest cannot be booted from a static checkout, so they reported `available:false`. The
organ that closes the absence class covered 3/7 of the product.

**Decision.** A second oracle, `src/ubg/oracle-static.js`, that derives the route table from
what the framework routes ON: the shape of the project. For Next and Medusa that is literally
the filesystem (`app/x/route.ts` → `/x`); for Strapi it is the literal `{ method, path }`
pairs in the route tables; for Nest it is the decorators, re-read by a walk that pre-filters
nothing.

**The independence rule.** `oracle-static.js` may not import an extractor. It shares
`@babel/parser` with them and nothing else. An oracle that reuses the analyser's walk is not
an oracle, it is a mirror: a bug would be reproduced faithfully on both sides of the diff and
the comparison would CONFIRM the bug. This is the same rule the sealing certificates follow
(ADR-080), promoted from the test suite into the product.

**Conservatism is the contract, and it decides the design.** A false gap costs a healthy app
its verdict, and a tool that does that gets switched off within a week. So every rule answers
"would the framework DEFINITELY serve this?", never "probably", and every ambiguous convention
is left out rather than guessed at: Strapi's core routers (reproducing its pluraliser would be
a guess), Next's parallel slots and catch-alls, a computed controller prefix. Those shapes are
already carried by the blind-spot ledger; the oracle's job is only surface nobody carried at
all. Measured on the corpus: 27 convention-routed fixtures, 26 of them healthy, exactly 1 gap
— in the one fixture built to have one.

**The boot-free oracle runs UNASKED.** The runtime oracle is opt-in because it executes the
target's code — that is the user's call. The convention oracle only reads directories, so
withholding it behind a flag would be withholding a free honesty check, and a check that has
to be requested is a check nobody runs. Every `prove` on the four now prints either a
measured `0 gap(s)` or a `PREMISE_GAP` and exit 1.

**A declared hole is not a gap.** Surface the extractor already declared (`unknownHandlers`)
is suppressed from the oracle's input, keyed on file AND verb — never file alone, or one
unreadable export would blind the oracle to every other export in the module. Two names for
one problem inflate the count and teach a reader to discount both.

**What it found immediately.** `app/dist/route.ts` (E-081): Next serves it at `/dist`, and
the extractor's directory filter dropped it with no route, no skip and no unknown handler —
invisible on all three channels, which no invariant about *seen* registrations could catch.
And Next's Pages Router (`pages/api/**`), still fully served by Next 14 and with no SPARDA
lowering at all: previously a total silence, now a measured premise gap.

**OpenAPI has no oracle and never will.** There, the spec IS the premise. The only second
source of truth would be the app it claims to describe, which SPARDA does not have.

Suite **1085** (+94), mutants **77/77** (+11), 4 deps.

## ADR-083 — One premise call, every gate: a guarantee is not partial, it is universal or false

**Context.** ADR-081 and ADR-082 built the premise verifier and its two oracles, and wired
them into `prove`. An audit of the merged tree found the obvious thing nobody had checked:
seven commands emit a verdict, and **six of them never asked**. `apocalypse` — whose exit
code is the CI deploy gate, and which the README pitches on its first line — could still
exit 0 over an app whose route table nobody had verified. `badge` could still emit a green
SVG for a public README.

**The lesson, stated plainly, because it is the expensive one.** A safety property that
holds on one consumer out of seven is not 1/7 of a guarantee. It is a FALSE guarantee, and
strictly worse than no feature at all: the ADR, the docs and the release notes all claimed
"SPARDA no longer certifies what it has not seen", so the sentence was believed everywhere
while being true in exactly one place. Building an organ and wiring it into one caller is
not shipping it.

**Decision.** One shared entry point in `premise.js` —

```js
const premise = await premiseFor(canonical, report, { cwd, probe });
const blind   = surveyBlindspots(canonical, withPremiseGaps(report, premise));
```

— called by `apocalypse`, `badge`, `dossier`, `review` and `prove`. Not a convention: a
single code path. Four duplicated lines per command is exactly how one of them silently
drifts, and the drift is invisible because each command's own tests keep passing. The
opt-in boundary lives INSIDE the helper, so it cannot be got wrong per caller: the runtime
oracle executes the target's code and requires `--probe`; the convention oracle reads
directories and always runs.

**Deliberately excluded, and why.** `enforce` and `heal` emit a verdict about a DELTA —
"did synthesizing this guard introduce anything", "did this replay regress" — not about the
app. A premise gap fed into either would make them refuse to act on any app that has one,
which is precisely backwards: enforcing a guard on an incompletely-seen app is still the
right move. `prove` stays the authority on the app-level word, and it reads `enforce`'s
manifest. The exclusion is a named, two-item allowlist in the test, not a silent gap.

**Sealed by a rule, not a list.** `tests/premise-wired-everywhere.test.js` scans
`src/commands/` and fails when any module that grades a compiled graph does not call
`premiseFor`. Pinning today's five commands would only re-prove the fix; pinning the rule
is what stops the eighth command from repeating it. A second assertion keeps the scan from
passing vacuously if the detection ever stops matching.

**Two bugs the wiring surfaced, neither of which was being looked for.** `badgeFor` had no
`PREMISE_GAP` branch, so the public badge read **"0 findings"** on an app whose surface we
demonstrably did not have (E-084) — the colour was already right, which is what hid it. And
`reviewGraphs` graded the GRAPH with no report at all, so the PR gate never saw a single
skipped surface: a pull request that made a whole file unparseable reviewed exactly like one
that changed nothing (E-085). Both are the same shape as the bug being fixed — a channel
that exists and is not read — which is the argument for the structural test over a list.

Suite **1094** (+9), mutants **81/81** (+4), 4 deps.

### Amendment (2026-07-27) — the rule was scoped to a directory; the corpus replay

Sealing the fix with a rule was right; scoping the rule to `src/commands/` reproduced the
very defect it sealed one level up. Widening the scan to `src/`, `scripts/`, `bench/`,
`tools/` found **two more graders nobody had counted** (E-086): `proveApp` in
`src/server/stdio.js` — the `sparda_prove` MCP tool, i.e. the one consumer that acts on the
verdict word without reading the code — and `bench/repro.mjs`, which writes a verdict into
the committed evidence file the README cites. Both now call `premiseFor`, as does
`scripts/corpus-oracle.mjs`. A grader is now identified by its IMPORT of `verdictOf` /
`badgeFor` from `apocalypse.js`, so the definer is not mistaken for a consumer and no future
grader is excluded by name; each exemption carries a reason and is machine-checked (a module
exempted for stating no verdict word fails the suite the moment it states one).

**The corpus replay, which is what made this real.** The seven giants were re-cloned and
re-measured with the premise wired. The effect was isolated by grading each tree TWICE —
premise off, premise on — so the premise's contribution could never be confused with
upstream drift:

| app | oracle | enumerated | gaps | verdict |
|---|---|---|---|---|
| dub | convention | 591 | 0 | NOT_PROVEN |
| novu | convention | 365 | 0 | PARTIAL |
| cal.com | convention | 1 | 0 | NOT_PROVEN |
| twenty | convention | 122 | 0 | NOT_PROVEN |
| immich | convention | 235 | 0 | PARTIAL |
| **nocodb** | convention | 78 | **1** | **PREMISE_GAP** |
| ghostfolio | convention | 115 | 0 | RISKY |

Every lowering in the corpus has an oracle; six contradict nothing. **nocodb — the app that
carried the repository's only `PROVEN` on real code (338 routes, 127 writes, 90.2 %, zero
findings) — is `PREMISE_GAP`,** on a named route the framework serves and the compiler never
saw: `POST /auth/google/genTokenByCode`, a login endpoint (root cause E-087). That claim is
retired by measurement. **The corpus now contains no `PROVEN` at all**, which is the honest
state of the product on code it did not write, and the first corpus baseline in which that
statement means anything.

Two pins added because the replay showed they were missing: `premiseOracle` /
`premiseProbed` / `premiseGaps` per app (an oracle that silently goes UNAVAILABLE is a
regression in the honesty organ itself, and pinning only the gap count would read that
failure as good news — and "0 gaps" means something very different at 591 routes enumerated
than at cal.com's 1), and `_pinned: {commit, date}` per app, so a drift can be attributed
before it is believed (E-088).

Suite **1099** (+5), mutants **83/83** (+2), 4 deps.
## ADR-084 — A decorator is what it DOES, not what it is called

**Context.** The corpus replay left seven giants and no `PROVEN`. Grading the *reasons*
rather than the verdicts found one dominant, mechanical cause: on novu, **1003 guard steps,
71 verified (7 %)**, and the 932 unverified were exactly **four decorator names**.

The A/B that named it: immich, same framework, **459/459 verified**. immich registers its
guard globally (`APP_GUARD`), which SPARDA already proves once and credits app-wide. novu
applies its guard **per controller**, through NestJS's official composition API:

```ts
export function RequireAuthentication() {
  return applyDecorators(UseGuards(CommunityUserAuthGuard), ApiBearerAuth(…));
}
```

SPARDA matched `RequireAuthentication` against the auth-name regex, recorded an ASSERTED
guard, and stopped — guard resolution opens a CLASS, and this symbol is a FUNCTION. The
`canActivate` two hops away extends `@nestjs/passport`'s `AuthGuard` **and** throws
`UnauthorizedException`: the proof chain existed end to end, and the first link was
unwalkable.

**Decision.** Resolve a decorator NAME to its declaration and read what it applies.
`applyDecorators(UseGuards(X))` → X, then the existing class resolution proves X. This is
the same principle as E-060 (`@Author` is not auth because its BODY reads user input),
applied one level up: **a decorator is what it does, not what it is called.**

**The same read settles the opposite error.** `RequirePermissions` is
`SetMetadata(PERMISSIONS_KEY, …)` — a tag some guard reads elsewhere, gating nothing on its
own — and its name matched the same regex, so 221 more novu routes carried protection that
was never there. Dropping it is Direction 2 in the safe direction: removing invented
protection can only ADD findings.

**The trap that nearly shipped, and the rule it produced.** A blanket "SetMetadata is not a
guard" **deletes immich's entire auth model**: `@Authenticated = () => applyDecorators(
SetMetadata('authRoute', true))` is the dominant Nest idiom, where the tag is the route's
OPT-IN to an app-wide guard that reads it. The blanket rule vanishes 253 verified guards and
invents 253 unguarded routes. So the drop is **conditional on the app registering no global
guard proven to deny**. Caught by a test written two sessions earlier for a different
feature — the argument for keeping end-to-end fixtures around after their ADR ships.

**Branch semantics, stated because it is the soundness-critical part.** A composite may be
a factory with runtime branches (`if (isEEAuthEnabled())`). Guards are collected as the
**union** over every branch — a guard applied on one branch is still a guard the app can
apply — and a branch whose returned decorator SPARDA cannot read is **DECLARED at high
risk**. Crediting the branch we read is a true statement about *that* configuration;
claiming the app is proven while a sibling configuration went unopened is not. So novu's
340 guards are credited AND novu can no longer reach PROVEN on their strength — both halves
are true, neither over-claims.

**Two implementation traps, both found by measurement rather than reasoning.** A constituent
is imported by the module that DECLARED the composite, never by the controller that used it
— resolving against the controller's import map degenerates the expansion into a rename
(the first working version produced 340 guards and **0** proofs). And a monorepo import
lands on a BARREL (`export * from './decorators'`) that declares nothing and records no
named import; following `starReexports` is the difference between reading a workspace
package's decorators and seeing none of them.

**Measured, isolated (same clone, same commit, extractor swapped):**

| | guards | verified | routes | coverage | findings |
|---|---|---|---|---|---|
| novu before | 1003 | **71** (7 %) | 451 | 14.8 % | 25 |
| novu after | 782 | **411** (53 %) | 451 | 14.8 % | 25 |
| immich before/after | 459 | 459 | 281 | 55.9 % | 7 |

immich is byte-identical — the non-regression witness that the change reads a new idiom
without disturbing the one that already worked.

Suite **1111** (+12 sur la #29), mutants **88/88** (+5), 4 deps.
## ADR-085 — Match the brand by SUFFIX, and register every path a decorator names

**Context.** The brief for twenty was "one rule, 14× IRREVERSIBLE_OBSERVABLE, stands
between it and a clean verdict". Measuring first inverted it:

| | before | after |
|---|---|---|
| files parsed (of 6090) | **33** | 128 |
| routes | **147** | **579** |
| guards / verified | 441 / 157 | 1868 / 583 |
| findings (high) | 14 (2) | 65 (28) |

SPARDA was reading **a quarter of the application**. "One rule" was an artefact of
near-total blindness, and the honest outcome of this work is that twenty gets **worse**,
not better — which is the correct outcome, because the extra findings are real.

**Decision 1 — the pre-filter matches a SHAPE, not a vocabulary.** `CANDIDATE_RE` listed
decorator names; twenty registers 54 resolvers as `@MetadataResolver` / `@CoreResolver` /
`@AdminResolver` and exactly one as `@Resolver`. A house brand is the norm. Matching the
SUFFIX (`[A-Za-z]*Controller`, `[A-Za-z]*Resolver`) is what `controllerPrefixOf` already
did for controllers — ADR-055's rule ("recognise the protocol, not the brand") had simply
never reached the pre-filter or the class-admission check.

Deliberately **not** widened to `Mutation|Query|Subscription`, despite those being the
GraphQL operation decorators: they are also PARAMETER decorators (`@Query('id') id:
string`) in ordinary REST controllers, and measured on twenty they buy one extra file out
of 6090. A class exposing a GraphQL operation carries a Resolver-suffixed brand, which the
suffix already catches. 33 → 128 files, 4.0 s for the whole monorepo.

**Decision 2 — a decorator registers every path it names.** `@Post(['a','b'])` is one
decorator and two live routes. Reading `args[0]`, seeing an `ArrayExpression` and falling
back to the controller prefix collapsed four of twenty's webhook controllers onto a
phantom `POST /` — the route that carried the two findings holding its verdict.

The obvious fix is the trap: `elements.find(isStringLiteral)` reads one path and drops the
rest, losing a live endpoint in silence — ADR-079 violated by the change meant to honour
it. One route per element; a mixed array routes its readable elements and DECLARES the
unreadable one at high risk.

**What this refuses to do, and why.** The draft that opened this chantier proposed
suppressing the webhook findings on the grounds that a signature-verifying webhook driven
by an external orchestrator is *self-compensating*: Stripe receives a 500 and retries, and
`subscriptions.cancel` / `invoices.pay` are idempotent, so a failed write is recovered.

The reasoning is sound as an ARGUMENT and inadmissible as a RULE. It rests on three
premises SPARDA cannot verify from the code in front of it: that the orchestrator retries,
that this handler surfaces a write failure as a 5xx rather than swallowing it, and that
the external call is idempotent. Crediting compensation SPARDA has not seen is inventing
protection — SOUNDNESS Direction 2, in the forbidden direction — and it is the same
"trust the convention" epistemology ADR-084 had just removed one layer down. A suppression
rule built on inference about an external system is the one kind of change this codebase
may not make on reasoning alone.

The correct handling was the parsing fix: the findings did not disappear, they moved to
the routes that actually serve them (`POST /webhooks/stripe`, not `POST /`). Whether a
webhook's retry path constitutes compensation is a question for a future rule that PROVES
its premises — a 5xx on the failure path, an idempotency key on the external call — not
for a name-based exemption.

**Corpus, decomposed** (E-088's `_pinned` earning its keep a second time): twenty's clone
sits on `590ae069` while the baseline was pinned at `e631c986`, so its drift is mixed. The
pin move alone accounts for `coverage 81.6 → 81.4` (measured on this clone BEFORE the
change); everything else — routes 147 → 579, guards 441 → 1868 — is this change. Re-pinned
and re-baselined so the move is visible in the artefact instead of left drifting. nocodb
sits AT its pin and gains too: routes 358 → 566, coverage 40.3 → 47.7. novu, immich and
ghostfolio are untouched.

Suite **1119** (+8), mutants **92/92** (+4), 4 deps.

## ADR-086 — A finding's unit is the REMEDIATION, not the effect node

**Context.** After ADR-085 opened twenty properly, it read 28 high findings across 14
routes — and ONE route carried **12** of them. `POST /graphql/sendEmail` resolves through
a provider-strategy DI graph into Gmail / Microsoft / IMAP-SMTP / email-group senders;
each leaf is its own effect node, and `IRREVERSIBLE_OBSERVABLE` emitted one finding per
node. **43 % of the app's high findings were one problem counted twelve times.**

`collapseFloods` (ADR-071) already encodes the principle — a signal that repeats loses
contrast — but it folds a rule firing across MANY ROUTES into a codebase-wide summary. It
has no notion of the same rule firing many times on ONE route, which is exactly what a DI
fan-out produces.

**Decision.** One finding per (route, rule) for `IRREVERSIBLE_OBSERVABLE`. The unit of a
finding is the unit of its REMEDIATION: fixing this rule means wrapping the send and the
write together, or adding an undo — a per-ROUTE change. Reporting per leaf described the
analysis's internal resolution depth, not the user's problem.

**The line this must not cross.** It is a CONTRAST fix, not a suppression, and three
properties make the difference auditable:

1. the same routes stay flagged — verified on twenty, the 14 routes before and after are
   IDENTICAL, only the count changed (28 → 14; nocodb 22 → 13);
2. severity is the strongest of the collapsed set, so the gate reads exactly as before;
3. every call is named in the message and every node stays in `evidence` — Direction 1's
   "an effect is in the graph or it is traced" holds twice over here.

**The rung that had to survive it.** Innate immunity (ADR-072): a generic external call is
an advisory `info`, never a hard finding. Collapsing several advisories may not manufacture
a `high`. A route carrying both kinds reports once at the hard severity — splitting them
would put the same route on two lines saying the same thing twice. Killing mutant included.

**What this does NOT do.** twenty still reads NOT_PROVEN, with 14 high findings on 14
routes — every one a real saga hole in its billing (Stripe) or messaging code, including
`POST /graphql/deleteCurrentWorkspace`. Honest counting made the report readable; it did
not make the app safe, and it was never supposed to.

Suite **1128** (+9), mutants **95/95** (+3), 4 deps.

## ADR-087 — The release is an artefact, and it gets a gate of its own

**Context.** v0.69.0 was published from a commit that was not the head of what was being
merged. It carried ADR-084 and neither ADR-085 nor ADR-086, so for four hours the package
on npm analysed a NestJS app with house decorator brands at a quarter of its size — the
exact Direction 3 violation the three sessions before it had removed from the codebase.

Nothing was broken. **Every test passed at the commit that was published.** `prepublishOnly`
ran `vitest run`, and `vitest run` was green, because the defect was never in the CODE: it
was in *which commit* got published, and in the release artefacts nobody updated — the
CHANGELOG had no 0.69.0 entry, and no tag had been pushed since v0.68.0, leaving two
releases with nothing to check out.

This is the project's own contract turned on the project. SPARDA exists to say that
"we could not measure" and "we measured nothing wrong" are different states. A green suite
is a statement about a TREE; a release is a statement about a PUBLISHED ARTEFACT. Reading
the first as the second is the same substitution, one level up from the code.

**Decision.** `prepublishOnly` runs `scripts/release-gate.mjs`, which asks the questions a
release actually fails on — and which a passing suite cannot answer:

| | catches |
|---|---|
| tree clean, on `main`, HEAD ≡ `origin/main` | a release cut mid-flight — 0.69.0's root cause |
| version absent from the registry | a forgotten bump, then "why did the fix not ship?" |
| `server.json` (×2) + `glama.json` agree | a partial bump: a grep finds the first copy and reports agreement |
| a `## [version]` CHANGELOG heading | a release nobody wrote down is a release nobody can audit |
| `v<version>` exists and points at HEAD | the drift since v0.68.0; a tag naming the wrong bytes is worse than none |
| suite green, mutants dead, corpus undrifted | the ordinary bar, restated where it is enforced |

**No escape hatch, deliberately.** A gate that can be talked out of a check gets talked out
of it, and the one release that skips the gate is the release that needed it. If a check is
wrong, the check gets fixed. This is a claim about INPUTS, not about strings: the gate reads
no `process.argv` and exactly one environment variable, `SPARDA_CORPUS`, which can only ADD
the corpus check. Both are asserted by tests, because the gate's own header contains the
word `--force` in order to refuse it — a grep cannot tell a check from a comment about one.

**The decisions live apart from the I/O** (`scripts/release-checks.mjs`, pure). A gate that
exists only as a script can only be tested by grepping its source, and a text assertion dies
the first time a message is reworded while the check itself rots. Pure functions can be
handed the exact state 0.69.0 was released from and required to refuse it — which is what
`tests/release-gate.test.js` does, mutant-backed, for every row of the table above.

**Where it is honest about its own limits.** Two checks can fail to be *measurable*, and
both say so instead of printing a tick: the corpus without clones is `SKIPPED`, and an
unreachable registry is `UNVERIFIED (not a pass)` — distinguished from `E404`, which is the
desired state and passes. The rule the codebase turns on does not get suspended for the
codebase's own tooling.

**What this does not do.** It cannot make a release correct; it can only refuse one that is
demonstrably not what was reviewed. 0.69.0's contents were fine at their own commit — the
gate's whole subject is the distance between that commit and the one that shipped.

Suite **1145** (+17), mutants **100/100** (+5), 4 deps.

## ADR-088 — A class is looked up THROUGH barrels, exactly as a function already was

**Context.** novu read `PARTIAL` with **0 findings** and 14.8 % coverage. The brief was
"raise the coverage". The measurement said something else: of **2039 constructor-DI hops,
1479 resolved to nothing** — `PinoLogger` 307 times, then `IntegrationRepository`,
`EnvironmentRepository`, `SubscriberRepository`, every repository the app writes through.

All of them failed the same way. A monorepo package (`@novu/dal`,
`@novu/application-generic`) resolves to its entry file, and that entry file is a
**barrel**: sixty `export * from './repositories/…'` lines and not one class declaration.
`classInModule` looks for a class DECLARED in the module it was handed, found nothing, and
returned null.

`resolveExportedFunction` has crossed barrels since the `lib/auth/index.ts` era — a route
importing a helper from a barrel resolves fine. **Classes never got the twin**, so the
entire DI half of the resolver stopped at every workspace package in every monorepo.

**Decision.** `resolveExportedClass` — the class twin, same shape, same `seen` bound: the
class as declared here, else through a named re-export, else through each `export *`.
Memoized per (module, class name) in the resolver, because a sixty-line barrel is
otherwise re-walked once per hop.

**Why this is a soundness fix and not a precision one.** A route whose only behavior lives
behind the barrel resolves to **zero behavior**, and a route with zero behavior has nothing
to flag. The fixture states it exactly: `POST /orders/purge/:tenant` deletes every order of
a tenant with no guard, and before this change it produced **no finding at all**, at
coverage `unknown` (0/0) and verdict `SURFACE`. Blindness that reads as an empty route is
the one shape of imprecision that pushes the verdict the unsafe way — the same family as
E-092, where a file that is never opened produces no route, no skip and no unknown handler.

**Measured, isolated** (same clones, same pinned commits, resolver permuted — the whole
corpus run twice):

| | before | after |
|---|---|---|
| novu verdict | PARTIAL | **NOT_PROVEN** |
| novu db writes | 52 | **132** |
| novu db reads | 792 | **1464** |
| novu findings | 0 | **4** (advisories 12 → 15) |
| novu coverage | 14.8 % | 15.1 % |
| twenty / immich / nocodb / ghostfolio | — | **byte-identical** |

**novu got WORSE, and that is the result.** Its clean `PARTIAL` was resting on 80 database
writes its routes perform and SPARDA could not see. Coverage barely moved — opening the
repositories reveals their own unresolved calls too — which is the honest answer to "raise
the coverage": the number was never the problem, the missing subject was.

immich unchanged is the control that makes the claim narrow: same framework, same
extractor, no unbuilt workspace barrels, no drift. The change reaches what it was aimed at.

**What is still open.** 750 of novu's blind spots are `.execute(command)` calls on injected
use cases, recorded as `db_read` with an unknown table — the raw-SQL fallback fires on the
method NAME with no database provenance, so a CQRS app's every DI hop is charged as an
unreadable query. Fixing the label is not enough on its own: the phantom is currently the
only trace an unresolved hop leaves anywhere, so it must be replaced by a real
`unresolved-call` blind spot in the same change, never simply deleted (Direction 1).

Suite **1152** (+7), mutants **102/102** (+2), 4 deps.

## ADR-089 — The auth a decorator scan cannot see: MiddlewareConsumer.forRoutes()

**Context.** A NestJS module can gate its routes without a single `@UseGuards` on the
controller — by registering middleware in its own `configure()` method:

```ts
export class ArticleModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(
      { path: 'articles/:slug', method: RequestMethod.DELETE }, …);
  }
}
```

The controller carries no guard decorator, so SPARDA's per-method scan read the mutation as
UNGUARDED and fired a CRITICAL. Measured on `lujakob/nestjs-realworld-example-app`: 7 hard
findings, **4 of them false** — the routes ARE authenticated by `AuthMiddleware`, bound from
the module, not the controller. This is the middleware twin of the `APP_GUARD` global-guard
detection (ADR-055's global path): the guard is real, it just lives one file from the route.

**Decision.** Read the binding once, in the module, and attach the guard to every route it
PROVABLY targets. Two grades, matching SPARDA's asserted/verified split:

1. **Asserted (name-trusted).** An auth-named applied middleware matched to a route becomes an
   ASSERTED guard (ADR-063) — enough to clear the false UNGUARDED critical, never enough for
   PROVEN on its own.
2. **Verified (deny-proven).** When the middleware's `use()` resolves through DI to a real deny
   (a 4xx throw / `res.status(401)`), the guard reads VERIFIED and the mutation reaches PROVEN
   — the same proof the global-guard path already earns. Proof beats name: a proven denier is a
   guard whatever it is called; a middleware that proves no deny must be auth-named to attach
   even asserted.

**Soundness.** Attaching a guard DOWNGRADES a finding, so a binding matched to a route it does
not cover would HIDE a hole (SOUNDNESS Direction 2). Three disciplines keep it honest:

- **The matcher never over-covers.** A target `:param` covers a route segment (literal or
  param); a target literal never covers a route `:param` (the route serves URLs the literal
  misses); a shorter target never covers a deeper route, and the method must match. So
  `forRoutes('user', GET)` does NOT cover `DELETE /users/:slug`.
- **Unreadable is declared, never guessed.** A computed path, a spread, an `exclude()` we
  cannot parse — matches NOTHING and is recorded as a high-risk blind spot. An under-match is a
  surfaceable false positive, the safe direction.
- **A non-guard middleware never softens.** A `LoggerMiddleware` bound via forRoutes is neither
  auth-named nor deny-proven, so it attaches no guard and its destructive route keeps its
  critical.

**Measured on nestjs-realworld** (same clone, same commit, extractor permuted):

| | before | after |
|---|---|---|
| O1 criticals | 7 | **3** |
| false criticals (article mutations) | 4 | **0** — now PROVEN-guarded |
| `AuthMiddleware` guard nodes verified | 0 | **12 / 12** |
| real `DELETE /users/:slug` (no auth) | drowned in 7 | **stands out in 3** |

The 4 false positives clear AND become PROVEN; the two remaining non-article criticals are
honest (`GET /articles` public browse, `POST /users` public registration), and the genuinely
unguarded `DELETE /users/:slug` — deletable by anyone — stops hiding in the noise. The floor
(stop crying false) and the ceiling (prove the guard, surface the real hole) in one change.

Suite **1157** passing, mutants **106/106** (+4), 4 deps.

## ADR-090 — The editor may help you install, and may never help you silence

**Context.** The 0.70.1 extension was correct and unfriendly. A missing CLI produced an honest
error and a dead end; the status bar had one action whatever the state; and the brief asked for
three more things — an install button, a walkthrough, and "Quick Fixes that suggest invoking
the AI to fix the finding."

Two of those are pure UX. The third is a security decision wearing UX clothes, and this ADR
exists mostly to write down why it was answered differently than asked.

**Decision, part 1 — the install button, and its narrow condition.** A missing CLI is the one
failure a user can fix in a click, so it earns one. Three properties make it defensible:

- **A visible terminal, never a background install.** An install can prompt, fail, or take a
  minute — unreadable from a spinner, obvious in a terminal. And a security tool that silently
  downloads and executes a package because a button was clicked has borrowed the exact habit it
  exists to argue against. The command is shown; the user can read it, stop it, or copy it.
- **The package manager comes from the lockfile**, not a guess. `npm i` inside a pnpm workspace
  creates a second, divergent `node_modules`, and the user ends up debugging a tree they never
  asked for. Evidence on disk decides.
- **Always `-D`, never `-g`.** The version that PROVES the code must be the version the project
  pinned, or two machines on the same commit can disagree. Killing mutant included.

**And it is offered only when installing is genuinely the remedy.** A configured
`sparda.command` pointing at a path that does not exist fails with `ENOENT` — the same word an
absent CLI produces. Installing `sparda-mcp` would not fix that setting. So the remedy is
decided by WHERE we were pointed (`cli.source === 'npx'`, i.e. we fell all the way through),
never by what the error text said. **A button offering the wrong remedy is a wrong answer
delivered with more confidence than a plain error message.**

**Decision, part 2 — the lightbulb explains; it does not fix.** A `Quick Fix` in VS Code carries
a promise: apply this and the problem is gone. A SPARDA finding says an **authorization decision
is missing** — who may touch what — and that decision belongs to a human. There is no mechanical
repair, and a lightbulb implying one invites the single most dangerous edit available: silencing
the finding rather than closing the hole. SPARDA would then read `PROVEN` over a real hole,
**through its own UI**. That is the product's core failure mode, delivered by its most
convenient affordance.

So the code actions are `explain` (the evidence chain) and, on `UNGUARDED_MUTATION` only,
`enforce` — **as a dry run**. `enforce` is the one "fix" that cannot lie: it inserts a boundary
check, recompiles, and keeps the edit ONLY if the app then proves `PROVEN`, reverting
byte-for-byte otherwise (ADR-076). It is a fix that re-derives its own result instead of
asserting it. Even so the lightbulb only PLANS: a code action that edits code on click, in a
security tool, would be indefensible. Not offered on `OBJECT_SCOPE_UNPROVEN`, because a boundary
check does not close an ownership hole — the caller is authenticated and still must not touch
that object, and proposing a check that cannot fix the problem it is attached to is its own
kind of dishonesty. Three killing mutants.

**Decision, part 3 — the status bar is a menu.** A fixed target is wrong because what the user
needs depends on what the bar is saying. The menu is built from the last result: install first
when the CLI is missing, the Problems panel first when hard findings stand, re-prove otherwise.
A test requires every item to name a command the extension actually registers — the manifest
already could not advertise a command nothing implements, and now the menu cannot either.

**What did NOT change, and was reconsidered.** `PROVEN` still gets no emphatic colour. VS Code
offers exactly two status-bar backgrounds, warning and error; the absence of alarm IS the
signal, and painting the calm state green would put SPARDA's most emphatic pixel on its least
defensible claim. `UNKNOWN` remains a warning background with its reason in the tooltip.

Suite **1197** (+16), mutants **110/110** (+3), 4 deps.

## ADR-091 — A premise nobody measured cannot license the strongest word

**Context.** `premiseFor` has always reported an absent oracle honestly:
`{ available: false, gaps: [] }`. Every consumer then read it through one line:

```js
export function withPremiseGaps(report, premise) {
  if (!premise?.gaps?.length) return report;   // available:false ⇒ gaps:[] ⇒ report UNCHANGED
```

and one predicate, `premiseGaps > 0`. Both are blind to the difference between **an oracle
that did not run** and **an oracle that ran and agreed**. The label was honest; the system
consuming it could not tell the two apart, so the verdict was computed as though Direction 3
had been verified.

Measured on our own fixtures before the fix: **of the 8 that read `PROVEN`, 7 had no oracle
run at all** — every one of them Express or FastAPI. It went unseen because all seven corpus
giants are `CONVENTION_ROUTED`, so their premise IS measured on every run: the regression net
and the field were blind in complementary places (E-104).

Found by an independent agent auditing `docs/BRIEF-FOR-A-STRONGER-MIND.md`; its
implementation was lost to a usage limit before it could be pushed. The diagnosis was
reproduced here from its description, and it was right.

**Decision.** The premise now has three states, not two, and the verdict can see them:

| basis | meaning | effect on `PROVEN` |
|---|---|---|
| `measured` | an oracle that is not the analyser enumerated the surface and agreed | none |
| `declared` | the artefact analysed IS the route table (OpenAPI) — a second witness would be the same map twice | none |
| `unmeasured` | no oracle ran | **withheld: `PROVEN` → `PARTIAL`** |

**Why a PARTIAL rung and not `PREMISE_GAP`.** A gap is *measured evidence* that the subject
was incomplete, and it blocks. Silence is only the absence of a witness. `PARTIAL` already
means exactly the right thing — "proved what was seen" — so this withholds a claim without
inventing a fault, and **never fails a gate**. The strongest word is the only casualty, and it
is the only one that was over-claiming.

**Why `null` still means "old semantics".** `heal` grades a regression delta, a partial graph
that was never a whole-app proof. A caller with no premise to speak of passes nothing and is
untouched — the rung is opt-in for consumers that actually have an app.

**The reason is carried, not just the word.** A reader told *"PARTIAL: 100 % of the surface
resolved"* concludes the analysis was thorough and the word merely cautious. The truth was
that nothing checked whether that surface was the app's — a different sentence with a
different remedy (`--probe`). `prove` now leads with it, and `--json` carries
`premise.basis` so a machine consumer can tell the two apart too.

**`enforce` was the sharpest instance**, and it splits into two questions rather than one.
It announced the literal string `PROVEN (ENFORCED)` on every successful run — on Express,
the only framework it supports, which has no boot-free oracle. So the strongest word SPARDA
has was printed, unconditionally, over a route table nobody had checked.

The *edit* is licensed by the DELTA (same app before and after; the premise is identical on
both sides and cannot discriminate), and gating the rollback on a measured premise would not
make enforce safer — it would make enforce impossible. The *announcement* is licensed by the
ORACLE. So the rollback logic is unchanged and deliberately premise-blind, while the word is
now `PARTIAL (ENFORCED)` when nothing measured the premise, with the reason printed.

**Measured.** Fixtures: `PROVEN` 8 → **1**, and that one has a measured premise;
`PROVEN` with an unmeasured premise **7 → 0**. Corpus: **0 drift on the six clonable giants**
— all convention-routed, so all already measured, which is exactly the control this needed.
`dub` remains uncloned here and is stated as unmeasured, not assumed.

Suite **1197**, mutants **113/113** (+3), 4 deps.

## ADR-092 — The admission goes INSIDE the number, never beside it

**Context.** E-104 was not one bug. Auditing the RULE rather than the suspects — the method
an outside agent used to find E-104 in the first place — turned up four more instances of the
same shape in an hour, and the shape is more interesting than any of them:

| where | the honest field, PRESENT | the headline that lied |
|---|---|---|
| premise (E-104) | `available: false` | `premiseGaps: 0` → **PROVEN** |
| `falsify` | `note: 'nothing to falsify'` | `score: 1` |
| `gate` | `abstained: <reason>` | `ok: true` |
| `speculate` | `(by lookup)` | `✓ PROVEN` |
| `immunize` | — | `✓ PROVEN` |

**Nobody ever lied in the honest field.** Not once in five instances did anyone write
`available: true` for an oracle that had not run. The admission was simply put NEXT TO the
number rather than IN it — and the number is what gets read, graphed, and branched on. A note
is written for a reader who already suspects something is wrong; that reader is exactly the
one who does not need it.

**Decision.** Every value a consumer acts on must be able to say "I don't know" **in itself**.

- `falsify` returns `score: null` when nothing was falsifiable. It used to return `1` — a
  perfect score for a run that checked nothing, with the note beside it. A test named
  *"(vacuously 1)"* had **codified** the equality, which is how long it survived.
- `gate` emits `ok: null` when it abstains. Abstaining stays right (the agent is mid-edit; a
  false alarm there is worse than silence) and it still exits 0 — it just stops answering a
  question it did not ask.
- The immunity **capsule carries its own basis of measurement**, and `proven` becomes
  three-state. A capsule is PORTABLE: replayed in another repo by `speculate`, a frozen
  `proven: true` is a claim re-asserted where its licence can no longer even be checked —
  strictly worse than E-104, where the oracle was one call away. An older capsule with no
  basis keeps its previous meaning, because retroactively invalidating proofs we never
  inspected would be its own dishonesty.
- `immunize` and `speculate` read that three-state field and say `UNMEASURED PREMISE` rather
  than `PROVEN`. Both check `=== null` FIRST: a falsy `null` collapsing into "not proven"
  would be a different lie, in the safe direction, and still a lie.

**`null`, and specifically not `0` / `false` / `[]`.** Those are ANSWERS — "we measured, and
the answer is none". Only `null` says "there is no answer here", and only `null` refuses to be
summed, averaged, or rendered green.

**The method is the deliverable.** Fixing five leaks is worth less than being able to find the
sixth, so the technique is now mechanized rather than remembered:

- **`docs/SOUNDNESS.md` discipline 3d** states the rule where every feature is checked.
- **`tests/unmeasured-is-not-a-pass.test.js`** is a REGISTRY, not a test file: each row
  constructs one surface's unmeasured state and asserts its headline does not read as a pass.
  A new headline field adds a row — otherwise the family reopens one leak at a time, which is
  precisely how it accumulated.
- **`CLAUDE.md` hard rule 13**, so it is read before code is written rather than after.

If a surface has no expressible "I don't know", that absence IS the finding: it will invent
one under pressure.

**Honest note on provenance.** E-104 was found by an independent agent auditing
`docs/BRIEF-FOR-A-STRONGER-MIND.md`; its implementation was lost to a usage limit before it
could be pushed. It also flagged `speculate` and `immunize` by name. The diagnosis and the
`enforce` split were reproduced here; the generalization and the registry are this session's.

Suite **1209** (+12), mutants **116/116** (+6), 4 deps.

## ADR-093 — A guarantee is reachable, or it is decoration

**Status:** accepted · supersedes nothing, amends ADR-083 and ADR-092 · E-106

**Context.** ADR-092 gave the immunity capsule a three-state `proven` so a portable proof could
never re-assert a claim whose premise nobody measured. The test passed. The mutant died. The
branch shipped. And no call site ever passed `premiseBasis`, so in the product the field was
always `null`, the branch never fired, and `sparda immunize` on an Express app printed
`✓ PROVEN` exactly as before. The organ existed and nothing was plumbed into it.

Two of the four call sites had the value in scope: `prove` computes the premise, uses it for
the verdict word, and builds the capsule without it; `dossier` built the capsule three lines
before computing the premise at all. Two others — `immunize` and `genome` — had never called
`premiseFor` in their lives, which is a plain violation of hard rule 11 that the rule's own
structural guard could not see, because that guard scans for consumers of `verdictOf`/`badgeFor`
and `buildCapsule` is a second grader.

**Decision.**

1. **`basisFrom(premise)` is the only way to obtain a basis.** Nine call sites had hand-copied
   `premise.available ? 'measured' : (premise?.basis ?? 'unmeasured')`. One function now. Its
   default — for a caller holding no premise at all — is `'unmeasured'`: **forgetting to measure
   must fail toward the weaker word.** That default is unreachable from today's callers, and has
   a test of its own for exactly that reason: it exists for the caller not yet written, and
   E-106 is the proof that such a caller arrives.

2. **Every `buildCapsule` call site states a basis**, and a source rule enforces it. This is a
   *wiring* property — "every call site passes this argument" cannot be observed by running one
   command, which is precisely why four of them stayed unwired under a green suite.

3. **`immunize` and `genome` call `premiseFor`.** `genome` matters most: it grades a graph,
   signs the result with Ed25519 and merges it into a file strangers pull. Antibodies are
   per-behaviour claims, so a route the compiler never saw does not falsify the ones minted —
   it means none exists for it. That is now **named per route**, not counted, because a genome
   that silently under-represents an app teaches the world that the surface it covered *is* the
   app.

4. **The structural rule names the property, not the function.** `GRADERS` lists every function
   that turns a compiled graph into a claim someone acts on. ADR-083's first version scoped the
   scan to a directory; the amendment widened it to the repo; this one had scoped it to a name.
   Both times the gap was exactly the size of the scope.

5. **Only the POSITIVE claim is withheld.** ADR-092's `premiseUnmeasured ? null : …` blanked a
   genuine `false`. The premise bounds the route *set*, and a route absent from the graph cannot
   rescue one that is in it and exposed — so NOT-PROVEN needs no premise. And `immunize` gates on
   `=== false`, never on falsiness: `null` is falsy, and gating on it would fail builds because
   no oracle was *available*, which `premise.js` forbids in those words.

6. **Every registry row owes two assertions.** EXPRESSIBLE — the headline field can hold the
   unmeasured state (hand-constructed). REACHABLE — a real call path produces it. The first
   without the second is a green row over a dead wire.

**Also fixed in the same pass, from the same audit** (each with a killing mutant):
`stitch` recorded a service that failed to compile as `unread`, gates CI on it, and qualifies
the join as PARTIAL — a half join finds no cross-service BOLA and used to report that as
"no cross-service calls resolved (targets may be dynamic or unrelated)". `heal --check` no
longer claims "zero protection lost" when no `baseline.json` was frozen, since without it
`diffGraphs` never ran. `timeless replay` no longer reports "every tap consumed, zero
divergence" over a flight with zero taps — nothing was virtualized, so the match says today's
environment agreed, not that the code is unchanged.

**Consequence, stated plainly.** `sparda immunize` on an Express or FastAPI app now withholds
`PROVEN` until `--probe` runs the oracle, exactly as `prove` has since ADR-091. Exit code stays
0: the word is withheld, no fault was found, and those are different outcomes.

## ADR-094 — A tag that only exists on the releaser's disk names nothing

**Status:** accepted · E-107 · amended by ADR-095

**Context.** The gate's tag check read `git rev-list -n 1 v<version>` — a purely LOCAL question.
v0.71.0 was cut with the tag created and never pushed (the environment refused the push), and the
gate answered `v0.71.0 exists and points at HEAD`. Every word of that was true and it certified
nothing: a tag nobody else can fetch names no bytes to anyone but its author. That is the v0.69.0
class of gap again — the local view and the published view diverging, with nothing looking at the
seam.

**Decision.** `tagChecks` also takes `remoteAt`, read from `git ls-remote --tags origin <tag>`,
and requires it to equal the local commit. An ANNOTATED tag answers with two lines — the tag
object, then `<sha> refs/tags/<tag>^{}` for the commit it wraps — so the dereferenced line is
preferred, because `at` comes from `rev-list` and is already a commit.

**Amendment (ADR-095).** As first written this collapsed two states: `ls-remote` FAILING and
`ls-remote` returning nothing both produced "the tag is not pushed". An unreachable network was
reported as a measurement, sending the operator hunting for a tag that was already there. It now
carries `remoteReachable`, and an origin it could not reach says `UNVERIFIED`. Both still BLOCK —
a release gate that cannot verify must not certify, the same call `fetched:false` already makes —
but the stated reason is the true one, and the reason is what someone acts on.

**Also decided here:** publishing is driven by `.github/workflows/release.yml`, fired by a `v*`
tag push and gated on `npm run release:check`. That finally puts `vsce publish` behind the same
door as `npm publish` — the VS Code extension had been shipping with nothing checked but its
version number, which is how a stub reached the Marketplace at 0.70.0.


## ADR-095 — The restore may not depend on the process that is dying

**Status:** accepted · E-108 · amends ADR-094

**Context.** `src/ubg/apocalypse.js` reached `main` carrying `if (false)` where
`assertedOnlyMutationRoutes` decides whether a route is guarded by trust alone. With that line
dead, `assertedMutations` is always 0, the PARTIAL rung never fires, and a route protected only
by an UNVERIFIED guard reads `PROVEN` — the exact false-PROVEN generator ADR-070 exists to
remove. It shipped inside a commit whose stated scope was release automation.

Nobody wrote it. `if (false)` is byte-for-byte the `repl` of a mutant that has lived in
`tests/mutation/run.mjs` since ADR-070. The harness writes the mutated file, runs one test, and
restores in a `finally` — and `finally` covers a thrown error, not a killed process. Ctrl-C, a CI
timeout, an OOM: the mutation stays on disk, `git add -A` sweeps it into the next commit, and the
suite stays green, because a surviving mutant is BY CONSTRUCTION invisible to the tests.

**Reproduced, not theorised.** SIGKILL during a run left `src/ubg/llm-resolve.js` mutated with
signal handlers installed — the harness lives inside a BLOCKING `execFileSync`, so a signal
cannot reach JS until the child returns, and a SIGKILL never reaches it at all.

**Decision — three layers, because each covers what the previous cannot.**

1. **A journal, written BEFORE the file is touched.** The original bytes go to
   `tests/mutation/.in-flight.json` (gitignored), and the NEXT run puts them back and says so.
   This is the load-bearing one: recovery that depends on the dying process running code is not
   recovery. An unreadable journal is FATAL, never skipped — it means a file may still be
   mutated, and running the suite over a tree we know is suspect is the thing being prevented.
2. **Signal handlers** for SIGINT/SIGTERM/SIGHUP, which cover the polite exits and give an
   immediate message rather than a mystery.
3. **`tests/no-mutant-left-behind.test.js`**, in the ORDINARY suite. The harness already knows
   every mutation it can make, so "is the tree mutated?" is a lookup, not a judgement — and it
   costs milliseconds where `npm run mutation` costs ten minutes. It caught the residue the very
   first time it was reproduced.

The predicate is exact rather than a scan for `repl`: a file is mutated when the mutant's `find`
is ABSENT **and** its `repl` is PRESENT. Several mutants replace with the same generic text, and
`if (false)` is legitimate in plenty of code. The same file also fails when a `find` no longer
matches at all — `npm run mutation` reports that as SURVIVED, correctly but ten minutes and one
commit too late, and Prettier moving a line is enough to cause it.

**Consequence.** The mutation harness is now importable without running: `MUTANTS` is exported
and the run is behind an "am I the entry point?" guard, placed last in the file because `run()`
closes over the journal path.

**Rule.** **A cleanup that only runs when the program is healthy is not a cleanup.** State the
intent on durable storage before taking the risky action, and heal from that record on the next
start. And when a tool can put the repository into a wrong state, the ordinary suite — not the
tool's own slow mode — is where that state must be detected.
