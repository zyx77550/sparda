# 2026-07-15 — verified global guards (the BOLA socle)

**Scope:** the surviving-findings audit showed the "unguarded-mutation" lens is saturated
(honest but benign signal); the real jump is object-level auth (BOLA/IDOR). Its prerequisite:
prove a route IS authenticated. immich showed 253 guards / 0 verified — app-wide auth.
**Commits:** `<hash>` · **Branch:** `claude/current-task-u45a4d` · **Tests:** 603/603 green (3 skip)

## Done
- **Audit of every surviving corpus finding** (dub 9, twenty 5, immich 6, novu 2, ghostfolio 1):
  ~0 real exploitable bugs — almost all pre-auth (login/signup/oauth), signature-verified
  webhooks, public-by-design, or FPs from unseen global auth. Conclusion: the current lens is
  at its precision ceiling; real bugs in authenticated apps are BOLA/privilege-esc/injection,
  which SPARDA is blind to. Documented the strategic fork (verified global guards → BOLA).
- **Verified global guards** (`nestjs.js`): `detectGlobalDenyGuard` finds the app-wide guard
  (`{ provide: APP_GUARD, useClass: X }` / `useGlobalGuards(new X())`), resolves its
  `canActivate` THROUGH DI (`handlerScan` follows `this.authService.authenticate()` to its
  `throw`), and when proven, every auth-named guard on the app earns `verified` via a synthetic
  deny scan. **immich: 253 guards 0 → 253 verified**, coverage 91.5 → 93.9; findings + verdict
  unchanged. Fixture `ubg-nest-global-guard` + 2 tests.
- **Oracle in action:** the immich metric move (guardsVerified 0 → 253) surfaced as intended
  DRIFT on `npm run corpus`, then re-baselined — the net working exactly as designed, one
  session after being built.

## Not done / deferred
- **nocodb PROVEN 898 / 0 verified** — its auth is NOT a Nest APP_GUARD (custom framework /
  middleware), so untouched; the possible hollow PROVEN still wants an audit.
- **BOLA / object-level authorization** — the next lens, now unblocked. A route that reads/writes
  by a request-supplied `:id`, guarded by generic auth but with NO ownership predicate tying the
  object to the session. This is the real-bug frontier (OWASP API #1) and the demo target.

## Decisions made
- Attribution is conservative (SOUNDNESS Direction 2): only upgrades an auth-named guard
  asserted → verified on a route that ALREADY has that guard, when a global guard is proven to
  deny app-wide. Never invents a guard on an unguarded route, so it cannot hide a hole — the
  guarded/unguarded verdict is byte-identical, only credibility sharpens.
- Reused `handlerScan` (DI-following) rather than `guardScan` (deepScan, no `this.<dep>`) —
  the global-guard deny is one DI hop deep, which deepScan alone would miss.

## Notes for the next session (BOLA)
- Raw material is all present: symbolic `:id` tables (`meta.symbolic`), request-derived params,
  the guard chain, and now VERIFIED auth. BOLA = a write/read to a `:id`-scoped table under a
  verified-auth guard, where no `where { …, userId: session }`-style ownership predicate is seen.
- Build it advisory-first (like taint enrichment) to avoid noise; measure the surface BEFORE
  committing to a finding (the taint lesson). Check against SOUNDNESS before shipping.
- `guardScan` (not the global path) still uses `deepScan` without DI — a `@UseGuards(X)` whose
  canActivate delegates the deny through `this.<dep>` would read asserted. If that shows up on a
  giant, switch guardScan to the DI-following `handlerScan` path too.
