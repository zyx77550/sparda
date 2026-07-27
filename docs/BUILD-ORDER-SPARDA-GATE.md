# 🔨 CONSIGNE DE BUILD — pour le Fable qui code

> 2026-07-19. De : Zak + 3 passes d'analyse (2 stratégiques + toi). **Autonome : tu n'as besoin
> d'aucune autre branche pour agir.** Priorité absolue, elle prime sur le travail moteur.
>
> **Le contexte en une phrase :** le moteur est de classe mondiale mais branché sur un nerf mort.
> Le levier n'est PAS une nouvelle invention — c'est mettre l'organe déjà construit là où vivent
> les agents (la boucle d'édit), via des canaux qui n'exigent aucune audience. ~200 lignes + 3 fixes.

## Ce qui est CONFIRMÉ (mesuré, pas supposé)

- `sparda_prove` + le baseline-diff d'apocalypse existent (`src/server/stdio.js`, prompt
  `prove-my-edit`). Un sabotage simulé sur dub (retirer `withWorkspace` de `POST /api/links`) →
  `GUARD_REMOVED [critical]` en **1,8 s**, déterministe, offline, zéro clé. **Le moteur du wedge est là.**
- `src/commands/hook.js` n'est QU'une sentinelle de sync post-commit — **aucun hook agent** (edit-loop).
- `apocalypse` sur `demo-app` sort **SURFACE ONLY / ZERO behavior resolved** — la démo bundlée
  démontre l'INVERSE du produit (l'anti-démo). Vérifié.

## LE WEDGE À CONSTRUIRE : `sparda gate`

Un gate déterministe < 2 s branché dans la boucle d'édit de l'agent. Réutilise TOUT l'existant.

1. **`sparda gate`** (nouvelle commande + emballage hook) : rejoue la passe **baseline-diff**
   d'`apocalypse` après un edit et renvoie à l'agent, en < 2 s : garde retirée / route droppée /
   blast radius agrandi. Réutilise `apocalypse --save-baseline` + la logique de `sparda_prove`.
2. **Plugin Claude Code** : hook `PostToolUse` (et/ou pre-commit) qui appelle `sparda gate`,
   packagé pour installation en **1 commande**. Même mécanique portable pour Cursor ensuite.
3. **`bench/guard-removal-replay.mjs`** : scripter le sabotage-replay reproductible en une commande.
   C'est le "aha" de 60 s et la démo du lancement. **Marketing = ce replay SIMULÉ, jamais les
   vrais findings de dub (responsible disclosure — les criticals réels ne sont pas des munitions).**

## LES 3 RÉPARATIONS URGENTES (canaux + crédibilité)

1. **Le listing du registre MCP officiel est périmé** (v0.10.1, pitch d'avant-pivot "expose ton
   app en MCP"). Il recrute les mauvais visiteurs sur ton seul canal actif. → republier en 0.65.0
   avec le pitch trust-layer / gate.
2. **`sparda review --base` cassé depuis un sous-dossier de monorepo** : lancé depuis `apps/web`
   d'un monorepo, il compile la racine du worktree et répond "No supported framework found, try
   cd apps/web" — où on était déjà. → threader le `cwd`/`--dir` jusqu'au compile.
3. **Remplacer la demo bundlée** (SURFACE ONLY) par un fixture qui PROUVE réellement quelque chose
   — idéalement le sabotage-replay. La 1ʳᵉ impression ne doit plus démontrer l'inverse du produit.

## GARDE-FOUS (non négociables)

- **Soundness intacte** : le gate réutilise la preuve déterministe existante — jamais un faux
  "sûr". Advisory là où c'est advisory.
- **Responsible disclosure** : zéro vraie faille de repo tiers dans la comm. Sabotage simulé only.
- **Vitrine honnête** : jamais "révolutionnaire / seul au monde / le roi". On dit *"le seul gate
  déterministe < 2 s, zéro-config, zéro-clé, dans la boucle d'édit de l'agent."*
- **Tests verts + tsc clean avant tout push.** (Rappel : ne jamais livrer du rouge.)

## POURQUOI ça marche malgré solo + zéro distribution

La distribution vers les AGENTS (registre MCP, marketplace de plugins Claude Code, awesome-lists,
GitHub Action Marketplace — `action.yml` prêt, jamais publié) **n'exige aucune audience préalable.**
La contrainte "zéro distribution" ne vaut que pour les humains. Le créneau "déterministe + local +
< 2 s + zéro clé + dans l'édit" est **vide et financé** (Qodo vient de lever 70 M$ sur la douleur
voisine). **La vitesse compte — tu n'es pas seul dans la pièce longtemps.**

## Références (pour le contexte complet)

- Verdict stratégique détaillé : `docs/ARBITRE-VERDICT-2026-07-19.md`
  (branche `claude/sparda-compiler-analysis-3qvx9b`).
- Direction produit + projection : `docs/THESIS-BEHAVIOR-COMPILER-FOR-AGENTS.md`,
  `docs/_MASTER-MAP-AND-DIRECTION-2026-07-19.md`, `docs/false-positive-classes`,
  `docs/csop-handoff` — chacun sur sa branche `docs/*`. (À consolider dans main quand tu pourras.)

## Ordre d'exécution

**S1 :** `sparda gate` + plugin + `bench/guard-removal-replay.mjs` + les 3 fixes. Livrable
vérifiable : plugin installable en 1 commande, replay reproductible, registre à jour.
Le reste (dogfooding, awesome-lists PR, Show HN) suit — cf. `ARBITRE-VERDICT` §7 plan 30 jours.

> **En une ligne :** organe de classe mondiale + nerf mort → le geste de génie, c'est 200 lignes
> de hook et une fiche de registre à jour. Construis le gate. C'est tout le levier.
