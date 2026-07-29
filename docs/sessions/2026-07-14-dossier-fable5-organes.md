# 2026-07-14 — Dossier Fable 5 : analyse des organes et dépassement des limites

**Scope:** audit externe complémentaire (second regard sur les limites identifiées
par l'analyse précédente : stress-test 2026-07-13 + items Round 7 différés) —
docs uniquement, zéro code touché.
**Commits:** voir branche · **Branch:** `claude/fable5-system-audit-idtfzw` · **Tests:** non affectés (docs-only)

## Done

- `docs/audit/2026-07-14-dossier-fable5-organes.md` — le dossier complet :
  vue globale, 8 organes (ingestion, effets, IR, prouveur, exécution dérivée,
  génome, runtime MCP, chaîne produit), matrice fondamentale/contingente,
  6 ADR proposés (ADR-P1…P6) évalués contre le cadre Cohérence/Pérennité/
  Robustesse/Déployabilité/Auditabilité, ordre de dépendances recommandé.

## Not done / deferred

- Aucun ADR-P promu dans `DECISIONS.md` — ce sont des *propositions* d'audit ;
  la promotion (numérotation ADR-047+) est une décision owner, ADR par ADR.
- Aucun code modifié : le dossier recommande, il n'implémente pas.

## Decisions made

- (proposées, pas actées) Les 6 ADR-P du dossier. Les deux verdicts d'analyse
  clés : la plupart des « murs » du Round 7 sont des dettes de duplication
  (un moteur interprocédural unique en résout 4) ; deux limites seulement sont
  réellement fondamentales (promesse du prouveur, vérité d'exécution du génome)
  et doivent rester assumées telles quelles.
- Signal urgent indépendant du reste : ajouter `proverVersion`/`hashVersion` à
  l'enveloppe signée du génome AVANT tout parc installé (sinon migration `bh2_`
  impossible à distinguer des conflits).

## Bugs hit

- Aucun (lecture seule).

## Notes for the next session

- La sonde runtime `src/probe/` (shim Express + reconcile) existe déjà et n'est
  PAS reliée à l'ingestion UBG — c'est le levier le moins cher contre le mur
  directus/parse-server (ADR-P3). Ne pas la réinventer.
- Ordre de dépendances : dominance des gardes (sans dépendance) → ADR-P2
  (moteur unifié, byte-identité exigée avant extension) → ADR-P1 (dataflow
  dans l'IR, hash versionné) ; P3/P5 parallélisables ; P4 puis P6 ensuite.
- Leçon E-029 réaffirmée : aucune nouvelle obligation nominale au prouveur
  avant le dataflow.
