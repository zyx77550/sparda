# 2026-07-14 — Le banc de torture permanent : corpus épinglé + verdicts d'or (ADR-056)

**Scope:** suite de la même journée d'exécution roadmap — ADR-P5 du dossier posé AVANT le
refactor ADR-P2, comme le dossier l'ordonne (« il protège le refactor »).
**Commits:** voir branche · **Branch:** `claude/weak-dossier-context-qm0bb2` · **Tests:** 560 ✓ inchangés (le banc est un outil, pas du runtime)

## Done

- **`tools/bench/`** : `corpus.json` (4 repos réels épinglés par SHA — directus, immich,
  express-boilerplate, open-webui, tous qualifiés à la main ce trimestre), `golden/<name>.json`
  (verdict consacré : routes, verdict, findings par règle, effets db, tables, guards,
  couverture, **sha256 du graphe canonique**), `run.mjs` (clone blobless+sparse au SHA,
  re-dérive, diffe champ par champ, exit 1 sur toute dérive ; `--update` re-consacre).
- **Workflow nocturne** `.github/workflows/bench.yml` (cron 03:00 + dispatch manuel).
- **Preuve de byte-identité produit** : deux cycles clone+dérivation indépendants → goldens
  identiques, hash de graphe inclus. Le déterminisme E-020/E-024 fait enfin du travail produit.
- ROADMAP Round 7 #6 ✅ cran 1 ; ADR-056 ; HANDOFF part 33.

## Not done / deferred

- Croissance vers 15 puis 500 repos : repo par repo, JAMAIS sans verdict d'or étalonné à la
  main (la règle anti-théâtre du dossier).
- Fuzzing des parsers dans le même job (ADR-P5 le prévoit) — à ajouter.
- twenty/dub/medusa/novu : pas encore épinglés (les goldens exigent une re-qualification à la
  main de chaque verdict — faire par lots de 2-3).

## Decisions made

- 4 repos, pas 500 : un golden sans vérité terrain n'est pas un golden.
- Le hash du graphe canonique entre dans le golden : la dérive la plus fine (un id d'effet qui
  bouge) est visible, pas seulement les compteurs.
- Pas de bump de version : le banc n'est pas dans le tarball npm (runtime inchangé).

## Bugs hit

- Aucun. (Le chemin clone-au-SHA blobless+sparse fonctionne du premier coup sur GitHub.)

## Notes for the next session

- **ADR-P2 commence maintenant, sous ce filet** : extraire `ubg/resolve.js` de
  `followDI`/`deepScan`/`followMembers` ; la définition de « safe » = `node tools/bench/run.mjs`
  vert + 560 vitest verts, AVANT toute extension (Next depth, table ORM par racine d'import).
- Après un changement LÉGITIME de graphe (nouvelle capacité), re-consacrer avec `--update` dans
  le même commit que la capacité — le diff du golden documente exactement ce que la capacité
  a changé sur du code réel.
