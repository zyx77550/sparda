# 2026-07-13 — Cross-class dataflow: directus 13% → 95% (0.30.0)

**Scope:** Zak: "reyna et miroir… choisi un, fais-le bien." Picked the real, provable arc
(interprocedural table dataflow) over the mirror-execution loop, and did it to completion on
real directus.
**Commits:** this one · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 546/546 (3 skipped)

## Done
- **Symbolic `this`-environment (`computeThisSymbols`, extract.js).** At a `new X(args)` site, bind
  `this.<field>` to the constructor arg's table value: request-derived → `:collection` (symbolic),
  string literal / `super('directus_activity')` → concrete. Threaded through the express
  class-method bundle (`scanFunction(fn, {thisSymbols})`), memo-keyed by binding, carried across
  `this.`/`super.` hops.
- **Both knex builder orders.** `.knex(t).insert()` (builderTableOf) and `.select().from(t)` /
  `.into(t)` (`chainVerbOp`, db-root-guarded so `Array.from` never fires). Bracket access
  (`req.params['collection']`) + TS `!`/`as` unwrap.
- **Middleware-slot effects (translate.js).** Attach effects from EVERY chain step with a body —
  directus's `router.get(path, …, handler, respond)` hid the real work in a middleware. Effect
  node ids made collision-aware so two bindings of one method line coexist.
- **Real directus: coverage 13% → 95%, db effects 11 → 344, `:collection` resolving.** Verdict
  still PROVEN, 0 findings. Full 11-app corpus: EVERY verdict + finding count identical to baseline.
- Fixture `ubg-crossclass-table` (symbolic + literal-super + both orders + id-collision) + 3 tests.
  ADR-051, E-033, CHANGELOG 0.30.0, stress-report + HANDOFF updated.

## Not done / deferred
- **The Reyna/mirror execution loop.** Investigated `mirror` and confirmed it's a mock BUILT FROM
  the graph — driving it at blind spots is circular. The honest loop needs executing the real
  target app (deps, runtime, against the zero-infra ethos) — a separate multi-session arc, not
  faked here.
- One pre-existing false table survives: `trx.insert(payloadWithoutAliases)` reads the variable
  name as a table via the Drizzle path (directus write path). Narrow, not introduced this session.
- `chainVerbOp` needs a recognizable db root; an exotically-aliased builder still slips through
  (→ correctly a blind spot).

## Decisions made
- ADR-051. Chose provable dataflow over theatrical execution-loop. Effect-id collision-awareness
  added surgically (only bumps when a different table would collide), so the pinned
  `effect:...:0` id format in fingerprint/polarity/speculative/determinism tests is unaffected.

## Bugs hit
- E-033 (the two stacked blockers: cross-class hop + middleware-slot handler). Self-caught chain:
  fixture worked but directus didn't → traced to `req.params['collection']` bracket access (fixed)
  → then to the `respond`-last middleware pattern (fixed) → then a node-id collision dropped the
  second binding (fixed with collision-aware ids). Each found by probing the real repo, not guessing.

## Notes for the next session
- directus at 95% is the strongest single proof point SPARDA has on a real monster — good material
  for the residual-labs article and the genome demo.
- The middleware-effect attach is a general improvement (every app now scans all chain steps); it
  raised resolved-effect counts across the corpus (dub 682, novu 1011, immich 283) with zero
  verdict movement — worth remembering it's load-bearing if effect counts ever shift unexpectedly.
- Next honest arc remains Reyna's loop: execute high-risk blind spots via a real harness (not the
  graph-mock `mirror`) and fold observations back as resolved. Bigger, multi-session.
