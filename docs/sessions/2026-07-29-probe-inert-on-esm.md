# 2026-07-29 — The runtime oracle never worked on an ESM Express app, then reported the wrong paths (E-109, E-110)

**Scope:** smoke-test the runtime probe before building an overnight lab on top of it.
**Branch:** `main` · **Tests:** 1231 green, 3 skipped · **Mutants:** 131/131 · ESLint 0 ·
Prettier clean · 4 deps.

## Done

- **Found E-109 on the cheapest possible target.** `prove --probe` on SPARDA's own bundled
  `demo-app` (Express, 5 routes, verified serving on `:3456`) timed out and reported "the app did
  not boot". Isolated the cause with a 10-line experiment: on Node 22 an ESM
  `import express from 'express'` never goes through `Module._load`, which is the shim's entire
  interception mechanism. The CJS path fires immediately; the ESM path never does.
- **Fixed it with one mechanism** (ADR-097): the shim pre-requires express from the entry file's
  resolution root, so the app's later `import` gets the already-patched instance. Verified — a
  marker set before the import is readable after it. `demo-app` went `SURFACE` → `PREMISE_GAP`,
  i.e. the oracle now runs and reconciles.
- **Made the probe say WHY it saw nothing** — four states, and the child's stderr is kept instead
  of discarded. Three states used to print as the fourth.
- **Deleted my own first fix** because its mutant survived. Detecting `"type": "module"` to switch
  to `--import` looks more correct and changes nothing measurable; the suite said the line was not
  load-bearing, so it is gone.
- **Then fixed E-110, which the E-109 fix exposed.** With the oracle finally running, `demo-app`
  showed 3 premise gaps — two of them false: a router mounted at `/api/users` was reported at its
  DECLARED paths (`GET /:id`, `POST /`). The mount point is established after the route is
  registered, so the path could never have been right at emission time. Routes are now staged and
  resolved once the app is wired (ADR-098). **3 gaps → 1**, and the survivor is the true one.
- Tests: an ESM fixture for the live probe (the missing half of the matrix), a nested-mount
  fixture, unit coverage for all four diagnostic states, and a behavioural test that the target's
  stderr survives. Five killing mutants. Docs: E-109, E-110, ADR-097, ADR-098, CHANGELOG,
  HANDOFF brick #38.

## Not done / deferred

- The lab itself (`lab/`) is not built. Its plan was reviewed; the first smoke run is what produced
  this session instead. Both defects it would have tripped over are now closed, so the smoke run
  can proceed with `demo-app` as target #0.
- The probe is Express-only for this work. The FastAPI/Flask side was not touched or re-verified.

## Decisions made

- **Pre-load the module you need to patch; do not hope to intercept it.** Interception depends on
  which loader the consumer happens to use — not a property we control or can see. Pre-loading has
  no loader-dependent behaviour.
- **A wrong diagnosis is worse than no diagnosis.** "The app did not boot" over a healthy app
  sends the user to debug their own code. Rule 13 applies to diagnostics, not just verdicts.
- **A line whose mutant survives gets deleted, not defended.**

## Bugs hit

- My first hypothesis (the shim picks CJS vs ESM by file extension) was **wrong** — both shims
  gave 0 routes. Testing it took 2 minutes and saved building on a false cause.
- A test asserting on a source pattern failed because the comment explaining the rule contains the
  pattern. **Third occurrence this session** — replaced with a behavioural assertion.
- Stale shell cwd after a `cd`, again: a `vitest` run reported "no test files found". Use absolute
  paths.
- **Two bugs of my own in the E-110 change, both found by running it rather than reading it.**
  Renaming `record` → `stage` left `module.exports = { record, ... }` pointing at a dead name, so
  the shim threw at load and the probe silently saw zero routes — surfaced only because the E-109
  stderr fix now keeps the child's error. And settling on the child's `exit` races the delivery of
  its last stderr chunk: the test passed alone and failed in the full parallel suite. `close`
  (stdio drained) is deterministic; proved with three consecutive full runs.

## Notes for the next session

- **Smoke-test an oracle on the cheapest target before building anything on it.** The lab was
  about to buy a night of compute on a probe that could not see. `demo-app` costs 15 seconds and
  found it.
- **A capability tested through one module system is tested for one module system.** Where a
  mechanism depends on the loader, the fixture matrix IS the test.
- **A false positive in the SAFE direction is still a defect** — its bill is just paid by a
  consumer you have not written yet. E-110 could only withhold `PROVEN`, never grant it, so nothing
  the suite watches got worse. It was still going to wreck the lab's best signal.
- **A fact not yet established cannot be recorded correctly, only recorded early.** Buffer the
  observation, resolve it when the state is complete.
- Next, in order: the lab's smoke run with `demo-app` as target #0 and a REAL pinned commit, then
  one real repo end to end (measure → triage → gate → a leads/ dir with a working REPRO), then 20.
