# 2026-07-13 — Vague 1: coverage as a first-class signal (0.31.0)

**Scope:** First wave of Zak's "rapproche tous les organes du 10". Make the blindspot coverage
ratio travel WITH the proof through every organ that carries a verdict.
**Commit:** `fbe1822` · **Branch:** `claude/new-session-5yhx6t` · **Tests:** 546/546 (3 skipped)

## Done
- Capsule (`buildCapsule`, immunity.js) carries `coverage` + `blindHigh` → genome/world-memory
  records "proven over how much". `immunize` prints it (directus 98%). `dossier` hero stat.
  `review` reports coverage DELTA vs base (a PR that blinds the app is flagged even when clean).
- Blindspot risk sharpened: unguarded unreadable mutation high → critical.
- Zero corpus verdict/finding change — it reports, never re-judges. ADR-052.

## Not done / deferred
- Waves 2 (breadth), 3 (taint), Reyna loop — see NEXT-WAVES-PLAYBOOK.md.

## Notes
- Capsule coverage omits `skipped-surface` (no report there), so it's a slight over-estimate vs
  the full ledger (directus 98% capsule vs 95% ledger). Documented; ledger is ground truth.
