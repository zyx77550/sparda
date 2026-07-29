# Session 2026-07-19 — ARBITRE-2 : le wedge construit et mesuré (`sparda gate`)

**Mandat :** ne pas opiner — PROUVER le wedge en code, puis livrer le playbook complet
(positionnement, distribution, lancement, kill-criteria, réponse concurrente, thèse
Anthropic, monétisation, red-team). Livrable : `docs/ARBITRE2-PLAYBOOK-2026-07-19.md`.

**Construit :**
- `src/commands/gate.js` — le gate de boucle d'édit, delta-only (l'état pré-existant ne
  bloque jamais un edit) : `diffGraphs` + delta `checkGraph` vs baseline (composition
  ADR-030), auto-arm au premier run, `--hook` = contrat Claude Code PostToolUse (silence
  quand clean ; rapport sur stderr + exit 2 sur régression), `--arm`, `--json`.
- Câblage `src/index.js` (case + help + listing), 4 tests `tests/gate.test.js` (delta-only,
  GUARD_REMOVED bloquant, finding introduit vs pré-existant, medium jamais bloquant),
  `bench/guard-removal-replay.mjs` (démo 60 s reproductible, sabotage INJECTÉ puis
  restauré — responsible disclosure by design).

**Mesuré (dub réel, 580 routes) :** sabotage wrapper→identité attrapé `GUARD_REMOVED
[critical]` avec file:line en 1,88 s interne / 2,2 s wall, exit 2 ; edit bénin = silence
total ; nouvelle route non gardée = `UNGUARDED_MUTATION` introduit attrapé ; app médiane
(fixture) = 55 ms. Replay scripté : détection 1 465 ms. Suite : **687 verts / 3 skip
(76 fichiers)**, ESLint/Prettier clean, valve ADR-029 passée (elle a attrapé le module non
tracké avant `git add` — witness).

**Vérifié encore vrai (de l'ARBITRE-1) :** listing registre MCP périmé (v0.10.1, pitch
pré-pivot) ; `review --base` toujours cassé en sous-dossier monorepo ; demo bundlée
toujours SURFACE ONLY 0 %.

**Le playbook tranche :** S1 = packager (plugin Claude Code + registres + Action) et livrer
la Classe 2 des FP AVANT tout lancement ; métrique nord = repos actifs externes ; seuil de
kill à J+30 post-lancement (≥ 10 repos externes ou uniques ×5, sinon pivot plateforme) ;
M6 (RFC Anthropic) reste gelé jusqu'à l'usage. Probabilités honnêtes dans le doc (§6).

**Prochaine session :** merger le gate, puis S1 J2-J7 du playbook (plugin, registres,
Action, fix review monorepo, remplacer la demo, Classe 2).
