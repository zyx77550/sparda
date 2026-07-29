# 2026-07-11 — Collective immunity: Brick 1 + the world-genome vision (ADR-035)

**Scope:** Zak asked the deep question — what does SPARDA have that nobody has, that
we can 10000×? Pushed past the "safe" answer (the UBG as unique IR) to the real one:
SPARDA holds *both ends of a loop* (genotype + phenotype) and can address behavior by
content. Shipped the load-bearing brick, designed the rest, reframed the autopilot.
**Branch:** `claude/new-session-5yhx6t` · **Tests:** 438 ✓ (435 pass/3 skip) + 10/10
router self-test · ESLint 0 / Prettier clean · **Version:** 0.15.0 prepared (not published)

## Done
- **Brick 1 SHIPPED — the portable behavior fingerprint** (`src/ubg/fingerprint.js`,
  `sparda fingerprint`). A coordinate-free `behaviorHash` per entrypoint: same
  behavioral shape in different repos → same hash. **Proven in practice:** a fixture
  route and a real Prisma route both hash to `bh1_a51c7d3e…`. Deterministic +
  locale-independent (reuses `stableStringify`, now exported from schema.js;
  `indexGraph`/`reachOf` exported from apocalypse.js). `--json`; `NO FINGERPRINT`/exit 1
  on a blind compile.
- **Tests:** `tests/fingerprint.test.js` (8 — cross-repo portability, shape divergence
  on guard/op, coordinate-freedom, determinism, one-per-entrypoint); wrapper coverage in
  `command-smoke.test.js`. Full suite 438 green.
- **The vision, documented:** `docs/COLLECTIVE-IMMUNITY.md` (thesis + Bricks 1–3 + the
  conductor + honesty ledger), ADR-035, ROADMAP Round 6.
- **Autopilot reframed:** `docs/gemini/autopilot-corpus.md` — "run on every repo, always"
  becomes: scan freely (read-only, local; product = the genome corpus + a proof gallery),
  disclose rarely (curated, human-approved). Mass auto-issues explicitly rejected.
- **Version → 0.15.0** (new command); CHANGELOG, HANDOFF part 11, GEMINI release task
  updated (supersedes the unpublished 0.14.1).

## Not done / deferred (all designed, none a rewrite)
- **Brick 2** — antibody envelope re-keyed by `behaviorHash`, signed, structure-only
  (extend `seed`; only `heal --check`-proven fixes ship).
- **Brick 3** — `zyx77550/sparda-genome` git repo + pull-on-compile cache + opt-in push.
- **The conductor** — progressive-disclosure install status over existing commands.
- **The autopilot** — designed; NOT authorized to run (needs Zak's explicit go; outbound
  rules are law when it does).

## Decisions made
- **ADR-035** — collective immunity via content-addressed behavior. The moat isn't an
  organ, it's the *loop* (both ends + a deterministic address). A competitor forks the
  code; they can't fork the corpus.
- **The scan's product is knowledge, not spam.** Reframed Zak's "issues on every repo"
  into corpus-building + rare human-approved disclosure. Protects the trust brand.
- **Granularity is versioned** (`bh1`): tune with corpus data, never silently.

## Bugs hit
- Publish self-containment gate flagged `index.js` importing the new (untracked)
  `fingerprint.js` files — the guard working as designed; fixed by `git add`. (Recurring
  reminder: new runtime files must be staged before the gate passes.)

## Notes for the next session
- The fingerprint descriptor is deliberately conservative (method, pathParams, guards,
  validated, observable, effects[], writes[with invariant classes]). If corpus data shows
  it's too coarse (distinct bugs colliding) or too fine (no sharing), bump to `bh2` — do
  NOT mutate `bh1`'s shape in place (addresses must be stable).
- Brick 2's envelope already has a home: `seed.js` exports the exact knowledge shape;
  re-key its antibodies by `behaviorHash` and sign. Privacy law (structure + sanitized
  lessons only) is already enforced there — never relax it.

---

## Part 2 (same day) — the middle: ternary algebra + the 1-byte capsule (ADR-036/037)

Zak pushed twice more: "two ends isn't enough" and "a tiny thing that costs nothing and
does great things by itself" (BitNet lineage). Built the missing middle.

### Done
- **Polarity (ADR-036)** — `src/ubg/polarity.js` + `sparda polarity`. Ternary vector
  {−,·,+} per route over the 5 obligations, built inside `checkGraph` (a −1 IS a finding;
  `indexGraph`/`reachOf`/`checkGraph` now the shared source). Verdict = sign check, review
  = subtraction (`polarityDelta`), posture = column sum. `tests/polarity.test.js` (10),
  incl. a findings⇄−1 alignment test on ubg-express/semantics/lifecycle (zero drift).
- **Immunity capsule (ADR-037)** — `src/ubg/immunity.js` + `sparda immunize`. `packVector`/
  `unpackVector`: 5 trits → 1 byte (243<256), exhaustively round-trip-tested over all 243.
  `.sparda/immunity.json` = `{behaviorHash, pol(1B), exposed}` per route; the real Prisma
  app froze to **5 bytes** (`[121,121,12,121,12]`). `judge()` = pure offline lookup;
  `mergePosture()` composes app→fleet. `tests/immunity.test.js` (6).
- Docs: ADR-036 + ADR-037, blueprint "the middle" section, CHANGELOG (polarity+immunize
  under 0.15.0), HANDOFF part 12, ROADMAP.

### Notes for next session
- Axes are fixed at 5 (one per obligation). Adding an obligation adds an axis → the byte
  packing still holds up to 5 trits; a 6th axis needs 3^6=729 > 256 (2 bytes) — bump the
  capsule `v` to `imm2` if/when that happens, don't silently widen.
- The capsule is the natural payload for Brick 2's antibody envelope: attach a proven
  `heal --check` fix keyed by the same `behaviorHash`, sign it, and it's a genome record.
- Runtime enforcement (the injected router consulting the capsule at request time) is the
  obvious next "acts on its own" step — deferred: it touches all router templates, higher risk.
