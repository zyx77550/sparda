# 2026-06-16 — Repository Split & v0.5.3 Metadata

**Scope:** Complete repository split to open-core and update NPM package metadata with links to the public repository.
**Commits:** `b48c609`, `8faf3f7` (HQ), `9963fea` (public) · **Branch:** `main` · **Tests:** 229/229 green (10/10 router self-tests passed)

## Done
- **GEMINI.md Contract**: Committed `GEMINI.md` to private HQ [b48c609](file:///C:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/GEMINI.md).
- **Public Hardening**: Verified Actions settings require approval for fork pull request workflows, confirmed no `pull_request_target` workflows exist, added `CODEOWNERS` and strict branch protection on `main` (requires PR, Code Owner review, 4 CI matrix status checks, force-push and deletion blocked).
- **Metadata Patch & Bump (v0.5.3)**: Added repository, homepage, and bugs fields to `package.json`, bumped version to `0.5.3`. Verified tests run 100% green. Pushed to `sparda-hq` [8faf3f7] and synchronized/pushed to `sparda` [9963fea].
- **Profile README**: Updated `zyx77550/zyx77550` to list SPARDA in the active Residual Ecosystem.

## Not done / deferred
- **npm publish**: Attempted `npm publish`, but failed due to OTP requirement (`npm error code EOTP`). Bypassed to Zak (as per `GEMINI.md` operating contract).

## Decisions made
- Confirmed that parallel tests in CI are susceptible to race conditions on shared fixtures (specifically `express-demo/.sparda` created/deleted by `sparda.test.js` while `gossip.test.js` is copying it). We will need to refactor `testFixture` and `testFastAPIFixture` in `sparda.test.js` to use a isolated temp copy of the fixtures instead of mutating in place.

## Notes for the next session
- Fix the test suite fixture race condition.
- Zak needs to run `npm publish` in the private HQ repository for `sparda-mcp@0.5.3` (since it requires OTP).
