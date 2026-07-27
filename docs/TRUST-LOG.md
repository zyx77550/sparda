# SPARDA Trust Log

SPARDA makes one hard promise: **it never fakes a proof.** A verdict of `PROVEN` means the
declared guards, invariants, transactions and aggregate boundaries cannot be broken by the code
SPARDA resolved — and when it can only see part of an app, it says so (`PROVEN (PARTIAL)`,
`SURFACE`), it does not round up to green.

That promise is only credible if we hold ourselves to it in public. Most tools bury their
analysis bugs. We publish ours — every time the "never fake a proof" invariant was even *at
risk*, what broke, and how it was closed. This page is that record.

> The engineering rule behind it (our soundness contract): **effects are over-approximated**
> (we never lose a real one — blindness degrades the verdict, never hides it) and **guards are
> under-approximated** (a guard is trusted only when a deny path is actually proven). Every
> imprecision therefore pushes the verdict *toward* NOT_PROVEN / more findings — never toward a
> false PROVEN. A false PROVEN is the one unforgivable bug.

## Incidents (most recent first)

### 2026-07 — a low-coverage clean app read a bare "PROVEN"
An app where SPARDA resolved almost none of its behavior could still read `PROVEN`. Technically
there was nothing to disprove — but "proved 23% of the surface" presented as `PROVEN` overclaims.
**Fixed:** a coverage floor now downgrades a clean-but-shallow app to `SURFACE`, and between the
floor and a completeness bar the verdict reads **`PROVEN (PARTIAL)`** with an explicit "the rest
is UNPROVEN, not safe" caveat. The badge, the CLI, the PR comment and the HTML report all inherit
this — none can show a bare `PROVEN` over a partially-seen app.

### 2026-07 — a helper reached transitively could fabricate a guard
While teaching the resolver to follow more calls, a function that merely *threw a 403 somewhere
downstream* (or was merely *named* like an auth check) could be counted as a guard on a route it
did not actually protect — turning a genuinely public, unguarded mutation into a false `PROVEN`.
**Fixed:** a helper reached through a call is trusted as a guard **only** when SPARDA proves it
can deny; a name is never enough, and effects contributed by a followed call never carry a guard
signal. Verified against a regression corpus that pins the guard counts.

### 2026-07 — the prompt-injection filter was bypassable
Not a proof bug, but a product-security one worth the same transparency. The docstring-poisoning
filter ran an ASCII denylist, so a Cyrillic look-alike letter ("Ignоre") or a zero-width splitter
("ig​nore") spelled a trigger word the filter couldn't see. **Fixed:** the text is normalized
(NFKC + homoglyph fold + invisible-character neutralization) before the denylist runs; six
evasion variants are now regression-tested, and legitimate non-English descriptions still pass.

## How to report

Found a case where SPARDA says `PROVEN` but a declared guard/invariant *can* be broken? That is
the bug we care about most. Open an issue at
[github.com/zyx77550/sparda](https://github.com/zyx77550/sparda/issues) with the smallest repro
you can — a false PROVEN jumps the queue.
