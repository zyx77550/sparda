# 2026-07-11 — Corpus bug-hunt: SPARDA on real, public OSS repos

**Goal.** Move past fixtures. Point `sparda apocalypse` / `sparda ubg` at real,
popular, public Express repositories — the code strangers actually copy — and
record what SPARDA proves, what it flags, and where it is blind. This is the
first execution of the "corpus bug-hunt flywheel" noted as the next
high-leverage, zero-budget distribution move (ADR-033, identity session).

**Branch:** `claude/new-session-5yhx6t` (restarted from `origin/main` @ `eca06a0`
after PR #12 merged) · **SPARDA:** v0.14.0 · **Method:** clone `--depth 1`, run
from inside the app dir: `node <sparda>/src/index.js apocalypse`.

**Headline.** On the **official Prisma Express example** (`prisma/prisma-examples`,
~62k★ — the canonical "how to build a REST API with Prisma" reference), SPARDA
returns **NOT PROVEN** with **2 critical `UNGUARDED_MUTATION` findings** that are
verified real in the source: two `PUT` endpoints mutate the database straight
from a URL `:id` with **no authorization or ownership guard anywhere on the
path**. On a well-maintained boilerplate (validation everywhere) it returns
**PROVEN** — SPARDA does not cry wolf.

---

## Results

| Repo | ★ | Parsed | Verdict | Detail |
|---|---|---|---|---|
| `prisma/prisma-examples` → `orm/express` | ~62k | 18 nodes / 23 edges, 5 routes, 2 SQL tables | **✗ NOT PROVEN** | 2 critical, 2 medium, 2 info |
| `hagopj13/node-express-boilerplate` | ~7k | 30 nodes / 73 edges, 8 routes | **✓ PROVEN** | 40 obligations discharged, 0 violations |
| `cornflourblue/node-mysql-registration-login-api` | ~1k | **0 nodes** (not parsed) | vacuous PROVEN — **discarded** | `rootpath` non-relative requires |
| `santiq/bulletproof-nodejs` | ~5.7k | **0 nodes** (not parsed) | vacuous PROVEN — **discarded** | TS + DI route-loader |

A "PROVEN over 0 nodes" is **vacuous** and is never presented as a proof. Logged
as a parser-coverage gap, not a pass.

---

## The headline finding (verified against source)

```
$ cd prisma-examples/orm/express && node <sparda>/src/index.js apocalypse
APOCALYPSE — deployment proof over 18 nodes, 23 edges
  ✗ [critical] UNGUARDED_MUTATION — PUT /post/:id/views mutates post with no guard anywhere on the path
  ✗ [critical] UNGUARDED_MUTATION — PUT /publish/:id     mutates post with no guard anywhere on the path
  ⚠ [medium]   UNVALIDATED_CONSTRAINED_WRITE — PUT /post/:id/views ...
  ⚠ [medium]   UNVALIDATED_CONSTRAINED_WRITE — PUT /publish/:id ...
  · [info]     AGGREGATE_MEMBER_BYPASS ×2 (post is a member of aggregate User)
✗ NOT PROVEN — 2 critical, 0 high, 2 medium, 2 info
```

Ground truth — `src/index.ts`:

```ts
app.put('/post/:id/views', async (req, res) => {
  const { id } = req.params
  const post = await prisma.post.update({          // ← mutation
    where: { id: Number(id) },                      // ← id straight from URL
    data: { viewCount: { increment: 1 } },
  })
  // ...no auth, no ownership check, no guard
})

app.put('/publish/:id', async (req, res) => {
  const { id } = req.params
  // findUnique(published) then:
  const post = await prisma.post.update({ where: { id: Number(id) }, ... })
})
```

Both handlers take `:id` directly from the URL and call `prisma.post.update()`
with **zero** authorization. Anyone can publish, unpublish, or inflate the view
count of **any** post by guessing an integer id. SPARDA's `UNGUARDED_MUTATION`
critical is technically correct.

**Honest framing (this matters).** This is an *official teaching example*,
intentionally minimal, and it ships **no auth by design** — the finding is not a
"gotcha" against Prisma. The point is the opposite and stronger: SPARDA
mechanically surfaces the exact class of risk a developer **inherits the moment
they copy this reference into a real app** — the single most common way this
bug reaches production. That is the product thesis in one command: *AI (or a
tutorial) writes; SPARDA proves.*

---

## Determinism holds on real code (E-020 regression guard)

The verdict is byte-identical across independent runs **and** across locales —
the cross-machine determinism fix (E-020, `cmp` vs `localeCompare`) is not a
fixture artifact:

```
$ node <sparda>/src/index.js apocalypse --json | sha256sum   # run 1
04571373c2c11f11f2f867105a1637726635a0a6e37fae10ca7981bf805cbf81
$ node <sparda>/src/index.js apocalypse --json | sha256sum   # run 2
04571373c2c11f11f2f867105a1637726635a0a6e37fae10ca7981bf805cbf81
$ LC_ALL=C ...            04571373...   (identical)
$ LC_ALL=en_US.UTF-8 ...  04571373...   (identical)
```

Same graph, same proof, on any machine — the property SPARDA sells.

---

## The clean control (SPARDA does not cry wolf)

`hagopj13/node-express-boilerplate` validates every input (Joi) and guards its
routes. SPARDA compiles 8 routes / 30 nodes and returns:

```
✓ PROVEN — 40 obligation(s) discharged, zero violations.
  No declared guard, invariant, transaction or aggregate boundary can be broken by this tree.
```

A tool that flags everything is noise. PROVEN-on-good + NOT-PROVEN-on-risky, from
the same engine with zero config, is the credibility pair.

---

## Parser-coverage gaps found (honest limitations → backlog)

Two real repos compiled to **0 nodes** — SPARDA could not locate their routes:

1. **`rootpath`-style non-relative requires** (`require('_middleware/validate')`,
   `app.use('/users', require('./users/users.controller'))`). The AST route
   walker resolves relative imports; the `rootpath` package rewrites the module
   root at runtime, so the static walk misses the mount.
2. **TypeScript + dependency-injected route loaders** (`bulletproof-nodejs`:
   `export default (app) => { routes(app) }`, routes wired via a loader). No
   literal `app.METHOD(...)` call site for the AST to anchor on.

Neither is a false verdict — SPARDA correctly emitted nothing rather than a wrong
proof, and the run surfaced them as "0 nodes" (a visible non-result, never a
green check). Both are legitimate parser-coverage items. See the ERRORS backlog
note added this session.

---

## What sells (for ROADMAP / go-to-market — stays in HQ)

- The reproducible artifact of value is a **one-command critical finding on a
  62k★ reference repo**, deterministic, with the exact endpoints named. That is
  a tweet, a Reddit post, and a README hero on its own.
- The **PROVEN control** is half the credibility — lead with the pair.
- Next moves: (a) widen parser coverage to `rootpath` + TS DI loaders (each one
  unlocks a whole class of real repos); (b) run the same sweep behind
  `sparda review` on a live PR to show the sticky bot comment on real code;
  (c) responsible-disclosure playbook before publishing any repo-named finding
  that is NOT an intentional teaching example.

## Reproduce

```bash
git clone --depth 1 https://github.com/prisma/prisma-examples
cd prisma-examples/orm/express
node /path/to/sparda/src/index.js apocalypse          # NOT PROVEN, 2 critical
node /path/to/sparda/src/index.js apocalypse --json | sha256sum   # 04571373...
```

---

## Follow-up (same day) — hardening: "never a vacuous proof again"

The corpus run exposed a soundness hole and two coverage gaps. Both addressed the
same day (ADR-034, C-001; tests green, 424 Vitest).

**1. The provability guard (the real fix — closes the risk class for all repos).**
A zero-entrypoint compile used to print "✓ PROVEN over 0 nodes" and exit 0.
`verdictOf` is now provability-aware (`provable = entrypoints > 0`, folded into
`safe`/`clean`); apocalypse and review print **`✗ NO PROOF` and exit 1** on a blind
compile. A parser-coverage miss can never again read as a green proof.

**2. C-001a fixed — inline-require router mounts.** `app.use('/x',
require('./x.controller'))` was dropped (only Identifier args were mounted). Now
resolved. **`cornflourblue` went 0 nodes → 7 routes, correct PROVEN** (it guards with
`authorize()` and validates with Joi — a legitimate pass, not a vacuous one).

**3. C-001b (TS DI loaders) — still backlog, but now safe.** `bulletproof-nodejs`
stays unparsed, but now yields **NO PROOF (exit 1)**, not a false PROVEN.

### Corpus verdicts, after hardening

| Repo | Before | After |
|---|---|---|
| `hagopj13/node-express-boilerplate` | ✓ PROVEN | ✓ PROVEN (unchanged) |
| `cornflourblue/node-mysql-registration-login-api` | 0 nodes → vacuous PROVEN | ✓ **PROVEN** (7 routes, 6 guards — real) |
| `santiq/bulletproof-nodejs` | 0 nodes → vacuous PROVEN | ✗ **NO PROOF**, exit 1 (honest) |
| `prisma/prisma-examples` → `orm/express` | ✗ NOT PROVEN, 2 critical | ✗ NOT PROVEN, 2 critical (unchanged) |

Regression fixtures: `tests/fixtures/ubg-inline-mount/` (C-001a parses),
`tests/fixtures/ubg-blind/` (NO PROOF). Unit + wrapper coverage in
`tests/apocalypse.test.js` and `tests/command-smoke.test.js`.
