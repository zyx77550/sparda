# Competitive intelligence

Living file: who plays in our niche, what they do better, what we adopt
(and do better), what we deliberately ignore. Update on every serious scan.

---

## mcp-anything (Type-MCP) — scanned 2026-06-11

**"One command to turn any codebase into an MCP server"** — literally our
tagline. Apache 2.0, Python, ~37 stars, active (v0.2.0 Apr 2026).
https://github.com/type-mcp/mcp-anything

### What it is
A *code generator*: scans a codebase/spec (static analysis) or takes a YAML
"brief" (LLM-driven, needs an Anthropic API key) and emits a separate,
pip-installable MCP proxy server package that calls your API over HTTP.

### What it does better than us — and what we take

| Their strength | Our move |
|---|---|
| **CRUD grouping**: 3+ operations on one resource → a single `manage_x(operation=...)` tool. "57% less tool surface" vs flat lists — fewer tools = less agent context, fewer hallucinations | **Adopt at init (deterministic)**: same resource path + multiple methods → one grouped tool with an `operation` param. Then go further: our Round-2 condensation *also* groups by observed usage, which a static generator can never do. Static grouping day 1, living grouping forever |
| **SKILL.md**: an agent-readable manual — recipes, gotchas, anti-patterns — generated with the server | **Adopt and make it alive**: theirs is written once at generation and drifts. Ours can be regenerated from *runtime truth*: real observed schemas, real latencies, quarantine history — and our antibodies are literally machine-learned gotchas. A living SKILL.md beats a static one by definition |
| **`/.well-known/mcp` discovery endpoint** | Adopt — trivial addition to the injected router |
| **Eval harness**: generated eval cases + conformance report shipped with the server | Adopt later (Shadow): generate eval cases from *real recorded traffic* (replay), not LLM guesses — converges with the R3 "dream" |
| **27 frameworks / 8 ecosystems** (Spring, Rails, Go, Rust, gRPC, GraphQL, OpenAPI, even CLIs) | **Do NOT chase**. Breadth is their war; depth is ours. We add frameworks by user vote, one at a time, each with a real-runtime test (E-009 taught us why) |
| **Brief-driven design** (describe the domain in YAML, LLM designs the toolset) | Adopt the *idea*, fix the *economics*: theirs burns an API key; our sampling pass can curate/group tools from a user-written goal for free |

### What we do better — structurally, they cannot copy

1. **In-process vs outside proxy.** Their output is a *second server* to
   deploy, secure, and keep in sync. We inject into the live app: real auth
   chain, warm DB pools, zero extra deployment, removable byte-for-byte.
2. **We live; they generate.** After generation their server is frozen and
   drifts as the API evolves. We observe runtime, quarantine sick routes,
   diagnose failures, accumulate antibodies, re-sync on every commit
   (sentinel). Nothing in their architecture can do any of this.
3. **Zero-cost intelligence.** Their LLM mode requires an Anthropic API key
   (their dependency list includes the Anthropic API). Our semantic layer
   rides the client's own model via MCP sampling — no key, no bill.
4. **Write-safety as a product.** Disabled-by-default writes, per-write UI
   confirmation, proof-after-write, quarantine. They ship docs and telemetry;
   we ship guarantees.
5. **License moat.** Apache 2.0 means anyone (including us) can fork them;
   BUSL means they cannot resell us.

### Threat level
**Medium and rising.** Same pitch, more frameworks, good agent-ergonomics
ideas, permissive license. Their weakness is structural (outside-the-process,
static, key-dependent) — ours is just earliness. Speed wins this.

### Action items adopted into the roadmap
- v0.4: deterministic CRUD grouping at init + `/.well-known/mcp` endpoint.
- v0.4–0.5: living SKILL.md (regenerated from manifest + runtime memory;
  antibodies rendered as "gotchas", quarantine history as "known flaky").
- Shadow: traffic-derived eval harness; sampling-driven brief mode.

---

## SAST incumbents — Semgrep / CodeQL / Snyk (added 2026-07-17, audit lever #6)

The first question any technical buyer/investor asks now that SPARDA is a *proof/trust layer*:
**"why not just use CodeQL, it's free on GitHub?"** Zero mention of them existed here — that gap
was itself the finding. Here is the honest answer.

### The category difference (lead with this)
Semgrep/CodeQL/Snyk are **SAST**: they scan *source* for *patterns* (CodeQL adds taint over a
source dataflow graph). Question answered: *"does this code match a known-bad shape?"*
SPARDA is a **behavior compiler + deploy-time proof gate**: it compiles the whole backend into
one deterministic graph and *discharges proof obligations* (can any declared guard / invariant /
transaction / aggregate boundary be broken?). Question answered: *"is this deploy safe against the
properties I declared?"* Different question — we do **not** win by being "a better linter".

### Where SPARDA wins (defensible)
- **Setup:** `npx sparda-mcp apocalypse`, zero config/account. CodeQL needs a build + a DB.
- **Determinism:** same code → byte-identical graph & verdict. SAST drifts with rule-set/version.
- **Soundness contract:** never a false PROVEN; imprecision degrades to SURFACE/PARTIAL, never
  hides a risk. (SAST's chronic complaint is FP noise — a 246-tool survey: "few exploitable".)
- **Honesty ledger:** SPARDA ships its own blind-spot list + coverage %. No SAST says "here's
  what I couldn't see".
- **One graph, many tools:** the same compile powers `mirror` (serve the API), `timeless`
  (replay), `heal`, and MCP. SAST is analysis-only.
- **Local / private:** 100% local, 4 exact-pinned deps, no telemetry.

Wedge sentence: **"CodeQL tells you your code matches a bad pattern. SPARDA proves your deploy
can't break the guards you declared — in one command, with a verdict it will never fake."**

### Where they win (say it plainly — the buyer already knows)
- **Breadth:** many languages, thousands of rules. SPARDA is JS/TS/Python-family (+ OpenAPI,
  shallower). Breadth is their war, not ours.
- **Mature taint/injection:** CodeQL's SQLi/XSS/RCE dataflow is state-of-the-art. Ours is early;
  BOLA is advisory, not yet a proven verdict.
- **Brand & security-research muscle:** CVE track records, enterprise procurement. We're early.

**Do NOT claim** "nobody does adversarial path-finding" — CodeQL does. Our moat is **zero-setup +
determinism + the proof/trust framing**, not the algorithm.

### The one-command repro (build it, don't assert it)
`bench/` should carry a side-by-side on one shared public repo: `npx sparda-mcp apocalypse` vs
`semgrep --config=auto`. Report setup time, wall-clock, and — the real point — how many SPARDA
findings are *proven obligations* vs how many Semgrep findings need triage. Ship numbers, not
adjectives.

### Naming & SEO (audit lever #7)
"SPARDA" as a bare keyword is an SEO dead-end — a web search returns the Devil May Cry character
(Capcom / Netflix 2025) top to bottom. Never target the bare name for organic discovery. Target
long-tail intent: *"AI code proof gate", "prove deploy safety", "MCP trust layer", "behavior
graph compiler", "static BOLA detection"*. Keep `sparda-mcp` on npm (equity built), reserve the
bare `sparda` defensively, do not rename.
