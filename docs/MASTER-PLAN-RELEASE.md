# MASTER-PLAN-RELEASE.md — the release playbook

> **Read this ENTIRELY before touching anything, every time you publish.** Not because the
> steps are hard, but because every one of them has already been done wrong once, and each
> mistake is named below with its error number. An agent that improvises here re-derives a
> failure the project already paid for.

**Audience:** any AI agent (or human) publishing SPARDA. **Scope:** from a green tree to four
published artefacts — npm, the VS Code Marketplace, the MCP registry, and the git tag.

---

## 0. Context discipline — read this before you read anything else

You have a finite context window, and this project has more history than fits in it. **Do not
try to hold the history in the conversation.** The project is designed so you don't have to:

| Where | What it holds | When to read it |
|---|---|---|
| `docs/HANDOFF.md` | The PRESENT: done / not done / next | Always, first, every session |
| `docs/DECISIONS.md` | Why it is built this way (ADR log, append-only) | Before changing a design |
| `docs/ERRORS.md` | Every non-trivial failure already seen | **Before touching code that failed before** |
| `docs/sessions/` | One file per session (append-only) | When you need "what happened on X date" |
| The Obsidian vault | Zak's own notes and long-form thinking | When the repo doesn't answer |
| **This file** | How to publish | Every release |

**The rule: offload, don't memorise.** When you learn something durable, WRITE IT to the right
file. When you need something old, READ the file — do not ask the conversation to remember it,
and do not reconstruct it from guesses. A fact that lives only in a chat does not exist.

**Read narrowly.** Do not `cat` the whole of `DECISIONS.md` (100+ ADRs) or `ERRORS.md` (100+
entries) into your context. Grep for the entry you need. Saturating your context is itself a
failure mode: it is what produces confident, wrong process decisions.

---

## 1. Where the code lives — the valve

Two directories, and the separation is a security boundary, not a convenience.

```
C:\Users\zakar\Developer\sparda-hq             ← HQ. Source of truth. Code, tests, git, GitHub.
C:\Users\zakar\Developer\sparda\_public_sync   ← The valve. Air-gapped. Public files only.
```

**HARD RULE: never run a third-party publishing tool from `sparda-hq`.** `mcp-publisher.exe`
lives ONLY in `_public_sync`, and is run ONLY from there. HQ contains private notes, drafts and
history; a tool that packages "the current directory" from HQ is a data leak with no undo.

Only files that are already public may cross the valve. For an MCP release that is exactly one
file: `server.json`. Copy it deliberately, one file at a time. Never sync a directory.

---

## 2. Pre-flight, in `sparda-hq` — the green bar

Run all four. All four must be clean. There is no partial credit.

```bash
npm test                 # the suite
npm run mutation         # 128 mutants — ALL must be killed
npx eslint .             # must print nothing
npm run format:check     # Prettier, scope **/*.{js,cjs,mjs} — JS only, NOT Markdown or YAML
```

**If `npm run mutation` says `⚠ target moved` or `✗ SURVIVED`, STOP.** That is not noise. It
means either a guarded line has no test that bites, or the harness is protecting nothing
because a line moved (Prettier reflowing one line is enough). Fix the harness or the test —
never delete the mutant.

**If you changed a soundness-critical line, it ships with a mutant that kills it** (hard rule
12). A change with no mutant is a change with no guardian.

---

## 3. The mutation-residue guarantee — check this before every commit

**What happened (E-108).** `src/ubg/apocalypse.js` reached `main` carrying `if (false)` where
`assertedOnlyMutationRoutes` decides whether a route is guarded by trust alone. That killed the
PARTIAL rung, so **a route protected only by an unverified guard read `PROVEN`**. Nobody wrote
it: the string is byte-for-byte a mutant's replacement text, left on disk when the harness was
killed mid-run, then swept in by a blind `git add -A`.

**Why the suite could not see it:** a mutant that SURVIVES is, by construction, a mutation no
test detects.

**What is in place now** (ADR-095), so you do not have to be careful — you have to not defeat it:

1. The harness journals the original bytes to `tests/mutation/.in-flight.json` **before**
   touching a file, and the next run restores them and says so. If you see
   `⚠ a previous run was interrupted mid-mutant — restored <file>`, that is the system working.
2. `tests/no-mutant-left-behind.test.js` runs in the ORDINARY suite and fails if any mutation
   is sitting in the tree. Milliseconds, versus ten minutes for `npm run mutation`.

**Your obligation is one line, before every commit:**

```bash
git status && git diff --stat
```

**Read what you are about to commit.** If a file you never edited is modified, do not commit it
— find out why. `git add -A` after an interrupted mutation run is exactly how E-108 shipped.

---

## 4. The version bump — four manifests move together

A partial bump is a real failure shape (the gate has a check for it). Every one of these must
carry the new version:

| File | Field(s) |
|---|---|
| `package.json` | `version` |
| `server.json` | `version` **and** `packages.0.version` — TWO copies |
| `glama.json` | `version` |
| `extensions/vscode/package.json` | `version` |

And `CHANGELOG.md` needs a `## [<version>]` heading with real content — what changed for a
USER, not a list of commits. A release nobody wrote down is a release nobody can audit later
(E-096, v0.69.0).

**Write the entry for the version you are ABOUT to cut, never for the one you last cut.** The
moment a tag is pushed, its entry is FROZEN: a later fix opens a NEW heading, even for one line.
E-111 is this rule being broken — two fixes were appended to `## [0.71.1]` hours after `v0.71.1`
had shipped, so the changelog promised a working ESM probe to everyone running a version that did
not have it. **Re-check `npm view sparda-mcp version` at the moment you write the entry, not at
the start of the session.** A precondition verified once is a memory, not a precondition.

The gate cannot help you here: it checks that a heading for this version EXISTS, and no check can
verify that a paragraph is true.

**Commit the bump and the CHANGELOG. Push to `main`. The tag comes after — never before.**

---

## 5. The tag — created LAST, on the tip of `main`

This is the step that has gone wrong most often. The order is not stylistic.

```bash
git checkout main
git pull origin main
npm run release:check          # ~12 min: it runs the suite AND the mutants
```

The gate asks six questions, in this order:

1. tree clean, on `main`, HEAD identical to `origin/main`
2. this version is not already on npm
3. all manifests agree
4. the CHANGELOG describes this version
5. **the tag exists, points at HEAD, and is PUSHED to origin**
6. suite green, mutants dead, corpus (SKIPPED without clones — said, never counted as a pass)

On the first run it will fail on (5), because the tag does not exist yet. **That is the
expected state.** Everything else must be green first. Then:

```bash
git tag -a v<version> -m "v<version>"
git push origin v<version>
```

**Do not commit anything between creating the tag and pushing it.** Any commit moves HEAD off
the tag and the gate will refuse — correctly.

**If someone else pushed to `main` while you were preparing:** delete the local tag, pull, and
start step 5 over. Never `git tag -f`. The tag names bytes; renaming which bytes it means is
the whole failure this gate exists to prevent.

### Two traps, both already paid for

- **E-107** — the gate used to check the tag LOCALLY only. A tag on your disk names nothing to
  anyone else. It now checks `git ls-remote`, and an unreachable origin says `UNVERIFIED` and
  blocks (both block; only the stated reason differs).
- **The detached HEAD.** On GitHub Actions a tag push produces a detached HEAD, and
  `git rev-parse --abbrev-ref HEAD` answers the literal `HEAD`. The gate accepts that **only**
  when HEAD is byte-identical to `origin/main`. **NEVER "fix" this by adding `git checkout main`
  to the workflow** — on a tag build, `main`'s tip may have moved past the tag, so that would
  publish bytes nobody tagged. That is the v0.69.0 failure, reintroduced.

---

## 6. GitHub Actions — npm and the VS Code Marketplace

Pushing the tag fires `.github/workflows/release.yml`. It runs `npm run release:check` again on
a clean runner, then publishes. You do not run `npm publish` yourself when the workflow is
healthy — that would be a double publish attempt.

**Watch the run.** Three outcomes:

| What you see | What it means | What to do |
|---|---|---|
| Gate fails on the runner but passed locally | The runner sees something your machine does not (usually: the tag or a commit is not pushed) | Fix the repo, delete the tag, redo step 5 |
| `UNVERIFIED: NPM_TOKEN or VSCE_PAT is not set` | A repo secret is missing | Zak adds it in repo Settings → Secrets. You cannot. |
| Jobs die in 2–11 s with no logs, several `cancelled` | **Not a code defect** — the runners never started (Actions quota / rate limit / billing) | See the fallback below |

### Fallback when Actions cannot run — authorised, and still gated

This is NOT an escape hatch: `prepublishOnly` runs the full gate inside `npm publish`, so the
manual path is gated exactly like the automated one.

```bash
npm publish                # prepublishOnly runs the gate; a failure here means DO NOT SHIP
npm run publish:vscode     # @vscode/vsce@3.9.2, pinned — same tool as the workflow
```

**VS Code specifics.** The extension is `zyx77550.sparda`, entry `./src/extension.cjs`, icon
`extensions/vscode/logo.png`. Keep the logo small (~111 KB) — a heavy asset bloats every
install for nothing. Verify before publishing:

```bash
cd extensions/vscode && npx --yes @vscode/vsce@3.9.2 package --out %TEMP%\t.vsix
```

It prints the file list and total size. A package much over ~200 KB means an asset slipped in.
(A non-square icon is accepted by `vsce` — measured, not assumed — it just renders letterboxed.)

---

## 7. The MCP registry — manual, isolated, in the valve

Last, and deliberately not automated: it runs a third-party binary, so it runs behind the air
gap. Do this only AFTER npm has the new version, because `server.json` points at the npm
package.

```powershell
# 1. copy ONE file across the valve — never a directory
copy C:\Users\zakar\Developer\sparda-hq\server.json C:\Users\zakar\Developer\sparda\_public_sync\server.json

# 2. work from the valve, never from HQ
cd C:\Users\zakar\Developer\sparda\_public_sync

# 3. authenticate, then publish
.\mcp-publisher.exe login github
.\mcp-publisher.exe publish
```

**The binary is `mcp-publisher.exe` (v1.8.0, Windows AMD64), and only that.** Historical error:
`registry.exe` was downloaded by mistake — that is the registry BACKEND, it looks for a
PostgreSQL database and will never publish anything. If the tool asks about a database, you
have the wrong binary.

Before publishing, confirm the copied `server.json` carries the version you just released
(`version` and `packages.0.version` — both).

---

## 8. After the release — write it down, or it did not happen

Non-negotiable, and it is what makes the next session cheap:

1. Rewrite `docs/HANDOFF.md` — it describes the **present**, not history.
2. Add `docs/sessions/YYYY-MM-DD-<slug>.md` from `docs/sessions/TEMPLATE.md`.
3. Any real bug hit → `docs/ERRORS.md`. Any real choice made → `docs/DECISIONS.md`. Both
   append-only.
4. Mirror anything durable into the Obsidian vault.

---

## 9. The forbidden list

- ❌ **No escape hatch in the gate.** No flag, no environment variable that SKIPS a check. The
  one release that skips the gate is the one that needed it. If a check is wrong, fix the check.
- ❌ **No `git tag -f`, no force-push to `main`.**
- ❌ **No `git add -A` without reading `git status` first** (E-108).
- ❌ **No `git checkout main` in the release workflow** (§5).
- ❌ **No publishing tool run from `sparda-hq`** (§1).
- ❌ **No new runtime dependency.** There are exactly four, exact-pinned; that is a selling
  point. A new one needs an entry in `docs/DECISIONS.md` first (hard rule 8).
- ❌ **Never `git tag` before the version bump and CHANGELOG are committed and pushed.**
- ❌ **Never report a step as done that you did not verify.** "The tests probably pass" is not a
  release artifact. Run it, read the output, quote it.

---

## 10. The checklist — copy this into your task list

```
[ ]  0  read docs/HANDOFF.md; grep ERRORS.md for anything touching this release
[ ]  1  cd sparda-hq, git checkout main, git pull origin main
[ ]  2  npm test                    → green
[ ]  3  npm run mutation            → all 128 killed, zero "target moved"
[ ]  4  npx eslint .                → silent
[ ]  5  npm run format:check        → clean
[ ]  6  git status && git diff --stat → READ IT. Nothing you did not edit.
[ ]  7  bump 4 manifests (server.json TWICE) + CHANGELOG entry
[ ]  8  commit, push to main
[ ]  9  npm run release:check       → green except "tag exists" (expected)
[ ] 10  git tag -a v<version> -m "v<version>"   ← nothing committed after this
[ ] 11  git push origin v<version>
[ ] 12  watch the Actions run → npm + VS Code published
        (runners down? npm publish && npm run publish:vscode — still gated)
[ ] 13  verify: npm view sparda-mcp version   → the new one
[ ] 14  copy server.json → _public_sync, cd there, mcp-publisher login + publish
[ ] 15  rewrite HANDOFF.md, add docs/sessions/<today>.md, mirror to Obsidian
[ ] 16  sync public repo: cd sparda-hq, git archive v<version> | tar -x -C ../sparda, then commit, tag, push
```

---

**Last updated:** 2026-07-29, for v0.71.1. Related: ADR-087 (the gate exists), ADR-094 (the tag
must be pushed), ADR-095 (residues and the detached HEAD), E-096, E-101…E-103, E-107, E-108.
