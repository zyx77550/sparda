# ⚔️ Attack plan — for Fable (code) · authored by Claude + Zak

> **Roles.** **Fable** builds the code below. **Zak** owns distribution & the first external user
> (demand side). **Gemini** keeps feeding the genome (`docs/gemini/GENOME-MINING-TASK.md`) + ops.
> **Claude+Zak** authored this plan. This is HQ-internal (moat), never published.

## The one strategic frame (everything below serves this)

Two **different jobs** — never confuse them:

- **Credibility** (depth + languages + measured numbers) → makes people *believe* the tech is real.
- **Moat** (genome + standard + position) → the durable, compounding lead.

And the chain that ties them:

> **Depth+languages buy CREDIBILITY → credibility buys USERS → users feed the GENOME → the genome
> (+ standard + position) IS the moat.**

So Fable's depth/breadth work is **not** feature-sprawl — it is the *fuel intake* of the moat. The
compass that keeps it honest and pointed: **every depth brick is measured by the recall loop** (below);
we ship a number, never a claim.

## Non-negotiable invariants (a task that breaks one is wrong, no matter how good)

1. **Never a false `PROVEN`.** Every depth technique is *under-approximating* — it may resolve more
   or raise a finding, never fabricate a guard/green (ADR-061). Depth must never buy a false green.
2. **Offline · deterministic.** Static AST + graph ops only. No LLM on the critical path (LLM only
   "on surprise", memoized, degrades gracefully).
3. **4 exact-pinned deps.** Breadth via OpenAPI (0 dep) or subprocess-to-toolchain (0 dep). One new
   parsing substrate — **tree-sitter** — is allowed but costs +1 dep → **requires an ADR** (rule #8).
   **Never** a native parser *per language*.
4. **The host never pays.** Extraction is dev-time/CLI, never on the host's request path.
5. **Everything lands in the UBG.** Write techniques against the IR, not a language — so each brick
   **multiplies across every present and future language** (this is the whole leverage).

## The mapping — strategy theme ↔ roadmap ↔ concrete task

| # | Strategy | Roadmap | Concrete code task (Fable) | Done when |
|---|---|---|---|---|
| **0** | credibility compass | R7.6 | **Recall loop as CI.** Wire `bench/cve-replay.mjs --mine` over a pinned repo set into a nightly/committed metric (recall %, per miss-class). It is the drift net AND the credibility number. | a committed recall baseline + it fails/flags on regression |
| **1** ✅ | credibility-depth | R7.3 · ADR-062/063 | **Guard/permission taxonomy: custom decorators.** Model `@HasPermission`/`@HasRole`/app `@Roles(...)`/policy-guard patterns as `guard` nodes (verified vs asserted per ADR honesty). This is the *measured* bottleneck (ghostfolio recall 1/8). | ✅ **DONE (ADR-063, Claude, Fable unavail).** The genome localized it to principal-injection PARAM decorators (`@AuthWorkspace`/`@AuthUser`/`@GetUser` — invisible to `useGuards`), now modeled as asserted guards. Compass proven deterministically: param-decorator removal → `GUARD_REMOVED` (was `missed`). No false PROVEN; unguarded routes still flag. |
| **2** ◑ | credibility-depth | R7.1 · M1 · ADR-058 · ADR-061/064 | **Unify provenance into ONE interprocedural value-flow engine.** Fold the origin-recognition work (effect-client, repo, tx-alias — ADR-061) + user-data taint (req→constrained sink) into a single UBG pass. Multiplies across all languages. | ◑ **DONE-WHEN MET (ADR-064, Claude).** Taint now follows destructuring + identifier aliases (the dominant handler shapes it missed); O2 is proof-grade on a proven request→constrained-column flow (`tainted:true`, source→sink); flagship `UNGUARDED_MUTATION` carries the taint clause on the common idiom (was silent). Sound/additive: taint under-approximates, only decorates emitted findings; conservative O2 still fires when taint sees nothing. Remaining depth: the full origin-recognition merge into one pass. **Interprocedural taint DONE (ADR-066):** taint now crosses the helper-call boundary (`saveItem(req.body)` → the write inside taints), MUST-analysis, multi-hop, proof-grade O2 through the call. |
| **3** ◑ | credibility-depth | R7.2 · ADR-065 | **Partial evaluation of routing/wiring.** Symbolically unroll `for (c of controllers) app.use(...)` / registry loops to see framework-ized routes (directus/parse-server class). | ◑ **Strapi DONE (ADR-065, Claude).** New `strapi.js` partially evaluates the declarative route table + unrolls `createCoreRouter` to CRUD + resolves handler strings cross-file; a Strapi app that read 0 routes now reads its real entrypoints, honestly guarded via the ADR-055 posture (no false PROVEN). Remaining: directus/parse-server registry-loop shape (Express routers mounted in a controllers loop — same technique, different structure). |
| **4** | credibility (both) | R7.5 | **Adapter DSL.** An extractor = ~40 declarative lines, not 300 (ORM/framework). Makes depth-per-framework AND breadth cheap — the force multiplier for 1–3 and 5. | 2+ existing extractors ported; a new one added in <1 day |
| **5** | credibility-depth | audit (E-058 tail) | **Finish TypeORM + ORM tail.** `manager.save`, active-record `Entity.save`, and parse `@Entity` classes into `state` nodes (so O3/O5 fire on TypeORM-only apps). Same for the remaining ORMs. | a TypeORM-only app gets aggregate/atomicity proofs |
| **6** | credibility-breadth | R7.5 + new | **tree-sitter substrate (ADR first).** One grammar-runtime → deep breadth (Go/Ruby/Java/PHP/C#) via the DSL. Gate: only AFTER JS/TS recall is high. Keep OpenAPI (0-dep, ∞ shallow-but-sound) as the always-on breadth. | one non-JS/Python language compiles to UBG deep |
| **7** | **moat** | R6 | **Genome bricks.** Antibody envelope (re-key by `behaviorHash`, signed, structure+lesson only, `heal --check`-proven) + backplane (public git repo of signed content-addressed antibodies, pull-on-compile, offline-first). Consumes Gemini's mined antibodies. | a second repo inherits a diagnosis it never computed |
| **8** | **moat** | M6 · SBIR | **UBG/SBIR as an open standard.** Formalize the spec doc + a JSON Schema + a round-trip conformance test (`emit→ingest` already exists in `verify`). The rails everyone builds on. | an external tool can read/emit a valid UBG |

## Sequence (phases — each phase's depth work is validated by the phase-0 loop)

- **Phase 0 — the compass (do first).** Task 0. Without a live recall number, all depth work is blind.
- **Phase 1 — lift the number (credibility).** Tasks 1 → 2 (the two biggest measured levers), then 5.
  Re-run the loop after each; ship the lift as the credibility artifact ("recall X%→Y%, offline").
- **Phase 2 — cheap breadth (credibility).** Task 4 (DSL) → 3 (partial eval) → 6 (tree-sitter, ADR).
  OpenAPI stays sound throughout — it's "any backend" *today*.
- **Phase 3 — convert credibility to moat.** Tasks 7 (genome) + 8 (standard). This is where the users
  that credibility earned start compounding into the network effect.

## Explicitly NOT Fable's job

- **Distribution / first user / pitch / registries** → Zak (the demand side; the plugin/Action
  saturation, the design partner, the recall number turned into a public artifact).
- **Genome mining at scale** → Gemini (`GENOME-MINING-TASK.md`) — produces the antibodies Task 7 consumes.
- **Business decisions** (license, what ships, the narrative surface) → Zak.

## The one line to keep

> Fable makes the number go up (credibility) and builds the rails+registry (moat); Zak turns the
> number into users; Gemini turns public history into antibodies. One UBG, bricks that compose, a
> loop that measures — zero infra, never a false green.
