# A brief for a stronger mind

> You are reading this because you can hold more of SPARDA in your head at once than the
> people who built it. This file is not a task list. It is an honest map of where we are
> stuck, what we already tried, why the obvious fix is usually wrong, and which walls —
> if you break them — turn this from a good tool into something there is no substitute for.
>
> Everything here is measurable. If a number in this file disagrees with the repository,
> **the repository is right and this file is stale** — say so, and tell us which commit
> moved it.

---

## 0. The one sentence that must survive you

**SPARDA may be wrong by over-flagging. It may never be wrong by staying silent.**

Every other rule in this document is a consequence of that one. A change that makes SPARDA
faster, broader, prettier or more popular, and that lets one real ungated mutation read as
proven, is not an improvement — it is the end of the product. There is no gain that buys it
back, because the entire value proposition is *"you can trust the green."*

Read `docs/SOUNDNESS.md` before you read anything else. It is short, and it is the contract.

---

## 1. What SPARDA actually is

A **behavior compiler**. Backend source (+ schema) → a deterministic **UBG** (Unified
Behavior Graph) → proofs over that graph.

```
detect → parse (Babel/AST, per framework) → extract effects & guards →
resolve (interprocedural, bounded, memoized) → translate → UBG →
apocalypse (rules) + blindspots (the ledger) + premise (the oracles) → a verdict word
```

Seven verdict words, in `verdictState`:

| word | means |
|---|---|
| `PROVEN` | every mutation is dominated by a guard SPARDA saw deny |
| `PROVEN (ENFORCED)` | same, but one guard is a boundary check SPARDA itself synthesized — always disclosed |
| `PARTIAL` | proved what it saw; coverage or blind spots too low to claim more |
| `RISKY` | findings exist and they are real |
| `SURFACE` / `NO_PROOF` | almost nothing resolved — the analysis has no subject |
| `NOT_PROVEN` | hard findings stand |
| `PREMISE_GAP` | an oracle found a route the compiler never saw. **Deliberately not PARTIAL**: PARTIAL means "proved what was seen"; a gap means "what was seen was not the app" |

Non-negotiable engineering facts about the thing you are modifying:

- **4 runtime dependencies**, exact-pinned: `@babel/parser`, `@babel/traverse`,
  `@clack/prompts`, `@modelcontextprotocol/sdk`. This is a selling point, not an accident.
- **ESM, Node ≥ 18.** ~13k lines in `src/ubg/`.
- **stdout is the MCP protocol.** Human logs go to stderr. Always.
- **Deterministic**: same input → byte-identical UBG. Non-determinism is a bug, not a
  tradeoff.
- **The host never pays.** Nothing heavy on the request path of the app being analysed.
- **LLM output is advisory, never required, and always sanitized** before storage or display.

---

## 2. How to prove anything you claim

This is the most valuable part of this file. Do not skip it. We have been burned by
plausible reasoning that measurement contradicted, more than once, in both directions.

### The instruments

```bash
npm test                                  # 1183 tests
npm run mutation                          # 107 mutants — all must die
npm run release:check                     # the release gate (ADR-087)
SPARDA_CORPUS=/path node scripts/corpus-oracle.mjs           # 7 real apps, pinned
SPARDA_CORPUS=/path node scripts/corpus-oracle.mjs --update  # re-baseline (ON PURPOSE ONLY)
```

### The A/B protocol that actually isolates a change

Fixtures prove a feature works. **They cannot prove a change did no collateral damage.**
For that, permute the extractor against a frozen corpus:

1. Clone the seven giants, `git checkout` each to the exact `_pinned.commit` in
   `corpus.snapshot.json`. Do not measure a moving tree against a frozen baseline — that
   drift is uninterpretable, and re-baselining reflexively is how a regression becomes the
   norm (E-088).
2. Run the oracle on your branch. Run it again with the single file you changed reverted.
   Diff the two.
3. When a metric moves, **do not accept the aggregate**. Aggregates hide inversions. Compare
   the SETS:
   - every `file:line` that carried an effect, before and after;
   - every route, and its per-route effect counts, before and after;
   - every finding, before and after.

A worked example, from a real session: ADR-089 moved twenty's `dbWrites` from 813 to 812.
The aggregate said "an effect was lost", which would have been a Direction 1 violation. The
sets said: 509 distinct write locations before and after, 476 routes with writes and
identical per-route counts, 31 findings both ways. Only a node ordinal had shifted, because
guard steps are prepended to the chain. **One number lied; three sets told the truth.**

### The obligation when findings go DOWN

`docs/SOUNDNESS.md` §3c. "Fewer findings" is two different things, told apart by the flagged
SET and never by the count:

- **UNSAFE** — a route that was flagged stops being flagged, or a severity drops below the
  gate. That is a false negative whatever the justification. Reject.
- **SAFE** — the same routes stay flagged at the same severity, and only duplicates of one
  problem on one route collapse.

Show the flagged set before and after, on a **real corpus app**, not a fixture. Anything kept
out of the report must survive in `evidence`.

### The rule about skipped checks

The corpus oracle prints `SKIP` for apps nobody cloned. Twice now, a change shipped with its
effect on five NestJS giants simply not taken, because the author had one small repro repo
(E-098, E-100). **A skipped check is a debt, not a pass.** If you cannot measure something,
name it in your report. `dub` currently cannot be cloned from our environment; if you can,
measure it — it is the app with the highest coverage (97.9 %) and 75 findings, and nobody has
looked at whether those 75 are real.

---

## 3. The invariants — breaking any of these is a regression, whatever it buys

These are SPARDA's identity. A change that violates one is not a trade-off we would consider;
it is a different product with the same name.

1. **Direction 1 — effects are OVER-approximated.** An effect the concrete program can execute
   is in the graph, or traced as a blind spot. Never silently dropped.
2. **Direction 2 — guards are UNDER-approximated.** A guard reads `verified` only on a deny
   SPARDA actually saw. Never fabricated to silence a finding.
3. **Direction 3 — the route SET is OVER-approximated.** A route the app serves is an
   entrypoint, or a DECLARED unknown handler, or a measured premise gap. A file that is never
   opened produces no route, no skip and no unknown handler — that silence is the failure mode
   that produced every false PROVEN we have ever shipped (E-067…E-071, E-080, E-092).
4. **A registration is MODELLED or DECLARED — never dropped.** Every `continue` in a
   registration dispatch either registers something or emits an `UnknownHandler` plus a
   high-risk blind spot.
5. **An oracle may not import an extractor.** An oracle that reuses the analyser's walk is a
   mirror: it reproduces the bug on both sides of the diff and confirms it instead of finding
   it (ADR-082). This rule found nocodb's real premise gap.
6. **Every module that grades a graph calls `premiseFor`.** A guarantee is universal or it is
   false. An organ reachable from some consumers buys confidence it has not earned (ADR-083).
7. **"Could not measure" ≠ "measured nothing wrong."** Everywhere. Coverage `0/0` is
   `unknown`, not `100%`. An oracle that enumerated nothing is `available: false`, not "no
   gaps". An unreachable registry is `UNVERIFIED`, not a pass. This distinction *is* the
   product.
8. **New behaviour ships with tests; new soundness-critical lines ship with a killing mutant.**
   A guarded line with no test that bites is behaviour with no guardian.
9. **No new runtime dependency** without an ADR. Four is a feature.
10. **`sparda remove` leaves a byte-for-byte clean diff.** Anything SPARDA writes into a user's
    app is marked, idempotent, backed up, and reversible.

If you believe one of these rules is wrong, **say so explicitly and argue it** — do not route
around it. We changed ADR-086's counting rule because someone made that argument well. But a
change that quietly weakens one of these while claiming a different benefit is the single
thing we will reject on sight.

---

## 4. Where we actually are (verifiable, 2026-07-28, `sparda-mcp@0.70.1`)

```
app          verdict       routes   coverage   findings   guards verified/total
dub          NOT_PROVEN      593      97.9%        75          516/516
novu         NOT_PROVEN      451      15.1%         4          411/782
cal.com      NOT_PROVEN      177      94.3%        12          252/436
twenty       NOT_PROVEN      579      77.0%        14          583/1868
immich       PARTIAL         281      55.9%         0          459/459
nocodb       PREMISE_GAP     566      47.6%        13            9/899
ghostfolio   RISKY           115      76.0%         1           98/193
```

**Read that table honestly: not one real application reads `PROVEN`.** Seven serious
open-source backends, ~2,762 routes, and the strongest verdict we produce on any of them is
`PARTIAL` (immich, on zero findings and 55.9 % coverage).

That is either
- (a) the correct answer — real apps genuinely are not provable, and our job is to say so; or
- (b) evidence that the bar is mis-specified, or that we are blind in a way we have not named.

**We do not know which, and we would very much like you to tell us.** It is the single most
important open question about this product, and it is not primarily a coding question.

---

## 5. The walls

Each wall: what we see, what we tried, why the obvious fix is wrong, and what breaking it buys.
Take any of them. Take none of them and take something we did not see — that is also a good
answer, provided you can measure it.

### W1 — An unresolved call leaves no trace at all

**What we see.** The interprocedural resolver (`src/ubg/resolve.js`) follows
`this.<prop>.<method>()` through the constructor-DI graph, bounded and memoized. When it
*fails* — the class is not found, the method is not in the chain, the depth cap hits — it
returns `null` and the walk simply continues. No effect, no skip entry, no blind spot.

**Measured**: on novu, **1,479 of 2,039 constructor-DI hops resolved to nothing.** Silently.

**Why it matters.** This is a Direction 1 hole at the resolver boundary. A route whose entire
behaviour lives behind failed hops resolves to *zero behaviour*, and a route with zero
behaviour has nothing to flag — it reads `SURFACE` at coverage `unknown`, not `blind`. We
proved this is not theoretical: a fixture with an unguarded `deleteMany` behind a workspace
barrel produced **no finding at all** before ADR-088 (E-097).

**The entangled trap.** 750 of novu's blind spots are `.execute(command)` calls on injected
CQRS use cases, recorded as `db_read` with an unknown table. That is a *misclassification* —
`usecase.execute(cmd)` is not a database read — and the raw-SQL fallback in `extract.js` fires
on the METHOD NAME with no database provenance. **But you cannot simply delete the phantom.**
It is currently the only trace an unresolved hop leaves *anywhere*. Removing the label without
first giving unresolved hops a real `unresolved-call` blind spot converts an honest
over-approximation into a silent loss — the exact inversion Direction 1 forbids. The two
changes are one change.

**What breaking it buys.** Coverage stops being a fiction on every DI-heavy app. More
importantly, the ledger starts describing the actual shape of our blindness, which is the
prerequisite for closing it.

**Where to look.** `src/ubg/resolve.js` (`classBundle`, `followCalls`, `classMethodBundle`),
`src/ubg/extract.js` around the `query`/`execute` raw-SQL branch, `src/ubg/blindspots.js`
(`isOpaqueTarget`, and the four blind-spot kinds).

---

### W2 — Symbolic targets: we see the write and cannot name what it touches

**What we see.** twenty carries 139 high blind spots. They decompose as:

```
55  fs_write    with a computed path
41  http_call   with a computed URL
34  db_write    with an unresolved table (19 through a TypeORM queryRunner)
 7  blind mutations
 2  skipped surfaces
```

These are **honest**: SPARDA saw the effect and cannot resolve its target. They are also what
holds twenty at `PARTIAL`-or-worse even at zero findings, because a high blind spot is a hole
whose size we cannot know.

**What we tried.** Symbolic tables (`:collection`, param-derived) already exist and are
deliberately NOT counted as opaque — a symbolic answer is a precise answer expressed as a rule.
That machinery covers the easy cases. The hard ones are genuine dataflow: a path assembled
from three variables across two files, a URL built from config plus a template literal.

**Why the obvious fix is wrong.** Guessing a target — "it probably writes to `uploads/`" —
manufactures precision. If a guessed target ever suppresses a finding, that is Direction 2
violated by the back door. Any resolution must be *derived*, and anything not derived stays
opaque.

**What breaking it buys.** This is the last ~20 % of the strongest app in the corpus, and it
generalizes: computed targets are the residual blindness on every app above 70 % coverage. It
is the frontier where SPARDA stops being an AST reader and becomes an abstract interpreter in
the Cousot sense — which is what the README already claims lineage from.

**Honest framing:** this is a research project, not a patch. A partial, sound result (a lattice
that resolves 40 % of computed targets and abstains loudly on the rest) is worth far more to us
than a clever heuristic that resolves 90 % and is occasionally wrong.

---

### W3 — The blind-spot ledger points at the wrong line (E-099, OPEN)

**What we see.** A blind spot reached through a DI hop reports
`application-development.resolver.ts:21` — an `import` statement — while the `fs_write` it
describes is `this.fileStorageService.writeFile(…)` at
`application-development.service.ts:202`. The node's `loc.file` is the ENTRYPOINT's file; its
`loc.line` comes from the body actually scanned. **Two halves from different files:
individually correct, jointly meaningless.**

**Why it matters more than it looks.** The ledger is what SPARDA offers *instead of* a proof.
139 entries whose locations do not point at the code is not an honest answer — it is an
unusable one, and an unusable honest answer is how an honest tool gets ignored. It also made
W2 look like a research problem when a chunk of it is a reporting bug.

**The known shape of the fix.** Carry the declaring file alongside the line through the
resolver's merge, exactly as `helpers` already records `sourceFile`/`sourceLine`. We have not
done it because it touches the merge path on every lowering and will move corpus numbers; it
deserves its own change with a full A/B.

**What breaking it buys.** Cheap relative to W1/W2, and it makes every other blind-spot number
in this document actionable rather than decorative.

---

### W4 — Coverage may be a badly conditioned metric, and nobody has questioned it

**What we see.** `coverage = resolved / (resolved + blind)`. When ADR-088 taught the resolver
to cross workspace barrels, novu's *resolved* count nearly doubled (136 → 262) and its
coverage moved **14.8 % → 15.1 %** — because opening the repositories also revealed their own
unresolved calls, inflating the denominator in step.

**The question we cannot answer.** Is a metric whose denominator grows with its numerator
capable of expressing progress at all? Coverage is on the badge. It is in the verdict gate
(`PARTIAL` vs `PROVEN` turns on it). It is the number a user reads first. And we have never
audited whether it *means* what the gate assumes it means.

**What we are NOT asking for.** A metric that makes the numbers look better. If the honest
answer is "coverage on novu really is 15 % and that is the truth", we want that stated, with
the reasoning.

**What breaking it buys.** Either a defensible metric, or a defensible argument that this one
is already right. Both are worth more than the current situation, which is that we use it
without having examined it.

---

### W5 — No real application has ever read PROVEN

Section 4's table is the fact. The related, uncomfortable observation: SPARDA has *one*
historical `PROVEN` on real code (nocodb), and the premise verifier took it away — correctly,
because an oracle found a login endpoint the compiler had never seen (`POST
/auth/google/genTokenByCode`, still open as E-087: `nestjs.js` does not handle
`TemplateLiteral` decorator paths at all).

**The question.** Is `PROVEN` reachable on a real 500-route application? If yes, what is the
shortest honest path to the first one? If no, is a verdict word that nothing real can earn
doing useful work, or is it a promise the product cannot keep?

We are not asking you to lower the bar. We are asking whether the bar, as specified, is the
right bar — and if it is, what the concrete gap is between it and, say, immich (0 findings,
459/459 guards verified, held at PARTIAL by 55.9 % coverage and blind spots).

---

### W6 — Whole-program recompilation: there is no incrementality

**What we see.** Every command recompiles the app from scratch. twenty takes ~4 s. There is
memoization *within* a compile (class-method bundles, DI paths — twenty took 34 s without it,
E-027) but nothing *across* compiles.

**Why it matters.** The two highest-value surfaces both need sub-second answers:
- the **VS Code extension** (`extensions/vscode/`) re-proves the workspace on demand; on a
  monorepo that is seconds of spinner per keystroke-adjacent action;
- the **agent edit loop** — `sparda gate` in Claude Code's PostToolUse hook — pays that cost on
  *every AI edit*, which is precisely the loop the product exists to close.

**What breaking it buys.** This is the difference between "a tool you run" and "a tool that is
simply on." A UBG that updates in milliseconds when one file changes makes SPARDA a live
invariant, not a batch job — and that is the product we are actually trying to build.

**The constraint that makes it hard.** Determinism is non-negotiable: an incremental compile
must produce a graph *byte-identical* to the full compile, or the cache becomes a source of
verdicts nobody can reproduce. The seal (`fingerprint.js`, `schema.js` canonicalization) is
where you would prove that.

---

### W7 — Only two premise oracles, and they cover the frameworks unevenly

**What we see.** Direction 3 needs an oracle that is *not* the analyser. We have two: a runtime
probe (`PROBEABLE`: express/fastapi/flask — boots the app, so never used on the corpus) and a
boot-free convention oracle (`CONVENTION_ROUTED`: nextjs/medusa/strapi/nestjs, a directory
walk). `src/ubg/premise.js`, `src/ubg/oracle-static.js`.

**The gap.** The convention oracle is deliberately conservative — it emits only what the
framework *definitely* serves, and abstains on every ambiguous convention (Strapi's pluralised
core routers, Next's parallel slots, computed controller prefixes). That conservatism is
correct (a false gap withholds a verdict from a healthy app, and a tool that does that gets
switched off), but it means Direction 3's coverage is thin exactly where frameworks are
expressive.

**What a third oracle could be.** An app's own build output; an emitted OpenAPI document; the
framework's route table dumped by its own CLI; a container's routing table. Anything that is
*independent evidence of what is served*. Constraint: it may not import an extractor (§3.5).

**What breaking it buys.** Direction 3 is the direction that produced every false PROVEN in our
history and the one we have the weakest instruments for. A third independent oracle is the
highest-leverage soundness work available.

---

### W8 — The proof is not portable

**What we see.** SPARDA produces a verdict, a seal, a capsule, proof objects, a badge. To
*check* any of it, you re-run SPARDA. There is no artefact a third party can independently
verify without trusting our implementation.

**The question.** Could a SPARDA proof become a **certificate** — something small, signed,
and checkable by a program that is not SPARDA? Proof-carrying code has a literature; we have
never seriously asked whether the UBG's discharge obligations can be emitted in a form an
independent checker can re-derive.

**What breaking it buys.** The whole trust story becomes transferable. "AI writes, SPARDA
proves" is currently "trust SPARDA." A checkable certificate turns it into "check it
yourself." That is the difference between a tool and an institution, and it is probably the
most valuable thing in this document — and the least likely to be attempted, which is exactly
why we are naming it for a stronger reasoner.

---

### W9 — Guards are almost boolean; authorization is not

**What we see.** A guard is `asserted` (trusted by name) or `verified` (a proven deny). What
a guard *authorizes* is barely modelled: object-level authorization (BOLA/IDOR) is
**advisory only** (`OBJECT_SCOPE_UNPROVEN`, the O7 rung, the interprocedural ownership
witness of ADR-074), because we can prove "someone was denied" far more easily than "this
someone may touch this object."

**Why we stopped there.** Advisory was the honest stopping point: a guessed ownership model
that suppresses a finding is Direction 2 violated. But it means the single most common real
vulnerability class in modern web apps is something SPARDA points at rather than proves.

**What breaking it buys.** Proof-grade object scope would move SPARDA from "is this route
gated" to "is this route gated *for this actor, on this object*" — a different and much larger
product. It needs the taint/dataflow substrate (ADR-P1) that has been deferred repeatedly.

---

### W10 — Reach: two language families, and a long tail

JS/TS (Express, Next, NestJS, Medusa, Strapi) and Python (FastAPI, Flask) — plus any language
via emitted OpenAPI, which buys the route SET but none of the behaviour. Go, Java/Kotlin,
Ruby, PHP, C# are absent.

We list this last deliberately. **Breadth is the least interesting axis** and the most
tempting: a new lowering is visible, demoable, and does not require thinking hard about
soundness. A new framework that ships without answering "how is its premise checked?" (§3.6,
SOUNDNESS 4b) makes the product *worse*, because it adds surface the honesty organs cannot
reach. If you add a lowering, the oracle comes with it or it does not ship.

---

## 6. Where we are probably blind in ways we have not named

Honest speculation. We would rather you attack these than confirm them.

- **The corpus is seven apps, all open-source, all popular, all JS/TS-or-Python.** Selection
  bias is unmeasured. A corpus of *badly written* apps might tell us something the corpus of
  well-maintained ones cannot.
- **We have never adversarially attacked the premise oracles themselves.** We attack the
  extractor constantly (fixtures, mutants, the sealing certificates). An app crafted to make
  the convention oracle enumerate a route that is *not* served would produce a false
  `PREMISE_GAP` — annoying, not dangerous. The reverse is the dangerous one, and we have not
  tried hard to build it.
- **`falsify` ablates guards and demands the finding return.** Nobody has asked what the
  analogous test is for *effects* — ablate an effect and demand the proof notice.
- **The mutation harness is 107 hand-written mutants on lines we already thought about.** An
  AI fuzzing campaign (`tools/fuzzer/`) ran 2,224 mutants with 0 survivors, but its report
  (`bilan-fuzzing-ia.md`) is honest that an unknown fraction were killed by the *parser*, not
  the suite, and that the model only ever saw the first 3,000 characters of three files. The
  real coverage of our guardian tests is **not known**.
- **Nobody has audited the 75 findings on dub** — the highest-coverage app we have.
- **Performance beyond "it finishes"** has never been profiled against a target.

---

## 7. What we are NOT asking for

State this back to us if you disagree, but do not silently do it:

- A rewrite. The UBG's shape, the verdict vocabulary and the three directions are the product.
- A new runtime dependency without an ADR arguing it.
- A heuristic that improves aggregate numbers by guessing. Aggregates are not evidence.
- Anything that makes a verdict non-deterministic or environment-dependent.
- An escape hatch, anywhere. Not in the release gate, not in the analysis, not behind a flag.
  "The one release that skips the gate is the release that needed it" is written in ADR-087
  because it happened.
- Breadth (new frameworks, new languages) at the expense of the honesty organs.
- Optimism in the UI. `UNKNOWN` is not green. A verdict SPARDA did not obtain is never shown
  as one it did.

---

## 8. What a good answer looks like

Not a pull request full of code. A pull request full of **measured** code.

1. **Name the wall** you attacked, or the one you found that is not in this file.
2. **State the mechanism** — what SPARDA was doing, why it was wrong, in terms of the three
   directions.
3. **Measure it, isolated.** Same clones, same pinned commits, your change permuted in and
   out. Sets, not aggregates (§2).
4. **Say which direction the verdict moved and why that is the safe one.** If an app got
   *worse*, that is often the correct result — novu went PARTIAL → NOT_PROVEN when we made it
   see 80 database writes it had been blind to, and that was the whole point.
5. **Ship the guardian.** A test that fails without your change, and a mutant in
   `tests/mutation/run.mjs` that dies because of it.
6. **Write the ADR** in `docs/DECISIONS.md` and, if something broke on the way, the `E-` entry
   in `docs/ERRORS.md`. Both files are append-only institutional memory; they are why this
   brief could be written at all.
7. **Say what you could not measure.** Explicitly. "I could not clone dub" is a fine sentence.
   "It should be fine" is not.

---

## 9. Where to start reading

| file | why |
|---|---|
| `docs/SOUNDNESS.md` | the contract. Read first, read twice. |
| `docs/HANDOFF.md` | current state, most recent brick last |
| `docs/DECISIONS.md` | 89 ADRs. The *reasoning*, not just the outcomes. |
| `docs/ERRORS.md` | 104 entries (E-001…E-103). Every bug, its root cause, and the rule it produced. **This is where the real map of our blindness is.** |
| `docs/ARCHITECTURE.md` | the pipeline and the `sparda.json` schema |
| `src/ubg/resolve.js` | the interprocedural engine — W1 lives here |
| `src/ubg/blindspots.js` | the honesty organ — W3, W4 live here |
| `src/ubg/premise.js`, `oracle-static.js` | Direction 3's instruments — W7 |
| `src/ubg/apocalypse.js` | the rules and `verdictOf` — W5 |
| `scripts/corpus-oracle.mjs` | the regression net on real code |

---

## 10. A closing word, meant sincerely

SPARDA's best moments have all had the same shape: someone measured something they assumed,
found the assumption false, and the tool got **worse-looking and more honest** in the same
commit. twenty went from 2 high findings to 28 when we stopped reading a quarter of it. novu
went from a clean PARTIAL to NOT_PROVEN when we stopped losing 80 of its database writes.

If your best contribution is to prove that a number in section 4 is a lie, that is a better
outcome than a new feature. We will take it, we will record it, and we will thank you for it.

The one thing we ask is that you leave SPARDA still able to say **"I could not measure that"**
— clearly, loudly, and by construction. Everything else is negotiable. That is not.
