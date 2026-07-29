# 2026-06-11 — v0.2 merge, vision rounds, v0.3 immune system, the bible

**Scope:** merge the v0.2 trust layer; finish the design discussion started
in a previous (crashed) session; build ROADMAP round 1; structure the docs;
(afternoon) fix Windows CI, FastAPI runtime test + critical E-009 fix,
doctor v0.3, pain-first pitch, competitor scan.
**Commits:** `4409524` (v0.2 merge) → `ee3f49b` (competition scan).
**Branch:** `claude/quick-checkin-d6vpyh` · **Tests:** 26/26 green · CI green
(confirmed by owner — session's GitHub MCP auth expired mid-day).

## Done
- Fast-forwarded `main` to v0.2 (`claude/discussion-38d0rv`, 8 commits).
- Design: completed the "create what doesn't exist from what exists" rounds —
  round 2 (condensateur d'outils) and round 3 (organisme prédictif, 5 laws,
  free-energy principle as master rule). Captured in `ROADMAP.md`.
- Business model consolidated: Free / Shadow stable / Shadow Labs (opt-in
  beta checkboxes + visible resource gauges), maturity pipeline (ADR-012).
- **v0.3 immune system** (round 1 complete): latency baseline + antigen
  events and quarantine/half-open in *both* router templates; adaptive
  antibodies via sampling (sanitized, capped 50, persisted, carry-over);
  `sparda_get_context`; honest `isError`. Versions bumped to 0.3.0.
- Tests added: quarantine/half-open/anomaly runtime, immune carry-over,
  antibody-diagnosis notification, get_context assertions, FastAPI router
  `ast.parse` syntax check.
- The bible: `CLAUDE.md` + `docs/` (README, ARCHITECTURE, DECISIONS×12,
  ERRORS×9, SECURITY, TESTING, HANDOFF, sessions protocol).
- Afternoon: ROADMAP round 4 (le Noyau); pain-first README pitch + tested
  promise section; EXPLAINER.md + SPARDA-EXPLIQUE.md (fr); **FastAPI
  runtime test (real uvicorn) which caught E-009 on its first run — the
  generated FastAPI router had never been importable** (JSON literals in
  Python source; fixed via json.loads); doctor v0.3 (semantic/immune/
  quarantine state); COMPETITION.md (mcp-anything scan: adopt CRUD
  grouping, living SKILL.md, /.well-known/mcp; don't chase breadth).

## Not done / deferred
- Real-client (Claude Desktop) E2E validation — top gap, see HANDOFF.
- FastAPI uvicorn runtime test; `doctor` not v0.3-aware; npm publish.
- Rounds 2–3 implementation (designed only).

## Decisions made
- ADR-009 (immune thresholds), ADR-010 (antibody bounds/sanitization),
  ADR-012 (tiering) — recorded in DECISIONS.md.
- Docs in English; ROADMAP stays French (founder's voice).

## Bugs hit
- E-005 (get_context shifted the mock host's poll sequence → swallowed
  live event) and E-006 (undefined `upstreamStatus` → false `isError`) —
  recorded in ERRORS.md.
- CI follow-up (same day): Windows jobs had been red since FastAPI landed —
  E-007 (CRLF + `(\s*)` indent capture broke FastAPI injection idempotency;
  fixed with `[ \t]*`, EOL preservation, `.gitattributes`, regression test)
  and E-008 (EBUSY teardown race in the bridge test; fixed by awaiting
  child `close` + retrying rmSync).

## Notes for the next session
- The owner was asked whether to merge v0.3 into `main` — check the answer
  before doing anything else.
- Round 2 brick 1 (call-sequence recording) should reuse the existing
  `spardaRecord`/events organ — do not add a second observation path.
- Owner communicates in French; keep chat French, repo docs English.
