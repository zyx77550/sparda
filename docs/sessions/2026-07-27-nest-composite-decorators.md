# 2026-07-27 — `applyDecorators` : a decorator is what it does (ADR-084)

**Scope:** the first infiltration of a giant. Find why real enterprise Nest code cannot be
proven, and read the idiom it actually uses.
**Branch:** `claude/nest-composite-decorators` (rebased onto `main` after PR #29 merged)
**Tests:** 1111 ✓ (+12 sur la base #29) · mutants 88/88 (+5) · ESLint 0 · Prettier clean · 4 deps

## How the target was chosen

Not by intuition — by grading the REASONS behind the seven verdicts instead of the verdicts
themselves:

| app | verdict | coverage | guards verified | what actually blocks it |
|---|---|---|---|---|
| dub | NOT_PROVEN | 97.9 % | **516/516** | 127 real findings — extraction is excellent |
| immich | PARTIAL | 55.9 % | **459/459** | app is CLEAN; only coverage holds it |
| **novu** | PARTIAL | 14.8 % | **71/1003** | ← extraction collapses |
| nocodb | PREMISE_GAP | 40.4 % | 9/899 | same, plus E-087 |
| twenty | NOT_PROVEN | 81.6 % | 157/441 | one rule, 14× IRREVERSIBLE_OBSERVABLE |
| cal.com | NOT_PROVEN | 93.6 % | 252/436 | 16 findings |
| ghostfolio | RISKY | 76 % | 98/193 | no critical/high |

**"0 PROVEN" was the wrong frame.** `PARTIAL` is `clean && partial` — the app IS clean, with
a coverage caveat. And on dub, SPARDA reads 97.9 % of the code with 100 % of guards proven:
if dub is NOT_PROVEN, dub probably has holes, and making it green would be sacrificing the
product. The real question is per-app: **is this verdict earned by findings, or by
blindness?** Only novu and nocodb answer "blindness", and they answer it the same way.

## The diagnosis

novu's 932 unverified guards are **four decorator names** (340 + 316 + 221 + 55 = 932;
1003 − 932 = 71 = exactly the verified ones). The largest is NestJS's official composition
API, and the A/B against immich named the cause in one line: immich registers its guard
**globally** (already handled), novu applies it **per controller** through a composite.

`CommunityUserAuthGuard` extends `@nestjs/passport`'s `AuthGuard` and throws
`UnauthorizedException`. The proof existed end to end. SPARDA could not walk the first link,
because `guardScan` opens a CLASS and the symbol is a FUNCTION — so it fell back to the
name, which is precisely the epistemology this product exists to replace.

## Done

- **Composite resolution.** A decorator name resolves to its declaration;
  `applyDecorators(UseGuards(X))` yields X, and the existing class resolution proves X.
- **Branch semantics.** Union of guards over every branch; a branch whose returned decorator
  cannot be read is DECLARED at **high** risk. Both halves are true at once: novu's 340
  guards are credited (a true statement about the configuration read) AND novu cannot reach
  PROVEN on their strength (a sibling configuration went unopened).
- **`SetMetadata` stops counting as a guard** — but only where no global guard is proven to
  read it. 221 fake guards removed from novu.
- Fixture `ubg-nest-composite-guard` (three shapes: plain composite, conditional with an
  unreadable branch, metadata-only, and the metadata one reached THROUGH A BARREL) + 10
  tests + 5 killing mutants.

## Two of my own nets caught me

- The barrel mutant **survived** the first run: the fixture imported the metadata decorator
  directly, so the `starReexports` path was never exercised. Strengthened the corpus (moved
  it behind `export * from './permissions.decorator'`) rather than weakening the mutant —
  after which it kills.
- `premise-convention.test.js`'s "every fixture file is tracked by git" assertion, written
  two sessions ago for an unrelated `.gitignore` bug, went red on the new fixture files
  before they were committed. Both nets did exactly the job they were built for.

## Measured, isolated

Same clone, same commit, extractor swapped:

| | guards | verified | routes | coverage | findings |
|---|---|---|---|---|---|
| novu before | 1003 | **71** (7 %) | 451 | 14.8 % | 25 |
| novu after | 782 | **411** (53 %) | 451 | 14.8 % | 25 |
| immich before/after | 459 | 459 | 281 | 55.9 % | 7 |

Routes, coverage and findings are untouched: this change moves what SPARDA can PROVE about
protection, nothing else. immich byte-identical is the non-regression witness.

## The near-miss worth remembering

A blanket "SetMetadata is not a guard" **deletes immich's entire auth model** —
`@Authenticated = () => applyDecorators(SetMetadata('authRoute', true))` is the tag that
opts a route into the app-wide guard. 253 verified guards vanish, 253 unguarded routes are
invented. It was caught by `tests/nest-global-guard.test.js` going red — a test written two
sessions earlier for a different feature. That is the argument for keeping end-to-end
fixtures after their ADR ships.

A second one in the same function: `sawGuardSource` was set on any `applyDecorators` call
rather than on finding a `UseGuards` inside it, so a metadata-only composite resolved to
"no guards AND not metadata" and vanished from the chain entirely. A composite that resolves
to nothing now keeps its asserted reading — **resolution may add understanding, never delete
a gate.**

## Not done / next

- **novu's real blocker is now coverage: 14.8 %.** Guards are half-solved; the other half is
  that 85 % of its behaviour is unresolved. That is the next chantier and it is a different
  one (DI depth, workspace packages, unbuilt `dist` entry points).
- **The other two names, 371 steps:** `UserSession` / `SubscriberSession` are
  `createParamDecorator` principal injection — ASSERTED by design (ADR-063), correctly so:
  reading the principal proves a route CONSUMES auth, never that it DENIES.
- The corpus snapshot is **not** re-baselined here; that artefact belongs to PR #29. Once
  both land, one re-run settles both sets of numbers together.
- twenty is the cheapest remaining target: a single rule (14× IRREVERSIBLE_OBSERVABLE)
  stands between it and a clean verdict.
