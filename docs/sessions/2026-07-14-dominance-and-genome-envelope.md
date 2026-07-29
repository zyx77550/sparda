# 2026-07-14 — Dossier Fable 5, exécution : dominance O1 + enveloppe génome versionnée (0.33.0)

**Scope:** les deux premiers items de l'ordre du dossier (§10.2 de
`docs/audit/2026-07-14-dossier-fable5-organes.md`) — les seuls sans dépendance.
**Commits:** voir branche · **Branch:** `claude/weak-dossier-context-qm0bb2` · **Tests:** 555 ✓ (3 skip), ESLint 0, Prettier clean

## Done

- **O1 dominance (ADR-046 cran 2).** `chainDepths` dans `apocalypse.js` : profondeur de
  chaîne minimale par route (les arêtes de chaîne avancent la profondeur, les arêtes de
  corps l'héritent). O1 exige un guard à profondeur ≤ celle de l'écriture ; sinon
  **`MUTATION_BEFORE_GUARD`** (critical). `vec.auth` suit la dominance (alignement
  findings⇄−1 étendu dans `polarity.test.js`). Fixture `ubg-guard-dominance`
  (guard-après-effet flag, guard-avant clean, mêmes nœuds) + `guard-dominance.test.js` (4).
- **Enveloppe génome `ab2` (ADR-054 — l'item URGENT du dossier).** `hashVersion` (vérifié
  contre le préfixe du hash) + `proverVersion` (→ 2, car O1 a changé de sens) scellés dans
  le claim signé/adressé par contenu. `PROVER` scindé en nom + version. Test de cohérence
  de version dans `genome.test.js`.
- **E-034 :** immich à HEAD déclare `express` en dep directe → détection misroutée.
  Ordre de détection par spécificité (Medusa → NestJS → Express) ; épinglé en ajoutant
  `express` à la fixture `ubg-nestjs-deep`.
- **Corpus re-sondé (re-clone sparse/shallow) :** directus PROVEN F=0 cov 95 %, immich
  NOT_PROVEN F=2, express-bp NOT_PROVEN F=3 — verdicts byte-identiques au baseline v0.32.0,
  zéro faux positif de dominance.
- Docs : ADR-046 cran 2 + ADR-054, E-034, CHANGELOG 0.33.0, ROADMAP Round 7 #3 (✅ cran 2),
  HANDOFF part 31.

## Not done / deferred

- Dominance *intra-corps* (ordre appel-vs-effet dans un même body) : volontairement non
  accusée — attend le dataflow (Round 7 #1 / ADR-P1). Un guard appelé dans le corps du même
  step partage sa profondeur et compte encore (discipline E-029).
- Politique Brick 3 du génome (quorum, ré-dérivation, brûlage de clé) : reste ADR-P6, choix
  de gouvernance owner.
- ADR-P2 (moteur interprocédural unifié) : le prochain chantier selon l'ordre du dossier.

## Decisions made

- Dominance = cran 2 d'ADR-046 (pas de nouvel ADR, comme le dossier le prescrit) ;
  l'enveloppe versionnée = ADR-054.
- `proverVersion` démarre à 2 : le bump accompagne le changement de sémantique qui le
  justifie — le premier usage du champ est sa propre raison d'être.
- `ab1` rejeté par version : coût nul tant qu'aucun parc n'existe (fenêtre exploitée exprès).

## Bugs hit

- E-034 (voir ERRORS.md) — détection immich cassée par une dérive upstream, pas par nos
  changements. Le corpus n'étant pas épinglé par SHA, la dérive HEAD est invisible jusqu'au
  re-clone : argument de plus pour ADR-P5 (banc épinglé + verdicts d'or).

## Notes for the next session

- Ordre du dossier : **ADR-P2 ensuite** (extraction d'un `ubg/resolve.js` unique à résultats
  byte-identiques sur le corpus AVANT toute extension), puis ADR-P1 (arêtes dataflow, `bh2_` —
  l'enveloppe est prête pour ce bump). P3/P5 parallélisables.
- Le corpus scratchpad est éphémère : re-cloner (sparse+shallow) ; chemins dans
  `docs/NEXT-WAVES-PLAYBOOK.md` §0. directus/immich/express-bp re-validés aujourd'hui.
- `MUTATION_BEFORE_GUARD` ne se déclenche sur aucune app du corpus — attendu (règle
  structurelle précise). La première app réelle qui le lèvera sera un vrai bug à publier.
