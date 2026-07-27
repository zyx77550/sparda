# bench/ — reproduce every number in the README

The rule (URGENT-ADOPTION-PLAYBOOK tripwire): **no number ships in the README without a script
here that reproduces it.** A skeptic must be able to check a claim in one command, or the claim
reads as vaporware.

| README claim | Reproduce | Committed evidence |
|---|---|---|
| Compiles Dub / Immich / Medusa (579 / 281 / 477 routes), zero crashes, ≈1–2s each | `node bench/repro.mjs` (clones them) or `node bench/repro.mjs --corpus <dir>` | [`route-proof.json`](./route-proof.json) |
| Proxy overhead + flywheel latency (the runtime story) | `node bench/flywheel-bench.mjs` | [`results.json`](./results.json) |
| Deterministic compile (byte-identical) · sound guards | `npm test` (see `tests/determinism.test.js`, `tests/soundness.test.js`) | the test suite |
| Zero runtime dependencies beyond 4 exact-pinned | inspect `package.json` `dependencies` (4, pinned) | `package.json` |

## The honesty line

`bench/repro.mjs` reports **routes compiled** and the **per-repo verdict** separately, on purpose:

- *Routes compiled* is a parser claim — reproducible, deterministic, the number in the README.
- *PROVEN / NOT_PROVEN* is the per-repo safety verdict. Most real apps are **NOT_PROVEN** — that
  is the honest state of a large codebase, not a bug in SPARDA. A verdict of `PROVEN (PARTIAL)`
  means SPARDA proved only the resolved slice and says so; it never claims more than it saw.

`repro.mjs` exits non-zero if any repo crashes or its route count regresses below a floor, so it
doubles as a regression gate — run it in CI to keep the headline honest over time.
