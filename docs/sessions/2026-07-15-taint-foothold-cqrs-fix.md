# 2026-07-15 — taint foothold (ADR-P1) + the CQRS phantom-write fix

**Scope:** build the first consumer of the soundness contract — taint (request data → a
write) — measuring before building; ship it soundly or not at all.
**Commits:** `<hash>` · **Branch:** `claude/current-task-u45a4d` · **Tests:** 599/599 green (3 skip)

## Done
- **Measured the taint surface first** (`scratchpad/taint-surface.mjs`) — the old shortcut
  was measured dead, so this one earned its build. Real but modest (0–10 %), and a naive
  write-site detector is imprecise (ctx/payload = webhooks; can't see service-layer
  validation). Conclusion: no standalone taint finding — it would be dub-style noise.
- **Taint as ENRICHMENT** — `valueTainted`/`optionValueOf` in extract.js tag prisma
  `data:`, model-op `create/save(arg0)`, and supabase `insert(arg0)` writes `tainted` when
  the payload is provably request-derived (reusing `reqParamName`). translate.js carries
  `meta.tainted`; apocalypse tags the existing `UNGUARDED_MUTATION` `tainted: true`. Never a
  finding of its own → zero new false positives. Fixture `ubg-taint-write` + 3 tests.
- **E-040 — CQRS phantom-write fix.** Found while measuring taint: novu had **612/636
  db_writes phantom** (`SomeCommand.create({...})` CQRS factories read as model writes). A
  `NON_MODEL_RECEIVER` suffix gate excludes DI/CQRS infra receivers. novu **636 → 24
  db_writes, UNGUARDED 21 → 2**; dub/twenty/immich/cal.com unchanged, no verdict flips
  cleaner. Fixture `ubg-cqrs-command` + 3 tests.

## Not done / deferred
- **Crypto hash misread as a write** (`sha256`) — novu's 2 residual findings. Safe-kind
  noise; the fix (restrict `builderTableOf.isBaseCall` to DB receivers) risks hiding a real
  aliased `knex('t')` write, so deferred until a soundness-preserving gate is designed.
- **The full ADR-P1** — cross-function dataflow taint (follow the value through the
  validator/service layer). The only way to make taint high-volume AND drop the false
  "unvalidated." Multi-session, needs dataflow edges in the IR. Today's enrichment is its rail.

## Decisions made
- Taint is UNDER-approximated and advisory (enrichment, not a finding) — a missed tag hides
  nothing (the mutation still flags), so it can't produce a false negative, and it can't
  produce a false positive (it only decorates an existing finding). Sound both ways.
- E-040's exclusion list is deliberately conservative (SOUNDNESS Direction 1): only suffixes
  that can NEVER name an ORM model. Ambiguous nouns (Event/Entity/Schema/Payload) stay
  writes — over-flagging is safe, dropping a real write is not.

## Bugs hit
- E-040 (CQRS phantom writes) — see ERRORS.md. The lesson: a capitalization heuristic for
  "is this a model" is blind to CQRS/DDD, where `Xxx.create()` is a command factory.

## Notes for the next session
- When building the full ADR-P1 dataflow taint: the `meta.tainted` field and the apocalypse
  enrichment are already wired — richer taint just needs to set the flag from a cross-function
  walk. Check against SOUNDNESS Direction 1 (never lose a tainted→write path silently).
- The crypto-`sha256` FP and E-040 are the same species (a name-shaped heuristic firing on a
  non-DB receiver). If a general "is this receiver a data store" oracle is built, it closes
  both — but it must never restrict so hard it hides a real aliased connection.
