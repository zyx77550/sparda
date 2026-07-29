# 2026-07-27 — Twenty : the brief was wrong, and measuring first is why we know (ADR-085)

**Scope:** the "one rule, 14× IRREVERSIBLE_OBSERVABLE" lock on twenty.
**Branch:** `claude/nest-composite-decorators` (continues ADR-084)
**Tests:** 1119 ✓ (+8) · mutants 92/92 (+4) · ESLint 0 · Prettier clean · 4 deps

## The brief, and what the measurement said instead

The mission was to clear one rule and finally get a clean verdict on twenty. Before
touching the rule, two numbers:

| | before | after |
|---|---|---|
| files parsed (of 6090) | **33** | 128 |
| routes | **147** | **579** |
| guards / verified | 441 / 157 | 1868 / 583 |
| findings (high) | 14 (2) | **65 (28)** |
| coverage | 81.6 % | 77 % |

**SPARDA was reading a quarter of the application.** "One rule stands between twenty and a
clean verdict" was an artefact of near-total blindness. And the honest outcome of fixing it
is that twenty gets **worse** — 2 high findings become 28 — which is the correct outcome,
because the 26 new ones are real.

Also worth stating plainly: even with zero findings, twenty would read **PARTIAL**, not
PROVEN — 139 high blind spots and 77 % coverage. A "perfect verdict" was never one rule away.

## The two causes, both the same defect

**E-092 — the pre-filter matched a VOCABULARY.** `CANDIDATE_RE` listed decorator names.
twenty registers **54** GraphQL resolvers as `@MetadataResolver` / `@CoreResolver` /
`@AdminResolver` and exactly **one** as `@Resolver`. A house brand is the norm, not the
exception. Nothing complained because **a file that is never opened produces no route, no
skip and no unknown handler** — Direction 3's exact failure shape.

**E-093 — `@Post(['a','b'])` collapsed onto `POST /`.** Reading `args[0]`, finding an
`ArrayExpression`, judging it "not a literal" and falling back to the controller prefix.
Four of twenty's webhook controllers landed on one phantom route — including the two `high`
findings that held its verdict, reported against a URL the app does not serve.

Both are ADR-055's rule ("recognise the protocol, not the brand") never having reached the
pre-filter. The fix is a suffix match, which `controllerPrefixOf` had been doing all along.

## What it found

`POST /graphql/deleteCurrentWorkspace` — a **real saga hole**. It cancels the customer's
Stripe subscription (irreversible, outside any transaction) and then soft-deletes the
workspace. If the write fails, the customer has no subscription and a live workspace. It
sat in `workspace.resolver.ts` under `@MetadataResolver`, in a file SPARDA had never opened.

The draft that opened this chantier predicted exactly this, and the measurement confirms it.

## What I refused to implement, and why

The same draft proposed suppressing the webhook findings: a signature-verifying webhook
driven by an external orchestrator is *self-compensating* — Stripe gets a 500 and retries,
`subscriptions.cancel` is idempotent, so a failed write is recovered.

**Sound as an argument, inadmissible as a rule.** It rests on three premises SPARDA cannot
verify from the code: that the orchestrator retries, that this handler surfaces a write
failure as a 5xx instead of swallowing it, and that the external call is idempotent.
Crediting compensation SPARDA has not seen is inventing protection — Direction 2, in the
forbidden direction — and it is the same "trust the convention" epistemology ADR-084 had
just removed one layer down.

The parsing fix was the correct handling: the findings did not disappear, they moved to the
routes that actually serve them (`POST /webhooks/stripe`, not `POST /`). Whether a webhook's
retry path is compensation is a question for a future rule that PROVES its premises — a 5xx
on the failure path, an idempotency key on the call — not a name-based exemption.

## The trap inside the fix

The obvious array implementation is `elements.find(isStringLiteral)` — read one path, drop
the rest. That loses a live endpoint **in silence**: ADR-079 violated by the change written
to honour it. One route per element, and a mixed array routes its readable elements while
DECLARING the unreadable one at high risk.

## Corpus, decomposed

`_pinned` (E-088) earned its keep a second time. twenty's clone is `590ae069`, the baseline
was pinned at `e631c986`, so its drift is **mixed**:

- pin move alone → `coverage 81.6 → 81.4` (measured on this clone BEFORE the change)
- this change → everything else: routes 147 → 579, guards 441 → 1868, coverage 81.4 → 77

Re-pinned and re-baselined, so the move is visible in the artefact rather than left
drifting. **nocodb** sits AT its pin and gains too: routes 358 → 566, coverage 40.3 → 47.7.
novu, immich and ghostfolio are untouched.

## Not done / next

- **Neither twenty nor nocodb is close to PROVEN**, and it is no longer a parsing problem:
  twenty has 28 high findings and 139 high blind spots. The next question is whether those
  28 are real, one family at a time.
- The webhook-compensation rule, if it is ever built, must prove its premises.
- `@Acl()`-shaped decorators (E-091, nocodb) — effects applied by direct invocation inside
  an inline arrow — are still unread, and still declared rather than trusted.
