# 2026-07-27 — the corpus replayed with the premise: the last unchecked verdict

**Scope:** close the hole brick #30 left open — `scripts/corpus-oracle.mjs` graded the
seven giants with no premise check, and the committed baseline was pre-premise, carrying
the repository's only `PROVEN` on real code (nocodb, 338 routes, 127 writes, 90.2 %,
0 findings) obtained without any oracle ever looking at its route table.
**Commits:** see branch · **Branch:** `claude/corpus-oracle-premise-check-7cmcj4` ·
**Tests:** 1099 green (3 skipped), mutation 83/83, ESLint clean

## Done

- **`scripts/corpus-oracle.mjs` asks for the premise** — `premiseFor` + `withPremiseGaps`,
  the same shared call every command uses, `probe` deliberately absent (the corpus is seven
  third-party apps compiled in bulk; the one place SPARDA must never boot what it measures).
- **The structural rule now scans the repository, not a directory** (E-086). Widening it to
  `src/`, `scripts/`, `bench/`, `tools/` found two more unwired graders nobody had counted:
  `proveApp` in `src/server/stdio.js` (the `sparda_prove` MCP tool — the consumer that acts
  on the verdict word without reading the code) and `bench/repro.mjs` (which writes a verdict
  into the committed evidence file the README cites). Both wired. A grader is identified by
  its IMPORT of `verdictOf`/`badgeFor`, so the definer isn't mistaken for a consumer;
  exemptions carry a reason and are machine-checked.
- **The seven giants re-cloned and re-measured**, each tree graded TWICE — premise off and
  premise on — so the premise's contribution can never be confused with upstream drift:

  | app | oracle | enumerated | gaps | verdict (off → on) |
  |---|---|---|---|---|
  | dub | convention | 591 | 0 | NOT_PROVEN → NOT_PROVEN |
  | novu | convention | 365 | 0 | PARTIAL → PARTIAL |
  | cal.com | convention | 1 | 0 | NOT_PROVEN → NOT_PROVEN |
  | twenty | convention | 122 | 0 | NOT_PROVEN → NOT_PROVEN |
  | immich | convention | 235 | 0 | PARTIAL → PARTIAL |
  | **nocodb** | convention | 78 | **1** | NOT_PROVEN → **PREMISE_GAP** |
  | ghostfolio | convention | 115 | 0 | RISKY → RISKY |

  Every lowering in the corpus has an oracle. **nocodb is `PREMISE_GAP`** on a named route:
  `POST /auth/google/genTokenByCode` — a login endpoint that sets a refresh token and an
  auth cookie, served by the framework, never compiled. **The corpus now holds no `PROVEN`
  at all.**
- **Baseline re-frozen** with three new pins (`premiseOracle`, `premiseProbed`,
  `premiseGaps`) and per-app corpus provenance (`_pinned: {commit, date}`), plus the
  `nocodb` entry re-pointed at `packages/nocodb` (the monorepo root stopped detecting
  upstream — the old entry was an `ERROR` row). `tests/corpus-snapshot.test.js` enforces all
  of it, including "a recorded gap MUST have taken the verdict down".
- **2 killing mutants** (MCP tool graded without the premise; corpus oracle back to its
  pre-ADR-083 state) — both die.

## Not done / deferred

- **E-087 — the root cause of the nocodb gap, left OPEN on purpose.** `nestjs.js` has no
  `TemplateLiteral` handling, so `` @Post(`/auth/google/genTokenByCode`) `` is dropped while
  `oracle-static.js` reads it (a substitution-free template literal is a literal path the
  framework definitely serves). The fix is small and monotone in the safe direction, but it
  moves corpus numbers a SECOND time — shipping it here would blend an extractor precision
  change into the premise-wiring measurement, which is the exact "movement not understood"
  failure re-baselining exists to prevent. Next brick: fixture + test + killing mutant.
- **`tools/corpus/run.mjs` still calls `verdictOf(findings)` with no coverage** — pre-existing,
  and it only reads `.counts`, so it states no verdict word. Exempted as NO_WORD, and the
  exemption is machine-checked.

## Decisions made

- **The corpus oracle never probes.** The runtime oracle executes the target's code; a bulk
  run over seven third-party repos is the last place that may happen as a side effect.
  Convention oracle only — which covers all seven lowerings in the corpus anyway.
- **Gap ROUTES are printed, never pinned.** A count is not actionable; the route is. But
  pinning the list would make the snapshot churn on any upstream rename of a route SPARDA
  already fails to see.
- **`premiseProbed` is pinned** because "0 gaps" means very different things at 591 routes
  enumerated (a real second opinion) and at cal.com's 1 (an oracle that saw almost nothing
  and therefore contradicted nothing). Soundness is unaffected either way — gaps only ever
  WITHHOLD a verdict — but the reader deserves to know how strong the check was.
- **Provenance is recorded but NOT diffed.** A giant landing a PR is not SPARDA drifting; it
  is printed beside every delta so drift can be attributed instead of guessed at.

## Bugs hit

- **E-086** — the premise rule was scoped to `src/commands/`; two more graders were unwired.
- **E-087** — a Nest route written with backticks is invisible to the compiler (OPEN).
- **E-088** — the corpus baseline recorded metrics but not the tree they were measured on,
  making every drift uninterpretable; and its `nocodb` entry pointed at a dir that no longer
  compiles.

## Notes for the next session

- **The old nocodb `PROVEN` is not replayable, and saying so matters.** No commit was ever
  recorded and the app dir changed, so the drop from `PROVEN` to `PREMISE_GAP` stacks three
  causes (app dir, upstream drift, the premise). Only the third is isolated cleanly — same
  tree, two gradings. Don't let a future note claim the premise alone killed it.
- **`SPARDA_CORPUS` corpus is ephemeral here.** Re-clone with `git clone --depth 1
  --filter=blob:none`; the seven fit in ~1.7 GB and clone in well under a minute in
  parallel. `npm ci` first — the oracle needs `@babel/parser`.
- **cal.com's convention oracle enumerates 1 route out of 175.** Harmless to soundness, but
  it is the weakest premise check in the corpus and now visible in the snapshot. If the Nest
  static oracle is ever strengthened, cal.com is where to measure it.
