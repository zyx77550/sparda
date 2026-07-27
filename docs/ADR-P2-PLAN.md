# ADR-P2 — executable plan: one interprocedural resolver

> The prep that turns the big refactor from groping into mechanical. Read this AND
> `docs/VISION.md` §6 before starting. The refactor merges three follow-engines that solve
> ONE problem — "resolve `x.m()` across modules to the bodies it reaches, bounded" — into a
> single `src/ubg/resolve.js`, with frameworks as configuration. The whole session runs under
> ONE non-negotiable invariant, below.

## 0. The invariant (the definition of "safe")

**Phase 1 must be byte-identical on the golden bench.** After extracting the shared engine and
re-pointing the three frameworks at it, `node tools/bench/run.mjs` must be GREEN on all 6 pinned
repos — same verdict, same finding counts, **same canonical-graph sha256**. Only when that holds
do you touch behaviour (Phase 2). The bench is the net; the graph hash is the proof.

The bench now covers every path this refactor touches:
- **Nest DI (`followDI`)** → immich, twenty (twenty also exercises the GraphQL-resolver path,
  which reuses the Nest DI machine — ADR-053).
- **Express deep (`deepScan`/`followMembers`)** → directus (class services), express-boilerplate.
- **Python follow (`follow_function`/`call_targets_of`)** → open-webui.
- **Next.js** → dub. (Next has no deep follow yet — that is a Phase 2 EXTENSION, not a move.)

## 1. What exists today (the three engines to unify)

| Engine | File | Entry points | Resolves |
|---|---|---|---|
| Nest DI | `src/ubg/nestjs.js` | `followDI`, `diMapWithMod` | `this.svc.m()` via constructor param types, up the `extends` chain, tsconfig `paths` |
| Express deep | `src/ubg/express.js` | `deepScan`, `followMembers` | `importedObj.method()` through CJS/ESM barrels, class instances |
| Python follow | `src/ubg/fastapi_extract.py` | `follow_function`, `call_targets_of`, `deepen_scan` | imported fns, singletons, DI classes, `self.` re-dispatch, base classes |

Shared helpers already factored once: `classInModule` / `baseClassOf` / `methodInClassChain`
live in `extract.js` and are used by both the Nest and Express followers — that is the seam the
unified resolver widens. `extract.js` is 1,389 lines; this refactor is also how it shrinks.

All three already share the SAME earned invariants (do not lose them):
- **depth ≤ 6**, **cycle-guarded** (a stack set), **memoised per (file, dispatch, method)** — the
  E-027 perf lesson (a method reached by N routes is resolved once).
- **effects-only across a call** — deny signals / validation flags NEVER propagate through a
  follow (the E-029 tripwire: a callee that raises 401 must not turn its caller into a guard).
- **source-order deterministic**, hard caps (`MAX_EFFECTS`), stable output.

## 2. The target — `src/ubg/resolve.js`

One engine, parameterised by a framework descriptor. Sketch of the interface (JS; the Python side
mirrors the same contract in `fastapi_extract.py`, it does not import JS):

```
// resolve.js
// followBody(start, cfg, ctx) -> { effects[] }
//   start : { file, fnNode, selfBinding|null }
//   cfg   : the framework descriptor (below)
//   ctx   : { depth, stack:Set, memo:Map }  // memo/stack are engine-owned, not per-call
export function makeResolver(cfg) { /* returns { followBody, deepen } */ }
```

The framework **descriptor** is the ONLY thing that differs between Express / Nest / Next / Medusa
(and, in spirit, Python):

```
cfg = {
  resolveModule(fromFile, specifier) -> absFile|null,   // tsconfig paths, CJS barrels, rel, py imports
  bindings(fnNode, mod) -> Map<name, {kind, class|effect}>, // local + DI + singleton + inline-new
  dispatch(callNode, bindings, mod, selfBinding) -> targets[], // how a call resolves to (mod, fn, selfBinding)
  scanBody(fnNode) -> { effects[] },                    // the leaf effect scanner (already exists per fw)
}
```

Nest, Express, Next, Medusa become four `cfg` objects. The recursion, bounds, memo, cycle-guard,
dedup, and effects-only rule live ONCE in `resolve.js`.

## 3. The two-phase discipline

### Phase 1 — extract with ZERO behaviour change (the mechanical part)

1. Create `resolve.js` with the shared recursion/bounds/memo/dedup lifted verbatim from the
   current followers (start from the Python `follow_function` shape — it is the cleanest and most
   recent). No new capability.
2. Write the Express `cfg` and Nest `cfg` as thin adapters over the CURRENT resolution logic in
   `express.js` / `nestjs.js` — call the same `classInModule` / `methodInClassChain` helpers.
3. Re-point `express.js` and `nestjs.js` to `resolve.js`. Delete the duplicated recursion in each.
4. **CHECKPOINT:** `npx vitest run` green (568+), then `node tools/bench/run.mjs` **byte-identical**
   on all 6 repos. If the graph sha256 moves on ANY repo, a subtlety was dropped — diff the
   canonical graph (the determinism makes the diff readable) and reconcile BEFORE proceeding. Do
   not "accept" a hash change in Phase 1.

Phase 1 ships as its own commit: "refactor(ubg): one resolver, byte-identical" — a pure,
verifiable extraction. This alone is worth it (kills the triplication, shrinks extract.js).

### Phase 2 — extend, one capability at a time, each its own checkpoint

Only after Phase 1 is green. Each extension re-runs the bench; a golden that MOVES is either a
regression (fix) or an improvement (re-consecrate with `--update` — that commit IS the review).

- **(a) Next.js depth.** Next currently has no follow (formbricks/dub read handlers but not the
  services they call). Add a Next `cfg` → Next gains depth for free. New effects only; verdicts
  should not flip on already-clean paths (watch dub's F=156 golden — it must not drop, per E-029).
- **(b) ORM by import-root, not by name.** Replace the syntactic ORM name-patterns with: an effect
  is a DB effect iff its receiver RESOLVES (via the engine) to an export of a known ORM module.
  Keep the name-patterns as a labelled `asserted` fallback (same verified/asserted provenance as
  ADR-046). This is where the repository-pattern resolves naturally and E-029-style false
  positives drop.
- **(c) Fix the depth-truncation memo (the §3 limitation from the health review).** In the unified
  engine, do NOT memoise a result that was truncated by the depth/cycle bound as if complete.
  Cleanest: tag each memo entry with whether its subtree was fully explored; a shallow hit may
  reuse only a complete entry, else it recomputes with its larger remaining budget. This is the
  "one place to make the bound complete-by-construction" the review pointed to.

## 4. Tripwires (paid for in blood already — do not relearn)

- **E-029:** effects-only across calls. Never propagate `guardSignals` / `validatesInput` through a
  follow. The corpus finding counts are the alarm — if dub/immich finding counts move in Phase 1,
  you propagated something you shouldn't.
- **E-027:** memoise per (file, dispatch, method) or big Nest repos regress to 30s+. twenty is the
  canary (it re-resolves shared resolver methods across 145 routes).
- **Determinism:** sort every module walk, keep source order for effects, no `localeCompare` on
  output-reaching paths (use `cmp`). The bench graph sha256 is the guarantee.

## 5. Why this is the prerequisite for ADR-P1 (dataflow)

The taint pass (P1) needs ONE call-graph to propagate `req.body -> db_write`. Three divergent
followers cannot carry a dataflow edge coherently; the unified resolver is the substrate the
`dataflow` IR edge (ADR-P1, `bh2_`) is emitted from. Do P2 first, exactly for this reason.

## 6. Rollback

Every step is a commit; the bench is the net. If Phase 2(x) regresses a golden and cannot be
reconciled, revert that one commit — Phase 1 and the earlier Phase-2 steps stand on their own.
Nothing here is a big-bang; it is a sequence of individually-green, bench-verified commits.
