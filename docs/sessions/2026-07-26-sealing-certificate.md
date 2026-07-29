# 2026-07-26 — The sealing certificate: C3 + seven more silent losses (ADR-080)

**Scope:** close C3 (`app.use('/path', handler)` as a terminal endpoint), then sweep every
early exit in the extractor for other silent losses, and leave behind a machine-checkable
guarantee rather than a promise.
**Branch:** `claude/sparda-hq-robustness-fy1ttv` · **Tests:** 972 ✓ · mutants 61/61 · lint/format clean · 4 deps

## Done

- **C3 / E-073.** `handlePathedUse` decides a pathed callable's role by BEHAVIOUR
  (`callsNext()` — is the third parameter referenced anywhere in the body?). Terminal →
  routes on every modelled verb; middleware → prefix-scoped credit; opaque body →
  declared `UnknownHandler`. Works at any depth, so the nested form is modelled too.
- **E-074 — dynamic write spellings.** Optional member, optional call, tagged-template raw
  SQL, and an unnameable receiver each produced NO effect. Optional chaining is modelled;
  `taggedTemplateEffect` reads the template's static parts as SQL; `handleInSubtree` finds
  a proven handle inside an unnameable receiver. All provenance-gated.
- **E-075 — `app?.post(…)` / `app.post?.(…)`.** `isCall()` / `isMember()` normalise the
  optional node types across the whole dispatch, including the Route chain walk and the
  `.apply` / `.call` / `Reflect.apply` detectors.
- **E-076 — `router.use(guard)` at depth > 0.** Now credited with the router's mount
  prefix. Shipped with its rail: `orderIn` (intra-file position) breaks the tie when two
  registrations share a mount rank, and `ubg-router-use-order` pins that the route ABOVE
  the guard still flags.
- **The last undeclared exit.** A dynamic route path on a modelled verb emitted a
  `skipped` entry but no `UnknownHandler`; it does now, at high risk.
- **The certificate — `tests/no-silent-loss.test.js`.** Sweeps the invariant over every
  Express fixture with an INDEPENDENT enumeration (own Babel walk, own app-var detection,
  own plumbing allowlist). Asserts non-vacuity (≥ 15 fixtures) and zero unknowns on the
  clean fixtures.
- **14 new killing mutants** (61 total), all verified to bite.

## Two of my own bugs, caught by my own tests

- `registerRoute` takes seven parameters; the pathed-use path called it with six, so
  `order` and the conditional flag silently fell off the end. Caught because the new C3
  test asserted the middleware still guarded its prefix — and it did not.
- `mountTargetFile` read a LOCAL function passed to `app.use('/p', fn)` as an unresolved
  router mount, losing the callable entirely. Same test, same failure.

Worth recording: both were found by an assertion about something ELSE (that the `/api`
middleware still works), not by the assertion aimed at the new feature. Tests that pin the
surroundings catch more than tests that pin the change.

## Design rules applied (and why)

1. **Known semantics are MODELLED, not declared.** Optional chaining is the same call
   whenever the object exists. Emitting an `UnknownHandler` there would trade a silent
   loss for a loud one — the blind-spot channel is for genuine uncertainty, not for work
   not done.
2. **Uncertainty is DECLARED** — opaque body at a path, dynamic path, computed member,
   lost file: `UnknownHandler` + high-risk blind spot, which bars PROVEN.
3. **Recall on a GUARD ships with a rail.** Making `router.use(auth)` visible is a
   false-positive fix, but crediting a guard is the dangerous direction. A fix that
   manufactures a PROVEN is worse than the bug it removes.

## Not done / deferred

- **`parser/express.js` and `openapi.js`** still exclude `all` and the optional forms.
  They feed MCP tool generation and spec ingestion, not the proof verdict. Changing the
  generated tool surface is a user-visible decision, deliberately separate.
- **Python (`fastapi_extract.py`)** has none of this: no conditional marking, no order
  stamps, no registration invariant. The Flask/FastAPI side is the obvious next sweep, and
  the same three rules port directly.
- **Non-Express frameworks** (Nest, Next, Medusa, Strapi) were not swept. The invariant is
  currently an Express property; generalising it means giving each extractor an
  `unknownHandlers` channel.

## Notes for the next session

- The certificate's PLUMBING list is an intentional SECOND copy of `NON_ROUTE_METHODS`.
  If the extractor's list grows, the sweep flags the newly-silenced member — that friction
  is the point. Widen both, deliberately, or not at all.
- `callsNext` treats a continuation captured by an inner closure as "referenced", which
  keeps the callable classified as middleware. That is the conservative direction: it
  declines to invent endpoints rather than inventing them.
- The red-team corpus (29 attacks) lives in the scratch sandbox, not the repo; its
  distilled permanent form is the nine `tests/fixtures/ubg-*` fixtures added across
  bricks #26 and #27.
