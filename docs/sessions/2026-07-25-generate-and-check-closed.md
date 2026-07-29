# 2026-07-25 — Generate-and-check closed: interprocedural witness + the MCP generator

**Scope:** Execute the two "next natural wedge work" items the previous session named — the
interprocedural half of the ADR-074 ownership witness, and the MCP-sampling generator riding the
same verifier — plus a self-audit of the new adversarial surface.
**Commits:** `6d91d61` · `fb3229d` · `233329b` · **Branch:** `claude/sparda-hq-audit-evolution-r8ml8t`
· **Tests:** 824 ✓ (3 skip) · **Mutants:** 37/37 · lint/format/publish-gate clean · 4 deps.

## Done

- **Interprocedural ownership witness (ADR-075 A, checker V2).** `callBindsOwnershipWitness` in
  `extract.js` — call-site principal binding (`valueIsIdentity` classifies args; `req.body.*`
  never identity) + resolved-helper-body compare+deny over exactly the bound params (bare or
  member-off-param, works through imports). Wired in `resolve.js followCalls` (bare-call branch,
  per call site, before the `seen` dedup). Feeds `ownerAsserted` (O7 advisory) only — never a
  guard. Fixture `ubg-bola-witness-helper` (2 discharged / 3 adversarial controls stay), 2 killing
  mutants. Corpus zero-drift measured before/after (dub 43 O7, ghostfolio 2 O7, unchanged).
- **`sparda_witness` MCP tool (ADR-075 B, the generator).** `src/ubg/witness.js` (pure):
  `verifyWitnessAt` re-proves a proposed `{route, file, line}` with the same verifiers the static
  pass trusts; `admitWitnesses` adds the attribution TETHER (hinted file = route's file or a
  direct import — an unreachable-but-real check clears nothing). `witnessApp` exported from
  `stdio.js` like `proveApp`; hintless call returns the target list (the calling agent is a
  generator), hintless + sampling capability asks the client's own LLM (`WITNESS_TOKENS` 800,
  host never pays). Every discharge carries `witnessVia: 'generator+verified'`. Fixture
  `ubg-bola-generator` (real check behind a variable indirection the resolver doesn't follow —
  the exact recall gap), 9 tests incl. path traversal + tether + spoof, 2 killing mutants.
- **Self-audit hardening** (`233329b`): lexical containment before any fs access, realpath both
  sides (symlink smuggling dead), all fs errors fail closed; no double compile when sampling
  yields nothing. Probed hostile inputs (`null` hints, non-integer lines, nonexistent dirs) —
  never throws.
- ADR-075 in `docs/DECISIONS.md`; this record; HANDOFF Brick #22.

## Not done / deferred

- **New witness FORMS for the generator** — policy calls (`can(user,'read',doc)`), tenant-scoped
  clients, RLS: each new deterministic verifier multiplies the same loop. The highest-leverage
  next brick of this line.
- **`PROVEN-ENFORCED` verdict tier** (validated as a spike in Brick #20, still not integrated).
- **Next.js handlers through the resolver** — dub's 43 O7 stay static because Next handlers are
  shallow-scanned (known, HANDOFF part 48); the witness loop covers them only via `sparda_witness`
  hints (which works — the verifier is route-agnostic) but native bare-call following for Next
  remains open.
- **Tether depth**: one hop of imports, not the resolved call graph. Honest under-approximation;
  a resolved-reach tether would admit deeper-but-real witnesses.
- CI minutes exhausted until Aug 1 (unchanged) — proven green locally.

## Decisions made

- ADR-075 (see DECISIONS.md): neither call site nor helper body alone clears; generator hints buy
  nothing until re-proven; tether one-hop by design; advisory-only blast radius end to end.
- The witness check runs per CALL SITE (before the helper `seen` dedup) — a later call with the
  right bindings must still count.

## Bugs hit

- **O7's `adminish` filter reads reached guard LABELS** — a deny-carrying helper named
  `assert*Admin*` anywhere on the route's reach makes it "adminish" and skips O7. Intended
  behavior (privileged routes aren't object-BOLA), but it silently absorbed my first adversarial
  control (helper named `assertAdmin`); renamed the control off the admin vocabulary. Trap for
  future fixtures: keep adversarial helper names off `/admin|internal|system|cron|super/i`.
- **`realpathSync` ordering**: realpath-first turned a lexical `../` escape into `file-not-found`
  (target didn't exist) instead of `outside-app-dir` — check lexically first, then realpath.
- Publish-gate failure on the new `witness.js` until `git add` — the self-containment check runs
  over `git ls-files`, so an untracked new module imported by a published one reads as dangling.

## Notes for the next session

- The generator loop is LIVE but its verifier vocabulary is 2 forms. Before adding forms, measure
  which pattern dominates the surviving corpus advisories (dub's 43 are Next-shallow; check
  nocodb/cal.com O7 shapes first).
- `witnessApp` compiles per call (like `proveApp`) — fine for agent cadence; if it ever rides a
  hook, add the gate's baseline-reuse pattern.
- The `sparda_witness` sampling path is host-untested (same posture as the VS Code extension):
  pure logic fully tested, `server.createMessage` wiring validates on first live client.

> Remember: rewrite `docs/HANDOFF.md` before committing this file.
