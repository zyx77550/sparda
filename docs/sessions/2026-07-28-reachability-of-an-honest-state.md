# 2026-07-28 — The reachability of an honest state (E-106, ADR-093)

**Scope:** engrave the audit method into HQ, then continue it onto the surfaces E-105 never
covered — `stitch`, `mirror`, `timeless`, `heal`, `genome` — and fix what it finds.
**Commits:** `85279ec` … · **Branch:** `claude/sparda-hq-robustness-fy1ttv` · **Tests:** 1216
green, 3 skipped · **Mutants:** 124/124 dead · ESLint 0 · Prettier clean · 4 deps.

## Done

- **Audited the five remaining surfaces with the engraved method.** For each one the question
  was not "does it lie" but "which call path produces its UNMEASURED state". `genome` had none:
  it grades a compiled graph, signs the result with Ed25519 and merges it into a file strangers
  pull, and had never called `premiseFor`. Following that back found the rest.
- **E-106 — the ADR-092 fix was wired to nothing.** All four `buildCapsule` call sites passed no
  `premiseBasis`, so the three-state `proven` was unreachable in the product and `immunize`
  printed an `◑ UNMEASURED PREMISE` branch no input could produce. The registry test that
  asserted `buildCapsule(g, { premiseBasis: 'unmeasured' }).proven === null` had passed since the
  day it was written. It was true, and useless.
- **`basisFrom(premise)`** — one source for the basis; nine hand-copied ternaries removed. Its
  default is `'unmeasured'`, with its own test, because the line exists for the caller not yet
  written.
- **`immunize` and `genome` call `premiseFor`** (hard rule 11). `genome` names each route it has
  no antibody for, rather than counting them — a count reads as a measure of the app when it is a
  measure of the surface SPARDA had.
- **The structural rule now names the property, not the function.** `GRADERS` in
  `tests/premise-wired-everywhere.test.js` lists everything that turns a compiled graph into a
  claim; `buildCapsule` was a second grader the rule could not see.
- **Only the POSITIVE claim is withheld.** ADR-092's `premiseUnmeasured ? null : …` blanked a
  genuine `false`; and `immunize` gated CI on falsiness, so `null` would have failed builds
  because no oracle was *available*. Both fixed, both with killing mutants.
- **Three more surfaces corrected:** `stitch` records uncompiled services, gates CI on them and
  marks the join PARTIAL; `heal --check` stops claiming "zero protection lost" with no baseline;
  `timeless replay` stops claiming "every tap consumed, zero divergence" over zero taps.
- **Docs:** ADR-093, E-106, SOUNDNESS 3e (EXPRESSIBLE + REACHABLE) and 3f (when a rule misses
  something, ask what its scope was), CLAUDE.md hard rules 11 and 13, CHANGELOG 0.71.0.

## Not done / deferred

- **Merge to `main` and publish 0.71.0.** `main` is at `3dab129`; this branch is not merged. The
  publish sequence is merge → `git tag -a v0.71.0` → `npm run release:check` → `npm publish` →
  `npm run publish:vscode`. Zak runs it.
- **`npm run publish:vscode` still bypasses the release gate.** Flagged across several sessions,
  never decided. The extension reaches the Marketplace with nothing checked but its version
  number — which is exactly how it shipped a stub at 0.70.0.
- **E-099 (OPEN)** — blind-spot locations point at the wrong line.
- **The `.execute()` phantom** — 750 of novu's blind spots. Must be REPLACED by a real
  `unresolved-call` blind spot in the same change, never deleted alone (Direction 1).
- **`mirror` was audited and left alone.** It serves a route the compiler read as unguarded with
  no lock and no qualifier, so a front-end can be built against a mock that lacks auth the real
  app has. That is a real gap, but the fix is a signal the graph does not currently carry
  (per-route "guard unknown" vs "no guard"), so it is a brick, not a line.

## Decisions made

- **The premise withholds the positive claim only.** A route missing from the graph cannot
  rescue one that is in it and exposed, so NOT-PROVEN needs no premise. The one-way direction
  `premise.js` already stated, applied to the capsule.
- **An unmeasured premise never closes a gate.** Exit code 0, word withheld. SPARDA does not
  fail a build because a measurement was unavailable to it.
- **A source rule is the right instrument for a wiring property.** "Every call site passes this
  argument" cannot be observed by running one command — which is precisely how four of them
  stayed unwired under a green suite. Written against the argument, with a vacuity check that
  lists the sites.

## Bugs hit

- **Three suite tests were defending the leak** (`command-smoke.test.js`), asserting `immunize`
  prints `✓ PROVEN` on an Express fixture nothing had ever premise-checked. Same shape as the
  `(vacuously 1)` case in E-105. Two of the three turned out to be pointing at a real bug in my
  own fix — they were right that `false` must survive.
- **A test grepping for a phrase failed because a comment explaining the rule contains it.**
  The `--force` lesson, third occurrence. Fixed by asserting on the two ARMS of the ternary
  rather than counting the phrase in the file.
- **A hand-built "risky" graph produced a clean polarity**, so the asymmetry test passed for the
  wrong reason. Replaced with a compiled fixture: only the compiler can make an exposed axis
  true.
- **A mutant survived** because `basisFrom`'s default is unreachable from every current caller.
  Killed by testing the default directly rather than weakening the mutant — the default is the
  whole of E-106 in one value.

## Notes for the next session

- **The method, restated, because it keeps paying:** take the CONTRACT, enumerate every place a
  measurement can be absent, and for each one ask both questions — can the headline express "I
  don't know", and does a real call path produce it. The second question is the one that found
  E-106, and it is the one that is easy to skip.
- **When a rule fails to catch something, look at its SCOPE before its logic.** Directory, then
  function name. Both times the gap was the size of the scope. The next one will be too.
- The registry (`tests/unmeasured-is-not-a-pass.test.js`) is a ledger, not a test file. Its
  header table now has eight rows. Add to it rather than writing a new file.
