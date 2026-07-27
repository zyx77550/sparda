# 2026-07-12 — Deep repo audit + fixes (post-0.15.0)

**Scope:** Zak asked for a thorough audit of the whole repo, to dogfood SPARDA on our
own surfaces, fix every bug intelligently, and document. Done. Two real bugs found and
fixed, both with regression tests; suite green throughout.

## Method
- Baseline: `npm test` (was red — see below), ESLint, Prettier, dep count (4, pinned),
  engine floor (Node ≥18). All green after fixes.
- **Dogfood sweep:** ran every proof/compile command (`ubg`, `apocalypse`, `polarity`,
  `fingerprint`, `immunize`, `verify`) across all fixtures + `demo-app`. `verify` proves
  the compiler's own laws 6/6 on every app. The whole command surface is robust; the
  `ubg-openapi` fixture correctly errors on a bare `ubg` (needs `--openapi`), not a bug.
- Read the determinism-sensitive sort sites across `src/**`.

## Bug 1 — E-023 (HIGH): `sparda immunize` crashed on a fresh checkout
- `runImmunize` wrote `.sparda/immunity.json` via `atomicWrite` **without creating
  `.sparda/` first** → `ENOENT` on the temp file, exit 2. It only worked if a prior
  command had already made the dir. New in 0.15.0.
- **Caught by a smoke test Gemini added** (the test was correct; my code was wrong — this
  is exactly what the audit is for). Also: Gemini had committed that failing test to
  `main`, so main was red on arrival — fixing the code turned it green.
- **Fix:** `fs.mkdirSync(dirname, { recursive: true })` before the write. Verified
  standalone on a virgin `demo-app`. Audited every other `atomicWrite` caller — all
  create their dir first; the miss was isolated to `immunize`.

## Bug 2 — E-024 (ORANGE): derived artifacts not byte-identical across locales
- E-020 fixed the *graph's* determinism, but the derived emitters still sorted with
  `localeCompare`: apocalypse findings + per-entrypoint order (→ `polarity`/`immunize`/
  `review` outputs), the OpenAPI spec, the mirror dump, the `ubg` report. `localeCompare`
  collation is host-locale-dependent; for mixed-case / punctuation routes it diverges
  from code units, so a machine in another locale emits **different bytes** — breaking the
  core "byte-identical everywhere" promise. Proven: `/Users /_debug /admin /users` sort
  differently under `cmp` vs `localeCompare('en-US')`. Slipped past because fixtures use
  only lowercase routes.
- **Fix:** every output-reaching `localeCompare` → the exported `cmp` (code units) in
  `apocalypse.js`, `openapi-emit.js`, `mirror.js`, `commands/ubg.js`. Regression:
  `tests/determinism.test.js` (routes chosen so the two orders diverge; asserts output
  follows `cmp`, not `localeCompare`).
- **Follow-up logged (not a bug today):** graph-*building* sorts (`ubg/express`, `nextjs`,
  `sql`, `prisma`, `link`, `reach`, `passes/*`) still use `localeCompare`, but they feed
  `canonicalizeGraph` which re-sorts by `cmp`, so they don't change `ubg.json` bytes.
  Convert for defense-in-depth if any ever assigns order-dependent ids.

## Result
- Both fixed with tests. **465 Vitest (462 pass / 3 skip)**, ESLint 0, Prettier clean,
  10/10 router self-test. `main` green.
- Detail: `docs/ERRORS.md` E-023, E-024.

## Big-picture items recorded (from Gemini's stress tests — NOT built here)
- **Dub.co scaled** (Gemini): ~4200 files / 559 Next.js routes compiled in ~4s, 2048
  nodes / 3228 edges, 145 critical + 4 high findings. The engine scales to an industrial
  monster. (Report lives on Gemini's local machine, not in this repo.)
- **Medusa hit a wall:** dependency-injection (Awilix/Inversify) + dynamic route loaders
  defeat `detect.js` → 0 routes. This is the same class as C-001b. The universal-parser
  vision (IoC-aware detection, inter-file taint/symbolic execution) is the next frontier —
  tracked in ROADMAP, a multi-session build, not faked in one pass.
- **Agentic-immunity demo (Gemini, V1 with Groq/Llama):** blind AI transferred money
  through an unguarded route; the same AI given SPARDA's proof **refused** the dangerous
  action. First evidence of the closed loop — worth hardening into the flagship demo.
