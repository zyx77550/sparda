# 2026-07-26 — The invariant on seven lowerings + the boot-free premise oracle (ADR-082)

**Scope:** close the three gaps the previous session declared as "not done" — the
registration invariant on the six non-Express lowerings, the certificate that swept
Express alone, and the four frameworks whose premise could not be checked because the
probe cannot boot them. Plus the parse-server entry-detection bug.
**Branch:** `claude/sparda-hq-robustness-fy1ttv` (on top of the merged PR #25)
**Tests:** 1085 ✓ (+94) · mutants 77/77 (+11) · ESLint 0 · Prettier clean · 4 deps

## The three holes, and what closed each

### 1. The invariant stopped at Express (E-080)

ADR-079 says a registration is either MODELLED or DECLARED. It was an Express rule with
an Express seal. Six lowerings could still lose a live endpoint on all three channels at
once — no route, no skip, no unknown handler. One path per lowering, all six closed:

| lowering | what vanished |
|---|---|
| next | the whole subtree under `[...slug]` / `@slot` / `(..)x` — behind a directory skip carrying **no risk**, i.e. below `blindHigh` |
| next | an unparseable `middleware.ts` — the app's only global gate |
| medusa | `export const POST = registry.handler` — the verb is exported, so Medusa serves it |
| strapi | a route table entry resolved to a controller action that does not exist |
| openapi | any path-item member outside the verb list — in the lowering whose premise is that the spec IS the declaration |
| fastapi | a decorator whose path is not a literal |

Measured on `nextjs-basic`: `app/api/docs/[...slug]/route.js` serves GET and appeared
nowhere in the report.

Next deliberately does **not** synthesize a URL for an unrouted subtree. SPARDA does not
know the path, and inventing one would misplace every guard judgement about the route —
the same reasoning as E-078.

### 2. The certificate swept Express alone

`tests/no-silent-loss-fleet.test.js`: the same method, six more times. Each sweep
re-enumerates the declared surface with an **independent** implementation — its own file
walk, its own AST or spec read — and demands the extractor account for every item.

The independence matters more off Express than on it: the non-Express lowerings decide
*which files to parse* with their own filters (a candidate regex, a filename convention,
a directory layout). A file the extractor never opens produces nothing at all, which is
the one shape of failure a self-reported coverage number cannot see. This sweep opens
every file itself.

Guarded against vacuity by a **corpus-total surface floor per framework**, not a
per-fixture one — some fixtures legitimately declare their surface another way (Flask
class-based views, Next server actions). The killing mutant blinds an enumerator and the
floor bites.

`tests/registration-invariant-fleet.test.js` is the third leg: a named fixture per
lowering, each asserting the declaration **and** that the app can no longer read PROVEN.
A declaration nobody grades is a log line.

### 3. Four lowerings had no premise oracle (ADR-082, E-082)

`verifyPremise` boots the app. Next, Medusa, Strapi and Nest cannot be booted from a
static checkout — so the strongest honesty organ in the system covered 3/7 of the product.

`src/ubg/oracle-static.js` derives the route table from what those frameworks actually
route on: the filesystem (Next, Medusa), the literal `{method, path}` pairs (Strapi), the
decorators re-read by a walk that pre-filters nothing (Nest).

**It runs unasked.** The runtime oracle is opt-in because it executes the target's code.
This one reads directories, so gating it behind a flag would be withholding a free
honesty check — and a check that must be requested is a check nobody runs.

## Decisions worth keeping

- **The independence rule, promoted from the tests into the product.** `oracle-static.js`
  may not import an extractor. An oracle that reuses the analyser's walk is a mirror: the
  bug is reproduced faithfully on both sides of the diff and the comparison confirms it.
- **Conservatism decides the design.** A false gap takes the verdict from a healthy app,
  and a tool that does that is off within a week. Every ambiguous convention is LEFT OUT,
  not guessed: Strapi's pluralised core routers (reproducing its pluraliser is a guess),
  Next's parallel slots and catch-alls, a computed controller prefix. Those shapes are
  already carried by the ledger — the oracle only looks for surface nobody carried.
  **Measured: 27 convention-routed fixtures, 26 of them healthy, exactly 1 gap — in
  the one fixture built to have one.**
- **A declared hole is not a gap.** `unknownHandlers` are suppressed from the oracle's
  input, keyed on file **and** verb — never file alone, or one unreadable export blinds
  the oracle to every other export in the module.
- **An empty enumeration is `unavailable`, never "no gaps"** — the same rail as the empty
  probe, with the same killing mutant. A silent oracle must never read as a clean bill.

## What the new oracle found on its first sweep

- **E-081 — `app/dist/route.ts`.** Next serves it at `/dist`; `dist` means nothing to the
  router. The extractor filtered it as build output, so it produced no route, no skip and
  no unknown handler. **No invariant about *seen* registrations could have caught this** —
  the file was never opened. That is precisely why the oracle has to be independent.
- **Next's Pages Router.** `pages/api/**` is still fully served by Next 14 and SPARDA has
  no lowering for it. Previously a total silence; now a measured premise gap, `exit 1`.

## Also shipped

**Q1 — entry detection.** `searchExpressEntry` returns every candidate; `compile` declares
a GUESSED entry at high risk, naming the rejected candidates, when more than one file
constructs an Express app. On the parse-server repo the search picked
`benchmark/performance.js`; it now resolves `src/ParseServer.ts`.

## Not done / deferred

- **Python** still has no conditional marking, no declaration order and no registration
  invariant on the Express model. Its `unknownHandlers` channel exists but covers one shape.
- **OpenAPI has no premise oracle and never will.** There the spec IS the premise; the only
  second source of truth is the app it claims to describe, which SPARDA does not have.
- **Strapi's core routers are outside the oracle.** Reproducing the pluraliser is the work
  that would close it, and it must be verified against a real Strapi app, not invented here.
- The convention oracle now runs on every `prove` for four frameworks. It parses files the
  extractor also parses; on a very large monorepo that cost has not been measured.

## Notes for the next session

- `CONVENTION_ROUTED` is the honest boundary of the boot-free oracle, exactly as `PROBEABLE`
  is for the runtime one. Adding a framework is a claim that the enumeration reproduces its
  routing rules — verify against a real app before widening.
- The corpus sweep in `tests/premise-convention.test.js` ("zero premise gaps" on every
  convention fixture) is the regression net that makes widening safe. Run it first.

## Addendum — the documentation debt this session created, and closed

Auditing the session against `docs/README.md`'s own update conditions turned up five
docs that the work obliged and that the first two commits had not touched. The gaps were
real, not cosmetic:

- **`SOUNDNESS.md` was the serious one.** It described a **two-direction** safety contract
  for a system that had grown a third. The premise verifier (ADR-081) and the boot-free
  oracle (ADR-082) enforce a rule the document never stated — *the route SET is
  over-approximated* — along with its dual, *an oracle's own claims are
  under-approximated*, which is exactly the reasoning that keeps Strapi's core routers out
  of `oracle-static.js`. That rule lived only in source comments and ADRs, i.e. nowhere an
  external auditor reads before deciding whether SPARDA may say "proves". Direction 3 is
  now written, with its two rails (empty enumeration = `unavailable`; an oracle may not
  import an extractor) and its own Mechanized table.
- **`ARCHITECTURE.md`** listed neither `premise.js` nor `oracle-static.js`, and the file
  map still claimed "389 Vitest" against a suite of 1085. The premise verifier is now
  described where it belongs — explicitly OUTSIDE the consumer list, because every
  consumer reasons over the graph and is therefore blind to what is missing from it.
- **`TESTING.md`** did not mention the mutation harness at all, though it is the net that
  caught the most this session, and its "new framework" acceptance bar was three items
  when the honest bar is now five (a fleet-certificate enumerator and an explicit premise
  answer were missing). Both fixed, plus the two traps the harness has already cost us
  (mutated residue surviving a `git stash`; `⚠ target moved` counting as survived).
- **`README.md`** promised `PROVEN (PARTIAL)` as the worst case. Since this session
  `prove` can emit `PREMISE NOT VERIFIED` with no flag on four frameworks — a stronger
  negative, and a user-visible one.
- **`CLAUDE.md`** gained two hard rules that had been enforced in code and tests but never
  written as law: the registration invariant, and "an oracle may not import an extractor".
  Rule 11 now also requires `npm run mutation` green before a push, which is what the
  session actually practised.

The lesson worth carrying: **the docs debt was invisible from inside the work.** Both
code commits were green, sealed and mutant-covered, and the session still ended with a
safety contract describing an engine that no longer existed. Auditing against the
`docs/README.md` table — one row at a time, condition by condition — is what surfaced it,
and it takes five minutes.
