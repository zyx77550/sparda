# 2026-07-12 — Medusa file-based routing: the real wall down

**Scope:** Gemini re-tested SPARDA on Medusa and hit 0 routes again — the NestJS
extractor (part 16) can't see it because Medusa has no `@Controller` classes. Build the
third route pattern (file-based) so Medusa compiles to real proofs.
**Commits:** (this session) · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 489/489 green (3 skip)

## Done
- **`src/ubg/medusa.js`** — file-based route extractor. Walks `src/api/**/route.{ts,js}`,
  derives the path from the directory (`[id]`→`:id`, `[...rest]`→`:rest`), reads exported
  `GET/POST/PUT/PATCH/DELETE` consts/functions as methods. Two conventions beyond path:
  - **Inverted auth**: guarded by default; `export const AUTHENTICATE = false` is the only
    opt-out. Emits a synthetic `authenticate` guard node unless the literal false is present.
  - **Workflow-verb effect heuristic**: the mutation is `createProductWorkflow(...).run()`,
    not an ORM call, so `scanFunction` sees nothing. We walk the body for `*Workflow`/`*Step`
    callees and synthesize a `db_write`/`db_read` from the verb, with a table from the name.
- **Wired**: `detect.js` (→ `framework: 'medusa'`, entry `src/api`, checked before Nest),
  `compile.js` extractors map. Emits the standard `extractExpress` shape — whole immunity
  stack (fingerprint/polarity/immunize/speculate/dossier) works unchanged.
- **Proof on real `medusajs/medusa` `develop` (319 route.ts): 0 → 476 routes**, 0 skipped,
  ~0.5s. 435 db_writes, 26 db_reads, 121 state tables, 474 guards. Verdict provable & clean.
- **Fixture + tests** `tests/medusa.test.js` (6): 4-route fixture proves path derivation,
  `:params`, workflow→db_write synthesis, the inverted-auth flag (one critical
  `UNGUARDED_MUTATION` on the `AUTHENTICATE=false` public cart), and guard nodes on the rest.
- Docs: ADR-040, ERRORS.md C-001c, HANDOFF part 17, CHANGELOG 0.18.0, version → 0.18.0.

## Not done / deferred
- **Medusa DML parsing.** Medusa declares data models in its own DSL (not `.sql`/`.prisma`),
  so obligation O2 (field-level validation) has no constraint set on Medusa — it can't fire.
  This is the next ingestion rung; route/guard/atomicity/reversibility obligations all work.
- **Genome Brick 2** (signed antibody envelope, "techno de foi") — task #29, next up.

## Decisions made
- The verdict on real Medusa is *clean*, and that is **honest, not a bug**. Medusa
  authenticates nearly every mutation; the two `AUTHENTICATE=false` files are a read-only
  feature-flags route and an invite-accept route carrying its own `res.status(401)`
  deny-guard (which `scanFunction` reads as a guard signal). We do NOT manufacture findings
  to look impressive — a clean mature codebase should read clean.
- Ingestion is a **ladder**, extended not rewritten: each hidden-route framework gets a rung
  that reads the static signal that IS there (here: the filesystem + workflow names).

## Bugs hit
- None new. The recurring self-containment publish-gate tripped on the untracked
  `src/ubg/medusa.js` until `git add`ed — expected, documented behaviour.

## Notes for the next session
- Real Medusa proof was run from a sparse shallow clone of `packages/medusa/src/api` on the
  `develop` branch (default branch is `develop`, NOT `main`) copied into a throwaway app dir
  with a minimal `package.json`. The clone is in scratchpad (ephemeral) — re-clone to re-run.
- The workflow-verb regex (`WRITE_VERB`/`READ_VERB` in `medusa.js`) is a naming inference,
  same trade-off as SQL/Prisma literal harvesting. If Medusa adds verbs, extend the lists.
- Next: **genome Brick 2** — the signed antibody envelope. Ed25519 signature + content
  addressing by `behaviorHash`, git repo as the zero-infra backplane. The capsule
  (`immunity.js`) is the payload; Brick 2 is the trust envelope around it.
