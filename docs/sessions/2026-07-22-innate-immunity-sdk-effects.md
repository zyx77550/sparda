# 2026-07-22 — Innate immunity: vendor-SDK effect receptor (audit blind spot #1)

**Scope:** Close the worst false negative from the independent audit (`SPARDA_AUDIT_REPORT.md`):
vendor-SDK calls that ARE irreversible external effects but wear no `fetch`/http-client skin
(`stripe.charges.create()`) resolved to nothing, so O4 (irreversibility) never fired on real
payment code.
**Commits:** this session · **Branch:** `claude/sparda-mcp-security-audit-nw3kek` · **Tests:** 717/717 green (+3 new), 3 skipped

## Done
- **PAMP receptor in `src/ubg/extract.js`** — a small, declarative catalog (`EFFECT_SDK_PATHS`
  + `EFFECT_SDK_METHODS`) of CONSERVED vendor call shapes (Stripe money-movement, Twilio
  send, SES/nodemailer mail, S3/SNS/SQS), matched on the property path BELOW the (user-named)
  root via `memberPathBelowRoot` / `knownExternalEffect`. Emits an observable `http_call`
  effect. Checked AFTER every DB handler returns, so an ORM call is never misread.
- **Verified on the exact audit case:** `stripe.charges.create()` + DB write → now resolves the
  charge as `http_call` (`sdk:charges.create`, observable, non-compensable) and fires
  `IRREVERSIBLE_OBSERVABLE` (high). Was: `RISKY` (missed).
- **No false positive:** `ubg-proven` and the clean fixture stay `PROVEN` (plain
  `prisma.note.create` is NOT read as an SDK effect).
- **Tests:** new fixture `tests/fixtures/ubg-sdk-effect` + `tests/sdk-effect.test.js` (3 cases:
  http_call resolution, O4 firing, ORM negative). Full suite 717/717 green, eslint clean.

## Brick #2 — DONE (FK harvest robust to real-world @relation shapes)
- **Root cause (found empirically, not the assumed one):** it was NOT `@@map` (the table node is
  keyed by the model name; `@@map` is only an alias). The `@relation` parser used a single-line
  regex `@relation(\s*fields:` that only matched a plain, first-attribute relation. **Named**
  relations (`@relation("Name", …, onDelete: Cascade)`) and **multiline** relations were silently
  dropped → consistency domains collapsed to one-table islands → O3/O5 never fired on serious
  schemas. (So the `prisma/migrations` stigmergy idea was unnecessary — the schema was right
  there; only the parser was too strict.)
- **Fix (`src/ubg/prisma.js`):** harvest FKs over the WHOLE model body with `[\s\S]`, pulling
  `fields:`/`references:` INDEPENDENTLY (order-agnostic, multiline-safe). Removed the fragile
  in-loop single-line extraction.
- **Verified:** probe fixture with plain/named/multiline relations → all 3 now yield the FK;
  end-to-end, 4 FK-linked tables merge into one aggregate and O3 `NON_ATOMIC_AGGREGATE_WRITE`
  fires on a named-relation write (was: 4 islands, silent).
- **Tests:** `tests/fixtures/ubg-prisma-relations` + `tests/prisma-relations.test.js` (plain,
  named+onDelete, multiline, no-back-relation-FP). Suite 721/721 green, eslint clean.

## Brick #3 — DONE (client-provenance through interactive transactions)
- **Root cause:** `prisma.$transaction(async (tx) => { tx.order.create(...) })` hands the callback
  a transactional client named `tx`, which the `/prisma|client|db/` heuristic can't see, so every
  write inside vanished → the dominant Prisma idiom compiled to SURFACE (blind). An UNGUARDED
  write inside such a transaction was a **silent pass**.
- **Fix (`src/ubg/extract.js`):** in the TX-wrapper visit, bind the callback's param name(s) into
  `txCtx.dbAliases` (the "prion" bind — db-identity templated by contact, scoped to the tx body,
  never leaks). The Prisma op check now accepts a client whose name is in `dbAliases`.
- **Verified:** callback-tx writes reappear, both tagged with the SAME tx scope (atomic → no
  false NON_ATOMIC, no false PROVEN); an unguarded write inside the callback now fires
  `UNGUARDED_MUTATION` (critical, tainted) instead of passing silently.
- **Tests:** `tests/fixtures/ubg-tx-callback` + `tests/tx-callback.test.js`. Suite 724/724 green,
  eslint clean.

## Brick #4 — DONE (cross-package monorepo effect resolution)
- **Root cause (again, not the assumed one):** workspace resolution already worked
  (`@acme/data` → the sibling package, barrel re-export threaded) — the write dead-ended because
  the leaf was exported as `module.exports.createOrder = async () => …`, a direct
  function-to-exports assignment the function collector never captured (only `const f = …; export
  { f }` and `function f(){}` were seen). So a `service.createOrder()` call resolved to no body →
  SURFACE. NOT a workspace-linking problem; a CommonJS export-style gap that also affects
  single-package apps.
- **Fix (`src/ubg/extract.js`):** the `exports.X = …` handler now also registers a directly-
  assigned function/arrow (incl. a wrapped `catchAsync(async …)`) as an exported function `X`.
- **Verified end-to-end:** `packages/api` → controller → `@acme/data` barrel → `order.service.js`
  → `Order.create()` now resolves `db_write:order` (was SURFACE), and the boundary-crossing
  unguarded route fires `UNGUARDED_MUTATION` (critical) instead of passing silently.
- **Tests:** extended `tests/workspace-resolve.test.js` with an end-to-end block (the proof that
  previously "lived only on the corpus") + a unit test for the export-style capture. Suite
  728/728 green, eslint clean.

## Minor precision fixes (the audit's lower-severity list)
- **O2 no longer fires on a DELETE** (`src/ubg/apocalypse.js`): a delete removes a row, so it
  can't violate a CHECK/NOT NULL/UNIQUE value constraint. Was noise (medium on
  `DELETE /users/:id` because `users.email` is UNIQUE). A guarded delete now reads PROVEN; an
  UPDATE to the same constrained table still flags. Test: `tests/o2-delete-precision.test.js`.
- **PARTIAL label oracle↔CLI drift removed** (`scripts/corpus-oracle.mjs`): the oracle
  hand-rolled the verdict string without the PARTIAL rung and didn't pass `blindHigh`, so
  cal.com read PROVEN at 23% coverage while `sparda apocalypse` said PARTIAL. Oracle now imports
  and uses `verdictState` with the same `coverage`+`blindHigh` inputs as the CLI — they can't
  disagree by construction. Snapshot: `cal.com` PROVEN→PARTIAL (deterministic at 23% < 60%);
  `tests/corpus-snapshot.test.js` VERDICTS set now includes PARTIAL. Any blindHigh-driven flip on
  another PROVEN app (e.g. nocodb) is caught on the next real `--update` with the giants present.

## Round-2 re-audit + bricks #5–#6 (effect-extraction breadth)
Adversarial probe battery (ORMs, frameworks, write positions, more SDKs) after the first six
fixes. Solid: parallel writes (`Promise.all`), writes in `.then()`/conditionals, Mongoose,
Sequelize create/update, SQL table-level `FOREIGN KEY` clauses, `router.use(auth)` guards.

- **Brick #5 — AWS SDK v3 + Resend** (`src/ubg/extract.js`): `client.send(new PutObjectCommand())`
  matched by the command class in the argument; `emails.send`/`emails.create` added to the path
  catalog. Test in `tests/sdk-effect.test.js` (AWS v3 positive + plain-`.send` negative).
- **Brick #6 — import-provenance for effect clients** (the ant cuticular-hydrocarbon / "colony
  odor" model): a binding imported from an effect package (`@sendgrid/mail`, `stripe`, aws-sdk,
  kafkajs, …) or built from one (`new S3Client()`, `Stripe(key)` factory, alias) carries an effect
  LABEL acquired at its source; any call on a labeled binding is recognized by ORIGIN, not by
  guessing the method name — catching the bare `.send()` tail (SendGrid `sgMail.send`) the path
  catalog can't. Read-shaped methods (`get/list/retrieve/…`) stay GET (not observable) so a read
  never becomes a false irreversibility finding; a non-effect package (lodash) never fires.
  - `parseModule` builds `facts.effectClients` (`collectEffectClients`); `scanFunction` threads it
    via `env.effectClients` → `ctx`; `inspectCall` checks it; `resolve.js` passes each module's set
    at every scan site.
  - Also fixed a pre-existing gap found on the way: **inline arrow route handlers were never
    deep-scanned** (only module-member handlers were), so they followed no service calls and got no
    provenance. `express.js` now `deepScan`s inline handlers like every other callable branch —
    strict improvement, suite stayed green.
  - Test: `tests/fixtures/ubg-sdk-provenance` + `tests/sdk-provenance.test.js`. Suite 735/735.

## Brick #7 — DONE (TypeORM write resolution via repository provenance)
- **Root cause:** TypeORM write verbs (`save/insert/update/delete/remove/upsert/…`) run on a
  repository whose entity is nowhere in the call — `this.repo.save(dto)` (NestJS injected) or
  `getRepository(User).save()` (Express). The ORM handlers didn't know these shapes, so a
  NestJS+TypeORM app — a top enterprise stack — read SURFACE and proved nothing.
- **Fix (`src/ubg/extract.js` + `resolve.js`):** repository provenance, same shape as the effect-
  client label. `collectRepoFields(cls)` reads constructor params (`@InjectRepository(Entity)` or
  `Repository<Entity>` type) → field→table; `collectRepoVars(fnNode)` reads local
  `getRepository(Entity)` → var→table. Merged into `ctx.repoTables`; a TypeORM write verb on a
  receiver in that map emits a `db_write` on the entity table. A generic `.save()` on an unknown
  object never fires (near-zero FP).
- **Verified end-to-end:** NestJS controller → service DI hop → `this.repo.save/delete` resolves
  `db_write:user` (insert+delete), the `@UseGuards` POST is clean and the unguarded DELETE fires
  `UNGUARDED_MUTATION` critical; Express `getRepository` with insert/update/remove all resolve.
- **Along the way:** exported `collectRepoFields`, added a local `walkAst` to extract.js (it must
  not import resolve.js). Test: `tests/fixtures/ubg-typeorm-nest` + `tests/typeorm.test.js` (Nest
  injected, local getRepository, generic-.save negative). Suite 740/740 green, eslint clean.

## Remaining gaps (reported, next bricks — not yet built)
- **TypeORM `manager.save()` / active-record `Entity.save()`** — the entity-manager and BaseEntity
  static shapes are not yet labeled (only injected/typed repos and `getRepository` vars are).
- **TypeORM @Entity classes as state nodes** — the entities ARE the schema, but SPARDA doesn't yet
  parse them into `state` nodes, so O3/O5 (aggregate atomicity) can't fire on a TypeORM-only app
  (writes resolve, but there's no FK/domain layer). Parallel to `prisma.js`; a separate brick.
- **Nested-factory clients** (`const producer = kafka.producer()`) not yet labeled.
- **Framework breadth**: Fastify, Koa (honest "not supported" errors), Hono (not detected).

## All four audit holes closed
Bricks #1–#4 shipped this session. Two of the four root causes were NOT the ones the roadmap-gap
analysis predicted (FK: parser strictness, not `@@map`/migrations; monorepo: a CommonJS
export-style gap, not workspace linking) — found empirically before coding, per the discipline
note. Remaining audit items are lower-severity (medium noise on DELETE, PARTIAL label
oracle/CLI drift, `bin` naming) and by-design (no runtime value evaluation).

## Decisions made
- Innate layer is **deterministic + additive + write-only**: it can only RAISE a finding, never
  fabricate a false `PROVEN` — a stale catalog under-detects, it never lies. The adaptive layer
  (LLM-on-surprise → antibody keyed by behaviorHash, shared via the genome) is a later brick for
  the long tail; the innate catalog handles the head cheaply with zero LLM/network.
- Kept the catalog narrow (highly-specific conserved shapes) to keep FP near zero. `messages.create`
  / `calls.create` are the loosest entries (Twilio) — acceptable since the direction is safe.

## Bugs hit
- None. First implementation passed; the only care was ordering (receptor must sit AFTER the
  Prisma/Drizzle/etc. handlers so an ORM call returns early and is never double-counted).

## Notes for the next session
- **Corpus drift expected & legitimate:** on apps that call a payment/mail/queue SDK next to a
  write (e.g. dub uses Stripe), `IRREVERSIBLE_OBSERVABLE` counts will rise. `corpus-oracle` will
  flag drift — re-baseline intentionally (`--update`) once the giants are cloned, noting the
  reason. Not present in this ephemeral env, so the oracle skipped.
- To extend the catalog: add conserved multi-segment paths to `EFFECT_SDK_PATHS` (lowercased,
  path below root) or strong single tokens to `EFFECT_SDK_METHODS`. Keep it specific.

---

## Task 1 (later same day) — custom principal-injection PARAM decorators as guards (ADR-063)

**Trigger.** Fable (the code executor per `docs/ATTACK-PLAN-FABLE.md`) was unavailable; Zak asked
Claude to take over the roadmap. Gemini had pushed the genome-mining results
(`docs/gemini/GENOME-MINING-RESULTS.md`, 9 repos, **0/83 genuine re-derived**), which localize the
#1 recall bottleneck. Attack-Plan Task 1 was the highest-value measured brick.

**What the genome actually said (refining ADR-062's guess).** ADR-062 guessed the next brick was
custom permission *method* decorators (`@HasPermission`/`@HasRole`). The real 9-repo data was
sharper: auth-named METHOD decorators (`@Authenticated`, `@Acl`, `@RequirePermissions`) already read
as guards. The genuine blind spot is the custom **parameter** decorator that injects the
authenticated principal — `@AuthWorkspace()`, `@AuthUser()`, `@AuthUserWorkspaceId()` (twenty),
`@CurrentUser()`/`@GetUser()` (everywhere). They sit on the handler's PARAMETERS, which `useGuards()`
never scanned, so twenty's every resolver mutation cried a FALSE `UNGUARDED_MUTATION`.

**Change (3 files, additive).**
- `src/ubg/nestjs.js`: `PARAM_AUTH_DECORATOR` regex + `paramAuthGuards(method)` read route-method
  param decorators; matches are added to the chain as **asserted** guard steps (deduped against
  named guards). `ASSERTED_PRINCIPAL_SCAN` marks them. A proven global guard still upgrades them to
  verified (`GLOBAL_GUARD_SCAN`); otherwise they stay asserted.
- `src/ubg/extract.js`: `isGuardLike` now also honors an explicit `scan.assertedGuard` flag — the
  ONE surgical line that lets bare-principal names (`@GetUser`, `@Principal`, no `GUARD_NAME` token)
  gate their route WITHOUT widening the broad `GUARD_NAME` regex globally (which would misclassify a
  plain `getUser` Express middleware and risk a real false-negative).

**Honesty rails (the whole point), both tested.**
1. Asserted-never-verified: a param decorator has no deny body, so it can only read `asserted`
   (blindspot-ledger unverified) — it downgrades a false positive, never buys a `PROVEN`.
2. Never suppresses a real hole: `wipeAllUsers` (no auth param) STILL flags `UNGUARDED_MUTATION`.

**The compass — deterministic, not the noisy clone.** The genome miner's twenty sample is
noise-dominated: `bench/mined-twentyhq-twenty.json` is 15/15 `missed`, but the subjects are dep-bumps
("bump http-proxy-middleware"), refactors, and CLI token fixes — the `FIX_MSG`/`GUARD_ADD` candidate
filter matched "security"/"auth" in a subject, not an actual param-guard-on-route addition. So a
re-mine cannot cleanly attribute a lift, and claiming one would be dishonest. Instead the recall lift
is proven at the miner's CORE computation: removing `@AuthWorkspace()` from the fixture now yields
`diffGraphs → GUARD_REMOVED` (the exact `re-derived` verdict) where before the decorator was
invisible → empty diff → `missed`. Locked as a permanent network-free test.

**Result.** `tests/param-auth-decorator.test.js` (6 tests incl. the compass) + fixture
`ubg-param-auth-decorator`. Full gate: **757 tests ✓**, 20/20 mutants killed, ESLint 0, Prettier
clean. No new runtime dependency (still 4). Also fixed a pre-existing `no-useless-assignment` lint
error in `tests/wedge.test.js` that was blocking a clean gate.

**Next bricks (unchanged priority).** Task 2 (unify provenance/taint into one value-flow pass) and
Task 3 (partial-eval routing for Strapi/directus "no-routes"). The genome loop re-measures each.

---

## Task 2 (taint half) — value-flow through destructuring/aliases + proof-grade O2 (ADR-064)

**Trigger.** Zak greenlit Task 2 after Task 1. Task 2's done-when is "taint O2 becomes proof-grade;
recall lift measured." Explored the existing taint first: SPARDA already had per-write taint
(`valueTainted` → request-derived value at a write), but `collectReqDerived` only tracked a direct
member binding (`const c = req.body.x`), so it missed the shapes handlers actually use.

**Probe (measured the gap before touching code).** A two-route Express app: `/a` writes
`req.body.title` directly (tainted ✓), `/b` writes `const { title } = req.body` (tainted ✗ — the
destructuring idiom was invisible). Confirmed the flagship taint evidence never fired on the common
shape.

**Change (2 files, additive).**
- `src/ubg/extract.js` `collectReqDerived`: now follows request taint through object-pattern
  DESTRUCTURING (`{ title }`, `{ title: t }`, `{ ...rest }`) and identifier ALIASES (`const b =
  req.body; const c = b`), one source-order pass (earlier binding in the map before a later ref).
- `src/ubg/apocalypse.js` O2: proof-grade tier — a PROVEN request→constrained-column flow names the
  source→sink and tags `tainted: true`; the conservative flag fires unchanged when taint sees no flow.

**Honesty rails (kept intact).** Taint under-approximates by design → a richer reach can only SHARPEN
a true finding, never invent one (the tag only decorates emitted findings). O2 still fires on a
server-controlled constrained write when taint sees nothing (the `/publish` `data:{title:'published'}`
case) — the proof-grade tier is a strict addition, so better taint precision never drops an O2.

**Measured lift.** After the fix, `/b` (destructured) taints; `UNGUARDED_MUTATION` on it now reads
"…and request data flows straight into the write" (was silent). O2 on a proven flow reads "lets
unvalidated request data flow straight into posts.title" vs the old speculative "no validation on
this route." O2 is deliberately not a miner `STATIC_HIT` (ADR-062), so this lifts finding QUALITY on
the flagship rule (the credibility surface), not the recall count.

**Result.** `tests/taint-flow.test.js` (4 tests, incl. the server-controlled soundness case) +
fixture `ubg-taint-flow`. Two new mutation guardians (param-decorator feature; destructuring taint).
Full gate: **761 tests ✓**, **22/22** mutants, ESLint 0, Prettier clean, 4 deps.

**Task 2 status.** Done-when MET (proof-grade O2 + value-flow taint). Continued depth remaining:
interprocedural taint across helper-call boundaries, and the full ADR-061 origin-recognition merge
(effect-client/repo/tx-alias) into ONE value-flow pass. Next brick candidate: Task 3 (partial-eval
routing for Strapi/directus "no-routes").

---

## Task 3 (Strapi) — partial evaluation of the declarative route table (ADR-065)

**Trigger.** Zak: "Task 3 ensuite tu fera profondeur de 1-2-3." Task 3 = unblock the genome's
"no-routes" frameworks (Strapi/directus). Explored detect.js + the extractor dispatch first.

**Root cause (Strapi).** Its routes are a DATA STRUCTURE the framework reads at boot —
`module.exports = { routes: [ { method, path, handler } ] }` and, dominantly, `createCoreRouter(uid)`
(one call standing for a 5-row CRUD table) — not a route CALL. Every AST-call/decorator scan saw 0
routes → the whole app SURFACE.

**Change (4 files, one new extractor).**
- `src/ubg/strapi.js` (new, modeled on medusa.js): reads the `routes:` array as data, unrolls
  `createCoreRouter(uid)` to CRUD (pathed from the content-type `pluralName`), resolves
  `handler:'a.action'` cross-file to the controller method, scans effects. Strapi ORM vocab
  (`entityService`/`db.query(uid)`/`documents(uid)`) synthesized locally — shared hot path untouched.
- `src/detect.js`: Strapi detection, dep (`@strapi/strapi`) OR structural (`src/api/*/routes/*` with
  a route table / core router), checked before express (a Strapi app lists koa/express transitively).
- `src/ubg/compile.js`: dispatch `strapi → extractStrapi`.

**Honesty (reused ADR-055 posture, not reinvented).** Strapi's permissions live in admin config, not
code. So: `config.auth:false` = public opt-out (its mutation flags unguarded, honestly); any opt-out
⇒ guarded-by-default, other routes get an asserted `framework-default-auth` (never verified — no
false PROVEN); `config.policies/middlewares` → asserted guards. A killing mutant guards the posture
(giving a public route the default guard fails the suite).

**Result (measured on the fixture).** An app that read **0 routes now reads 6** (custom table +
unrolled core CRUD); custom handlers' cross-file `entityService.update` / `db.query(uid).delete`
resolve to writes on `article`; the core `create` write is synthesized on the uid table; only the
`auth:false` publish route flags `UNGUARDED_MUTATION`. `tests/strapi.test.js` (6 tests) + fixture
`ubg-strapi`. Two new mutation guardians (core-router unroll; posture honesty). Full gate: **767 ✓**,
**24/24** mutants, ESLint 0, Prettier clean, 4 deps. One incidental fix: the publish-gate
self-containment test reads `git ls-files`, so the new `strapi.js` had to be staged to count as
published (it correctly flagged compile.js's dangling import until then).

**Task 3 status.** Strapi done. Remaining: directus/parse-server registry-loop shape (Express routers
mounted in `for (const c of controllers) app.use(c.path, c.router)`) — same partial-evaluation
technique on a different structure.

**Next (per Zak).** Depth pass over Tasks 1-2-3: interprocedural taint across helper-call boundaries
(Task 2 depth), verified-guard resolution for custom param/policy decorators where a body IS visible
(Task 1 depth), and the directus/parse-server registry loop (Task 3 depth).

---

## Depth pass, item 1 — interprocedural taint (Task 2 depth, ADR-066)

**Trigger.** Zak: "profondeur de 1-2-3." Started with the highest-value cross-cutting depth item —
taint stopped at the call boundary (ADR-064 only reached within a function), missing the pervasive
controller→service write-in-a-helper pattern.

**Change (2 files).** `src/ubg/resolve.js` `followCalls`: on the bare-helper hop that already merges
effects, bind the helper's params the caller proved request-derived (`seedTaint`) and pass them as
`reqDerivedSeed`; thread the seed through the recursion for multi-hop. `src/ubg/extract.js`:
`collectReqDerived(fnNode, seed)` merges the seed; `scanFunction` accepts `env.reqDerivedSeed`;
exported `collectReqDerived` + `reqParamName`. Mirrors the existing `computeThisSymbols` constructor-
arg binding.

**Honesty.** MUST-analysis — a param is seeded only when the arg is PROVEN request-derived, so the
pass only adds a true taint tag / lifts O2 to proof-grade, never fabricates a finding. Identifier
params only (destructured signatures left to the callee's own scan — the safe under-approximation).
Documented imprecision: shared effect nodes mean a helper called from a tainting AND a non-tainting
site carries one tag (over-approx on an advisory tag, never a hidden hole) — left explicit in ADR-066.

**Result.** `/via-helper` (`const { title } = req.body; applyTitle(id, title)`) → the constrained
write inside `applyTitle` is now proof-grade tainted; `/publish` (server literal, own node) stays
untainted. `tests/taint-flow.test.js` (5 tests). Killing mutant on the seed. Full gate: **768 ✓**,
**25/25** mutants, ESLint 0, Prettier clean, 4 deps. No regression across the shared resolver.

**Depth pass remaining.** Task 1 depth (verified guards where a param/policy body denies), Task 3
depth (directus/parse-server registry-loop unroll), Task 2 further (the full ADR-061 origin-
recognition merge into one value-flow pass; per-call-site effect identity if the shared-node
imprecision ever bites).

---

## Self-audit of the session (Zak: "reviens, déteste voir ce que tu as manqué")

Turned the honesty discipline on my own 4 bricks + the depth item. Ran adversarial probes, not
theory. Findings, most severe first:

| # | Finding | Severity | Direction | Disposition |
|---|---------|----------|-----------|-------------|
| A | `@Author`/`@Authorization` param decorators falsely asserted a guard → could HIDE an unguarded mutation | **HIGH (soundness)** | Direction 2 (hides a hole) | **FIXED** — E-060, regex lookahead + decoy test |
| B | ADR-066 interprocedural taint claimed "handler→controller→service" but covers BARE calls only, not DI/method calls | Medium (overstated doc) | — | **CLAIM CORRECTED** — DI-taint queued as its own brick (cache-key hazard) |
| C | Taint under-approximates nested (`{ user: { id } }`) + array destructuring | Low | Direction 1 (safe) | **DOCUMENTED** — improvement axis |
| D | Strapi custom-vs-core route on same method+path collides; resolves to custom by file order | Low | correct outcome, fragile | **DOCUMENTED** — deterministic today (article.js < core.js), not guaranteed by design |
| E | Strapi `strapi.service(uid).method()` write vocab not recognized | Low | Direction 1 (safe, misses a write) | **NOTED** — extend STRAPI vocab next |
| — | (checked, NOT a problem) `finding.tainted` on O2 does not drive verdict/severity — purely evidence | — | — | verified clean |
| — | (pre-existing, not mine) module-level `new Service()` instances in Express aren't resolved → 0 writes | — | — | out of scope, noted |

**The one that mattered.** Finding A is the real miss: my ADR-063 rail protected the PROVEN direction
("asserted, never verified") but I did not guard the OTHER direction — an over-broad asserted guard
*hiding* a finding. That is precisely the error class SPARDA exists to refuse, and it slipped my first
review because the fixture only tested true-auth decorators, never a decoy. Lesson folded into the
fixture (an `@Author` decoy now lives beside `@AuthWorkspace`).

**Remaining depth queue (unchanged + corrected).** Task 1 depth (verified param/policy guards where a
body denies), Task 2 depth (DI/method-call taint with a seed-aware bundle key; full ADR-061 origin
merge), Task 3 depth (directus/parse-server registry loop; Strapi `strapi.service` vocab).

---

## "On peut pas faire mieux que des regex?" — behavioral param-decorator resolution (ADR-067)

**Trigger.** Zak, after E-060, questioned the regex approach itself. Correct instinct: the
param-decorator path was name-guessing, and my E-060 fix (a lookahead) was just a less-wrong regex —
against SPARDA's own "behaviour, not names" thesis.

**Distinction drawn.** Two regex families: STRUCTURAL (HTTP verbs, file conventions — closed
vocabularies, correct as-is) vs NAME-SEMANTIC (guessing meaning from an identifier — the weak spot,
where E-060 lived). Only the second is worth replacing.

**Change (`nestjs.js`).** For a custom param decorator, resolve its `createParamDecorator(fn)`
definition (same-file or through its import) and read what request field the body returns:
- body visible → BEHAVIOUR is final: injects the principal iff it reads a PRINCIPAL_FIELD
  (`.user`/`.workspace`/…) whose object chain does not pass through a user-input field
  (`req.body.user` is caller-controlled). `@Author`→`body.author`→not a guard; `@AuthWorkspace`→
  `.workspace`→guard. The name is irrelevant when the body is seen.
- body opaque (library import) → tokenized-name fallback (`splitIdent` → whole tokens, `Author`→
  [author]≠auth), honestly labelled a guess.

**Two-directional gain (verified).** Soundness: `@Author` decoy (reads user input) now rejected at the
root — the whole class, not two hard-coded names. Recall: `@Whoami` (no auth token in its name, body
reads `request.user`) now correctly a guard — impossible for any name-match. Both locked as tests.

**Honesty rail.** Reading the principal proves the route CONSUMES auth, not that it DENIES — still an
ASSERTED guard (ADR-063), never verified alone. Full gate: **770 ✓**, 25/25 mutants, lint/format
clean, 4 deps.

**Generalization noted (not done).** `splitIdent` + behaviour-over-name is the template for the other
name-semantic regexes (`GUARD_NAME`, `WRITE_VERB`, `OWNERSHIP_KEY`) — a follow-on consistency pass.

---

## Tri-AI research → first gem shipped: effect-bias inversion (ADR-068)

**Trigger.** Zak brought back three IA answers to the "faire mieux que des regex" brief and asked me
to study them with the same honesty filter I use on my own code (solves vs displaces vs hides).

**Verdict on the three.** They CONVERGED on abstract interpretation + effect systems + provenance —
which is what SPARDA already is (validation, not pivot). ~80% confirmation; the real new value was
~3 things: (a) a LIVE hole, (b) the type-lock/quarantine architecture, (c) generalized introduction
rules (my ADR-067 is a special case). Vernis rejected honestly: subgraph isomorphism (NP-complete,
self-admitted "displaces"), bayesian priors (no data to calibrate — premature), distributional
semantics (correlation not proof), aktionsart verb classes (lexical matching in disguise).

**The gem shipped first — the live hole.** Probe: `db.nukeEverything(req.body.confirm)` on a proven
knex handle → 0 effects, 0 findings. An unguarded custom write was invisible. The insight (only one
of the three saw it): for effects the safe bias INVERTS — unknown method on a proven persistence
handle → treat as write. Implemented as ADR-068: `collectDbHandles` (provenance, mirrors
`collectEffectClients`), an `opaque` `db_write` with a null table, counted toward O1 only. Additive,
provenance-gated, flood-tested. Suite 775, 27/27 mutants.

**Bugs hit while implementing.** (1) The opaque effect emitted but O1 didn't fire — O1 counts
mutations via effect→state edges, and a null-table write has none; fixed by counting opaque writes
with a null stateId directly in apocalypse (O2/O3/O5 skip null-state naturally). (2) The `opaque`
marker was stripped by `attachBody`'s meta whitelist in translate.js; added it. (3) `fmtStates`
crashed on a null stateId; guarded it. (4) A mutant find-string went stale (prettier wrapped the line
when ADR-067 added `, mod`); fixed to a single-line substring.

**Honest scope.** V1 = same-module handle. The shared-`import { db } from './db'` pattern (the common
real shape) is V2 — cross-module handle resolution, cycle-safe in the resolver (doing it inside
`collectDbHandles`, which runs during `parseModule`, risks import-cycle recursion).

**Next from the research (not yet built).** The type-lock on the verdict (honesty by construction —
a heuristic path structurally cannot emit PROVEN or suppress a finding; would make E-060 impossible);
BOLA via the FK graph (prove ownership from the schema, quarantine `OWNERSHIP_KEY`); cross-module
handle resolution (ADR-068 V2).

---

## The type-lock, step 1 — auth-library deny catalog (ADR-069)

**Trigger.** Toward the type-lock (honesty by construction), the audit found the real hole: guard
provenance is cosmetic (`"does not change the verdict"`). Probe: an opaque-middleware-guarded
mutation reads PROVEN with guardsVerified=0. Discussed the strategic fork with Zak (strict lock ⇒
most apps PARTIAL because auth is opaque npm middleware). Zak cut through it: **don't lower the bar,
learn to read them** — and noted it's the same catalog mechanism we already use for effects.

**Change.** `AUTH_GUARD_PACKAGES` + `authDenyCall` + `collectAuthGuards` in extract.js (provenance,
mirrors collectDbHandles/collectEffectClients); a deny-form auth-lib middleware earns a synthetic
deny-scan → the guard reads VERIFIED. Wired into express `resolveCallable` (inline
`passport.authenticate(…)` and aliased `const requireAuth = …`). Deny-FORM precision: abstains on
`passport.authenticate(…, cb)` and `expressjwt({credentialsRequired:false})` (they don't auto-deny).

**Verification (Zak asked for it).** On the fixture: `passport.authenticate('jwt',{session:false})`
→ verified=true; aliased `expressjwt({…})` → verified=true; the callback form and
credentialsRequired:false → verified=false (honest abstain). So an app on passport goes from
guardsVerified=0 (would be PARTIAL under the lock) to verified (stays PROVEN legitimately).

**Bug hit (and the lesson).** While probing the mutant by hand I ran a GLOBAL `sed
s/return true;/…/` that corrupted 8 unrelated `return true;` lines in extract.js. Recovered cleanly
via `git checkout HEAD -- src/ubg/extract.js` + re-applying the two edits. Lesson: never global-sed a
common token in a hot file — surgical line-scoped edits only. Also learned the passport `!hasCallback`
precision is redundant (inline callback caught by the wrapped-handler branch; aliased by mod.functions
scanning the callback), so it carries no mutant; the express-jwt `credentialsRequired` precision IS
observable and carries the killing mutant.

**Result.** `tests/auth-catalog.test.js` (5 tests) + fixture `ubg-auth-catalog`. Suite 780, 28/28
mutants, lint/format clean, 4 deps.

**Next (together, per Zak's sequencing).** Flip the STRICT LOCK: an app whose safety rests on an
asserted (unverified) guard reads PARTIAL, not PROVEN — now safe because passport/express-jwt read
verified. Then: NestJS `@nestjs/passport` catalog, cross-module handle/guard resolution.

---

## The type-lock, step 2 — PROVEN requires verified, by construction (ADR-070)

**Decision (Zak: "fais le meilleur et justifie").** Chose to flip the strict lock NOW (framework-
agnostic, the actual honesty fix) rather than expand the catalog first — and to make it PRECISE (only
a mutation protected by asserted-only guards downgrades, not guards on reads).

**Change.** `verdictOf` gains `assertedOnlyMutations(graph)`: counts clean mutation routes where no
gating guard is verified. `partial` fires on it (alongside coverage/blindHigh). Kept in ONE chokepoint
(verdictOf, from the graph) so no caller threads it — the honesty rule is a property of the verdict
function, unroutable-around. CLI (prove.js) names the reason so PARTIAL-at-100%-coverage is legible.

**Verification.** opaque-guard app → PARTIAL (assertedMutations=1, was false PROVEN); passport
deny-form app → PROVEN (verified via ADR-069). Full suite: zero existing fixtures flipped (their
PROVEN rests on in-repo verified guards). `tests/type-lock.test.js` + two fixtures + killing mutant.
Also fixed the E-047 mutant's find-string (my edit re-wrapped the `partial` condition). Suite 783,
29/29 mutants, lint/format clean.

**Why this ordering was best (the justification).** (1) The lock is framework-agnostic — one flip
protects express/nest/strapi/all at once; the catalog is per-framework and endless ("one more lib"
forever). Flipping first means the honesty guarantee is universal NOW; the catalog then RESTORES
PROVEN incrementally on solid ground. (2) One-chokepoint enforcement makes E-060's class structurally
impossible, which was the whole point — a per-caller flag would just be a new convention to forget.
(3) Sequenced after ADR-069 so the green wall didn't collapse: the common opaque guards already read
verified. (4) Precise (mutation-only) avoids false modesty (asserted guard on a read doesn't lie about
the app's write-safety). Net: PROVEN now means proven; PARTIAL is the honest, legible common case; the
catalog is the honest engine that grows PROVEN back.

**Next.** NestJS `@nestjs/passport` + `@UseGuards(AuthGuard('jwt'))` catalog (nest apps PARTIAL→PROVEN);
cross-module handle/guard resolution (ADR-068/069 V2); BOLA via FK graph.

---

## The catalog, NestJS half — @nestjs/passport (ADR-071)

**Trigger.** With the type-lock live (ADR-070), Nest apps on `@UseGuards(AuthGuard('jwt'))` (the
dominant Nest idiom) dropped to PARTIAL. Extend the catalog to restore PROVEN honestly.

**Change.** `nestPassportGuard(name, mod)` in nestjs.js: recognizes inline `AuthGuard('jwt')` (name
imported from @nestjs/passport) and a subclass `extends AuthGuard('jwt')` (resolved same-file or via
import, superclass provenance checked in its own module). Wired into `guardStepScan` after guardScan.
Deny-FORM precision: abstains when the subclass overrides canActivate/handleRequest (may swallow the
deny). Reuses GLOBAL_GUARD_SCAN as the deny-scan. Provenance, never a name test.

**Verification.** inline → verified; plain subclass → verified; handleRequest-override subclass →
asserted (honest). End-to-end: a clean Nest passport app reads PROVEN (guardsVerified 1/1), was
PARTIAL. `tests/nest-passport.test.js` + fixture. Suite 786, 30/30 mutants, lint/format clean.

**State of the catalog.** Two dominant JS auth stacks now covered: express (passport, express-jwt) +
Nest (@nestjs/passport). PROVEN is real (type-lock) AND reachable for real apps (catalog). Remaining:
next-auth / better-auth, FastAPI deps (Depends(get_current_user)), cross-module aliased express
middleware, BOLA via FK graph, ADR-068 V2 (cross-module DB handles).

---

## Breaking THEIR limit in THEIR domain — innate immunity for O4 (ADR-072)

**Trigger.** Zak: the competitors think like coders (narrow); we think universally (which living-world
domain already solved this perfectly?) then port to real code. Target: their core weakness — false
positives (why devs abandon SAST). "Try several, find the best, verify no regression, integrate."

**Measured first (not guessed).** Ran SPARDA on real apps and dissected the HARD findings: ghostfolio
= 0 hard FPs (already precise). immich (281 routes, 100% guards verified) = only 2 hard findings, both
`IRREVERSIBLE_OBSERVABLE` on GENERIC external calls (a search's embedding fetch, an OAuth handshake) —
both wolf-cries, and alone they blocked a fully-guarded app off PROVEN.

**The immune port.** How does the immune system avoid attacking the body? It attacks KNOWN pathogens
(innate PAMP recognition) and TOLERATES the unfamiliar — attacking everything unknown is autoimmunity,
i.e. the false positive itself. Mapped onto O4: a KNOWN-dangerous observable (`sdk:` PAMP catalog —
payment/mail you cannot undo) → HARD; a GENERIC `dynamic` call (unknown fetch, usually a read) →
ADVISORY (surfaced, not cried-wolf). The metaphor mapped exactly onto our EXISTING SDK catalog — no
new machinery.

**Validated (Zak's checklist).** (a) doesn't break us: full suite 789 pass, no regression. (b) sound
— hides no hole: `stripe.charges.create`+write with no compensation STILL hard-flags (soundness test);
the generic call is downgraded, not silenced (advisory, still visible). (c) breaks their limit: kills
the FP that no analyst-minded tool can kill without losing soundness. (d) real gain: immich
NOT_PROVEN → PROVEN — a real 281-route app goes green, honestly. One invariant refined (advisory
findings exempt from polarity⇄findings, like BOLA).

**Integrated.** `tests/immune-observable.test.js` (known→hard, generic→advisory, never silenced) +
fixture `ubg-immune-observable` + a killing mutant (autoimmune → wolf-cry returns). Suite 789, 31/31
mutants, lint/format clean.

**The method as moat.** This is the repeatable engine: for each of their walls, find the domain of the
living world that already crossed it (immune tolerance for false positives; olfaction for effect
recognition; predictive coding for opacity), port it to real tested code. Competitors can copy a
feature, not "think universal first, then real program." Next candidate walls: reachability under
opacity (predictive coding / active inference), and the self/non-self app-convention model for
crediting proven app-wide protections.
