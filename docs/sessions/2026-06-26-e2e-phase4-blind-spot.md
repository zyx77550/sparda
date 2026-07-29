# 2026-06-26 — Close the E2E blind spot with a real-client phase4 run

**Scope:** Prove end-to-end, with a real MCP client, the post-0.3.0 organs that the
unit tests can't prove (recycling flywheel, circuit crystallization, write-safety on
the wire, `remove` clean-diff). Not run end-to-end since 2026-06-11 — the biggest
blind spot. Automate it so it's re-runnable in one command instead of a manual desk drill.
**Commits:** committed alongside this note · **Branch:** `main` (`sparda-hq`) ·
**Tests:** 230/230 Vitest + 10/10 router self-test + **7/7 E2E phase4** green.

## Done
- **Wrote `tests/e2e/phase4.mjs`** — a fixture-based real MCP client (reuses
  `tests/e2e/harness.mjs`) targeting `tests/fixtures/express-demo`. The old
  `phase1-3` scripts are pinned to the deleted `sparda-demo-app` (routes
  `products`/`flaky`) and fail as-is; phase4 replaces them for the post-0.3.0 organs.
  **Ran 7/7 ALL PASS** (JSON verdict, exit 0):
  - **4.1 protocol** — `get_health/get_api_prospects/get_api_users_by_id` + the 4
    meta-tools listed; `post_api_users`/`delete_api_prospects_by_id` **hidden**
    (write-safety, rule #3); `GET /v2/meta` (dynamic template literal) **skipped**.
  - **4.1 annotations** — `get_api_prospects` → `readOnlyHint:true, idempotentHint:true`.
  - **4.2 live read** — `get_api_prospects` returns host data `count:3`, `isError:false`.
  - **4.3 flywheel** — after ≥3 identical reads, `recycling.flywheel.armed≥1`
    (served-from-memory), `runtime.purity`: prospects=**pure**, health=**unknown/volatile**.
  - **4.4 crystallization** — prospects→users(`{id:2}`, a **number**) observed ×3 →
    composite `circuit_get_api_prospects_then_get_api_users_by_id` appears
    (`[Labs circuit …]`, GET-only) and **runs the whole chain live**.
  - **4.x stdout discipline** — 0 non-JSON lines leaked on the bridge stdout (rule #2).
- **`remove` clean-diff re-proven** — after the run, `git status` clean + `git diff`
  empty: byte-for-byte return to the baseline commit (promise #1, rule #4).
- **Wrote `docs/E2E-RUNBOOK.md`** — the manual real-client protocol (Claude Desktop),
  §0→§7, each step with a bolded gate. Validated every claim against a real `init`
  (tool names, `/v2/meta` skip, port 3456, write-disabled). Appendix points at phase4
  as the one-command shortcut for §2→§4.
- **Updated `docs/HANDOFF.md`** — next-step #1 rewritten from "biggest blind spot,
  not run since 2026-06-11" to "largely DONE 2026-06-26, 7/7"; branch-state line now
  carries the phase4 result.

## Not done / deferred
- **§5 write opt-in via *native* elicitation** through a real client (Claude Desktop
  accept/decline UI) is the only step not scripted — phase4 can't drive a human-facing
  elicitation. Low risk: covered by the 10/10 router self-test (confirm-token two-phase)
  and the archived `debrief_phase3.md`. Revive a manual drill only if a regression is
  suspected.
- **`phase1-3` not resurrected** — they'd need the old bespoke app rebuilt to test
  quarantine/antibody/cooldown, which the 230 unit tests already cover. Left as-is.

## Decisions made
- **New phase4 over patching phase1-3.** The old scripts assume a deleted app; rather
  than reconstruct it, a fresh fixture-based script is lower-friction and matches the
  organs that actually shipped since 0.3.0. The bespoke-app regression stays the unit
  tests' job.
- **The crystallization recipe MUST use a numeric id.** `condenser.candidateValue`
  rejects single-char strings (length<2) but always retains numbers under an `id` key
  (String-coerced). `get_api_users_by_id { id: 2 }` — a number, not `"2"` — is the only
  combination that reliably crystallizes. Documented in both the script and the runbook.

## Bugs hit
- **SIGPIPE killed `init` during setup.** Piping the clack-UI `init` through
  `| grep | head` closed the pipe early and aborted init before "Wrote sparda.json";
  `|| true` masked it. Fix: run init without a downstream pipe. (Lesson: don't pipe
  interactive-UI commands through `head`.)
- **Node `-e` misreads `/c/...` paths on Windows** (resolves to `C:\c\...`). Fix: `cd`
  into the dir + relative `require('./sparda.json')`.
- **Scratch dir `rm` raced a lingering node handle** (`Device or resource busy`);
  succeeded on retry once the host/bridge processes had exited.

## Notes for the next session
- Re-run the full E2E anytime: prep a copy of `express-demo` (express + `init` +
  `labs.recordSequences:true`), then `SPARDA_E2E_APP=<dir> node tests/e2e/phase4.mjs`
  → JSON verdict, exit 0 if green. See `docs/E2E-RUNBOOK.md` appendix.
- These files are HQ-only artifacts; they don't need allowlisting for public unless we
  decide to ship the runbook as docs. No public write was done.

> Remember: `docs/HANDOFF.md` rewritten before committing this file.
