# 2026-07-27 — Twenty's 28 high findings, triaged (ADR-086)

**Scope:** attack the 28 high findings ADR-085 surfaced on twenty. Determine which are
real before touching anything.
**Branch:** `claude/twenty-high-triage`
**Tests:** 1128 ✓ (+9) · mutants 95/95 (+3) · ESLint 0 · Prettier clean · 4 deps

## The triage, before any code

28 high findings — but **14 distinct routes**, and one route carried **12**:

```
12×  POST /graphql/sendEmail
       sendmessage, messageoutboundservice.sendmessage,
       gmailmessageoutboundservice.sendmessage,
       microsoftmessageoutboundservice.sendmessage,
       imapsmtpmessageoutboundservice.sendmessage,
       emailgroupmessageoutboundservice.sendmessage,
       emailingdomainsenderservice.sendemail, sendmail ×2, sendmessage ×2, sendemail
 2×  POST /graphql/checkoutSession        2×  POST /webhooks/stripe
 2×  POST /graphql/sendEmailViaEmailingDomain
 1×  … ten more, one each
```

Two families: **Stripe billing** (15) and **outbound messaging** (13). And the messaging
cluster is obviously ONE logical send resolved through a provider-strategy DI graph, with
each leaf — and each resolution depth — counted separately.

**43 % of twenty's high findings were a single problem counted twelve times.**

## What was fixed (E-094)

One finding per (route, rule) for `IRREVERSIBLE_OBSERVABLE`. `collapseFloods` (ADR-071)
already encodes "a signal that repeats loses contrast", but it folds a rule firing across
MANY ROUTES; it has no notion of the same rule firing many times on ONE route, which is
what a DI fan-out produces.

The unit of a finding is the unit of its **remediation**: fixing this rule means wrapping
the send and the write together, or adding an undo — a per-route change. Reporting per leaf
described the analyser's internal resolution depth, not the user's problem.

| | before | after |
|---|---|---|
| twenty high findings | 28 | **14** |
| twenty routes flagged | 14 | **14 — identical set** |
| nocodb findings | 22 | 13 |

**The identical route set is the whole argument.** This is a contrast fix, not a
suppression: same routes, same severity, same gate, every call named in the message and
every node kept in `evidence`.

## What was NOT fixed, and will not be

The 14 remaining high findings are **real**. Each is a route that makes an irreversible
external call — a Stripe charge, an email send — while mutating state, with no compensation
path. That is a genuine saga-hole family in twenty's billing and messaging code, and
`POST /graphql/deleteCurrentWorkspace` is the sharpest of them.

twenty still reads NOT_PROVEN. Honest counting made the report readable; it did not make
the app safe, and it was never supposed to. Getting twenty to PROVEN is now twenty's
work, not SPARDA's — which is the correct end state for a trust layer.

## E-095 — the merge that only half happened

PR #30 carried two commits; the merge landed only the first. `80591a9` (ADR-085) stayed on
the branch, and `main` still read twenty at 147 routes. GitHub had merged a PR head it had
not refreshed after the push.

Caught by **re-measuring after the merge instead of trusting it** —
`git merge-base --is-ancestor 80591a9 origin/main` → no. Cherry-picked, re-verified, merged
as PR #31.

The habit worth keeping: a "merged" report is a claim like any other. After any merge,
check that the commit you care about is an ancestor of the branch you merged into. One
command.

## Not done / next

- **The 14 are twenty's to fix.** If a future rule wants to soften a webhook's finding, it
  must PROVE the compensation — a 5xx on the failure path, an idempotency key on the call —
  not infer it from the shape (the refusal recorded in ADR-085 stands).
- twenty's other blocker is unchanged: **139 high blind spots, 77 % coverage.** Even at
  zero findings it reads PARTIAL, not PROVEN.
- `@Acl()`-shaped decorators (E-091) — effects applied by direct invocation inside an
  inline arrow — remain unread and declared.
