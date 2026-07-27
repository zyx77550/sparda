# NEXT WAVES PLAYBOOK — executable handoff toward "every organ → 10"

> Written 2026-07-13 at the end of a long session, so a FRESH session can execute the
> remaining waves without re-deriving anything. Each wave below is a self-contained PR:
> approach, exact files, gotchas already paid for, how to prove it, how to not regress.
> Read this AFTER `docs/HANDOFF.md`. The method never changes: investigate the root cause on
> a REAL repo → build it as a general capability → prove on that repo → lock with fixture +
> test → verify ZERO corpus regression → document (ADR + ERRORS + CHANGELOG + HANDOFF +
> session record) → commit + push to the working branch. Never `npm publish` (Gemini's job).

## 0. How to work (the standing setup a fresh session lacks)

**The corpus is EPHEMERAL.** The monster repos live under the session scratchpad
(`.../scratchpad/corpus`, `.../scratchpad/corpus2`) and are GONE in a fresh session. Re-clone
what you need, sparse + shallow, before measuring. The apps and their real app-dirs:

| app        | framework                | clone                   | app dir to point SPARDA at     |
| ---------- | ------------------------ | ----------------------- | ------------------------------ |
| directus   | Express (class services) | `directus/directus`     | `api/`                         |
| twenty     | NestJS + GraphQL         | `twentyhq/twenty`       | `packages/twenty-server`       |
| immich     | NestJS                   | `immich-app/immich`     | `server/`                      |
| open-webui | FastAPI/Python           | `open-webui/open-webui` | `backend/`                     |
| dub        | Next.js                  | `dubinc/dub`            | `apps/web`                     |
| medusa     | file-based               | `medusajs/medusa`       | `packages/medusa` (has `app/`) |
| novu       | NestJS                   | `novuhq/novu`           | an `apps/api`-style dir        |

**The probe** (drop in repo root, run with `node`, delete after — it needs the repo's own
`node_modules` for `@babel/*`):

```js
import { compileUBG } from './src/ubg/compile.js';
import { canonicalizeGraph } from './src/ubg/schema.js';
import { checkGraph, verdictOf } from './src/ubg/apocalypse.js';
import { surveyBlindspots } from './src/ubg/blindspots.js';
const { graph, report } = compileUBG(process.argv[2], { write: false });
const c = canonicalizeGraph(graph);
const { findings } = checkGraph(c);
const v = verdictOf(findings, c);
const b = surveyBlindspots(c, report);
const verdict = !v.provable
  ? 'NO_PROOF'
  : v.surfaceOnly
    ? 'SURFACE'
    : v.clean
      ? 'PROVEN'
      : v.safe
        ? 'RISKY'
        : 'NOT_PROVEN';
const eff = c.nodes.filter(
  (n) => n.kind === 'effect' && n.meta.effectType?.startsWith('db_'),
);
console.log(
  `${process.argv[3]} | ${report.routes}r | ${verdict} F=${findings.length} dbEff=${eff.length} | cov=${(b.coverage.ratio * 100).toFixed(0)}%`,
);
```

**The regression oracle**: before blaming a diff, `git stash` and re-probe on the OLD code —
this caught two false "regressions" (wrong clone paths) this quarter, and a third on 2026-07-15
(E-034). A change to ingestion is
only safe if EVERY corpus verdict + finding count is byte-identical to baseline (coverage/effect
counts MAY rise — that's the win). Baseline verdicts as of v0.32.0: dub NOT_PROVEN F=156, immich
NOT_PROVEN F=2, medusa PROVEN, twenty PROVEN, novu NOT_PROVEN F=21, cal NOT_PROVEN F=13,
express-bp NOT_PROVEN F=3, formbricks PROVEN, open-webui PROVEN, directus PROVEN F=0, fastapi PROVEN.

**⚠ Corpus drift (E-034, 2026-07-15):** immich and twenty at today's HEAD list `express` as a
DIRECT dep. RESOLVED in 0.33.0 — detection falls through to Nest/Medusa instead of throwing.
Lesson kept: corpus baselines are only comparable at pinned SHAs.

**Baselines updated (v0.34.0, 2026-07-15 HEAD clones):** directus PROVEN F=0 (344 dbEff, 95%),
immich NOT_PROVEN F=6 (431 dbEff, 92% — each finding source-verified genuine, incl. a real missing
`@Authenticated` on alpha `POST /admin/database-backups/start-restore`), twenty NOT_PROVEN F=5
(74 dbEff, 47% — OAuth-callback IRREVERSIBLE_OBSERVABLE class), open-webui PROVEN F=0
(**1353 dbEff, 77%** — was 0/0%), novu NO_PROOF 0r (upstream layout drift, honest). Older
v0.32.0 baselines above remain valid only for pre-drift clones.

Green gate every wave: `npx vitest run` (561 tests as of v0.34.0), `npx eslint src tests
--max-warnings 0`, `npx prettier --check src tests`.

---

## ✅ Wave 2b — SHIPPED 0.34.0 (Python effect depth: open-webui 0% → 77%)

Everything below executed as planned + SQLAlchemy 2.0 shapes (`execute(insert(User))`,
`scalars(select(User))`, `session.get/delete`, dotted receivers) + the module-level singleton
idiom (`Users = UsersTable()`) + deep-scanned `Depends()` providers. One trap found and fixed on
the way (E-035): spawnSync's 1 MiB default buffer killed the child on big extractions —
`extractFastAPI` now passes 64 MiB. Kept for reference:

## Wave 2b — Python effect depth (open-webui 0% → high). extract 8.2 → 9.

> **Re-scoped by ADR-054 (2026-07-15):** the JS call-following machinery now lives ONCE in
> `src/ubg/resolve.js` — that module is the REFERENCE SPEC for this wave. Python runs in a
> separate process (stdlib `ast`, zero pip deps), so it cannot import the engine; it implements
> the engine's CONTRACT instead: depth ≤ `MAX_RESOLVE_DEPTH` (6), memoization per (file,
> qualname), cycle guard by stack set, `mergeScan` merge semantics, deterministic ordering.
> Any future divergence between the two is a bug against resolve.js, not a judgment call.

**The gap.** `src/ubg/fastapi_extract.py` (781 lines, stdlib `ast`, zero pip deps) already scans a
handler BODY for effects exactly like `extract.js#scanFunction` (see `scan_function`,
`inspect_call`, `builder_table_of`, `parse_sql`). What it does NOT do is FOLLOW calls out of the
handler into service modules — the Python analogue of `resolve.js#deepScan`/`handlerScan`. So
open-webui reads 456 routes but only 64 effects: PROVEN is partly hollow (coverage ~0%).

**The port (implement the resolve.js contract in Python).** All inside `fastapi_extract.py`:

1. **Import resolution.** Build a per-file map of `from app.services.user import UserService` /
   `import app.services.user as u` → the resolved `.py` file (walk from `cwd`, honor packages/
   `__init__.py`). This is the Python analogue of `resolveRelImport` / `parseModule.imports`.
2. **Follow calls.** After scanning a handler body, for every `obj.method(...)` /
   `module_fn(...)` whose `obj`/module resolves to a known file, parse that file, find the
   function/method (incl. a class method up its `__bases__` chain — the analogue of
   `methodInClassChain`), scan it, MERGE its effects. Recurse, BOUNDED (depth ≤ 6) and
   MEMOIZED per (file, qualname) — the Nest 34s lesson (E-027): a service method reached by N
   routes must be resolved once. Cycle-guard with a stack set.
3. **FastAPI DI.** A handler param `svc: UserService = Depends(get_user_service)` or
   `Depends(UserService)` binds `svc` to that class — resolve `svc.method()` through it (the
   FastAPI analogue of Nest constructor DI). `get_*` provider functions that `return SomeService(...)`
   resolve to the class they construct.
4. **`self.` inside service methods.** A service method calling `self.other()` / `self.db.execute()`
   re-dispatches on the same class (mirror the JS `this.<m>()` handling). Constructor-stored
   `self.db = ...` is the seam; keep it simple (follow `self.<m>()` to sibling methods; the DB
   client itself is usually a module-level `session`/`engine`).

**Prove.** open-webui: effects should jump from ~64 toward the hundreds; coverage 0% → high.
Fixture `ubg-fastapi-deep` (a router whose handler calls `UserService().create()` in another
module, which does `session.execute(insert(...))`) + `fastapi-deep.test.js`. The Python effect
shapes already understood: raw SQL via `.execute("INSERT …")`, SQLAlchemy `session.add`/`.execute`,
the `SQL_VERBS`/`builder_table_of` maps. Extend those if open-webui uses an ORM shape not yet
covered (check what its services actually call first — likely SQLAlchemy `select()/insert()`).

**Gotchas paid for.** Determinism: sort file walks, source-order effects. Bound everything
(MAX_EFFECTS already 40 in the Python side). Tests need Python ≥ 3.9 on PATH (CI already assumes
it for the FastAPI fixtures).

---

## Next increment — ORM import-root provenance (ADR-054 remaining scope). Own session.

**The idea (from the dossier's ADR-P2).** Today an effect is recognized by NAME PATTERNS
(`prisma.cat.create`, `session.add`, capitalized-Mongoose-model) — fragile (E-029 family) and
provenance-blind. The engine should also check WHERE the receiver comes from: a receiver whose
import root is a known ORM package (`@prisma/client`, `knex`, `kysely`, `drizzle-orm`, `mongoose`,
`typeorm`, `sequelize`; Python: `sqlalchemy`, `databases`) yields a `verified` effect; a
name-pattern-only match degrades to `asserted` (kept, never deleted — same provenance split
ADR-046 gave guards). Each verified effect carries its resolved import root as evidence.

**Why it's deferred, honestly (part-25 precedent: recorded, not rushed).** It requires threading
module import context into `extract.js#scanFunction` (1389 lines, called from translate/express/
nestjs/nextjs/medusa paths), a provenance field on the effect meta, and consumers (blindspots
ranks opaque targets; dossier renders provenance). Wide surface, needs its own session with the
corpus oracle. NOT hard, just not an end-of-session rush.

**How (when taken up).** (1) `parseModule` already records imports — pass the owning mod into
`scanFunction` (it's available at every deepScan/handlerScan call site in resolve.js; translate's
direct calls pass null → asserted, unchanged). (2) In the effect emitters, resolve the receiver
root identifier against `mod.imports` + a small ORM-root table (package name prefix match on the
UNRESOLVED specifier — bare specifiers are exactly what resolveRelImport ignores today, so record
them separately as `mod.bareImports`). (3) `meta.provenance: 'verified'|'asserted'` +
`meta.importRoot`; corpus gate: verdicts identical, provenance is reporting-only at first
(blindspots may re-rank later, its own decision).

---

## Wave 3 — Taint dataflow in apocalypse (the bug class that sells). apocalypse 7.8 → 9.

**The obligation.** Prove that request input (`req.body`/`req.params`/`req.query`, or a symbolic
`:collection` table) REACHES a `db_write` WITHOUT passing a validation — by the flow of values,
not by names (Round 7 #1). This is the "unvalidated input mutates state" / mass-assignment class.

**Where the signals already are.** `translate.js` sets `graph.nodes.get(epId).meta.inputValidated`
when the handler scan saw a zod/Pydantic validator. Effects carry `meta.symbolic` (table itself
comes from the request) and `sets`/`inserts`/`where` literal maps. The entrypoint→handler
`data_flow` edge exists. `apocalypse.js#checkGraph` already has O2 (`UNVALIDATED_CONSTRAINED_WRITE`)
gated on DECLARED SQL invariants — Wave 3 is O2 generalized past the "must have DDL invariants"
gate, which most apps lack.

**The E-029 tripwire (READ THIS FIRST).** A naive "write + no zod → finding" lights up HUNDREDS of
false positives and flips PROVEN→NOT_PROVEN across the corpus. That exact over-broadening already
bit us once (E-029: bare throw/next(err) treated as deny). BOUND IT HARD. Two safe, precise cores:

- **`UNBOUNDED_WRITE_TARGET` (critical, very precise):** a `db_write` whose TABLE is symbolic
  (`meta.symbolic`, i.e. the caller picks the table) AND no guard on the path. "Anyone can write
  to any table" — a real, rare, severe hole. Almost cannot false-positive (few routes write to a
  request-named table). START HERE.
- **`UNVALIDATED_INPUT_WRITE` (medium, still bounded):** a mutating entrypoint with
  `inputValidated === false` AND a `db_write` whose `inserts`/`sets` are non-empty (real columns
  written) AND at least one guard is absent OR unverified. Ship behind a flag or at `info`
  severity first, measure FP rate on the corpus, and only promote if clean.

**Prove + guard.** After EACH new rule, re-run the full corpus and diff finding counts. If a rule
moves a verdict on an app whose write is actually fine (guarded by an unseen middleware), that's a
false positive → tighten or revert (do NOT ship a rule that regresses the corpus). New polarity
axis is optional and risky (the matrix is pinned to 5 axes in fingerprint/polarity/determinism/
speculative tests — adding a 6th breaks them; leave polarity alone unless you also update those).

---

## The big arc — Reyna's execution loop (blindspots 9→10, mirror 6.5→8+).

**Why it's not `mirror`.** `sparda mirror` (`src/ubg/mirror.js`) is a mock BUILT FROM the graph —
it serves what static already saw, so pointing it at blind spots is circular; it cannot reveal what
static missed. This was confirmed this session. The HONEST loop needs executing the REAL target
code and OBSERVING.

**What it needs (multi-session).** A harness that, for a high-risk blind spot the ledger names
(`sparda blindspots --json`), drives the real handler with probe inputs and records the effects it
actually performs (à la Reyna's twin, which really executes its target and checks real exploits).
Fold observations back as RESOLVED behavior → the UBS shrinks by execution, not just measurement.
Hard because it needs the app runnable (deps, a sandbox) and must never run on a request path
(rule #1). Zak's `reynaprovocateur` zip (in an earlier session) is the idea source: its
`unknown-zones.ts` (UBS tracking), `exploration-engine.ts` (the closed loop), `rl-twin.ts` (reward
= UBS reduction). NOTE its own bugs before reusing: infinite recursion
`getUBSReport↔estimateTimeToTarget`, `index.ts` won't compile (French apostrophes in single-quoted
strings), contradictory metrics. Take the IDEAS, not the code.

---

## Scorecard (v0.32.0) and point targets

| Organ                                 | Now       | After its wave | Wave                           |
| ------------------------------------- | --------- | -------------- | ------------------------------ |
| extract/ubg                           | 8.2       | 9              | 2b (Python) + more frameworks  |
| apocalypse                            | 7.8       | 9              | 3 (taint)                      |
| blindspots                            | 9         | 10             | Reyna loop                     |
| mirror                                | 6.5       | 8              | Reyna loop                     |
| review                                | 8.5       | 9              | richer semantic diff           |
| genome                                | 7         | 8.5            | real users (product, not code) |
| immunize/dossier/polarity/fingerprint | 7.5/8/7/7 | 8ish           | incremental                    |
| MCP layer                             | 8         | 8.5            | already solid                  |

General grade ~7.7 now (design A−, robustness A−, breadth B, maturity C+). The remaining points are
breadth (2b), proof depth (3), and the execution loop — none are design holes, all are build-outs,
each shippable exactly like the four increments already landed this quarter (instantiated services,
blindspot ledger, cross-class dataflow, GraphQL).
