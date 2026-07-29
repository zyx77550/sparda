# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Historical note: entries for 0.6–0.13.2 are tracked in the Obsidian journal
> and `docs/HANDOFF.md`; this file resumes structured entries at 0.13.3.

## [Unreleased]

## [0.71.1]

### Fixed

- **A mutation-testing residue had disabled a soundness check on `main`** (ADR-095, E-108).
  `src/ubg/apocalypse.js` carried `if (false)` where `assertedOnlyMutationRoutes` decides whether
  a route is guarded by trust alone — so `assertedMutations` was always 0, the PARTIAL rung never
  fired, and **a route protected only by an unverified guard read `PROVEN`**. Nobody wrote it:
  the string is byte-for-byte a mutant's replacement text, left behind when the mutation harness
  was killed mid-run and swept into an unrelated commit. The harness now journals the original
  bytes before touching a file and heals from that journal on its next start, and
  `tests/no-mutant-left-behind.test.js` fails the ORDINARY suite if any mutation is sitting in
  the tree — a check that costs milliseconds, where noticing it otherwise costs ten minutes and
  a code review.
- **The release workflow could never have published anything.** `actions/checkout` on a tag push
  produces a DETACHED HEAD, `git rev-parse --abbrev-ref HEAD` answers the literal `HEAD`, and the
  gate refused it as "not on main" — its first run would have died there. A detached HEAD is now
  accepted only when it is byte-identical to `origin/main`, which is the property the branch name
  was ever a proxy for; a detached checkout of any other commit is still refused.
- **An origin the gate could not REACH no longer reads as an un-pushed tag** (ADR-095). Both
  still block — a gate that cannot verify must not certify — but the unreachable case says
  `UNVERIFIED` instead of sending you to look for a tag that is already there.
- `docs/DECISIONS.md` was no longer valid UTF-8: the ADR-094 heading carried a Windows-1252
  em-dash byte and a stray carriage return that ate a letter of its own title.

### Added

- **A GitHub Actions release workflow**, fired by a `v*` tag push and gated on
  `npm run release:check` — which finally puts `vsce publish` behind the same door as
  `npm publish`. The VS Code extension had been shipping with nothing verified but its version
  number, which is how a stub reached the Marketplace at 0.70.0. Secrets are read through `env:`
  rather than interpolated into the shell, and `@vscode/vsce` is version-pinned, here and in
  `npm run publish:vscode`, so the publishing toolchain is not a moving target.
- **The release gate verifies the tag is PUSHED**, not merely present locally (ADR-094, E-107).

## [0.71.0] - 2026-07-28

### Added

- **VS Code: install the engine from the error that reports it missing** (ADR-090). The
  notification carries an **Install sparda-mcp** button; it runs in a visible terminal, with the
  package manager the lockfile names, always as a dev dependency, and the workspace re-proves
  itself when the binary appears. The button is shown only when installing is genuinely the
  remedy — a misconfigured `sparda.command` reports what actually failed instead.
- **VS Code: the status bar is a menu**, built from the current state so the first item is the
  useful one; a native three-step walkthrough; and lightbulbs on findings that EXPLAIN rather
  than claim to fix. The only write-adjacent code action is `enforce`, on unguarded mutations
  only and always a dry run — the one "fix" that re-derives its own result and reverts
  byte-for-byte if the recompiled app does not prove.

### Changed

- The release gate spawns **no shell on any platform** and no longer needs `npm` to be
  resolvable: the "is this version published?" check is an HTTP request to the registry
  (E-103). It also runs `node_modules/vitest/vitest.mjs` through `process.execPath` rather than
  `npx`, which could not start on Windows and resolved a test runner the lockfile does not pin
  (E-101, E-102).

**Read this before upgrading:** `PROVEN` now requires that something actually checked the app's
route table. On Express and FastAPI the oracle is opt-in, so those apps read `PARTIAL` until you
run with `--probe`; convention-routed frameworks (Next, Nest, Medusa, Strapi) are checked for
free and are unaffected. If your verdict got weaker on this upgrade, the app did not change —
what SPARDA is willing to claim without measuring did.

### Fixed

- **`PROVEN` was reachable with a premise nobody had measured** (ADR-091, E-104). An oracle that
  did not run and an oracle that ran and found nothing produced a byte-identical downstream
  state: `available: false` was honest, and `premiseGaps: 0` — the number the verdict read —
  could not tell the two apart. The premise now carries a `basis` (`measured` / `declared` for
  OpenAPI, where the spec IS the route table / `unmeasured`), and `unmeasured` is a PARTIAL rung.
  Never a gate failure: SPARDA does not demand what it could not measure.
- **Four more headlines said "fine" over a measurement that never happened** (ADR-092, E-105):
  `falsify` scored `1` with zero controls, `gate` returned `ok: true` while abstaining, and
  `speculate`/`immunize` printed `✓ PROVEN` from a capsule whose premise nobody checked. In each
  case the honest field was PRESENT and placed BESIDE the headline instead of inside it. The
  headline now carries `null` — not `0`, not `false`, which are answers.
- **And that fix was wired to nothing** (ADR-093, E-106). All four `buildCapsule` call sites
  passed no basis, so the three-state `proven` was unreachable and `immunize` printed an
  `UNMEASURED PREMISE` branch no input could produce — while its test, which constructed the
  state by hand, passed. `immunize` and `genome` now call `premiseFor` at all (`genome` signs
  its verdicts and merges them into a file strangers pull, and names each route it has no
  antibody for); the structural rule that enforces hard rule 11 now recognises `buildCapsule`
  as a grader; and only the POSITIVE claim is withheld — a real NOT-PROVEN needs no premise.
- **Three commands reported a partial measurement as a complete one.** `sparda stitch` recorded
  a service that failed to compile, gates CI on it and marks the join PARTIAL — a half join
  finds no cross-service BOLA and used to print that as "no cross-service calls resolved".
  `sparda heal --check` no longer claims "zero protection lost" when no pre-fix graph was
  frozen, since the guard diff never ran. `sparda timeless replay` no longer reports "every tap
  consumed, zero divergence" for a flight that recorded zero taps — nothing was virtualized, so
  the match says today's environment agreed, not that the code is unchanged.

## [0.70.1] - 2026-07-28

### Fixed

- **The VS Code extension shipped a stub to the Marketplace.** `extensions/vscode/` was
  published as `zyx77550.sparda@0.70.0` carrying one command whose entire body was
  `showInformationMessage('Audit command triggered! (Integration pending)')`. An outside
  reviewer read the manifest, read the source, and correctly called it a placeholder. A
  working extension already existed in `integrations/vscode/` — 135 tested lines, four
  commands, real Problems-panel diagnostics — and the two had drifted into separate
  directories with different publishers, so `npm run publish:vscode` shipped the wrong one.
  The two are now one: the working code lives in `extensions/vscode/` under the published
  identity, and `integrations/vscode/` is gone.
- **A published extension can no longer advertise a command nothing implements.** Nothing
  could have caught the stub — it parsed, the suite was green, and the release gate checks
  the extension's VERSION, not whether it does anything. `tests/vscode-extension.test.js`
  now requires the contributed commands and the registered handlers to be the same set,
  requires the manifest's entry point to exist, and rejects a placeholder body outright.
- **The extension's status bar cannot show a verdict it did not obtain.** A failed, missing
  or cancelled CLI run reads `UNKNOWN` with its reason in the tooltip, never a calm bar and
  never a stale one; a failed `apocalypse` leaves the Problems panel untouched rather than
  clearing it, since wiping it would turn "we could not measure" into a clean bill of health
  in the one place a developer trusts by habit. It also no longer blocks the editor
  (`spawn`, cancellable, single-flight) and never picks up a bare global `sparda` on `PATH`
  — the version that proves the code should be the version the project pinned.

## [0.70.0] - 2026-07-27
Generate-and-check closed as a loop (ADR-075) + the PROVEN-ENFORCED tier (ADR-076), a gate
for the RELEASE rather than the commit (ADR-087), and the barrel fix that made a monorepo's
DI graph visible (ADR-088). No new runtime dependency (still four).

**Read this before upgrading:** the barrel fix changes VERDICTS on monorepos. An app whose
services are injected from a workspace package was analysed without them — measured on a
real one, 1479 of 2039 DI hops resolved to nothing, and it read PARTIAL with 0 findings
while 80 of its 132 database writes were invisible. It now reads NOT_PROVEN with 4. If your
verdict got worse on this upgrade, the app did not change; what SPARDA can see did.

### Added
- **`sparda falsify` — the proof, challenged (Popper as a command).** Ablates every guard from
  the behavior graph in memory (contraction surgery, no recompile) and demands the verifier
  re-derive an UNGUARDED_MUTATION on each route whose green depended on protection. A route
  that does not flip is a HOLE — its verdict does not depend on its guards — and fails the
  command. One extra check pass prices the whole audit: 169 counterfactuals on a 580-route
  app in ~100 ms, offline, deterministic. The mechanical detector of the vacuous-proof class.
- **`sparda enforce` — synthesis under the court (PROVEN-ENFORCED).** A clean mutation route
  resting on a guard SPARDA cannot verify (the type-lock PARTIAL) gets a minimal boundary
  check SPARDA CAN verify, inserted into the route's middleware chain. The edit persists ONLY
  if the recompiled app proves PROVEN (else automatic byte-for-byte rollback), is reversible
  (`--revert`, hash-verified; `sparda remove` reverts too), and is always disclosed: `prove`
  reports **PROVEN (ENFORCED)**, never a silent bare PROVEN. Dry-run by default. Express V1.
- **Interprocedural ownership witness (O7/BOLA).** The commonest DELEGATED ownership idiom —
  `assertOwner(row.ownerId, req.user.id)` with the compare+deny in the helper (same-file or
  imported, bare or whole-object form) — now clears the O7 advisory: identity is bound at the
  call site, the helper body must deny on exactly those bound params. Adversarially tested
  (spoof / no-deny / deny-ignoring-identity all stay flagged); advisory-only, never a guard.
- **`sparda_witness` MCP tool — the generate-and-check loop.** Lists the routes where no
  ownership scope was proven; accepts `{route, file, line}` hints from the calling agent (or
  from the client's own LLM via MCP sampling, hintless) and re-proves every claim
  deterministically against the AST. Fabricated locations, unreachable-but-real checks
  (attribution tether), and path escapes are rejected; admitted discharges carry an auditable
  `generator+verified` provenance. Never changes the verdict.
- **A DI hop into a workspace package now crosses the barrel** (E-097, ADR-088). A monorepo
  package resolves to its entry file, that entry file is `export * from './…'` sixty times
  with no class declaration, and the resolver only looked for classes DECLARED in the module
  it landed on. Measured on a real monorepo: **1479 of 2039 constructor-DI hops resolved to
  nothing** — every repository the app writes through. And an unresolved hop leaves no
  trace, so a route whose behavior lives entirely behind the barrel resolved to zero
  behavior and produced **no finding at all**, at coverage `unknown` rather than `blind`.
  The app read PARTIAL with 0 findings while 80 of its 132 database writes were invisible;
  it now reads NOT_PROVEN with 4. Classes get the barrel walk functions have had since the
  `lib/auth/index.ts` era.
- **A release gate, because a green suite licenses a commit and not a release** (ADR-087,
  E-096). 0.69.0 was published from a commit that was not the head of what was being merged:
  for four hours the package on npm analysed a NestJS app at a quarter of its size, while
  every test passed at the commit that shipped. `prepublishOnly` now runs
  `scripts/release-gate.mjs` — tree clean, on `main`, HEAD identical to `origin/main`,
  version absent from the registry, `server.json` (twice) and `glama.json` agreeing with
  `package.json`, a CHANGELOG heading for the version, a `v<version>` tag pointing at HEAD,
  then suite, mutants and corpus. Runnable on demand as `npm run release:check`. No escape
  hatch: it reads no `process.argv` and one environment variable that can only add a check.
  What it cannot measure it names — `SKIPPED` for the corpus without clones, `UNVERIFIED`
  for an unreachable registry — never a tick.

## [0.69.1] - 2026-07-27

Corrections shipped ahead of the next milestone: what 0.69.0 put in front of users was
less honest than what the repository knew. No new runtime dependency (still four).

### Fixed

- **A NestJS app with house decorator brands was analysed at a quarter of its size**
  (E-092, ADR-085). The file pre-filter matched a fixed decorator VOCABULARY, so a class
  registered as `@MetadataResolver` / `@CoreResolver` / `@AdminResolver` — the norm in a
  real codebase, not the exception — was never opened. And a file that is never opened
  produces no route, no skipped entry and no unknown handler: the report showed a route
  count and a coverage percentage computed over a fraction of the app, **with no signal
  that anything was missing**. Brands are now matched by SUFFIX, exactly as controllers
  already were. Measured on a 6090-file monorepo: 33 → 128 files parsed, 147 → 579 routes,
  in 4.0 s.
- **`@Post(['a', 'b'])` registered no route at its declared paths** (E-093, ADR-085).
  Nest serves every element of the array; the reader saw an `ArrayExpression`, judged it
  "not a literal" and fell back to the controller prefix, collapsing whole webhook
  controllers onto a phantom `POST /` — findings were reported against a URL the app does
  not serve. Now one route per element; an element that cannot be read is declared at high
  risk while its readable siblings still route.
- **One missing compensation path was reported once per effect node** (E-094, ADR-086). A
  send resolved through a provider-strategy DI graph produced a finding per leaf: on a
  real app, one route accounted for twelve of twenty-eight high findings. A finding is now
  emitted per (route, rule) — the unit of a finding is the unit of its remediation. The
  set of flagged routes, their severity and the CI gate are unchanged; every call is named
  in the message and every node kept in the evidence.

### Changed

- `SOUNDNESS.md` gains discipline item 3c. "Fewer findings" is two different things, told
  apart by the flagged SET and never by the count: a route that stops being flagged is a
  false negative whatever the justification; duplicates of one problem on one route
  collapsing is not. The proof obligation is written down.

## [0.69.0] - 2026-07-27

The premise verifier reaches every gate, and the registration invariant reaches every
framework. No new runtime dependency (still four).

### Added

- **The premise check runs on every command that emits a verdict** (ADR-083). It had
  shipped wired into `prove` alone, which is worse than not shipping it: `apocalypse` —
  the CI gate — could still exit 0, and `badge` could still publish a green artifact, over
  an app whose route table nobody had checked.
- **A boot-free premise oracle** (ADR-082) for the frameworks that cannot be booted from a
  static checkout. It derives the route table from what those frameworks actually route on
  — the filesystem for Next and Medusa, the literal route tables for Strapi, the decorators
  for Nest — so the premise is now checkable on six lowerings out of seven. Because it
  executes nothing, it runs unasked.
- **The registration invariant on all seven lowerings** (ADR-079 extended), with a sealing
  certificate per lowering: each re-enumerates the declared surface with an independent
  second implementation and demands the extractor account for every item.
- **Composite decorator resolution** (ADR-084). `applyDecorators(UseGuards(X))` — NestJS's
  official composition API — resolved to a FUNCTION, and guard proof only opened CLASSES,
  so a guard that provably returns 401 was trusted by name instead of proven. On a real
  app: 71 → 411 guards proven.

### Fixed

- A premise gap rendered as `0 findings` on the public badge (E-084).
- `sparda review` graded the graph and never read the report, so the pull-request gate saw
  no skipped surface at all — a PR that made a whole file unparseable reviewed exactly like
  one that changed nothing (E-085).
- A `SetMetadata` tag counted as protection it never provided — except where a global guard
  proven to deny reads it, which is the dominant NestJS idiom (E-090).

## [0.68.0] - 2026-07-23
Trust-layer hardening — PROVEN must mean proven. Teach SPARDA the auth idioms real apps
write, lock honesty so a proof can never rest on a name, then take the first real step past
the wall every static tool hits. No new runtime dependency (still four, exact-pinned).

### Added
- **Behavioral custom param decorators (ADR-063/067).** A principal-injection decorator is
  resolved by what it READS, not its name: `@AuthWorkspace` reads the principal → a guard;
  `@Author` reads user input → **not** a guard. Kills the name-guessing that E-060 lived in.
- **Auth-library deny catalogs (ADR-069/071).** Express `passport` / `express-jwt` and NestJS
  `@nestjs/passport` `AuthGuard` read as **verified** (a published fact), with deny-form
  precision — a subclass overriding `handleRequest` stays asserted (honest abstain, no false
  PROVEN). Covers the two dominant JS auth stacks.
- **Named HTTP status constant as a deny signal (ADR-073).** `StatusCodes.FORBIDDEN` /
  `HttpStatus.FORBIDDEN` is recognized exactly like the numeric `403` — unblocking the
  commonest professional deny idiom (ghostfolio's 91 permission guards, most Nest apps).
- **Strapi extraction (ADR-065).** Partial evaluation of the declarative route table
  (`createCoreRouter` unrolled to its CRUD table); an app that read 0 routes now reads its real
  surface.
- **Value-flow taint (ADR-064/066).** Follows request data through destructuring/aliases and
  across the bare helper-call boundary → proof-grade O2 (`UNVALIDATED_CONSTRAINED_WRITE`).
- **Opaque write on a proven DB handle (ADR-068).** An unknown method on a handle imported from
  `knex`/`pg`/`@prisma/client`/`mongoose`/`typeorm` is treated as a write — a missed write is a
  hidden hole, so the effect bias inverts. Same-module handle (V1).
- **Deterministic ownership-witness verifier for O7/BOLA (ADR-074).** Recognizes the commonest
  hand-rolled ownership check — fetch-then-compare (`if (row.ownerId !== req.user.id) deny`) —
  and clears the false-positive advisory. Sound both ways, adversarially tested: a compare vs
  `req.body` (spoofable) or a compare that only logs is rejected. The deterministic checker half
  of a generate-and-check loop (finding a proof is undecidable, checking one is cheap).

### Changed
- **The honesty type-lock (ADR-070).** PROVEN now requires *verified* protection, enforced in a
  single chokepoint (`verdictOf`) so no signal can route around it. A mutation behind an
  asserted-only guard reads **PROVEN (PARTIAL)** with the honest reason, never a false PROVEN.
  Shipped after the catalogs, so real passport/Nest apps stay PROVEN — only genuinely-unprovable
  protection drops.
- **Innate immunity for O4 (ADR-072).** A known-dangerous observable (payment/mail from the SDK
  catalog) hard-flags; a generic external call becomes a tolerated advisory. Kills the
  false-positive wolf-cry without silencing a real irreversible effect (`stripe.charges.create`
  + write stays hard).

### Fixed
- **Self-audit (E-060).** `@Author` / `@Authorization` no longer falsely assert a guard — a
  soundness-direction-2 hole (it could hide a real UNGUARDED mutation), found by turning the
  audit on this session's own work.

## [0.67.0] - 2026-07-22
### Fixed
- **Critical packaging bug — the published package did not run (E-059).** `@babel/parser`,
  `@babel/traverse` and `@clack/prompts` are imported by `src/` at runtime but were declared as
  **devDependencies**, which npm does not install for a consumer. On a clean `npm i sparda-mcp`
  every flagship command crashed — `sparda ubg|prove|apocalypse|review|gate` with `Cannot find
  package '@babel/parser'`, `sparda init|demo|remove` with `@clack/prompts`. Only `--version`/help
  worked. Moved the three to `dependencies`, exact-pinned (runtime surface is now exactly the four
  advertised deps). The prepublish gate (`vitest run`) never caught it because tests run with
  devDependencies present; a new `tests/packaging.test.js` parses `src/` and fails if any runtime
  import is not a declared dependency (verified against a fresh tarball install).

### Added
- **Effect-extraction coverage (audit-driven, ADR-061).** Vendor-SDK effects that wear no
  `fetch`/http-client skin are now resolved: a PAMP path catalog (`stripe.charges.create`, AWS SDK
  v3 `client.send(new PutObjectCommand())`, Resend `emails.send`) plus **import provenance** — a
  binding imported from an effect package (or built from one) is recognized as an external effect
  by origin, catching the bare `.send()` tail (SendGrid, Kafka). Read-shaped methods stay
  non-observable GET, so a `.retrieve` never becomes a false irreversible finding.
- **TypeORM write resolution** via repository provenance: `this.repo.save()` (NestJS
  `@InjectRepository`) and `getRepository(User).save()` resolve to `db_write`s on the entity table;
  a NestJS+TypeORM app that read SURFACE now proves its mutations.
- **Prisma FK harvest** now handles named + multiline `@relation` (domains no longer collapse on
  real schemas); **interactive `$transaction(async (tx) => …)`** writes are resolved (client
  provenance); **cross-package monorepo** effects resolve (direct `module.exports.f = …` exports +
  inline handlers are deep-scanned).

### Changed
- O2 (`UNVALIDATED_CONSTRAINED_WRITE`) no longer fires on a DELETE (a delete cannot violate a value
  constraint). `corpus-oracle` now shares the CLI's `verdictState` (incl. PARTIAL) so oracle and
  `sparda apocalypse` can never disagree on the verdict word. No new runtime dependency.

## [0.66.0] - 2026-07-19
### Added
- **`sparda gate` — the agent edit-loop gate.** Proves THIS edit lost no guard, dropped no route,
  grew no blast radius — **delta-only** vs an armed baseline, so pre-existing state never blocks an
  edit (that noise would kill adoption; the false-positive kill below is its prerequisite). Reuses
  `diffGraphs` + `checkGraph` (the same composition `review` proved), so no new engine surface.
  `--arm` freezes the current graph as the accepted baseline; `--hook` is the Claude Code
  PostToolUse contract — silent when clean, reports on stderr and exits 2 (blocking feedback to the
  agent) on regression, and arms itself on first run (zero config). Verified end-to-end: on real dub
  (580 routes), replacing the `POST /api/links` auth wrapper with an identity fn is caught as
  `GUARD_REMOVED [critical]` in ~1.2 s — deterministic, offline, no key
  (`bench/guard-removal-replay.mjs`, self-verifying).

> 0.65.0 was prepared but never published to npm; its delta is folded into 0.66.0 below.

### Changed
- **False-positive reduction from a field test on two giants (dub, n8n), advisory-safe by
  construction — no hard rule touched, zero corpus drift.**
  - **G1 — call-site ownership assertion clears a false BOLA.** A route that proves ownership at
    the call site (`getCustomerOrThrow({ workspaceId: workspace.id, id })` — visible without
    resolving the imported helper) no longer raises `OBJECT_SCOPE_UNPROVEN`. dub: 60 → 39 false
    advisories. Soundness guard: a request-controlled value (`req.body.workspaceId`) is not the
    verified identity, so a real BOLA is never masked.
  - **G2 — credential-gated mutations downgrade to advisory (guard taxonomy B–D/F).** A
    public-by-design route whose body checks a credential and can refuse — a stored reset/invite
    token lookup that throws, a `verify`/signature call that 4xx's, an OAuth callback that
    redirects away — is not "unguarded" in the critical sense. `UNGUARDED_MUTATION` downgrades to
    an advisory naming the mechanism; it never proves a guard and never silences (a token READ
    with no refusal stays critical). dub: 5 false criticals → 1 (the honest survivor).
  - **G2 phase 2 — first-run + API-key families, through the call graph (E-049).** The two families
    whose refusal lives ONE CALL AWAY from the entrypoint — a Nest `this.service.x()` throw, an
    imported API-key validator, a `notAuthenticatedResponse()` helper — are now reached. Three
    signal drops fixed (`mergeScan` dropped `credentialSignals`; `attachBody` didn't tag reached
    bodies; `mergeNodes` dropped them on merge) + a named-refusal detector + a first-run family
    bounded to bootstrap PATHS that still requires a real refusal. All advisory-only. Field test
    (13 apps): immich 5→1 critical, formbricks 1→0, total 9→4; every downgrade verified genuinely
    gated.
  - **Class 1 — public-by-design re-label (`expectedPublic`, E-050).** A route whose PATH is a
    curated public signature (login/register/logout, forgot/reset-password, verify-email,
    oauth/sso/saml, callback/webhook, health/metrics/.well-known) is re-labeled critical → info
    "confirm intent". Triage by CONVENTION, marked distinctly from the evidence-based credential
    families; never hidden, never marked safe, never touches PROVEN. Deliberately precise (not a
    `/auth/**` blanket — `change-password` stays critical). Corpus: exactly one route re-labeled
    (immich `/auth/login`).
### Added
- **Proof objects — a re-verifiable discharge trace (`apocalypse --proof`).** Writes
  `.sparda/apocalypse.proof.json`: for every mutating route that passes its guard obligation, the
  exact `deny_path` (a real chain of node ids in the committed `ubg.json`), the provenance
  (`verified` vs `asserted`), the corroborating paths, and a `graph_hash` — so a third party can
  audit the proof WITHOUT re-compiling. Deterministic (same graph → byte-identical object) and
  emitted only for genuinely discharged obligations (a guardless mutation is a finding, never a
  proof). Turns "trust me, it's PROVEN" into "here is the path — trace it".

## [0.64.0] - 2026-07-18
### Added
- **Workspace-package resolution — the mycorrhizal network (E-048).** A monorepo app's real
  behavior lives in shared workspace packages it imports BY NAME (`@calcom/*`), not by path —
  outside the analyzed app dir. The resolver now walks up to the monorepo root (`package.json`
  `workspaces` / `pnpm-workspace.yaml`), builds a name→dir map (cached per root), and resolves
  `@scope/pkg[/subpath]` into the real source (a bare npm package still resolves to nothing). One
  mechanism closes **two** blind spots: **(effects)** cal.com/apps/api/v2's controller →
  `this.svc.updateEventType()` → `@calcom/platform-libraries` → `@calcom/trpc` → `prisma.update()`
  now resolves — coverage **71% → 87%**, and it surfaces a real previously-invisible unguarded
  mutation (`POST /verification/email/send-code`, no `@UseGuards`); **(state)** an app that
  declares no schema of its own but depends on a shared `@scope/prisma` package now parses that
  schema as its state layer — cal.com/apps/web **0 → 100 tables**, coverage **87% → 95%**, the
  schema-dependent rules (non-atomic aggregate, unvalidated constrained write) become measurable.
### Changed
- **The verdict now qualifies a bare PROVEN against high-risk blind spots (E-047).** Coverage is a
  ratio; on a giant it can clear the 60% completeness bar while the absolute count of high-risk
  blind spots is large (cal.com/api/v2: 71%, yet 46 guarded mutations whose writes never resolved).
  A clean app is now `PROVEN (PARTIAL)` when `coverage < 0.6` **or** any high blind spot remains,
  fed uniformly to every surface (prove, apocalypse, badge, dossier, review, the `sparda_prove`
  MCP tool, the bench) from the same `surveyBlindspots` — one source of truth. Sound: only ever
  softens PROVEN→PARTIAL, never masks a finding, never changes the CI gate.

## [0.63.0] - 2026-07-17
### Added
- **`sparda_prove` — the proof layer, served live over MCP.** An editing agent compiles + discharges
  the same static obligations as `sparda apocalypse` the moment it writes, and — when a baseline
  exists (`apocalypse --save-baseline`) — gets `regression: true` on any finding whose edit removed
  a guard, dropped a route, or grew the blast radius. Reuses `verdictState` verbatim (never
  over-claims), read-only, off the host request path. Plus a built-in `prove-my-edit` MCP prompt so
  agents that list prompts are told to prove their edit. (Discoverability in SKILL.md/README.)

## [0.62.0] - 2026-07-17
### Added
- **`sparda stitch` — cross-repo / cross-service proof (the moat; quorum sensing).** Point it at
  two or more service directories; it compiles each, joins one service's outbound HTTP calls to
  another's routes (suffix-matched so a base-URL prefix still resolves), and rides an advisory
  across the boundary — e.g. a **cross-service BOLA**: service A forwards a request id to service
  B's id-scoped endpoint, and the object-level authorization across the A→B boundary is unproven.
  A finding class **no mono-repo tool (CodeQL/Semgrep/Snyk) can produce**, because SPARDA already
  emits the artifact it needs — a committed `ubg.json` per repo, read together with no central
  infra. Cross-service findings are ADVISORY (a structural join, never runtime intent across the
  boundary). `src/ubg/stitch.js` (pure) + the command; tested + mutation-guarded.

## [0.61.0] - 2026-07-17
### Changed
- **Lateral inhibition: a rule that floods is collapsed to one summary (ADR-060).** A rule firing
  on a large fraction of routes (≥15% AND ≥10 routes) is a codebase-wide *pattern*, not N
  independent findings — 97 identical lines bury the rare, sharp signals. `collapseFloods` folds
  such a rule into ONE summary at its max severity, with every route in evidence. SOUND +
  verdict-neutral: a hard flood stays hard and still gates (nothing hidden — a suppressed danger
  would be a false PROVEN); we only stop it flooding the report. directus:
  `IRREVERSIBLE_OBSERVABLE` 97 lines → 1; dub: `AGGREGATE_MEMBER_BYPASS` 174 → 1 (advisories
  234 → 61), hard findings and verdict unchanged. Measured threshold; test + mutation-guarded.
  The retina's trick — suppress uniform signal, keep the edges — reproduced.

## [0.60.0] - 2026-07-17
### Fixed
- **Prisma split-schema folder now parsed — modern apps' state layer was invisible (E-046).**
  Apps using Prisma's `prismaSchemaFolder` layout (a `prisma/schema/` directory of many
  `*.prisma` files, no single `schema.prisma`) had **0 tables** parsed — the whole state layer
  (invariants, aggregates, ownership) was blind. `collectSchemaFiles` now scans the folder,
  gathering enums/models across all files then parsing per-file with correct locs. dub: **0 →
  82 tables**. The sound direction: dub's real posture became visible (hard findings 9 → 96:
  newly-seen unvalidated-constrained + non-atomic-aggregate writes), verdict unchanged.
### Added
- **BOLA advisory now names the missing scope (BolaRay CCS 2024, step 1).** `OBJECT_SCOPE_UNPROVEN`
  infers each accessed table's ownership model from its declared columns/FKs — `direct-owner`,
  `group-scoped`, `transitive` — and says it: *"commission should be direct-owner (userid) —
  verify object-level authorization"*. 50/60 of dub's advisories now carry a model. Still
  advisory (the schema reveals the model, never the runtime intent — the semantic gap OWASP/
  BolaRay name as why static analysis can't PROVE access control).
### Changed
- **`AGGREGATE_MEMBER_BYPASS` is now advisory (non-gating).** A direct member-table write is a
  design-smell, not a proven violation; on a schema-rich app it fires in bulk (dub: 174). It now
  points a human at the pattern without flooding the verdict — like BOLA.

## [0.59.0] - 2026-07-17
### Fixed
- **Restored the "4 exact-pinned runtime dependencies" invariant.** An unused, caret-ranged
  (and npm-`invalid`) `js-tokens` had crept into root `dependencies`, making it 5 deps and
  contradicting the README / CLAUDE.md rule 8 / the badge. It isn't imported anywhere in `src`
  (transitive-only via babel/vitest); removed it. Back to 4, exact-pinned.
### Added
- **`sparda <command> --help` (and `-h`).** Previously `--help` was ignored and the command
  just ran. Now every command prints its usage (flags, one-liner) and exits — with a graceful
  fallback for commands without a detailed entry.
- **CI gate: README claims match the bench evidence (`npm run bench:check`).** Fails the lint
  job if a README route count ever drifts from `bench/route-proof.json` (the committed,
  reproducible measurement) — no clone, no network. A heroic number can't silently rot.
### Docs
- **`docs/COMPETITION.md`: the honest SAST answer** (Semgrep / CodeQL / Snyk) — the category
  difference, where SPARDA wins (setup, determinism, soundness, honesty ledger, one-graph reuse)
  and where they win (breadth, mature taint, brand), plus the naming/SEO note (bare "sparda" is a
  Devil-May-Cry SEO dead-end — target long-tail intent). HQ-private (moat).
- **`docs/TRUST-LOG.md` (public-facing): SPARDA publishes its own proof-soundness incidents** —
  the low-coverage PROVEN, the transitive guard-fabrication, and the injection-filter bypass,
  each with the fix. The differentiator no marketing can fake: we show what broke in our own
  "never fake a proof" promise.

## [0.58.0] - 2026-07-17
### Added
- **`--dir` / `--cwd` flag — point SPARDA at a sub-directory without `cd`.** Every command now
  accepts `--dir <path>` (alias `--cwd`), resolved against the working directory, so a monorepo
  app (`prove --dir apps/web`) or an in-place reproduction works from the repo root. Previously
  `opts.cwd` was hard-wired to `process.cwd()` and the flag was silently ignored — the gap a
  world-class audit flagged (it couldn't reproduce a route count without it). Complements the
  `suggestAppDirs` monorepo hint (v0.52).

## [0.57.0] - 2026-07-17
### Security
- **Prompt-injection filter no longer bypassed by homoglyphs or zero-width splitters (E-045).**
  A world-class audit defeated `sanitizeDescription` in two lines: `"Ignоre all previous
  instructions"` (Cyrillic о) and an `"ignore<zwsp>previous"` zero-width split both passed as
  `flagged:false`. Fix: the denylist now runs on a normalized probe — NFKC + a curated
  Cyrillic/Greek→Latin homoglyph fold (no new dependency) + invisible-splitter neutralization
  (stripped AND space-substituted, to catch intra- and inter-word splits). Stored text keeps its
  original letters. Regression: 6 evasion cases must flag, 3 legit non-English descriptions must
  not over-block.

## [0.56.0] - 2026-07-17
### Docs
- **README rewritten for discovery (URGENT-ADOPTION J7).** Leads with "AI writes. SPARDA
  proves." and the trust-layer pitch instead of "the LLVM of web applications"; adds a badge
  row (npm, CI, node, pinned-deps, license) and a **60-second proof** block (`apocalypse` /
  `prove` / `badge`) up top. The prover is framed as the product; the MCP server as an optional
  runtime output. Claims are reproducible only (the stale, non-reproducible "3700 proved routes"
  is gone); the honesty line (PROVEN vs PARTIAL, compile vs prove) is front and center.
### Changed
- **`sparda dossier` is now a shareable, honest public report (URGENT-ADOPTION J3-4 #5).** The
  HTML report's verdict comes from the shared `verdictState`, so it shows `PROVEN (PARTIAL)`
  with the "UNPROVEN, not safe" caveat instead of a bare PROVEN on a low-coverage app — the
  public artifact can no longer over-claim. Added a screenshot-friendly coverage score chip in
  the hero, and the CLI now prints the verdict + coverage and frames the page as a shareable
  one-pager (verdict + risks + SPARDA's own blind spots = the honesty-as-trust showcase).

## [0.55.0] - 2026-07-17
### Changed
- **Every README number is now reproducible (URGENT-ADOPTION J1 #3).** `bench/repro.mjs` clones
  the exact repos the README names (Dub, Immich, Medusa), compiles each, and prints routes /
  verdict / time / crash count — with a route floor per repo so it doubles as a CI regression
  gate. Committed evidence in `bench/route-proof.json` (1,337 routes, 0 crashes, slowest 2.05s).
  `bench/README.md` maps each claim → its repro command.
- **The README's headline stopped over-claiming.** The stale "compiled and **proved** 3700+
  routes" (v0.26.0, not reproducible for the named repos) is replaced with the honest,
  script-backed number: SPARDA *compiles* Dub 579 / Immich 281 / Medusa 477 routes, zero
  crashes, ≈1–2s each — and *compiling* a route is explicitly distinguished from *proving* it
  safe (most real apps are NOT_PROVEN, the true state).

## [0.54.0] - 2026-07-17
### Added
- **GitHub Action `prove` mode + `prove --markdown` — the PR discovery surface (URGENT-ADOPTION
  J5).** Every PR gets a sticky comment with the trust verdict, the inline badge, coverage, and
  the top findings — the whole team sees SPARDA's proof for free (the growth loop the audit's
  new north-star, GitHub views/uniques, needs most). `prove --markdown` emits the comment body;
  the action's new `mode: prove` runs it through the existing sticky-comment poster. The badge
  in the comment comes from the shared `badgeFor` (also exported from apocalypse.js and now used
  by `badge` too), so the PR comment, the committed SVG, and the CLI can never disagree — and
  the PARTIAL rung means the comment can't over-claim either.

## [0.53.0] - 2026-07-17
### Added
- **`sparda badge` — the shareable artifact (URGENT-ADOPTION J3-4).** The move that converts a
  download into a star (Codecov/Lighthouse): a self-contained SVG badge (no external fetch —
  the zero-infra ethos) + a paste-ready README snippet, plus a shields.io endpoint alternative
  and `--json` for CI. The verdict word and colour come from the SAME source as `prove`
  (new `verdictState`, exported from apocalypse.js and now the single source of truth `prove`
  itself uses), so the public badge can NEVER over-claim: a 23%-resolved app renders a yellow
  `partial · 23%`, never a false green. Colour tracks the verdict exactly (green=proven,
  yellow=partial, orange=risky, red=findings, grey=surface/no-routes).

## [0.52.0] - 2026-07-17
### Added
- **Never a silent "0 routes" — actionable monorepo diagnostic (URGENT-ADOPTION J1 #2).** When
  detection finds no framework, or a compile resolves 0 routes, SPARDA now scans the
  conventional monorepo containers (`apps/`, `packages/`, `services/`, …) for sub-dirs that
  look like an analyzable app and points the user straight at them (`cd apps/web && sparda
  prove   # looks like Next.js`). Wired into `prove`, `ubg`, and the no-framework error. The
  scan is cheap (package.json deps + structural signatures, no entry-file tree walk) and never
  fires on a plain single app. The no-framework message also stopped under-claiming: it now
  lists Express, Next.js, NestJS, Medusa, FastAPI. `suggestAppDirs` exported from detect.js.

## [0.51.0] - 2026-07-17
### Fixed
- **Medusa detection is now structural, not dep-gated (E-043).** A Medusa app is detected by
  its file-based routing signature — a `src/api`/`api` tree of `route.ts` files exporting
  HTTP-verb handlers — with no `@medusajs` dep required, checked before the express block.
  The framework's own packages list `@medusajs/framework` in devDeps and carry `express`
  transitively, so the old dep+order logic mis-detected `packages/medusa` as a 1-route express
  app. It now reads **477 routes**, making the corpus/stress-test claim reproducible out-of-
  the-box for a skeptic cloning the framework repo. Regression: `ubg-medusa-nodep` fixture.
### Changed
- **Honest verdict packaging: PROVEN-COMPLETE vs PROVEN (PARTIAL) (E-044).** `verdictOf` now
  returns `partial`/`complete` (split at a 60% coverage bar) alongside `clean`, and `prove`
  renders `◑ PROVEN (PARTIAL)` with an explicit caveat when a clean app resolved only part of
  its surface (cal.com at 23%). A label refinement only — it never masks a finding, never
  changes the CI gate (`safe`); high-coverage proofs (medusa/nocodb/open-webui) stay PROVEN.

## [0.50.0] - 2026-07-15
### Added
- **Bare-call following — the resolver now follows `helper()` calls, not just `x.method()`.**
  A helper called bare (`getCustomerOrThrow({ workspaceId })`, `persistThing(dto)`) held
  effects and object-scoping the resolver never saw, capping coverage, BOLA precision, and
  taint. It now resolves bare calls (local `mod.functions` or imported, through barrel
  re-exports), scanned + recursed, memoised + depth-bounded. Real gains: **twenty coverage
  48 → 70 %**, cal.com 0 → 8 writes (proven-guarded, a stronger PROVEN), immich reads +42,
  nocodb +19 writes — with **zero verdict flips and zero new findings**.
  - **Sound by construction (two soundness mechanisms it had to respect):** a bare helper
    contributes its **effects only, never a guard** — it is not registered as a guard node
    (E-042: its name can't fabricate a gate) AND its deny signal is stripped before merge (a
    `throw 403` reached TRANSITIVELY through a bare call does not gate the caller — that
    fabricated `assertIntegrationEnvironmentScope` gating novu's public register → a false
    PROVEN, caught by the oracle and fixed here). A route's gate is a chain step or a
    directly-resolved verifier, never any denying function in its transitive closure. Effects
    merge; guards do not. immich's public admin-sign-up stays flagged; novu stays NOT_PROVEN.

## [0.49.0] - 2026-07-15
### Fixed
- **A called helper's guard-ish NAME no longer fabricates a guard (E-042).** translate
  classified any reachable helper as a guard if its NAME matched `GUARD_NAME` — so a called
  mapper/predicate like `mapUserAdmin` / `isAdminUser` (matched via "admin") could fabricate
  a gate and hide a real `UNGUARDED_MUTATION`, the one unforgivable error (SOUNDNESS
  Direction 2). Now a CALLED helper (role `function`) is a guard ONLY by a proven deny
  (`deniesWithStatus`), never by name; name-trust stays for explicit chain steps (a
  middleware you SEE gate the route). dub guards 514 → 513 (one fabricated helper-guard
  corrected), zero finding/verdict change; oracle re-baselined. The corpus oracle is the
  regression guard (a minimal repro proved impractical — the fabrication needs real-code
  reachability). This is the prerequisite that unblocks bare-call following (BOLA/taint
  precision) — following bare helpers is safe now that their names can't fabricate guards.

## [0.48.0] - 2026-07-15
### Added
- **BOLA / IDOR advisory — the first object-level-authorization signal (ADR-058 B, OWASP
  API #1).** `OBJECT_SCOPE_UNPROVEN`: a route accesses an object by a request-supplied id
  (`idScoped`) but NO query on its **resolved** path is scoped to the caller (`ownerScoped`
  — an ownership key or a session value), under a guard, not an admin/system route. This is
  the one bug class that survives on authenticated apps (the surviving-findings audit found
  the unguarded-mutation lens is otherwise saturated). **ADVISORY by design:** absence of a
  visible scope is FP-prone (a scoped client, RLS, or a bare-helper `where` is invisible),
  so it is `advisory: true`, severity `info`, and **never gates the verdict** — cal.com and
  nocodb stay PROVEN with advisories present. It is an honest review list ("I couldn't prove
  object-scope here — verify it"), not a vulnerability claim. Tested on the giants: dub 60,
  ghostfolio 8; immich/twenty/novu 0 (TypeORM query-builders carry no prisma `where` yet).
  The corpus oracle now tracks `advisories` separately from hard `findings`.
  - **Known precision gap (honest):** a chunk of dub's 60 are scoped by a BARE helper call
    (`getCustomerOrThrow({ workspaceId })`) the resolver doesn't follow (it follows
    `x.method()`, not `helper()`). Following bare imported calls — the same gap behind the
    taint/deny bare-call limits — is the next enabler and cuts these FPs.

## [0.47.0] - 2026-07-15
### Fixed
- **prisma `...OrThrow` / `createManyAndReturn` / `groupBy` unrecognized (E-041).** `PRISMA_OPS`
  missed common variants, so SPARDA was blind to the `findUniqueOrThrow` reads where apps put
  the authorization fetch — and, worse, to `createManyAndReturn` WRITES (a Direction-1 blind
  spot: a missed write can hide a real mutation). Completed the op table. dub reads 435 → 539,
  no verdict/finding change; corpus oracle re-baselined.

### Added
- **Object-scope provenance — the BOLA/IDOR substrate (ADR-058 B).** SPARDA now records, per
  query, whether it targets a bare `id` (`idScoped`) and whether it is scoped to the caller by
  an ownership key (`userId`/`workspaceId`/…) or a session value (`ownerScoped`). A route with
  an idScoped access and NO ownerScoped access anywhere on its **resolved** path is a BOLA
  candidate. Measured (measure-first, the taint lesson): the file-local heuristic gave **1019
  false candidates on dub**; on the resolved graph with the E-041 fix and admin/cron excluded
  it collapses to ~71 — proof BOLA is tractable, and (per ADR-058) advisory, not a hard finding
  yet. Additive flags only; no verdict moves. The advisory finding (with proper admin-guard
  exclusion + more scope-detection precision) is the next iteration.

## [0.46.0] - 2026-07-15
### Added
- **Verified global guards — app-wide `APP_GUARD` proven to deny (immich 0 → 253 verified).**
  Most real Nest apps authenticate app-wide: a global guard registered via
  `{ provide: APP_GUARD, useClass: AuthGuard }` (or `useGlobalGuards(...)`), invisible to a
  per-method decorator scan — so immich's 253 guards all read asserted-by-name, none proven.
  SPARDA now detects the global guard, resolves its `canActivate` THROUGH DI to a real deny
  (immich's `AuthGuard` delegates to `this.authService.authenticate()`, which throws
  `UnauthorizedException`/`ForbiddenException` one hop down), and — when proven — every
  auth-named guard on the app earns `verified`. **immich: 253 guards 0 → 253 verified**,
  coverage 91.5 → 93.9; findings and the guarded/unguarded verdict unchanged (purely a
  credibility sharpening, SOUNDNESS Direction 2 — it upgrades asserted → verified on already-
  guarded routes, never invents a guard). twenty/novu/dub/cal.com/nocodb unchanged. This is
  the socle for object-level authorization (BOLA): you must know a route IS authenticated
  before asking whether it is authorized for a specific object. The corpus oracle caught the
  immich metric move as intended drift and was re-baselined.

## [0.45.0] - 2026-07-15
### Added
- **The corpus oracle — a regression net for real giants (`npm run corpus`).** In-repo
  fixtures pin the small cases; nothing watched the GIANTS, so the tsconfig bug (E-039)
  silently took dub's guards 514 → 1 with no alarm. Now `scripts/corpus-oracle.mjs` compiles
  each pinned app (dub, novu, cal.com, twenty, immich, nocodb, ghostfolio) and diffs
  drift-sensitive metrics — verdict, findings by rule, db_writes/reads, guards verified,
  coverage — against a committed baseline (`corpus.snapshot.json`). Any drift (a verdict
  flip, a finding jump, guards collapsing, writes re-inflating) exits non-zero with a
  per-field diff. The giants aren't committed (huge, ephemeral env); the snapshot is —
  point `SPARDA_CORPUS` at the clones, and apps not present are skipped gracefully (never
  failed), so it runs wherever the corpus is cached and is a no-op where it isn't. This
  freezes every precision win so far (dub 152 → 9, novu 636 → 24 writes, twenty 156 verified
  guards) so it can't silently regress. A lightweight `tests/corpus-snapshot.test.js` keeps
  the committed baseline well-formed under `npm test` even without the corpus.

## [0.44.0] - 2026-07-15
### Fixed
- **CQRS command factories misread as db_writes (E-040) — novu 612 of 636 phantom.** A
  capitalized `.create()`/`.save()` receiver was always read as an active-record model, but
  in CQRS/DDD code it is just as often a command/query FACTORY
  (`GetWorkflowRunCommand.create({...})`) that touches no database. A `NON_MODEL_RECEIVER`
  gate now excludes receivers ending in a DI/CQRS infra suffix (Command, Query, UseCase,
  Handler, Dto, Service, Repository, Resolver, …) — which can never name an ORM model.
  novu: **636 → 24 db_writes, UNGUARDED 21 → 2**; dub/twenty/immich/cal.com unchanged, no
  verdict flips to cleaner. Ambiguous nouns that CAN be models (Event, Entity, Schema) are
  deliberately KEPT as writes — dropping a real write is the one unforgivable error
  (SOUNDNESS Direction 1); over-flagging is the safe one.

### Added
- **Taint as enrichment — request data flowing into a write, the ADR-P1 foothold.** When a
  write's payload is PROVABLY request-derived (`prisma.x.create({ data: req.body })`,
  `Model.create(req.body)`, `supabase.insert(body)` where `const body = req.body`), the
  effect is tagged `tainted` and the resulting `UNGUARDED_MUTATION` carries `tainted: true`
  with a sharpened message. It is a DECORATION on an already-emitted finding — **never a
  finding of its own** — so it highlights the worst routes (open AND fed by user input)
  without a single new false alarm. Under-approximated on purpose (SOUNDNESS): a missed tag
  hides nothing (the mutation still flags), and a per-function scan can't see service-layer
  validation, so it does not claim "unvalidated." The value grows once cross-function
  dataflow (the full ADR-P1) lands; today it is the sound, tested rail that work will ride.

## [0.43.0] - 2026-07-15
### Added
- **The soundness contract — SPARDA named as abstract interpretation, made checkable
  (`docs/SOUNDNESS.md` + `tests/soundness.test.js`).** States the safe-direction invariant
  every analysis feature must preserve: **effects are over-approximated** (a real side
  effect is either in the UBG or charged to a blindspot — never silently dropped) and
  **guards are under-approximated** (a guard is `verified` only on a proven deny — never
  fabricated). Corollary (the safety theorem): every imprecision pushes the verdict toward
  NOT_PROVEN / more findings (cry wolf), never toward PROVEN / fewer (blindness). This is
  the Cousot lineage — sound + total, drop complete — not a solver: **zero new deps, zero
  runtime, analysis-time only.** The test locks both directions on the fixtures (no
  `verified` guard is `opaque`; an unguarded mutation is always flagged while its guarded
  twin is not), so a future change that inverts either turns the suite red. Records the
  honest conditional assumptions (bounded depth as widening, unresolved dispatch → blindspot,
  future Hoare-style contracts, LLM advisory-only) and the rule binding them: an assumption
  must be **visible**, never silent — exactly the class of bug E-039 was.

## [0.42.0] - 2026-07-15
### Fixed
- **tsconfig alias resolution silently dead on any path glob (E-039).** `readTsconfig`
  stripped JSONC comments with a regex; a `paths` glob like `["pages/*"]` contains `/*`
  and a later `["**/*.ts"]` contains `*/`, so the block-comment regex deleted the whole
  span between them — wiping the `paths` block, so `JSON.parse` threw and every `@/…`
  alias resolved to null. Replaced with `stripJsonc`, a string-aware scan (only treats
  `//` `/* */` as comments outside strings; drops trailing commas). This was corpus-wide:
  any monorepo whose tsconfig carried a glob lost every alias hop.

### Added
- **Next.js guards that provably DENY are recognized — HOC wrappers, in-body verifiers,
  verb aliases (ADR-046/ADR-055 cont.).** A Next route rarely inlines its guard; it
  authenticates through a higher-order wrapper (`export const POST = withWorkspace(h)`),
  a bare verifier called at the top of a plain handler (`await verifyQstashSignature(req)`),
  or a verb alias (`export const PUT = PATCH`). SPARDA now resolves each — following ESM
  barrel re-exports (`export * from './workspace'`) to the real definition — and, when the
  wrapper/verifier **provably denies** (401/403, an auth exception, or a
  `{ code: "unauthorized" | "forbidden" }` error shape, deep-scanned through the returned
  inner function and bare helper calls), attaches a **verified** guard. In-body recognition
  is double-gated (a verifier-shaped name AND a proven deny) so it never suppresses a real
  hole on an incidental error-path 401. Genuinely open routes still flag. Real corpus:
  **dub 152 → 5 UNGUARDED** (147 false positives gone; guards 1 → 514, verified 513), the
  5 survivors all honest true-positives (pre-auth reset, soft-`getSession` OAuth callbacks).

## [0.41.0] - 2026-07-15
### Added
- **Verified guards — apocalypse proves a guard can DENY, not just trusts its name (ADR-046 cont.).**
  A `@UseGuards(X)` guard is now resolved: SPARDA reads X's `canActivate` and marks the guard
  **verified** only when it saw a real deny path — a `res.status(401/403)`, an auth exception
  (`throw new UnauthorizedException()` / `ForbiddenException` / `HttpException(_, 401|403)`), or a
  `return false` (the canonical Nest rejection, read as a deny only inside a resolved guard method,
  never in arbitrary code). A guard whose `canActivate` can never deny stays **asserted** — honest
  either way. Purely additive: the guarded/unguarded verdict is unchanged (corpus verdicts + finding
  sets byte-identical); only the credibility signal sharpens. Real corpus: **twenty 0 → 156 verified
  guards** (of 365). Only the deny SIGNAL is kept — a guard's own reads never enter the app graph.
  Fixture `ubg-verified-guard` (a throwing guard → verified; a no-op guard → asserted) + 4 tests.

## [0.40.0] - 2026-07-15
### Added
- **`sparda prove` — the whole trust verdict in one gesture.** One command assembles what
  used to take six: the verdict (apocalypse), what SPARDA could NOT see (blindspots coverage), the
  1-byte-per-route capsule (immunize), and a portable app **seal** (a content address over every
  route's behavior hash). It composes the existing organs — one source of truth per fact, so `prove`
  can never disagree with the specialists. Exit 1 on any critical/high, `--json` for CI, `--openapi`
  for any-language. This is the headline gesture the product was missing.
### Changed
- **The CLI help is now organized into tiers** — PROVE / IMMUNITY / INGEST & RUNTIME / SETUP — so
  the tool tells its own story. Experimental "living-organism" commands (`twin`, `grammar`,
  `evolve`, `seed`) are quarantined under **LABS**, hidden unless `sparda --labs`: still runnable,
  no longer diluting the story. No command was deleted; the spine just reads clearly now.

## [0.39.0] - 2026-07-15
### Added
- **Coverage-graded verdict — the doctrine's first brick (ADR-056).** A CLEAN app that resolved
  almost none of its own behavior (blindspot coverage below a 5% floor) now reads **SURFACE**, not
  PROVEN — "no violation found over ~nothing" is not a proof. Closes the last hollow PROVEN a real
  stress test found: cal-api-v2 (175 routes, 1 resolved effect, ~0% coverage) read PROVEN → now
  SURFACE. Guarded hard: coverage only downgrades a CLEAN app (findings.length === 0), so it can
  never mask a real finding behind SURFACE. Every genuine PROVEN (directus 95%, open-webui 77%,
  nocodb 71%, fixtures 60-100%) is unaffected. This is the first concrete step of the
  PROVEN-COMPLETE vs PROVEN-PARTIAL "decidable-fragment" doctrine. +3 tests.

## [0.38.0] - 2026-07-15
### Fixed
- **Monorepo app dirs whose framework config lives elsewhere no longer crash (E-038).** A second
  stress-test round found two more giants hard-failing at detection: Ghostfolio (Nx `apps/api` has
  34 `@Controller` files but only a `project.json` — its `@nestjs` dep is at the monorepo root) and
  Langflow (fastapi declared one directory up from the pointed backend dir). Two purely-structural
  last resorts, tried only when normal detection would otherwise throw (so no existing app is
  affected): a decorator-app structural scan (Ghostfolio → NOT PROVEN, 116 routes, 75% coverage,
  0.4s) and a bounded up-tree walk for a fastapi requirements/pyproject (Langflow → honest NO_PROOF
  instead of a crash). Fixture `ubg-monorepo-noapkg` + 2 tests.
### Notes
- **Consolidated stress test, 12 giants, ZERO crashes** (was 5/12 crashing before this session's
  robustness work): directus PROVEN 95%, immich NOT PROVEN 92%, twenty NOT PROVEN 47%, open-webui
  PROVEN 77%, n8n NOT PROVEN 22%, novu NOT PROVEN 59%, nocodb PROVEN 71%, ghostfolio NOT PROVEN 75%,
  vendure SURFACE 0%, ghost NO_PROOF, langflow NO_PROOF, cal-api-v2 (verdict coverage-gap, see
  below). Speeds 0.09–3.4s. **Known honest gap:** a clean app at ~0% coverage with a single
  non-read effect (cal-api-v2) still reads PROVEN — the coverage-graded verdict (PROVEN-COMPLETE vs
  PROVEN-PARTIAL) is the validated next brick.

## [0.37.0] - 2026-07-15
### Fixed
- **Reads-only is no longer a hollow PROVEN (E-037).** A positive PROVEN now requires
  mutation-capable observed behavior (`db_write`/`http_call`/`fs_write`) — every obligation SPARDA
  discharges is about state change, so an app resolved down to reads-only proves nothing and reads
  **SURFACE**, not PROVEN. Found by a stress test: Vendure compiled to 312 routes / 0 writes / 26
  reads and read "PROVEN" at 0% coverage. Now SURFACE. Corpus + all fixtures with a real write stay
  PROVEN, byte-identical. Fixture `ubg-reads-only` + 2 tests.
- **A real Express giant no longer hard-fails at detection (E-036).** The entry-file tree scan
  gave up after 400 files, so Ghost (1381 files) never reached its `core/shared/express.js` and a
  genuine Express app CRASHED. Entry-named files (`express`/`app`/`server`/`index`/`main`/
  `bootstrap`/`application`/`boot`) now get their own scan budget and are found at any depth. Ghost:
  crash → honest **NO_PROOF** (entry found, custom routing layer unseen — the correct verdict).
  Fixture `ubg-express-buried` + 2 tests.

## [0.36.0] - 2026-07-15
### Added
- **Recognize the protocol, not the framework (ADR-055).** Route ingestion is now brand-free:
  a class is a route source if a method carries an HTTP-verb decorator (`@Get`, `@HttpGet`,
  `@GetMapping`) — the verb, not the `@Controller` name — so a bespoke `@RestController`/
  `@Endpoint` framework reads exactly like Nest with zero per-framework config. The next app that
  invents its own decorator name is still HTTP underneath, so it is still seen.
- **Guarded-by-default posture inference (ADR-055).** A framework whose base auth lives in its
  registry/bootstrap (not its decorators) used to read as hundreds of false "unguarded" routes.
  Now: if ANY route declares an auth **opt-out** flag (`{ skipAuth: true }`, `{ authenticate:
  false }`, `{ public: true }`), the app is inferred guarded-by-default — every route WITHOUT the
  opt-out gets a synthetic asserted `framework-default-auth` guard, and only the genuinely public
  opt-out routes are evaluated on their merits (the Medusa inverted-auth pattern, generalized). No
  opt-out flag anywhere → posture not inferred → plain Nest apps byte-for-byte unaffected.
- **Decorator-framework detection.** `detectStack` routes an app with `express` + `reflect-metadata`
  and HTTP-verb decorators on classes to the decorator extractor (bounded, cached scan; gated on
  `reflect-metadata` so classic-express detection stays cheap).
- **Proven on n8n (`packages/cli`), a reputedly-unanalyzable giant:** was **0 routes / NO_PROOF**
  (home-made `@RestController` framework); now **494 routes, NOT PROVEN with 4 true-positive
  `UNGUARDED_MUTATION`** (the `skipAuth` public writes — `/auth/embed`, a Slack OAuth callback,
  `POST /e2e/reset`), 429 guards (asserted), coverage 21.7%, 2.5s. Full corpus (directus, immich,
  twenty, open-webui) + all fixtures byte-identical. Fixture `ubg-decorator-framework` + 6 tests.

## [0.35.0] - 2026-07-15
### Added
- **`UNBOUNDED_WRITE_TARGET` — taint's precise core (Wave 3a).** A new critical obligation (O6 in
  `apocalypse.js`): a `db_write` whose TABLE is chosen by the request (`meta.symbolic` — the URL
  names the collection) with NO guard on the path. "Anyone can write to any table they name" — a
  mass-assignment-of-target escalation, sharper and scarier than a generic unguarded write.
  Bounded HARD per the E-029 lesson: symbolic AND unguarded only. A GUARDED symbolic write
  (directus's per-collection permission layer, invisible to the static eye) is deliberately NOT
  flagged — measured: every symbolic write on the real corpus is guarded, so the rule fires ZERO
  false positives (directus stays PROVEN F=0, immich/twenty/open-webui verdicts unchanged). Rides
  the existing `vec.auth = -1` — no new polarity axis (the 5-axis matrix stays pinned). Fixture
  `ubg-unbounded-write` (guarded vs unguarded symbolic write) + 4 tests.

## [0.34.0] - 2026-07-15
### Added
- **Python effect depth — the resolve.js contract in Python (Wave 2b, ADR-054).**
  `fastapi_extract.py` now follows calls OUT of a handler exactly like the JS engine: module-level
  singletons (`Users = UsersTable()`, THE FastAPI repository idiom), imported classes and module
  aliases, bare imported functions, `self.<m>()` sibling dispatch, and DI-bound params
  (`Depends(UserService)` / class annotations) — bounded (depth 6), memoized per (file, qualname),
  cycle-guarded, deterministic. `Depends()` providers are deep-scanned too: an auth dependency
  that reads the user table is real, provable behavior on every route it guards. New effect
  shapes: SQLAlchemy 2.0 statement builders (`execute(insert(User).values(…))`,
  `scalars(select(User))`), `session.get(Model, id)`, `session.delete(obj)`, and dotted-receiver
  matching (`self.db.add(…)`). **open-webui: 456 routes, 0 → 1353 db effects, coverage 0% → 77%,
  verdict PROVEN unchanged, 3.3s.** Fixture `ubg-fastapi-deep` + 4 tests.
### Fixed
- `extractFastAPI` no longer dies on big extractions: the spawnSync buffer is 64 MiB (the 1 MiB
  default killed the child mid-write on open-webui and read as a phantom parse failure).

## [0.33.0] - 2026-07-15
### Added
- **The one walk (ADR-054 phase 2 — convergence).** Constructor-type DI is now a receiver kind
  inside the engine's single `followCalls` (the separate DI machine is gone), which enriches every
  DI framework with the full member-call capability set: a Nest handler now resolves instantiated
  classes, imported module calls, and `this.<m>()` sibling dispatch inside services. Real corpus:
  twenty 14 → 74 db effects (coverage 8% → 47%), immich 283 → 431 (88% → 92%) — surfacing findings
  verified genuine one by one, including a real missing `@Authenticated` decorator on immich's
  alpha `POST /admin/database-backups/start-restore` (every sibling endpoint carries it). directus
  and all 31 fixtures byte-identical. Fixture `ubg-nestjs-converged` + 3 tests.
### Fixed
- **E-034 — detection falls through (fix(detect)).** A Nest/Medusa app listing `express` as a
  direct dependency (immich, twenty at HEAD) no longer hard-fails hunting an `express()` entry:
  the Express branch falls through to the other framework checks. Fixture
  `ubg-nestjs-express-dep` + 2 tests.

## [0.32.1] - 2026-07-15
### Changed
- **One interprocedural resolution engine (ADR-054, phase 1).** The call-following machinery that
  existed three times — the Nest DI follower, the Express module/instance follower, and their
  line-for-line duplicated `mergeScan` — now lives once in `src/ubg/resolve.js`; `express.js` and
  `nestjs.js` are route-table adapters configuring it. Pure extraction, proven byte-identical:
  all 30 fixtures hash to the same canonical graph, directus reads byte-exact at its baseline
  (239 routes / PROVEN / 344 db effects / 95% coverage), twenty and immich are canonical-SHA
  identical old-vs-new at ~1s each. This is the prerequisite for taint dataflow in the IR and for
  Next/Python/GraphQL depth landing in one place instead of three (phase 2).

## [0.32.0] - 2026-07-13
### Added
- **GraphQL resolvers are now first-class entrypoints (ADR-053, Vague 2a).** A `@Resolver()` class
  wires like a `@Controller()`, so the Nest extractor reads its operations onto the graph's verbs:
  `@Query`/`@Subscription` → a read, `@Mutation` → a state change, namespaced under `graphql/`.
  Constructor DI, `@UseGuards`, effect resolution, guard proof and coverage all apply unchanged —
  a resolver method IS a route after mapping. twenty's resolver operations now enter the graph;
  full corpus verdicts unchanged. Fixture `ubg-graphql-resolver` + 3 tests.

## [0.31.0] - 2026-07-13
### Added
- **Coverage as a first-class signal everywhere (ADR-052).** The blindspot coverage ratio now
  travels WITH the proof through every organ that carries a verdict: the immunity capsule (and
  therefore the genome) records `coverage` + `blindHigh`; `immunize` prints it; the `dossier`
  shows it as a hero stat; `review` reports the coverage DELTA vs the base ref (a PR that makes
  the app harder to see is flagged even when clean). Blindspot risk sharpened: an unreadable
  mutation with NO guard escalates high → critical. Verdicts unchanged across the corpus — it
  reports, never re-judges. directus `immunize` reads "coverage 98%".

## [0.30.0] - 2026-07-13
### Added
- **Cross-class symbolic dataflow — the real interprocedural table resolution (ADR-051).** A
  table chosen at the route (`new ItemsService(req.collection, …)`), stored on `this.collection`,
  and queried deep in inherited methods (`this.knex(this.collection)`, `.select().from(this.collection)`)
  now resolves — request-derived → `:collection` (symbolic), a literal `super('directus_activity')`
  → a concrete table. Both knex builder orders handled (table before OR after the verb, via
  `chainVerbOp` with a db-root guard); request access via dot or bracket with TS `!`/`as` unwrapped.
- **Effects from middleware-slot handlers.** The translator attaches effects from EVERY chain step
  with a body, not just the terminal one — the near-universal `router.get(path, …, handler, respond)`
  shape put the real DB work in a middleware slot, previously unscanned. Effect node ids are now
  collision-aware, so the same method line under two bindings (`:collection` vs `directus_activity`)
  coexists.
- **Result:** directus coverage **13% → 95%**, db effects 11 → 344, verdict unchanged (PROVEN, 0
  findings); full corpus verdicts/findings byte-identical. Fixture `ubg-crossclass-table` + 3 tests.

## [0.29.0] - 2026-07-13
### Added
- **Blindspot ledger — SPARDA measures its own Unknown Behavior Surface (ADR-049).** New organ
  `src/ubg/blindspots.js` + command `sparda blindspots`: every place the static eye stops —
  opaque effect targets, mutating routes with unreadable bodies, name-only guards, un-graphable
  surface — enumerated and ranked by what each could hide, plus a coverage ratio (resolved ÷
  resolved+blind). Reported as an honesty line under every `apocalypse` verdict, as a "Where the
  proof stops" section in the `dossier`, and standalone (exit 1 on any high-or-worse blind spot).
  Verdicts are unchanged — it only makes the blindness visible: twenty PROVEN → coverage 8%,
  directus PROVEN → coverage 13%, dub NOT PROVEN → 99%. Seeded by Reyna's UBS idea, derived from
  the real graph (no hand-authored regions).
- **Symbolic table resolution (ADR-050, Round 7 #1 first cut).** A DB table sourced from the
  request (`knex(req.params.collection)`, `db.from(collection)`, `db.insertInto(req.params.type)`)
  now resolves to a symbolic `:collection` marked `symbolic: true` — a precise rule, not an
  `unknown` — so generic CRUD endpoints stop reading as opaque blind spots. Within-handler only;
  the cross-class constructor-dataflow case (directus) is scoped honestly for Round 7 #1 proper.

## [0.28.0] - 2026-07-13
### Added
- **Instantiated-service resolution (Round 7, directus-class apps).** The Express deep scanner
  now follows `const svc = new XService(…); await svc.createOne(…)` to the class's method —
  through the import, up the `extends` chain (real services inherit their DB calls from a base
  class), including `this.<m>()` re-dispatch from the *instantiated* class (overrides win) and
  `super.<m>()` from the declaring class's base. Wrapped INLINE handlers
  (`asyncHandler(async (req, res) => {…})` in route position) are unwrapped to their real body,
  and `this.knex('table')` — the class-field query-builder call — now yields a table op.
  Class-method scans are memoized per (class, method) across the extract (Nest bundleCache
  rationale). directus: SURFACE ONLY → real verdict with observed effects. Class-resolution
  helpers (`classInModule`/`baseClassOf`/`methodInClassChain`) moved to `extract.js`, shared
  with the NestJS DI follower. (ADR-048)

## [0.27.0] - 2026-07-13
### Added
- **Express routes built inside a setup function (Round 7 #2, first cut).** `flattenSetup`
  feeds the route walk the module top level PLUS the bodies of setup functions
  (`export default function createApp() { const app = express(); … }`) and the control-flow
  blocks inside them — never a function passed as a call argument, so handlers stay opaque.
  directus 0 → 239 real routes; node-express-boilerplate 8 → 9 (recovered an if-gated
  `/v1/docs`). (ADR-047)

## [0.26.0] - 2026-07-13
### Added
- **ORM breadth: Drizzle, TypeORM, Sequelize (Round 7 #5).** The effect scanner recognized raw
  SQL, Prisma, supabase/knex, Kysely and Mongoose; it now also reads Drizzle
  (`db.insert(users).values()` — table is a schema identifier, not a string), TypeORM
  active-record (`User.save()`/`findOneBy()`), and Sequelize (`Product.findAll()`/`bulkCreate()`/
  `destroy()`). Additive — zero change to any app not using them. Repository-pattern
  (`userRepository.save()`) is deliberately reached through DI resolution, not matched directly,
  to avoid double-counting.

## [0.25.0] - 2026-07-13
### Changed
- **Guard semantics — a guard must be able to deny (ADR-046).** A middleware named like an auth
  gate but whose visible body is a pure `(req,res,next)=>next()` pass-through (a disabled/stubbed
  guard) is downgraded — the route it "protects" now correctly reads as unguarded. Each guard
  node carries `verified` (SPARDA saw a 401/403 deny path) vs asserted-by-name; the verdict
  exposes `guards`/`guardsVerified` and the dossier renders "N/M guards verified". Opaque
  middleware/decorators are never downgraded (no false-positive regression).

## [0.24.1] - 2026-07-13
### Changed
- **34× faster on big NestJS apps.** twenty (a large Nest CRM) took 34.5s to compile — the DI
  resolver re-resolved each shared service method once *per route*, and the walk full-parsed
  every `.ts` file to find `@Controller`. Fixed with cross-route memoization of resolved method
  bundles + a `@Controller` string pre-filter. twenty 34.5s→1.0s, novu 6.5s→1.5s, immich
  3.4s→1.0s — identical results.

## [0.24.0] - 2026-07-13
### Fixed
- **Next.js was dropping ~90% of routes.** The extractor only registered a route for an *inline*
  `GET`/`POST` function; real apps wrap or alias the handler (`export const POST = withAuth(h)`,
  `export const GET = handler`, `export { postHandler as POST }`), so those routes were silently
  missed — a coverage AND honesty failure. A route now exists as soon as a verb is exported;
  the body is resolved when possible, left blind otherwise. cal.com 3→45 routes, formbricks
  12→119, dub 559→579. Found by a large multi-repo stress test.

## [0.23.0] - 2026-07-12
### Changed
- **Robust Express entry detection (ADR-045).** SPARDA used to hard-fail ("could not locate
  your Express entry") on any app whose entry file wasn't named one of a fixed list
  (`app.ts`/`server.ts`/`index.ts`/…). Now, when no named candidate matches, it scans the tree
  for the file that actually creates the app (a bare `express()` call), preferring a real
  server (one that `.listen()`s) — the same fallback FastAPI detection already uses. An app
  with an unconventional entry (`bootstrap.ts`, `ParseServer.ts`) is detected and analyzed
  instead of rejected. Standard apps are unaffected (named candidates still win first).

## [0.22.0] - 2026-07-12
### Added
- **Deep Express (CommonJS) effect resolution (ADR-044).** A stock Express boilerplate read as
  **0 effects / SURFACE ONLY** because the DB write hides two+ modules below the route, behind
  `service.method()` calls the flat scanner couldn't see. SPARDA now follows the CommonJS chain:
  **module-member handlers** (`thingController.create`) resolved to their body, **recursive
  module-member calls** (controller → service → model), **barrel re-exports**
  (`const { thingService } = require('./services')`), and **Mongoose** effects (`Thing.create()`)
  plus guard middleware (`auth()`). On the real boilerplate: **0 → 9 effects, 2 state tables**,
  SURFACE ONLY → NOT PROVEN with 3 genuine findings (public auth endpoints that mutate).
- Mongoose query recognition in the effect scanner (any Express/Mongoose app).

## [0.21.0] - 2026-07-12
### Added
- **Deep NestJS effect resolution (ADR-043).** Real NestJS monsters hide the DB write two DI
  hops below the controller, behind inheritance and idioms the first Nest extractor couldn't
  follow. SPARDA now resolves all four: **tsconfig `baseUrl`/`paths` imports** (`src/services/x`),
  **multi-hop DI** (controller → service → repository), **inherited DI** (the repo injected in a
  `BaseService` the service `extends`), and **Kysely** effects (`db.insertInto('t')`) plus
  **custom guard decorators** (`@Authenticated`, not only `@UseGuards`). On the real immich
  (281 routes) this goes from **1 effect / hollow PROVEN** to **310 effects, 45 state tables,
  253 guards, and a real verdict** — 2 genuinely-unguarded OAuth mutations surfaced, zero
  false-positive noise.
- Kysely query-builder support in the effect scanner (helps any Kysely app, not just NestJS).

## [0.20.0] - 2026-07-12
### Changed
- **No more hollow PROVEN — the behavior guard (ADR-042).** SPARDA used to print a green
  PROVEN on apps where it had resolved *zero* behavior (a spec via `--openapi`, or an app
  whose effects hide behind DI/external controllers) — "no obligations to fault" was reported
  as "safe". Now a graph with routes but no state-touching effects reports a distinct third
  verdict, **SURFACE ONLY** (amber), across `apocalypse`, `immunize`, and the `dossier`. It is
  *unprovable*, not *unsafe*, so it still exits 0 (a trivial service isn't blocked) — but it is
  never blessed as PROVEN. Found by a multi-repo stress test across immich (NestJS), dub
  (Next.js), Medusa, FastAPI, and GitHub's 1196-path OpenAPI spec
  (`docs/audit/2026-07-12-multi-repo-organ-stress-test.md`).
- The immunity capsule shares the same `countObserved` guard, so the capsule's `proven` flag
  and the apocalypse verdict's `clean` can never disagree.

## [0.19.1] - 2026-07-12
### Added
- **O(1) indexed genome recall.** `indexGenome()` builds a `behaviorHash → verdict` map
  once; `recallIndexed()` then answers in constant time — ~1387× faster per lookup than the
  linear scan at a 50k-antibody genome, results byte-identical. For an agent querying the
  shared genome per route in a tight loop. Zero new dependency, no worker, no daemon. (This
  is the SPARDA-correct version of a proposed "bitmask engine"; the full assessment of that
  and two other proposed pillars is in `docs/audit/2026-07-12-kimi-v2-assessment.md`.)

## [0.19.0] - 2026-07-12
### Added
- **`sparda genome` — the world immune memory (ADR-041).** Turns one app's proofs into
  portable, **self-verifying antibodies** that other SPARDA installs can trust *without
  trusting the sender* and with **zero infrastructure** — no server, no database, no CA,
  no chain. Each antibody is a ~250-byte claim (`behaviorHash` + the 1-byte polarity
  verdict) wrapped in a trust envelope with three offline-checkable guarantees:
  **integrity** (the id is the sha256 content address of the claim — tamper and it stops
  matching), **provenance** (an Ed25519 signature binds it to a public key that travels
  inside the antibody; reputation accrues to keys, not a server), and **truth**
  (the verdict is a deterministic function of the behavior, so anyone can re-derive it).
  The genome is canonical JSONL — that file *is* the database; `git push`/`pull` is the
  replication. Merging dedups, counts corroboration across independent issuers, and
  surfaces conflicts instead of hiding them. Built entirely on Node's `node:crypto` — no
  new dependency. The private signing key lives only in gitignored `.sparda/`.
### Changed
- `sparda genome` ensures `.sparda/` is git-ignored before writing the private key, so a
  signing key can never be committed by accident.

## [0.18.0] - 2026-07-12
### Added
- **Medusa support — file-based routing, the third pattern (ADR-040).** A real Medusa
  app used to compile to **0 routes / NO PROOF**: it has no `@Controller` classes (so the
  NestJS extractor found nothing), and its routes are a *filesystem convention* —
  `src/api/<path>/route.ts` where the directory is the route path and each exported
  `GET/POST/…` const is a method. SPARDA now reads that convention, plus two more:
  **inverted authentication** (Medusa authenticates by default; `export const AUTHENTICATE
  = false` is the only opt-out) and a **workflow-verb effect heuristic** (the DB write
  lives in `createProductWorkflow(...).run()`, not an ORM call, so the effect is
  synthesized from the workflow name). On the real `medusajs/medusa` checkout this reads
  **476 routes** (from 319 files) in ~0.5s with 435 mutations and 121 state tables —
  provable, not blind. Auto-detected from `@medusajs/*` deps + a `src/api` directory.
### Changed
- Framework detection now recognises Medusa (`framework: 'medusa'`) before NestJS, since a
  Medusa app may transitively pull Nest dependencies.

## [0.17.0] - 2026-07-11
### Added
- **`sparda dossier` — the human face of the proof.** Renders everything SPARDA proved
  about an app as ONE self-contained HTML page anyone can read: the verdict, the ternary
  safety matrix (route × obligation), every risk in plain language, and the frozen
  capsule. Zero dependencies, no CDN, no network — all CSS inline; deterministic (content
  derives only from the graph) and HTML-escaped. Written to `.sparda/dossier.html`, which
  is gitignored — **ephemeral by design**: it vanishes on `sparda remove`/a clean, so the
  reader keeps it only if they save it. For the person who can't read a terminal report.
- **NestJS support — the DI wall-breaker (ADR-039).** Apps built on NestJS (and the
  same dependency-injection pattern Medusa/Inversify use) used to be "not supported" or
  compile to 0 routes — routes are `@Get()` decorators and the real DB write lives in a
  service wired by DI, not in the controller. SPARDA now reads `@Controller`/`@Get/@Post/…`
  for the route table, `@UseGuards` for guards, and — the hard part — resolves DI
  **statically via constructor parameter types** (`constructor(private svc: CatsService)`),
  following `this.svc.method()` into the service to find the actual effect. A Nest fixture
  now yields a real critical `UNGUARDED_MUTATION` on an unguarded write found two DI hops
  deep. Same UBG out, so `apocalypse`/`polarity`/`immunize`/`speculate` all work on Nest.
### Changed
- `this.<field>.<op>()` access (e.g. `this.prisma.cat.create`) is now detected as an
  effect, not just bare `prisma.cat.create` — class-based code was previously invisible.
- The parser uses the `decorators-legacy` Babel plugin (TypeScript `experimentalDecorators`),
  required for NestJS parameter decorators (`@Body()`, `@Param()`).

## [0.16.0] - 2026-07-11
### Added
- **`sparda speculate` — speculative verification (ADR-038).** Re-verify the working
  tree against a frozen capsule (`.sparda/immunity.json`) by hash lookup instead of a
  full re-proof: routes whose behavioral shape is already known are settled for free
  (accepted if safe, rejected if a known-exposed shape); only genuinely NOVEL shapes pay
  the full prover. On an unchanged tree that's 100% settled — zero prover work. The
  speculative-decoding pattern applied to proof, and stronger than the analogy: a capsule
  hit is *exact* (same behaviorHash ⇒ same verdict the full prover would give, proven by
  test). This is what lets SPARDA verify at agent-inner-loop speed even on a 559-route
  monster. `--json`.

## [0.15.0] - 2026-07-11
### Fixed
- **`sparda immunize` crashed on a fresh checkout** (E-023) — it wrote
  `.sparda/immunity.json` without creating `.sparda/` first (ENOENT, exit 2). Now
  `mkdirSync(recursive)` before the write; runnable standalone on a virgin repo.
- **Derived artifacts are now byte-identical across locales** (E-024) — apocalypse
  findings, `polarity`/`immunize`/`review` order, the OpenAPI spec, and the mirror/ubg
  output sorted with `localeCompare` (host-locale-dependent) instead of `cmp` (code
  units). For mixed-case routes that broke the "same bytes on any machine" promise.
  All output-reaching sorts now use `cmp`; regression in `tests/determinism.test.js`.

### Added
- **`sparda fingerprint` — the portable behavior hash (ADR-035, Brick 1).** A
  coordinate-free `behaviorHash` per route: the same behavioral *shape* in any repo
  (verb, guard presence, validation, effect kinds, invariant classes touched) yields
  the same hash, regardless of file/line/name/path. Proven in practice — a fixture
  route and a real Prisma route share `bh1_a51c7d3e…`. Deterministic and locale-
  independent (same contract as the graph). This is the address a shared diagnosis is
  filed under — the first brick of collective immunity (`docs/COLLECTIVE-IMMUNITY.md`).
  `--json` for tooling; exits 1 with `NO FINGERPRINT` on a 0-route compile.
- **`sparda polarity` — proof as ternary arithmetic (ADR-036).** Each route reduces to a
  vector of {−,·,+} over the five safety obligations (auth, atomicity, reversibility,
  validation, aggregate), built inside the prover so a `−` *is* a finding (one source of
  truth). A verdict becomes a sign check, a PR review becomes a subtraction (a removed
  guard = a negative delta), and an app's posture becomes a column sum — the algebra that
  lets the collective genome compose behavior by adding ternary columns. Inspired by
  BitNet's ternary weights. `--json`.
- **`sparda immunize` — the immunity capsule (ADR-037).** Freezes the app's proven safety
  into a self-contained artifact of ~1 byte per route (five trits pack into one byte;
  the real Prisma example froze to 5 bytes). `.sparda/immunity.json` is portable, offline,
  and consulted by a pure `judge(behaviorHash)` lookup — no recompile, no LLM, no network.
  It is the atom of the world genome: capsules compose (posture is additive). `--json`.

## [0.14.1] - 2026-07-11
### Fixed
- **`apocalypse`/`review` never bless a 0-route compile again (provability
  guard).** When the parser could not see a repo's route surface, the graph had
  zero entrypoints and `apocalypse` printed "✓ PROVEN over 0 nodes" and exited 0 —
  a coverage miss reading as a green proof. `verdictOf` is now provability-aware
  (`provable = entrypoints > 0`, folded into `safe`/`clean`); both commands print
  **`✗ NO PROOF` and exit 1** on a blind compile, with `--verbose` explaining what
  was unseen. A parser-coverage gap can no longer masquerade as a proof. (ADR-034)
- **Inline-require router mounts now parse.** `app.use('/x',
  require('./x.controller'))` (rootpath-style apps) was dropped — only a
  pre-imported Identifier router was mounted. The inline `require()` is now
  resolved to the controller file, so its routes reach the graph. (C-001a)

## [0.14.0] - 2026-07-10
### Added
- **`sparda review` — the semantic PR diff.** Compiles a git base ref (in a
  detached worktree, static — no `npm install`) and your working tree to the
  behavior graph, then reports what the change removed (guards, invariants,
  entrypoints, blast radius) and what new provable risk it introduced — plus the
  endpoint surface delta. `--json` / `--markdown`; exit 1 on critical/high so it
  gates CI. `apocalypse` made relative: the baseline is git, not a file you
  remembered to save. (ADR-030)
- **The PR review bot.** `sparda review` as a GitHub Action (`mode: review`,
  beside the existing `mode: apocalypse`) that posts the behavior diff as ONE
  sticky comment which updates on every push. Comment-only by default — never
  blocks a merge; gating is opt-in (`fail-on-severity`). Adoption is one workflow
  file. (ADR-032)
- **The stateful mirror.** `sparda mirror` now lives the inferred state machine:
  a create seeds the initial state, a transition route advances it, a read
  reflects the current value, and an illegal transition (pay an already-paid
  order) is refused **409**. Derived from the code + schema, so it can never
  drift; apps with no machine are served stateless as before. (ADR-031)
### Fixed
- **Cross-machine determinism.** `canonicalizeGraph` sorted nodes by code unit
  but edges by `localeCompare` (locale/ICU-dependent), and `localeCompare` also
  drove graph *content* (SQL table dedup, helper pick, merge pick) and stored
  meta arrays — so the same code could compile to different canonical bytes on a
  differently-localed machine. One code-unit comparator everywhere it reaches the
  canonical bytes. (E-020)
- **`sparda remove` no longer deletes the backup it recommends** on an unclean
  revert — it stops before any destructive cleanup and preserves everything. (E-017)
- **Reversible injection** de-duplicated into one shared contract; removal is now
  the byte-exact inverse of the insert (fixes a stray top-of-file newline). (E-018)
- **Write-confirmation nonce** now minted with a CSPRNG (`node:crypto` /
  `uuid4`), not `Math.random()`; Node-18-safe. (E-019, E-021)
- **Mirror sends `Connection: close`** so pooling HTTP clients (undici on Node
  18) never hang on a stale keep-alive socket. (E-022)
### Security
- Sync valve now refuses to publish an incomplete runtime graph (a `src/**`
  module importing a file left behind), closing the under-send class. (ADR-029)

## [0.13.3] - 2026-07-07
### Fixed
- **Flight recorder — per-request entropy suppression.** The Node-18 guards
  that stop `fetch`/`crypto.randomUUID` from recording their internal
  `Date.now()`/`Math.random()` calls lived on the box (a global flag), not the
  request store. Under concurrent recording, one request's fetch window could
  swallow a *concurrent* request's entropy taps and silently corrupt its
  flight (caught fail-loud at replay, but a real determinism hole under load).
  Now scoped to `store.suppressEntropy` — per-request isolation via
  `AsyncLocalStorage`. This is the third audited fix; the first two shipped in
  0.13.2 (see below) but this one landed just after that cut.

## [0.13.2] - 2026-07-06
### Fixed
- **`verify` — the "canonical form is a fixed point" check was vacuous.** It
  compared `canonicalize(g)` against `canonicalize(g)` (trivially equal) and
  proved nothing. Now re-canonicalizes the already-canonical output: a real
  idempotence check. (The module that proves the compiler's laws had a hollow
  one.)
- **`openapi` ingestion — security filter was a no-op.** `opSecurity` filtered
  on `known.includes(s) || active.length`, always truthy, so an undeclared
  security scheme still produced a named guard. Now keeps declared schemes,
  falling back to raw references only when none are declared.

## [Unreleased]
### Added
- **ADR-022 completed for real: the key never touches a committed file.**
  The 0.8.0 backport still baked the localKey into the generated router as a
  fallback (and kept it in the manifest under a test-only flag). Now: the
  generators never substitute the key anywhere; all three router templates
  resolve it at runtime (`SPARDA_LOCAL_KEY` env → gitignored `.sparda/key`)
  and **fail closed** (503 "key not configured") when neither exists — an
  accidental deploy without `.sparda/` exposes nothing, by construction. The
  disk `sparda.json` is stripped of the key unconditionally (no VITEST-gated
  behavior differences between tests and production). ESM/CJS-safe file
  access via a generator-substituted `__FS_IMPORT__` (the old `require('fs')`
  silently threw in ESM apps, breaking file resolution). Tests updated to
  inject the key via env at router import, proving the fail-closed path.
- **Round 3, the predictive organism — the twin, the grammar, evolution —
  plus full germination (R3.2/R3.3/R3.4/R4.5, ADR-021).**
  - **`sparda twin`** (R3.2): a living mock reconstructed from the app's
    boundary. `twin --learn` calls the live router once per eligible GET and
    stores capped exemplars in `.sparda/twin.json` — the ONLY place a value
    ever lives (machine-local, gitignored, never the manifest, never a seed).
    `sparda twin` then serves the ghost: same routes AND the same `/mcp`
    surface, so the unchanged bridge (or any agent) exercises a harmless
    clone; writes are 202 echoes; `/mcp/stats` says `twin: true` — the ghost
    never pretends to be the flesh.
  - **`sparda grammar`** (R3.3): which call sequences MEAN something —
    observed edges from Labs circuits, hypothesis edges from exemplar
    response keys ∩ tool param names, always labelled apart, never acted on
    by themselves. Derived artifact `.sparda/grammar.json`, regenerable.
  - **`sparda evolve`** (R3.4): trials untested hypothesis chains against an
    in-process twin (never the host). Survivors land as SUGGESTIONS —
    `labs.circuits` entries with `seen: 0` and `evolved: true`, no composite:
    crystallization still demands the real observation threshold. Culled
    candidates are reported with their reason.
  - **`seed import --germinate`** (R4.5 full): the derived organs regrow from
    the imported genome on the receiving machine — structure travelled,
    values never did, and the grammar regerminates locally.
  - 10 new tests incl. the twin actually serving over HTTP, evolution
    trialing against it, and an end-to-end value-boundary proof (an exemplar
    value never appears in a seed or a grammar).
- **R2.4 — nothing disappears, x becomes y (composite re-mapping).** Until
  now a composite tool whose step route was renamed silently un-registered at
  bridge start. The wake-up pass now finds the step's **unique deterministic
  successor** (an enabled GET whose name keeps the old segments in order and
  ends on the same resource: `api_users` ⊂ `api_v2_users`) and re-maps the
  circuit — new key, renamed links, identity and observation count intact —
  with an `audit` event recording `x → y`. Ambiguity is never guessed: zero
  or two candidates puts the composite to sleep WITH a recorded lesson in
  `sparding.failures` (structure kept, it can come back). A step the USER
  disabled is respected — dormant, never re-routed around. Round 2 of the
  ROADMAP is now complete. 9 new tests.
- **`npx sparda-mcp seed export|import` — the genome (R4.5 lite).** Distills
  everything the organism LEARNED (semantic descriptions/workflows, immune
  antibodies, failure lessons, Labs circuit structure) into a portable
  `sparda-seed.json` that regerminates elsewhere — dev → prod, or a community
  seed for a popular stack — without re-paying the learning. Structure and
  lessons only, sanitized on export AND on import. **Security contract,
  pinned by tests:** a seed never carries (and import never reads) the
  localKey, the port, the sparding policies, or any per-tool `enabled` flag —
  a hostile seed cannot enable a write, flip a policy, or replace the key.
  Local knowledge always wins on conflicts; antibody hits merge as max();
  entries about tools the receiving app does not have are skipped. Same caps
  as the runtime organs (50 antibodies, 30 circuits). 8 new tests.
- **`npx sparda-mcp doctor --app` — the negentropy scan (R3.1, Maxwell's
  demon).** Deterministic rot detection with a named repair per finding:
  schema **drift** (stale tools the code no longer has, unsynced routes the
  manifest never met, shape drift via the sparding fingerprints), **dead
  current** (enabled tools with zero calls this session — honestly scoped,
  refuses the verdict without enough observation), **sickness** (live
  quarantine, recurring failure signatures, chronic antibodies served ≥3
  times while the wound stays open), **zombie config** (port drift,
  missing/stale router file vs the manifest's localKey). High-severity
  findings fail the doctor's exit code (CI-gateable). Zero LLM, zero new
  deps, works on all three frameworks. 11 new tests incl. an integration
  where rot is injected into the Next.js fixture and the demon smells it.
- **Next.js App Router support — the third framework.** `npx sparda-mcp init`
  now detects Next.js (dep `next` + `app/` or `src/app/`), AST-parses every
  `route.{js,ts}` handler (exported verb functions and `export const VERB =`
  arrows, filesystem-derived paths: `[id]` → `:id`, route groups stripped,
  catch-all/parallel/intercepting segments skipped with reasons, query params
  via `searchParams.get()`), and performs **file-based injection**: one
  generated catch-all handler at `app/mcp/[...sparda]/route.js` — web-standard
  Request/Response, zero imports — carrying the full organ set (proof engine,
  policies, write-safety, two-phase confirm, quarantine, purity, recycling
  gauge, gossip CRDT, 64KB cap, JSON error envelope). No user file is ever
  modified; `remove` deletes the file and prunes its directory chain
  (byte-identical tree, proven by test). 14 new tests including live
  execution of the generated handler without Next installed.
- **`npx sparda-mcp report` — the readable black box.** Renders everything the
  organism remembers (`sparda.json`: proof journal, failure lessons, antibodies,
  circuits/composites, semantic memory) plus live gauges when the host is up
  (`/mcp/stats`: calls, recycling rate, purity, quarantine) as a terminal report,
  a self-contained `--html` file (`.sparda/report.html`, zero external assets,
  hostile values escaped), or `--json`. Deterministic, read-only, zero new deps.
  Honest empty states ("no antibodies yet…") instead of zeros-as-success.
  9 new tests (`tests/report.test.js`).
- **Reproducible flywheel benchmark** (`bench/flywheel-bench.mjs`, zero new deps).
  Drives the real stdio bridge to produce honest, reproducible numbers in
  `bench/results.json`: ~**+2.7ms p50** proxy overhead on the request path, and an
  armed flywheel that served **501 reads from memory with the host touched zero
  times**. Replaces the previously unsubstantiated "97%" figure. Hit-rate is
  workload-shaped (50% on a 1:1 pure/volatile mix), not a fixed magic number.
### Fixed
- **Corrupt `sparda.json` no longer crashes the bridge with a raw `SyntaxError`.**
  `src/server/stdio.js` guards the manifest parse and exits with a `USER` error
  (with a restore/re-init hint) instead.
- **Request bodies are capped at 64KB** on both generators (DoS surface). Express
  renders `express.json({ limit: '64kb' })`; the FastAPI template gains a
  symmetric streaming guard (`sparda_read_json`) returning `413 payload too large`,
  wired into the gossip, invoke, and confirm handlers.
### Tooling (dev only — not shipped in the npm package)
- **ESLint 9 flat config + Prettier** with `lint`, `lint:fix`, `format`, and
  `format:check` scripts, plus a separate optional `lint` CI job. Baseline is
  green (0 ESLint errors, all owned JS Prettier-clean). The 4 required test-matrix
  checks are unchanged. All-new dev dependencies — the 4 exact-pinned **runtime**
  deps are untouched.
- **Vitest v8 coverage** (`npm run coverage`) measuring `src/**` → `coverage/`
  (gitignored). Reporting only, no gate yet. `npm test` is unchanged
  (instrumentation activates only under `--coverage`).

## [0.5.1] - 2026-06-13
### Fixed
- `args: null` (et tout `args` non-objet) renvoie désormais un `400` JSON au lieu de crasher
  le router sur `null[name]` et de fuiter une stack trace HTML.
- Body JSON malformé sur les endpoints SPARDA renvoie un `400` JSON sans stack trace : SPARDA
  parse ses propres endpoints et capture l'erreur localement au lieu de la laisser remonter
  vers la page d'erreur HTML d'Express.
- Verbes non-POST sur `/invoke` et `/invoke/confirm` renvoient un `405` JSON `{error, allow:'POST'}`
  au lieu du HTML Express brut. Toute route non matchée sous le router renvoie un `404` JSON.
- Ajout d'une error-envelope finale : la stack reste côté serveur, corrélée aux `/events` via `errorId`.
### Added
- **Two-phase commit pour `require_human`.** Un write/delete soumis à `require_human` n'est plus
  exécuté sur `/invoke` : le router renvoie `202 awaiting_confirmation` avec un nonce single-use,
  un preview contract et un champ `instruction` lisible par le LLM. La route host n'est pas touchée.
- Endpoint `POST /invoke/confirm` : rejoue le token (usage unique, TTL `SPARDA_CONFIRM_TTL_MS`,
  défaut 120s), re-juge la décision au moment du commit (un tool quarantainé entre-temps est refusé),
  puis exécute via le même chemin que l'allow-path.
- Variable d'env `SPARDA_CONFIRM_TTL_MS` (TTL des tokens de confirmation).
### Note
- Cas limite connu : si l'app host monte un `express.json()` GLOBAL avant le router SPARDA, le body
  malformé est levé en amont du router et reste à la charge du host (monter SPARDA avant le parser
  global, ou ajouter un error-handler app-level scoping `/mcp`).
