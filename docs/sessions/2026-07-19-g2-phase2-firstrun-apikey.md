# 2026-07-19 — G2 phase 2: first-run + API-key families through the call graph

**Scope:** close the first-run/admin-setup and API-key false-positive families "de manière
à ne plus jamais avoir ce piège" — the two families G2 phase 1 could not reach.
**Commits:** `278eec5` · **Branch:** `claude/current-task-u45a4d` · **Tests:** 681 Vitest green (+3), mutation 13/13 (+2), ESLint/Prettier clean

## Done
- **Root cause (measured, not guessed):** both families' refusal lives ONE CALL AWAY from the
  entrypoint — a Nest `this.service.x()` method, an imported validator, or a thin delegator that
  gets coalesced. G2 phase 1 only read credential signals off the direct middleware chain, so the
  signal never arrived. Three separate places were dropping it; all three are now plugged, all
  advisory-only (downgrade critical→advisory, never prove, never silence):
  - `resolve.js mergeScan` — was merging `effects` + `guardSignals` but silently dropping
    `credentialSignals` and G1 `ownerAsserted`. This is why immich admin-sign-up / start-restore
    (throw in a delegated service) read as false criticals. Now merged up.
  - `translate.js attachBody` — tag each expanded body node with its own refusal signal
    (`bodyDenies`/`bodyVerifies`/`bodyRedirects`) so a route that reaches it through the call graph
    sees the mechanism.
  - `passes/state-minimization.js mergeNodes` — a thin delegator (`handler → createFirstAdmin()`)
    is coalesced; it was carrying `returnShapes` but dropping the advisory body signals. Now carried.
- **Named-refusal detector (`extract.js`):** recognize the dominant Next.js/App-Router deny idiom —
  `responses.notAuthenticatedResponse()`, `forbidden()`, `badRequest()`, `tooManyRequests()`… —
  which `statusIn4xx` and the bare-`throw` check both miss. Advisory-only, family-gated.
- **`apocalypse.js` O1:** read credential signals from the reached set (not just `ep.meta`);
  broaden the stored-credential family to API keys / access tokens / PATs; add a **first-run
  family** bounded to bootstrap-shaped PATHS (setup/install/onboard/restore/admin-sign-up) that
  STILL requires a real refusal shape (`credGates`) to downgrade.
- **Field test, 13 real apps:** immich 5→1 critical, formbricks 1→0, total 9→4. Every downgrade
  MANUALLY verified genuinely gated: immich start-restore + admin-sign-up both throw
  `'the server already has an admin'` (real first-run gate); formbricks /management/me gated by an
  API-key validator; dub notification-preferences gated by `verifyUnsubscribeToken`.
- **Tests:** 3 new cases + fixture routes (API-key via call graph, first-run via delegated throw,
  and the soundness negative: a bootstrap path with NO refusal STAYS critical). 2 new mutation
  guards (named-refusal detector; the merge-node signal carry) — both bite.

## Not done / deferred
- **immich `POST /auth/login` stays critical.** It's a THIRD family (password-login: `compareBcrypt`
  + throw), not one of the two Zak named. Deliberately NOT chased — extending to a password-verify
  family would downgrade every login mutation and is scope creep. Left as one honest survivor.
- dub `/api/track/application`, papermark `(codebase-wide)`, rallly `/api/updates` — the other
  survivors; not first-run/API-key, left as-is.

## Decisions made
- **Advisory-only propagation through reachability is sound; effect ATTRIBUTION through reachability
  was not.** This is the key distinction from the reverted "option A" (imported-helper CFG wiring,
  which over-attributed effects → NON_ATOMIC fired 580/580). Here we only READ a refusal signal off
  bodies already reached, and it can only downgrade — it cannot fabricate a guard or a false PROVEN.
- First-run family is bounded to bootstrap-shaped PATHS **and** still requires a real refusal, so a
  generic "user not found → throw" on an ordinary route can never trip it.

## Bugs hit
- `mergeScan` dropping `credentialSignals` was the single highest-leverage miss — one line of
  omission that blinded the whole Nest/DI call graph to refusals. Worth an ERRORS.md note.

## Notes for the next session
- The measurement corpus (13 cloned giants) lives in the session scratchpad, not the repo. Harness:
  `scratchpad/g2-measure.mjs`, `g2-advisories.mjs`, `g2-probe.mjs`.
- 0.65.0 is still pending merge/publish (Gemini + Zak) — this G2 phase 2 lands ON TOP of it. Decide
  whether to fold into 0.65.0 or cut 0.66.0 before publishing.

> HANDOFF updated in the same commit set.
