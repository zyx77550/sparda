# 2026-07-26 — The premise verifier + the ghost verbs, fleet-wide (ADR-081)

**Scope:** wire the runtime oracle to the PROVEN gate; kill E-067 on the four non-Express
lowerings; start the registration invariant outside Express.
**Branch:** `claude/sparda-hq-robustness-fy1ttv` (on top of PR #25)
**Tests:** 991 ✓ (+19) · mutants 66/66 (+5) · ESLint 0 · Prettier clean · 4 deps

## The measurement that justified the session

Parse Server, installed from npm and deployed exactly as its own docs prescribe:

| | routes |
|---|---|
| static analysis | **1** (`GET /health`) |
| the framework actually builds | **90** |
| **gaps** | **89** |

Before: `◐ SURFACE ONLY`, **exit 0**. SPARDA reported on 1/90 of the app and said nothing
about the rest. After: `✗ PREMISE NOT VERIFIED`, the 89 listed, **exit 1**.

The 89 are not a new bug — `app.use('/parse', server.app)` mounts a sub-app from
node_modules, which the extractor does not follow by design. The point is that this
structural limit was **silent**, and is now **loud and measured**.

## Done

- **`src/ubg/premise.js` (E-079).** Boots the app, diffs the framework's real route table
  against the compiled entrypoints. A gap enters the ledger at CRITICAL risk, sets
  `premiseUnverified` → new `PREMISE_GAP` verdict state, and fails the CI gate.
- **E-077 — ghost verbs on the fleet.** Nest `@All`/`@Options`/`@Head` (+ the candidate
  pre-filter, or the file is never parsed), Next `OPTIONS`/`HEAD`, OpenAPI and Python
  `options`/`head`/`trace`. `@All` is EXPANDED like `app.all`.
- **The correctness fix that had to ship with it.** Modelling OPTIONS/HEAD/TRACE makes them
  entrypoints, and `mutating: method !== 'get'` would then read every CORS pre-flight
  handler as a mutation. Mutation is now the RFC 9110 safe-method set.
- **E-078 — NestJS gains `unknownHandlers`.** A non-literal decorator path was silently
  mounted at the controller prefix — MISPLACED, not lost, which is worse: every guard and
  prefix judgement about that route was then about a URL the app does not serve.

## Decisions worth keeping

- **`PREMISE_GAP` is not `PARTIAL`.** PARTIAL means "proved what was seen". A premise gap
  means "what was seen was not the app". Both would contain the word PROVEN; only one of
  them is honest here.
- **An empty probe is `unavailable`, never "no gaps".** `probeRoutes` returns `[]` on
  internal failure, so the naive reading would let a BROKEN oracle silently confirm every
  proof. Killing mutant included.
- **The CI gate moved too.** A green over routes nobody analysed is the exact failure this
  audit spent three sessions removing. Costs existing callers nothing — `premiseGaps`
  defaults to 0, so only a run that ASKED for the oracle can trip it.

## Not done / deferred

- **`unknownHandlers` in Next / Medusa / Strapi / OpenAPI.** NestJS is the second of seven;
  five remain, and the sealing certificate still sweeps Express only.
- **The probe cannot boot Nest / Next / Medusa / Strapi**, so those report
  `available:false`. Extending the oracle (a Nest `RouterExplorer` dump, a Next manifest
  read) is the natural follow-on and would make the premise check universal.
- **Detection picked the wrong entry on the parse-server REPO** (`benchmark/performance.js`).
  Measured, not fixed — entry-point selection on a monorepo-shaped library is its own
  problem, and guessing at it here would have been scope creep.
- Python still has no conditional marking, no declaration order, no registration invariant.

## Notes for the next session

- `PROBEABLE` is the honest boundary of the premise check. Adding a framework to it is a
  claim that the oracle can boot it — verify with a real app before widening.
- The 89-gap Parse Server case is the best available demo of the whole thesis: the tool
  that says "I could not see 89 of your 90 routes" is worth more than the tool that
  confidently reports on one.
