# SPARDA — a verification layer for the coding-agent loop

*A technical brief for engineers and researchers evaluating trust infrastructure for AI-written
code. Honest by construction: every claim below is either reproducible from the repo or explicitly
scoped as a limitation.*

## The thesis, in one line

Coding agents have closed the *capability* gap; what remains open is the *trust* gap. SPARDA is the
missing verification layer for that loop: it compiles a backend into a deterministic behavior graph
and discharges machine-checkable proof obligations against it, so the output of an agent can be
*vouched for* — not reviewed line by line, **proven** at the level of behavior.

## The problem, framed honestly

An agent can write a thousand lines an hour. Nothing downstream keeps that pace: human review is the
bottleneck, tests cover what someone thought to write, and a linter reads syntax, never grasping
what the *system* does. So teams either slow the agent to human-review speed, or ship on faith. Both
are failures of **scalable oversight** — the machinery that lets you trust more output than you can
personally inspect. Verification, not generation, is now the constraint.

## What SPARDA is (technically)

A **behavior compiler**. It lowers any backend — routes, DB queries, state mutations, guards,
side-effects — into one language-agnostic IR (the Unified Behavior Graph), then runs *passes* over
it: structural proof obligations (a mutation must be dominated by a guard; a constrained write needs
validated input; multi-table aggregate writes must be atomic; observable effects must be
compensable). Each finding is a counterexample path, not a heuristic.

The load-bearing property is **reproducibility**: the verdict is a deterministic, byte-identical
function of the source. Anyone, on any machine, can recompile and get the same answer. That is the
trust primitive — you extend trust to a stranger's verdict because *math* re-derives it, not because
an authority asserts it. It also makes verification *composable*: a coordinate-free behavior hash
turns "a behavior" into a content address, so a diagnosis learned once applies everywhere the same
behavioral shape recurs (collective immunity).

Two design choices a safety-minded reader will care about:

- **It reports what it cannot see.** The verdict is four honest states (PROVEN / NOT PROVEN /
  SURFACE ONLY / NO PROOF) plus a coverage ratio and a ranked blind-spot ledger. It never launders a
  gap into a green check. The tool that admits its own boundary is the one you can build oversight on.
- **It proves classes, never "no bugs."** SPARDA discharges *declared* obligation classes; it does
  not claim the absence of arbitrary bugs. Stating that boundary is deliberate — over-promising is
  how verification tools lose the trust they exist to create.

## Why this is adjacent to Anthropic specifically

- **Claude Code / the agent loop.** SPARDA already wires into Claude Code as a `Stop` hook: after
  each turn it proves the *behavior diff* of what the model just wrote (a removed guard, a grown
  blast radius) before a commit or PR — the tightest possible oversight loop. One command, static,
  never blocks the agent.
- **MCP-native.** SPARDA injects a reversible `/mcp` router inside a live process and bridges it over
  stdio; it is a first-class citizen of the protocol, with a novel take (compute from the host,
  intelligence from the client's own model via sampling).
- **Safety posture as identity.** Deterministic, re-derivable, honesty-first verification is the
  same value system: capability is only useful if it is *trustworthy* capability.

## Evidence (reproducible from the repo)

- **Determinism, locked.** A golden bench of 6 SHA-pinned real monsters (directus, immich,
  open-webui, dub, twenty, a stock Express app) re-derives byte-identical verdicts *including the
  canonical-graph hash* on every run.
- **Depth on real code.** open-webui (FastAPI): 0 → 1,325 resolved DB effects, coverage 0% → 94%,
  in ~4s. dub (Next.js, 579 routes): 156 findings collapse to a small set of behavioral defect
  classes — fix the shape once, fix every route that wears it.
- **Zero-infra.** 4 exact-pinned runtime dependencies, no server, no API key, git as the database
  for the portable verdict genome. It runs and exits; the host never pays.

## Where we are, honestly — and that we keep evolving

SPARDA is a **living system**; it ships disciplined evolution continuously (every change is recorded
under a strict protocol, and the determinism bench makes regressions impossible to miss). The honest
frontier:

- **Proof depth today is structural** (reachability + declared invariants). The next depth is
  value-flow: a dataflow IR on an abstract-interpretation footing, turning "unvalidated input reaches
  a write" from a boolean into a full taint counterexample. The engine unification that precedes it
  is planned and bench-protected.
- **The network effect (collective immunity)** is shipping at single-app scale and bootstrapping
  toward the cross-repo genome; similarity search (LSH over the behavior descriptor) turns it from
  reactive to anticipatory.

We would rather state the boundary precisely than blur it — because the entire value of a
verification layer is that, when it says *proven*, it means it, and anyone can check.

---

*Reproduce any claim: clone the repo, run `node tools/bench/run.mjs` (determinism), `node
integrations/claude-code/demo.mjs` (AI writes, SPARDA proves), or point `sparda apocalypse` at any
supported backend. Thesis and roadmap: `docs/VISION.md`.*
