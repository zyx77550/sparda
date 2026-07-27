# VISION — SPARDA

> The cap document. Not a roadmap (that is `ROADMAP.md` / `NEXT-WAVES-PLAYBOOK.md`) and not
> a changelog. This is *why SPARDA exists, what it is, where it wins, and what would make it
> the category-defining product of the next years* — written so it survives between sessions
> and so every surface (README, npm, registries, docs) can carry the same message.

## 1. The one sentence

**SPARDA is the trust layer for AI-written code. AI writes. SPARDA proves.**

Under the hood it is a **behavior compiler — the LLVM of web applications**: it lowers any
backend into one deterministic, language-agnostic graph (the Unified Behavior Graph), and then
*proves* what that system cannot break. The verdict is not an opinion — it is a **re-derivable
function of the source**: anyone, on any machine, can recompute it and get the same bytes.

The sharpest true claim we own, and the line everything else should ladder up to:

> **SPARDA proves classes of behavior, not lines — and what it proves, anyone can re-derive.**

## 2. Message doctrine — one story, two acts, one wedge

The message must be identical everywhere. It is **not** two products; it is one organism told
in order:

- **Act 1 — the wedge (lead with this):** *the trust layer for AI-written code.* AI writes a
  thousand lines an hour; nothing can vouch for them at that speed. SPARDA proves what can't
  break, deterministically, before it ships. This is the habit-forming entry point (the PR
  review bot: a behavior diff on every pull request), because it meets the highest anxiety in
  the market — "my AI wrote this; can I trust it?"
- **The "wow, how?" reveal (second beat):** *it's a behavior compiler, the LLVM of web apps.*
  Compile once; every capability is a pass over the graph. This is the curiosity hook — the
  thing a serious engineer (the kind at Anthropic) leans in to understand.
- **Act 2 — revealed later, never as the front door:** *the MCP runtime* — the same trust story
  at runtime, giving an AI agent safe hands inside the live process. It is one *output* of the
  graph, not the product (the README already says this — keep it).

**Rule:** never present Act 1 and Act 2 with equal weight to a newcomer. Two strong promises at
once dilute memory. Win the habit with proof, then reveal the organism.

### Canonical strings (propagate verbatim)

- **Hero (README, docs):**
  > **The trust layer for AI-written code.** *AI writes. SPARDA proves.*
  > Under the hood, a behavior compiler — the LLVM of web applications: it lowers any backend
  > into one deterministic graph, proves what can't break, and gives your AI safe hands at
  > runtime.
- **One-liner (npm `description`, `server.json`, SKILL intro):**
  > The trust layer for AI-written code — a behavior compiler that statically proves what your
  > backend can't break. Deterministic, zero-infra, zero API key.

## 3. Naming doctrine (decided)

The psychological wound of "mcp in the name" is mostly already avoided — do NOT rename now.

- **Brand, everywhere in prose and titles:** **SPARDA**.
- **The command people type:** `sparda` (already the `bin`, decoupled from the package name).
- **The MCP registry display title:** already "SPARDA" (`server.json` title).
- **The npm / registry identifier:** stays **`sparda-mcp`** — it is correct *in an MCP registry
  context*, and it is the ONLY surface where "mcp" appears. Renaming would break glama,
  awesome-mcp, the MCP registry, and existing installs, and npm already refuses bare `sparda`.
- **The `npx sparda-mcp <cmd>` install strings stay** as long as `sparda-mcp` is the published
  package — changing them to `sparda` would break `npx` (no `sparda` package exists).
- **Future, non-breaking, owner-published when wanted:** a scoped alias
  **`@residual-labs/sparda`** that re-exports `sparda-mcp`, so the install string can drop "mcp"
  (`npx @residual-labs/sparda`) while `sparda-mcp` stays alive for compatibility. This is an
  owner publish decision — documented here, not actioned.

## 4. Why SPARDA can be big — the real moats

1. **Determinism as a product feature.** Byte-identical, re-derivable output. Rare, and it
   compounds: the golden bench, `speculate`, fingerprint portability, and the genome all
   *depend* on it. Competitors' output fluctuates; ours diffs cleanly.
2. **The honesty organ.** A four-state verdict (PROVEN / NOT PROVEN / SURFACE ONLY / NO PROOF)
   plus coverage and a ranked blind-spot ledger. In a world drowning in AI false-confidence,
   the tool that says what it *cannot* see out-trusts the tool that cries wolf or hides gaps.
3. **Zero infra, 4 exact-pinned deps, git as the database.** Elegant and hard to copy; a funded
   competitor cannot easily match "it runs, it exits, it costs nothing."
4. **Collective immunity (the 10000x).** A coordinate-free `behaviorHash` + a re-derivable
   verdict = a diagnosis learned once, inherited everywhere the same behavioral shape occurs.
   A network effect no fork copies, because it needs *both* ends, which only SPARDA holds.
   Already shipping at single-app scale (defect classes, ADR-057) as the bridge to the genome.

## 5. What it honestly lacks (and must earn)

1. **Proof depth.** O1–O5 are structural (reachability + declared invariants). Until the
   dataflow enters the IR (ADR-P1), O2 is a boolean and "prove" is modest. This is priority #1.
2. **Genome cold-start.** Collective immunity is worthless at one user, magic at ten thousand.
   The single-app defect classes and a public golden corpus are the bootstrap.
3. **Linear breadth.** Every framework/ORM is hand-coded; an unparsed repo is NO PROOF. The one
   unified resolver (ADR-P2) plus a declarative adapter DSL bend this toward sub-linear.
4. **Subtle differentiation in a loud market.** The moats (determinism, honesty) require
   education. The risk is being out-marketed, not out-built. Answer: one sharp wedge, hammered.

## 6. The algorithmic roadmap to category-defining (cross-domain grafts)

These are the ideas from other fields that turn the moats into a lead nobody catches. Each has a
concrete anchor in the current code.

1. **e-graphs / equality saturation** (compiler optimization, `egg`). The fingerprint normalizes
   behavior to a *fixed* descriptor. An e-graph over the UBG proves behavioral equivalence far
   more aggressively — more behaviors collapse to one antibody → collective immunity gets
   dramatically stronger. Anchor: `ubg/fingerprint.js`, `ubg/classes.js`.
2. **Merkle DAG over the behavior graph** (Nix / Bazel / git content-addressing). The
   `behaviorHash` is already a content address; Merkle-ize the whole graph → **incremental
   proof** (re-prove only changed subtrees) and a single **behavior root per commit** = a
   *semantic* CI cache key. Verification cost then scales with behavioral *diversity*, not route
   count. Anchor: `ubg/schema.js` (canonicalization), `ubg/speculative.js`.
3. **LSH / MinHash** (similarity search) for **anticipatory immunity**. Move the genome from
   exact match to near-miss: "this behavior is one refactor away from a known-critical shape."
   Reactive → predictive. Anchor: the fingerprint descriptor's effect multiset; `ubg/genome.js`.
4. **Abstract interpretation / lattice theory** (program analysis) as the rigorous foundation for
   the dataflow depth (ADR-P1) and the bounded partial evaluator (ADR-P3): a lattice of abstract
   values with a widening operator makes the prover deeper *without* losing termination or
   soundness. Anchor: `ubg/apocalypse.js` O2, the future `ubg/resolve.js` (ADR-P2).

Bonus, when the base is deeper:

5. **Metamorphic + coverage-guided fuzzing with the mirror as differential oracle** (ADR-P4) —
   the only way a static tool can *measure* its own soundness against real execution.
6. **A learning layer for PRIORITIZATION only** (never for the verdict). The genome is a labeled
   dataset (behaviorHash → verdict, coverage, outcomes); a model can rank blind spots by
   empirical likelihood of a real bug ("behaviors of this shape were exploited 12% of the time").
   Learning informs *attention*; the verdict stays deterministic and sacred.

## 7. If this were a life's work — the sequence

1. **Depth:** ADR-P2 (one resolver) → ADR-P1 (dataflow in the IR) on an abstract-interpretation
   footing. Make "prove" undeniable. Everything runs under the golden bench (byte-identity is the
   safety net).
2. **Moat compounding:** e-graph equivalence + Merkle incremental proof. Now the collective
   immunity and the speed are un-catchable.
3. **Adoption:** the PR review bot as the single wedge, hammered into a habit. The MCP runtime is
   Act 2, revealed to those who already trust Act 1.
4. **Network effect:** grow the public golden corpus and the genome; LSH turns it predictive.

The direction is right. The foundation is rare. What remains is not invention but **depth,
focus, and volume** — all three are reachable.
