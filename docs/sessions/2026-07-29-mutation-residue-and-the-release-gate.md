# 2026-07-29 — A mutation residue in the verdict engine, and a release gate that could not release

**Scope:** audit `main` after four merges by three different hands; verify `3bd59ed` against the
new `public-path-overreach.test.js`; make v0.71.1 publishable.
**Branch:** `main` · **Tests:** 1228 green, 3 skipped · **Mutants:** 128/128 dead · ESLint 0 ·
Prettier clean · 4 deps.

## Done

- **Answered the question asked: there is no conflict.** `3bd59ed` (restores
  `assertedOnlyMutationRoutes`) and PR #37 (`expectedPublic` abstains in an authenticated
  namespace) touch different functions and different rungs, and both only ADD severity. Each is
  guarded by its own mutant and both die. Verified, not reasoned.
- **Found what `3bd59ed` actually was (E-108).** The `if (false)` is byte-for-byte the `repl` of
  a mutant living in `tests/mutation/run.mjs` since ADR-070 — a mutation-harness residue, not a
  hand-written bypass. The commit carrying it also *adds* a mutant to that harness, so the
  harness was running in that session.
- **Made the residue impossible to keep** (ADR-095): a journal written before the file is
  touched and replayed on the next start, signal handlers for the polite exits, and
  `tests/no-mutant-left-behind.test.js` in the ordinary suite.
- **Unblocked the release workflow.** It could never have published: `actions/checkout` on a tag
  push gives a detached HEAD and `treeChecks` refused it. A detached HEAD now passes only when
  byte-identical to `origin/main`.
- **`tagChecks` distinguishes an unreachable origin from an absent tag** (rule 13). Both block,
  only one is a measurement.
- **Repaired `docs/DECISIONS.md`** — it was no longer valid UTF-8. Rewrote ADR-094 and E-107 in
  full; added ADR-095 and E-108.
- Workflow hygiene: secrets via `env:` instead of shell interpolation, `@vscode/vsce` pinned to
  3.9.2 in both the workflow and `npm run publish:vscode`.

## Not done / deferred

- **Publishing 0.71.1.** Needs `git tag -a v0.71.1 && git push origin v0.71.1`, which fires the
  workflow. This environment's git proxy refuses tag pushes (403) and has no npm credentials.
- **GitHub Actions is rate-limited on the account** — every run on `main` fails in 2–11 s with
  no logs, including commits predating this work. Not a code defect; Zak confirmed and deferred.
- **The VS Code logo** is 1536×1024 (non-square) and 2.11 MB of a 2.12 MB package. I packaged the
  VSIX to check rather than guess: `vsce package` accepts it. Quality, not a blocker.
- **E-099** (blind-spot locations point at the wrong line) and the `.execute()` phantom remain
  open.

## Decisions made

- **A detached HEAD at `origin/main` is not an exemption**, it is the property the branch name
  was a proxy for. It cannot admit anything `head !== remote` would not already refuse, and the
  test proves that by asserting the negative case too.
- **An unverifiable check still blocks a RELEASE.** The corpus is SKIPPED and non-blocking
  because it only adds evidence; the tag is not. What changes is the sentence, never the outcome.
- **Recovery belongs on disk, not in a handler.** Handlers cover the polite exits; the journal
  covers the rest.

## Bugs hit

- **Reproduced E-108 live, by accident.** A SIGKILL mid-run left `src/ubg/llm-resolve.js` mutated
  *with signal handlers installed* — the harness sits inside a blocking `execFileSync`, so no
  signal reaches JS until the child returns, and SIGKILL never does. That failure is what proved
  the journal was necessary rather than nice.
- **Temporal dead zone**: the `run()` call was placed before `const JOURNAL`. Moved to the end of
  the file, with a comment saying why it must stay there.
- **Stale shell cwd again** — a `cd` into `extensions/vscode` made a later `vitest` run report
  "no test files found". Third occurrence. Use absolute paths.

## Notes for the next session

- **When a check "was disabled", look for the string in the mutation harness before assuming
  intent.** A `repl` value appearing in shipped source is a residue signature, and it reads
  exactly like sabotage in a diff.
- The suite guard also catches a mutant whose `find` has drifted — Prettier moving one line is
  enough. That used to surface only after ten minutes of `npm run mutation`.
- `main` moved twice during this audit (a docs merge, then a logo). Re-fetch before concluding
  anything about its state.
