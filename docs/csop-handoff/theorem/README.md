# Theorem layer — incremental conditional certificates

Extends the frozen CSOP (`../algorithm/`). Copy `../algorithm/{csop,types}.ts` into `src/` next
to `incremental.ts`, then `npm test`.

**Verified:** regression 20/20 (base intact) · differential composeSystem==oracle (5000 random) ·
metamorphic incremental==full with ZERO false-safe (20000 random edits stress) · monotonicity ·
determinism. See `PROOF-SKETCH.md`.
