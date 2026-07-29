# SOUNDNESS — the contract every feature obeys

> This is the promise under "AI writes, SPARDA proves." Not a style guide — a
> **safety contract**. Every analysis feature (a new ORM, a new framework, a guard
> idiom, taint) must preserve the three directions below. If it can't, it doesn't ship.
> Mechanized in `tests/soundness.test.js` and the sealing certificates.

## Lineage — we don't break the wall, we stand on Cousot's shoulders

Rice (1953) proved it: **any non-trivial semantic property of a program is
undecidable.** "Is this route guarded?" is exactly such a property. You cannot have a
procedure that is **sound** (never lies), **complete** (decides everything), and
**total** (halts on every program) — all three at once.

SPARDA does what abstract interpretation (Cousot & Cousot, 1977 — the theory behind
Astrée on Airbus, Infer at Meta) does: it **keeps sound + total, drops complete.** It
computes a decidable, terminating **over-approximation** of the program's behavior and
accepts "I don't know" (a false positive, a blindspot) rather than ever lying. The UBG
is that abstraction. This document states the abstraction relation precisely so it can
be defended.

## Two semantics

- **Concrete** — what the program actually does at runtime: the set of side effects it
  executes on a request (`db_write`, `http_call`, `fs_write`, …), and whether a request
  can be **denied** before reaching them.
- **Abstract** — the UBG: effect nodes, guard nodes (`verified` / `asserted`), a
  coverage ratio, and a blindspot ledger.

Soundness is a relation between the two, in **three directions** that must never invert.
Two of them are about what the analysis SAYS; the third is about what it is ABOUT.

## Direction 1 — effects are OVER-approximated (never lose a real one)

> If the concrete program can execute a side effect on a route, the UBG must either
> **contain that effect** or **record a blindspot** on that route. It may never
> silently drop it.

In practice:

- A body SPARDA cannot read is **opaque** (`meta.opaque`), not empty. "Read and found
  nothing" and "couldn't read" are different states, and the blindspot ledger keeps
  them apart.
- Imprecision (unresolved dynamic dispatch, an unfollowed call, a depth cutoff) lowers
  **coverage** — a visible number — it never removes an effect without a trace.
- **Corollary:** blindness degrades the verdict (toward `NO_PROOF` / `SURFACE` /
  `NOT_PROVEN`), it can never manufacture a clean `PROVEN`. A proof over ~none of the
  behavior is not a proof (E-037 / ADR-056).

## Direction 2 — guards are UNDER-approximated (never invent protection)

> A guard is marked `verified` **only** when SPARDA saw a real deny path — a
> `res.status(401/403)`, an auth exception, a `return false` inside a resolved
> `canActivate`, or a wrapper/verifier proven to deny. A guard we can't prove stays
> `asserted` (trusted by name, flagged unverified) or is left out entirely.

In practice:

- SPARDA never fabricates a guard to silence a finding. Every recognition feature (Nest
  `@UseGuards`, Next HOC wrappers, in-body verifiers) may suppress an
  `UNGUARDED_MUTATION` **only on a proven deny** — so a bug in one of them produces a
  false positive (noise), never a false negative (a hidden hole).
- An `opaque` step can never be `verified` — you cannot prove what you did not read.

## Direction 3 — the route SET is OVER-approximated (never lose the subject)

> If the concrete program serves a route, the UBG must either **contain that
> entrypoint**, or **declare it** (an `UnknownHandler` plus a high-risk blindspot — a
> registration SPARDA saw and could not bind), or **measure it as a premise gap** (an
> oracle found a route the compiler never saw at all). It may never silently omit it.

Directions 1 and 2 are about the CONTENTS of the analysis. This one is about its
SUBJECT, and it was added late because the failure it forbids is invisible from inside:

- **No instrument above can catch it.** Guard dominance, the type lock, the ledger,
  `falsify` — every organ reasons OVER the graph, so every one is blind to a route that
  is not IN the graph. `falsify` cannot ablate the guard of a route that does not exist.
  The false `PROVEN` verdicts of E-067…E-071 and E-080…E-081 were all absences, and not
  one of them was reachable by a better proof.
- **So it needs an oracle that is not the analyser** (ADR-081, ADR-082): the app booted
  and reporting its real route table, or the route table the framework's own file
  conventions imply. `src/ubg/premise.js` runs them; a gap enters the ledger at CRITICAL
  risk and yields `PREMISE_GAP` — deliberately *not* `PARTIAL`, because PARTIAL means
  "proved what was seen" and a gap means "what was seen was not the app".
- **The registration invariant** (ADR-079) is the same rule stated at the extractor
  boundary: a call on an app/router object is either MODELLED or DECLARED. An allowlist
  entry claiming a member cannot register a route is a deliberate, reviewable act.

### The dual — an oracle's own claims are UNDER-approximated

The oracle is subject to Direction 2's discipline, pointed at itself. A gap WITHHOLDS a
verdict, so a false gap is the safe kind of wrong — but a tool that takes the verdict
away from healthy apps is switched off within a week, and then it protects nobody. So an
oracle emits only what the framework **definitely** serves; every ambiguous convention is
left out rather than guessed (Strapi's pluralised core routers, Next's parallel slots, a
computed controller prefix). Those shapes are already carried by the ledger — the oracle
looks only for surface nobody carried at all.

Two rails make that auditable. An oracle that enumerated NOTHING is reported
`available:false`, never "no gaps" — otherwise a broken oracle silently confirms every
proof, the worst possible direction. And an oracle **may not import an extractor**: one
that reuses the analyser's walk is not an oracle but a mirror, reproducing a bug
faithfully on both sides of the diff and confirming it instead of finding it.

## The safety theorem (why the directions matter)

Because effects and the route set are over-approximated and guards are
under-approximated, **every imprecision pushes the verdict the SAFE way:**

> toward `NOT_PROVEN` / more findings (cry wolf) — never toward `PROVEN` / fewer
> findings (blindness).

This is the whole product. SPARDA is allowed to be wrong by **over-flagging**; it is not
allowed to be wrong by **staying silent on a real mutation.** A trust layer that can
lie the second way is worthless. dub's 147 false positives (v0.42.0) were the safe kind
of wrong; the moment a change lets a real ungated write read as `PROVEN`, the contract
is broken.

Direction 3 sharpens the theorem rather than extending it. An imprecision inside the
analysis costs coverage; an absence of the analysis costs nothing at all, and used to
IMPROVE the reading — SPARDA measured what it understood divided by what it understood,
so the blinder it got, the better its coverage looked. That is the one shape of
imprecision that pushed the verdict the unsafe way, and closing it is what Direction 3
is for.

## Honest assumptions (where soundness is CONDITIONAL — and made visible)

Soundness is relative to declared assumptions, exactly as Hoare/Dafny proofs are
relative to their annotations. SPARDA's assumptions are never hidden:

1. **Bounded depth** (`MAX_RESOLVE_DEPTH`, `MAX_CLASS_DEPTH`) — a widening operator. A
   call chain deeper than the bound is cut and **charged to coverage**, not assumed
   clean.
2. **Unresolved dispatch** (dynamic requires, reflection, opaque imports) — recorded as
   a blindspot, never resolved by guessing.
3. **Human contracts** (future, Hoare-style, in `sparda.json`) — an author may pin
   `{ "verifyToken": "grants-access" }`. The proof then holds **modulo** that pin, and
   the pin is part of the record.
4. **LLM output** is advisory and always sanitized (hard rule 7); it may raise a
   question, never silently downgrade a finding.

The rule binding all four: **an assumption must be visible** (in coverage, the blindspot
ledger, or a pinned contract). A silent assumption is the one bug this contract exists
to forbid — it is exactly how the tsconfig regression (E-039) hid: a failed parse
degraded to "no aliases" with no trace.

## The discipline — every feature proves it before it ships

1. Does it ever **drop an effect** the old code kept, without a coverage/blindspot
   trace? → reject.
2. Does it mark a guard `verified` **without a proven deny**? → reject.
3. Can a bug in it produce a **false negative** (fewer findings / a `PROVEN` that should
   be `NOT_PROVEN`)? → reject; re-gate so the failure mode is a false positive.
3b. Does it add a code path that can leave a registration **neither modelled nor
   declared**? → reject (Direction 3). Every `continue` in a registration dispatch must
   either register something or emit an `UnknownHandler`.
3c. Does it produce **fewer findings**? Then say which of the two kinds it is, and prove
   it. Item 3 forbids losing a finding; it does not forbid counting one finding once.
   The two are distinguished by the **flagged SET**, never by the count:
   - **UNSAFE** — a route that was flagged stops being flagged, or a severity drops below
     the gate. That is a false negative whatever the justification. → reject.
   - **SAFE** — the same routes stay flagged at the same severity, and only duplicates of
     one problem on one route collapse. The unit of a finding is the unit of its
     REMEDIATION (ADR-086): a rule fixed per route was never honestly counted per effect
     node, and a DI fan-out turned one missing compensation path into twelve lines.
   The proof obligation is concrete: show the flagged set before and after and show it is
   IDENTICAL, on a real corpus app, not a fixture. Anything kept out of the report must
   survive in `evidence` — "fewer lines" may never mean "less recorded".
3d. Does it emit a **number, a word, an `ok`, or a score** that a reader acts on? Then
   construct its UNMEASURED state and check what the HEADLINE says — not what the notes say.
   **Put the admission inside the number, never beside it.**

   This is item 7 of the honest-assumptions list, sharpened by five separate failures that all
   had the same shape. In none of them was the honest field missing:

   | where | the honest field, present | the headline that lied |
   |---|---|---|
   | premise (E-104) | `available: false` | `premiseGaps: 0` → **PROVEN** |
   | `falsify` | `note: 'nothing to falsify'` | `score: 1` |
   | `gate` | `abstained: <reason>` | `ok: true` |
   | `speculate` | `(by lookup)` | `✓ PROVEN` |
   | `immunize` | — | `✓ PROVEN` |

   Nobody ever wrote `available: true` for an oracle that had not run. The admission was
   simply placed NEXT TO the number instead of IN it — and a reader acts on the number, a
   dashboard graphs the number, a CI job branches on the number. The note is for someone who
   already suspects something is wrong, which is exactly the person who does not need it.

   `null` is the only value that carries its own caveat. **Not `0`, not `false`, not an empty
   array** — those are ANSWERS ("we measured, and the answer is none"). Only `null` says
   "there is no answer here", and only `null` cannot be summed, averaged, or shown green.

   If a surface has no expressible "I don't know", that is itself the finding: it will invent
   one under pressure. Mechanized in `tests/unmeasured-is-not-a-pass.test.js`, which is a
   REGISTRY — every new headline field adds a row, or the family reopens one leak at a time.

3e. **And then check that the state is REACHABLE.** A row that hand-constructs the unmeasured
   state proves the field can hold it. It proves nothing about whether any caller ever puts it
   there — and E-106 is that distinction costing a whole ADR. `buildCapsule(g, { premiseBasis:
   'unmeasured' }).proven === null` passed from the day it was written while all four call sites
   in `src/commands/` called `buildCapsule(canonical)` bare, so the three-state field was
   unreachable in the product and `immunize` printed an `UNMEASURED PREMISE` branch no input
   could produce. **A green row over a dead wire.**

   So every row owes two assertions:

   1. **EXPRESSIBLE** — the headline field can hold the unmeasured state. (hand-constructed)
   2. **REACHABLE** — a real call path actually produces it. (drive the command)

   Where the property is *wiring* rather than behaviour — "every call site passes this
   argument" — a source rule is the right instrument and not a compromise: wiring cannot be
   observed by running one command, which is exactly how four call sites stayed unwired under a
   green suite. Write it against the ARGUMENT, and keep a vacuity check that lists the sites, so
   the rule cannot quietly stop matching.

3f. **When a rule fails to catch something, ask what its SCOPE was.** ADR-083's structural
   guard was first scoped to `src/commands/` and found two more graders when widened to the
   repo. E-106 found two more still, because the widened rule was scoped to a *function name*
   (`verdictOf`/`badgeFor`) and `buildCapsule` is a second grader. Both times the gap was
   exactly the size of the scope. Key the predicate on the PROPERTY — "turns a compiled graph
   into a claim someone acts on" — and keep the list of such functions in one named place
   (`GRADERS`) so extending it is the obvious move rather than an insight.

4. Does it add a **runtime cost on the host request path** or a **new dependency**? →
   reject (hard rules 1, 8). Analysis-time compute is fine; host-time is not.
4a. **A new command that grades a compiled graph must call `premiseFor`.** Direction 3 is
   a property of the SYSTEM, not of one entry point: an organ reachable from one consumer
   out of seven is not a partial guarantee, it is a false one (ADR-083). Enforced
   structurally by `tests/premise-wired-everywhere.test.js`, which scans `src/commands/`.
4b. **A new framework must answer "how is its premise checked?"** — a runtime probe
   (`PROBEABLE`), a boot-free convention oracle (`CONVENTION_ROUTED`), or an explicit,
   written "neither, and here is why". Silence is the answer Direction 3 forbids.
5. Is it **deterministic** (same input → same UBG)? → required.
6. Corpus verdicts + finding sets stay **byte-identical** except where the change is the
   point, and the change moves the verdict the **safe** way. → required.

## Mechanized

`tests/soundness.test.js` locks the first two on the fixtures: no `verified` guard is
`opaque` (Direction 2), an unguarded mutation is always flagged while its guarded twin
is not (Direction 1 + the safety theorem — protection removed strictly _adds_ findings,
never removes them).

Direction 3 needs a different instrument, because a missing route leaves nothing in the
graph to assert on. It is locked by four files that compare the extractor against a
SECOND, independent implementation and demand they agree:

| File | Locks |
|---|---|
| `tests/no-silent-loss.test.js` | the sealing certificate on Express — an independent Babel walk re-enumerates every registration |
| `tests/no-silent-loss-fleet.test.js` | the same, for the other six lowerings, opening every file itself (so a controller the extractor's pre-filter never selected shows up as a lost route) |
| `tests/registration-invariant{,-fleet}.test.js` | a named fixture per lowering: the declaration exists AND the app can no longer read `PROVEN` |
| `tests/premise-gate.test.js`, `tests/premise-convention.test.js` | both oracles: they find real surface, they invent nothing on 26 healthy fixtures, and an empty enumeration reads `unavailable` |

Each of those has a killing mutant in `tests/mutation/run.mjs`, including anti-vacuity
mutants that blind an enumerator and require the certificate to notice it went silent.
A change that inverts any direction turns the suite red.
