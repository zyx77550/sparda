# 2026-07-14 — Classes de défauts comportementaux : corriger la forme une fois (ADR-057, 0.35.0)

**Scope:** un game-changer additif faisable sans session dédiée — combiner le `behaviorHash`
(fingerprint) avec le flux de findings d'apocalypse pour révéler la structure de récurrence des
défauts. Contrainte : sans faute (zéro dérive de verdict/graphe).
**Commits:** voir branche · **Branch:** `claude/weak-dossier-context-qm0bb2` · **Tests:** 567 ✓ (3 skip), ESLint 0, Prettier clean, bench byte-identique

## Done

- **`src/ubg/classes.js#behaviorClasses(graph)`** : croise `fingerprintGraph` (identité
  comportementale, ADR-035) avec `checkGraph`. Groupe les findings par `(rule, behaviorHash)` →
  une classe = un défaut (règle) sur des routes comportementalement identiques (hash), avec
  `canonical` (patient zéro), `instances`, `routeCount`, `findings`, `descriptor`. Hash null →
  singleton (jamais collapsé sur une supposition).
- **Surfacé, strictement additif** : ligne de verdict `apocalypse` (« 156 findings collapse to
  118 behavior classes »), champ `classes` dans `--json`, section « Defect classes » du dossier
  (uniquement les classes récurrentes, patient zéro + siblings, échappées XSS).
- **Sans faute prouvé** : ré-organise, ne re-juge jamais (règle coverage/blindspots). Verdicts,
  compteurs, polarité, capsule, graphe canonique inchangés → **bench d'or byte-identique, hash
  de graphe inclus**, sur les 5 repos épinglés. Total conservé (test : chaque finding dans
  exactement une classe). Résumé muet si rien ne récurre.
- **Preuve sur code réel** : dub 152 findings critiques → 114 classes, **22 récurrentes couvrant
  60 routes** (max = 5 routes sur une forme) ; express-bp 3→2 ; immich 2→2 (formes distinctes,
  pas de faux regroupement). Fixture `ubg-recurrence` + `classes.test.js` (6) + test dossier.
- **dub épinglé au bench** (579r, NOT_PROVEN F=156) — maison de régression de la capacité et
  entrée corpus au plus grand nombre de findings.
- Docs : ADR-057, CHANGELOG 0.35.0, HANDOFF part 34.

## Not done / deferred

- Pas de nouvelle notion de sévérité par classe (la classe hérite de la sévérité du finding).
- Cross-app (le même `behaviorHash` reliant deux apps via un anticorps) : c'est le génome
  (ADR-041/P6), pas ce chantier — mais c'est exactement la même clé, à une autre échelle.
- `review` ne montre pas encore le delta de classes (findings introduits regroupés) — extension
  naturelle mais non nécessaire ici ; à considérer quand `review` sera enrichi.

## Decisions made

- Clé de classe = `(rule, behaviorHash)` : deux routes de même forme mais findings différents ne
  fusionnent jamais (chacune n'entre que dans la classe de SON finding) — sûr et honnête.
- Le fingerprint n'inclut pas la dominance intra-chaîne ; comme on ne groupe que des findings qui
  EXISTENT déjà, ça reste sound (une classe ne contient que des routes portant réellement ce défaut).
- Additif d'abord : la valve ADR-029 a correctement signalé `classes.js` comme under-send tant
  qu'il n'était pas tracké — `git add` a suffi (couvert par `src/**` dans l'allowlist).

## Bugs hit

- Aucun bug produit. Le seul « rouge » transitoire : `publish-gate.test.js` (self-containment) a
  flagué `classes.js` comme import pendant car non-suivi par git — comportement correct de la
  valve, résolu en stageant le fichier.

## Notes for the next session

- **ADR-P2 (session dédiée)** reste le prochain grand pas : moteur interprocédural JS unifié
  `ubg/resolve.js`, sous le filet du bench (`node tools/bench/run.mjs` vert = définition de safe).
- Extension gratuite si besoin un jour : `review --json` pourrait exposer le delta de classes de
  défauts d'une PR (mêmes primitives), et le génome pourrait recall par classe.
- Communication : « SPARDA prouve des CLASSES de comportement, pas des routes — 579 routes de dub,
  118 classes de défauts, chacune un patient zéro » est une phrase pour Gemini le jour du launch.
