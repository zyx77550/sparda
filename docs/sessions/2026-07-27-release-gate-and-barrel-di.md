# 2026-07-27 — The release gate, then novu's barrel (ADR-087, ADR-088)

**Scope:** harden the publishing path so a half-state cannot ship again, then close novu's
coverage lock.
**Branch:** `claude/sparda-hq-robustness-fy1ttv`
**Tests:** 1154 ✓ (+9) · mutants 102/102 (+7) · ESLint 0 · Prettier clean · 4 deps

## 1 — The gate (ADR-087, E-096)

v0.69.0 was published from a commit that was not the head of what was being merged. For
four hours the package on npm analysed a NestJS app with house decorator brands at a
quarter of its size — the exact Direction 3 violation the three sessions before it had
removed from the codebase.

**Every test passed at the commit that shipped.** The defect was never in the code: it was
in *which commit* got published, and in the release artefacts nobody updated. A green suite
licenses a COMMIT; a release is a claim about PUBLISHED BYTES, and everything that can
differ between the two was unchecked.

`prepublishOnly` now runs `scripts/release-gate.mjs`:

| check | catches |
|---|---|
| tree clean, on `main`, HEAD ≡ `origin/main` | a release cut mid-flight — 0.69.0's root cause |
| version absent from the registry | a forgotten bump |
| `server.json` (×2) + `glama.json` agree | a partial bump a single grep reports as fine |
| `## [version]` CHANGELOG heading | a release nobody wrote down |
| `v<version>` exists, points at HEAD | the drift since v0.68.0 |
| suite, mutants, corpus | the ordinary bar, where it is enforced |

Two things make it real rather than decorative:

- **The decisions are pure** (`scripts/release-checks.mjs`), so the tests hand each one the
  exact state 0.69.0 was released from and require the refusal. A gate that exists only as
  a script can only be tested by grepping it — and the first version of that test failed
  immediately, because the gate's own header says `--force` in order to refuse it. **A
  hatch is not a string, it is an INPUT:** the assertion is now that the gate reads no
  `process.argv` and exactly one env var, one that can only make it stricter.
- **What it cannot measure, it names.** `SKIPPED` for the corpus without clones,
  `UNVERIFIED` for an unreachable registry — told apart from `E404`, which is the desired
  state and passes.

Verified end to end: it blocked with exactly three true failures (dirty tree, side branch,
`0.69.1` already on npm).

## 2 — novu's lock was a false reading (ADR-088, E-097)

The brief was "raise the 14.8 % coverage". The measurement said otherwise: **1479 of 2039
constructor-DI hops resolved to nothing** — `PinoLogger` 307 times, then every repository
the app writes through.

All the same cause. `@novu/dal` and `@novu/application-generic` resolve to their entry
file, and that file is a **barrel**: sixty `export * from './repositories/…'` lines, zero
class declarations. `classInModule` finds only classes DECLARED in the module it is handed.
`resolveExportedFunction` has crossed barrels since the `lib/auth/index.ts` era —
**classes never got the twin**, forty lines away in the same file.

**Why it is soundness, not precision.** An unresolved DI hop leaves no trace at all, so a
route whose behavior lives entirely behind the barrel resolves to zero behavior — and a
route with zero behavior has nothing to flag. The fixture states it: `POST
/orders/purge/:tenant` deletes every order of a tenant with no guard and produced **no
finding**, at coverage `unknown` (0/0) and verdict `SURFACE`.

Measured, isolated — same clones, same pinned commits, resolver permuted, whole corpus run
twice:

| | before | after |
|---|---|---|
| novu verdict | PARTIAL | **NOT_PROVEN** |
| novu db writes | 52 | **132** |
| novu db reads | 792 | **1464** |
| novu findings | 0 | **4** |
| novu coverage | 14.8 % | 15.1 % |
| twenty / immich / nocodb / ghostfolio | — | byte-identical |

**novu got worse, and that is the result.** Its clean PARTIAL was resting on 80 database
writes its routes perform and SPARDA could not see. Coverage barely moved, which is the
honest answer to the brief: the number was never the problem, the missing subject was.
immich unchanged is the control that keeps the claim narrow.

## 3 — E-098, found while isolating the above

cal.com drifted (`routes 175 → 177`) **with and without** the change. Its baseline dated
from 07-22; ADR-084/085/086 all landed after, and no session had a cal.com clone, so the
oracle printed `SKIP` and each change shipped unmeasured on it.

Not a bug in the oracle — skipping an absent app and saying so is correct. The gap is that
`SKIP` accumulates nowhere. All six clonable giants were pinned to their baselined commits
and re-measured in one pass. **dub could not be cloned in this environment and remains
unmeasured — stated, not hidden.**

Rule: **a skipped check is a debt, not a pass.**

## 4 — Lock 2 measured, and it is a REPORTING bug wearing a research problem's clothes

twenty's 139 high blind spots break down as 55 `fs_write` and 41 `http_call` with computed
targets, 34 `db_write` with an unresolved table (19 through a TypeORM `queryRunner`), 7
blind mutations and 2 skipped surfaces. Unlike novu's, these are **genuine residual
imprecision** — SPARDA saw the write and cannot name what it touches. Closing them is
symbolic target resolution: a project, not a patch.

But every one that resolved through a DI hop **points at the wrong line** (E-099, OPEN).
The blind spot reads `application-development.resolver.ts:21` — an `import` statement —
while the `fs_write` it describes is `this.fileStorageService.writeFile(…)` at
`application-development.service.ts:202`. The node's `loc.file` is the ENTRYPOINT's file
and its `loc.line` comes from the body actually scanned: two halves from different files,
individually right and jointly meaningless.

That matters more than it looks. The ledger is the honesty organ — what SPARDA offers
INSTEAD of a proof. 139 entries whose locations do not point at the code is not an honest
answer, it is an unusable one, and that is how an honest tool gets ignored. Recorded with
the reproduction rather than half-fixed; the fix is to carry the declaring file alongside
the line through the resolver's merge, as `helpers` already does with
`sourceFile`/`sourceLine`.

## Released as 0.70.0

Version bumped, `server.json` (×2) + `glama.json` synced, CHANGELOG entry written with an
explicit upgrade note: **the barrel fix changes verdicts on monorepos**, and an app whose
verdict got worse did not change — what SPARDA can see did. The one artefact still missing
is the `v0.70.0` tag on `main` after merge: this environment's git proxy refuses tag pushes,
and the gate will (correctly) block the publish until it exists.

## Not done / next

- **The `.execute()` phantom.** 750 of novu's blind spots are `.execute(command)` calls on
  injected use cases, recorded as `db_read` with an unknown table — the raw-SQL fallback
  fires on the method NAME with no database provenance, so a CQRS app has every DI hop
  charged as an unreadable query. **Fixing the label alone is not safe:** that phantom is
  currently the only trace an unresolved hop leaves anywhere, so it must be replaced by a
  real `unresolved-call` blind spot in the same change, never simply deleted (Direction 1).
- twenty's 139 high blind spots (77 % coverage) are still what holds it at PARTIAL.
- Tag `v0.69.1` exists locally only — this environment's git proxy refuses tag pushes.
