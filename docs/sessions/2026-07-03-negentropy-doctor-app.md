# Session 2026-07-03 (b) — negentropy: `doctor --app` (R3.1)

**Agent:** Claude (Fable 5) · **Roadmap slot:** adoption item ④ (owner GO).

## Why this organ matters for adoption

Until now SPARDA only had value if you use an MCP client. The negentropy scan
gives value to ANY Express/FastAPI/Next dev: a deterministic answer to "what
is rotting in my API surface" — dead routes, drift between code and manifest,
chronic failures. It widens the funnel beyond AI users, exactly as the
ROADMAP's R3.1 promised ("déterministe, constructible tôt").

## What shipped

`npx sparda-mcp doctor --app` — `src/commands/negentropy.js` (pure core +
renderer) wired into `doctor.js`, `--app` flag in the CLI.

Four rot families, every finding carrying `{kind, severity, title, detail, fix}`:
- **drift** — stale tools (manifest ⊃ code, HIGH → fails doctor), unsynced
  routes (code ⊃ manifest), shape drift via `sparding.toolFingerprints`
  (shared `fingerprintFor()` now exported — same sha256/8 the generators
  stamp). Re-parse failure → "drift not measurable", never a guess.
- **dead** — enabled tools at zero calls while others carry traffic; refuses
  the verdict under 60s uptime or zero total calls; detail says "this session
  only, not a lifetime verdict" (RAM gauges are session-scoped, stated).
  Disabled writes are never called dead — they are gated, not dead.
- **sick** — live quarantine (HIGH), recurring failure signatures (≥3, with
  the lesson on file; write_disabled gets its specific advice), chronic
  antibodies (≥3 hits: "the memory works, the wound stays open").
- **zombie** — port drift manifest vs detect (HIGH), router file missing
  (HIGH), router present but carrying another init's localKey (HIGH).

Doctor integration: negentropy runs after the base checks, reuses the live
`/mcp/stats` the doctor already fetched, lazily imports the right parser per
framework, and high-severity findings flip `healthy` → non-zero exit
(CI-gateable, same contract as the rest of doctor, E-012).

## State

Suite **266/266** (was 255, +11) · ESLint 0 · Prettier clean · zero new
runtime dep · zero LLM on any path.

## Next

1. Valve → public PR.
2. Roadmap ⑤: `sparda seed export/import` (R4.5 lite, community genomes).
3. Owner: 0.6.x/0.7.0 publish when he wants `report`-era organs on npm
   (report shipped in 0.6.0 already; negentropy is unreleased).
