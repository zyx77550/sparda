# 2026-07-14 — Vague 2b : profondeur d'effets Python — open-webui 0 % → 94 % (0.34.0)

**Scope:** exécution de la roadmap dans l'ordre du playbook/dossier : Wave 2b (le bras Python
d'ADR-P2, indépendant du refactor JS).
**Commits:** voir branche · **Branch:** `claude/weak-dossier-context-qm0bb2` · **Tests:** 560 ✓ (3 skip), ESLint 0, Prettier clean

## Done

- **Investigation d'abord (la méthode) :** open-webui à HEAD cloné et lu. Sa forme réelle :
  singletons module-level (`Chats = ChatTable()`), `async with get_async_db_context(db) as
  session:`, SQLAlchemy 2.x expression language (`execute(update(Chat).values(…))`,
  `session.get(Tool, id)`, statements liés à des locales).
- **`fastapi_extract.py` — moteur de suivi interprocédural (ADR-055).** Le contrat deep-scan JS
  porté en Python stdlib : fonctions importées, singletons, DI (`Depends` par annotation ou
  retour de provider), `self.` avec overrides-win, méthodes de classe de base résolues contre
  les imports du module DÉCLARANT. Profondeur ≤ 6, memo (fichier, classe de dispatch, méthode),
  garde de cycle, ordre source, **effets seulement** (tripwire E-029 : le 401 d'un callee ne
  fabrique jamais un guard).
- **Formes ORM, gated par récepteur :** expression language, statements liés,
  `session.get(Model, pk)`, `add`/`delete` résolus par modèle. Récepteur pointé doit matcher
  session|db et le modèle doit être Capitalisé (une `session` aiohttp ne matche pas).
- **Preuve : open-webui 456r, 0 → 1 325 effets db, 39 tables, 268 arêtes mutation, 712 gates,
  couverture 0 % → 94 %, ~4 s, déterministe.** PROVEN F=0 maintenu et désormais signifiant
  (chaque write dominé par un guard). directus/immich/express-bp inchangés.
- `translate.js` : dédoublonnage d'id d'effet par (op, cible) — deux fichiers callee sur le même
  numéro de ligne ne fusionnent plus un insert et un delete.
- Fixture `ubg-fastapi-deep` + `fastapi-deep.test.js` (5). Docs : ADR-055, CHANGELOG 0.34.0,
  playbook Wave 2b ✅, HANDOFF part 32.

## Not done / deferred

- Services stockés au constructeur (`self.svc.m()` posé dans `__init__`) — le résidu pré-ADR-051
  côté JS, même statut ici.
- peewee active-record — à ajouter quand une app réelle du corpus l'exige (discipline
  racine-d'import d'ADR-P2, pas de motif nominal).
- ADR-P2 JS (unification `ubg/resolve.js`) : le prochain chantier ; exiger la byte-identité
  corpus avant toute extension, et poser ADR-P5 (verdicts d'or) en même temps.

## Decisions made

- Wave 2b exécutée avant le refactor JS d'ADR-P2 : même contrat, zéro dépendance, plus gros
  déblocage de couverture du corpus — l'ordre du dossier est respecté dans l'esprit (P2
  commence par son bras sans risque).
- Effets uniquement à travers les appels ; jamais guardSignals/validatesInput (E-029).

## Bugs hit

- Ma sonde initiale passait un chemin RELATIF à `compileUBG` → le script Python résout la racine
  depuis son propre cwd → chemins `../../../main.py` et imports non résolus. Pas un bug produit
  (les tests passent des chemins absolus) ; à savoir pour les probes futurs.
- Collision d'id d'effet inter-fichiers (même ligne, même table, ops différents) révélée par la
  fixture — corrigée dans translate.js (clé (op, cible)).

## Notes for the next session

- **ADR-P2 JS ensuite** : extraire `ubg/resolve.js` (followDI + deepScan/followMembers), à
  résultats byte-identiques sur le corpus fixture AVANT extension. Poser d'abord le banc
  ADR-P5-lite (fichiers de verdict d'or committés + diff) — il protège le refactor.
- Le corpus scratchpad est éphémère ; open-webui ajouté aux apps re-validées aujourd'hui.
- open-webui PROVEN 94 % est une pièce de communication (« un monstre FastAPI prouvé en 4 s ») —
  pour Gemini le jour de la publication.
