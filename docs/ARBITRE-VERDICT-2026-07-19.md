# L'ARBITRE — verdict du 2026-07-19 (session d'audit externe, tout mesuré sur machine)

> Mission : trouver LA chose qui peut faire décoller SPARDA malgré solo founder + zéro
> distribution + zéro budget. Règle : aucune affirmation sans file:line ou chiffre mesuré
> pendant cette session. Les fichiers `_MASTER-MAP-AND-DIRECTION-2026-07-19.md` et
> `THESIS-BEHAVIOR-COMPILER-FOR-AGENTS.md` référencés par le brief N'EXISTENT PAS dans le
> repo — la synthèse d'une session précédente n'a pas été commitée (violation de la règle
> CLAUDE.md « never skip the handoff » ; leçon en soi).

## Ce qui a été mesuré (reproductible)

| Mesure | Résultat |
|---|---|
| `npm test` | 667 verts / 3 skip, 72 fichiers, ~22 s |
| `prove` sur dub réel (clone frais) | 580 routes, **2,5 s**, NOT PROVEN, 5 critical / 30 high, coverage 99 %, 518/518 gardes vérifiées |
| Sabotage n°1 (route cassée) + `apocalypse` vs baseline | `ENTRYPOINT_REMOVED` [high] en **1,9 s** |
| Sabotage n°2 (wrapper d'auth remplacé par une identité) | `GUARD_REMOVED — POST /api/links was guarded in the baseline and is now reachable without any guard` [critical] en **1,8 s** |
| `sparda review --base HEAD` depuis `apps/web` (monorepo) | **CASSÉ** — compile la base à la racine du worktree → « No supported framework found » et suggère `cd apps/web`… où on est déjà |
| Demo bundlée (`demo-app/`) via `ubg` + `apocalypse` | **SURFACE ONLY, coverage 0 %** — l'anti-démo |
| Registre MCP officiel (`registry.modelcontextprotocol.io`) | listing **gelé à v0.10.1** avec l'ANCIEN pitch (« Turn any Express or FastAPI app into an MCP server ») — le canal agent-natif n°1 vend l'identité d'avant le pivot |
| Intégration hooks Claude Code / Cursor | **inexistante** (`grep PostToolUse` → 0 ; `src/commands/hook.js:1` = sentinelle post-commit de sync, rien d'autre) |
| Taille réelle | src ≈ 21 k SLOC (ubg 9 541, commands 4 400, server 3 187) ; **31 commandes CLI** |

Recherche croisée (juillet 2026) : Qodo a levé **70 M$ (série B, 120 M$ total)** sur
exactement notre douleur (« code verification as AI coding scales ») mais en review
**LLM, enterprise, non-déterministe**. Sonar 2026 : 96 % des devs ne font pas confiance
au code IA, seuls 48 % vérifient avant commit ; 43 % des changements IA nécessitent du
debug en prod après avoir passé tous les gates. Les gates agent-natifs existants font
des **secrets** (GitHub MCP secret-scanning, GitGuardian MCP) ou des **policies/prompt-
injection** (Heeler). Le diff sémantique existant est cosmétique (SemanticDiff) ou
spec-first (oasdiff). **Personne ne fait la preuve déterministe locale < 2 s que l'edit
d'un agent n'a pas retiré une garde / agrandi le blast radius.** Ce coin est vide et il
est financé (Qodo prouve que le marché paie).

## 1. VERDICT

Le moteur est réel et sous-vendu d'un facteur énorme : j'ai vu un compilateur prouver
580 routes d'un vrai SaaS de production en 2,5 s et attraper une dé-protection d'auth en
1,8 s, déterministe, offline, zéro clé — et pendant ce temps le registre MCP le présente
comme « un outil qui transforme Express en serveur MCP » version 0.10.1, la demo bundlée
sort 0 % de coverage, et la commande vitrine `review` est cassée sur les monorepos (le
cas majoritaire). **Expansion fulgurante : possible mais non garantie — la condition
nécessaire est de mettre l'organe déjà construit (baseline + `sparda_prove`,
`src/server/stdio.js:375`) à l'endroit exact où vivent les agents : la boucle d'édit.**
Le levier unique : **le gate de régression comportementale dans la boucle de l'agent** —
« ton agent vient de retirer une garde, bloqué, 2 secondes, en local ». Tout le reste
(immunité collective, acquisition, SaaS) est en aval de ça.

## 2. LE WEDGE UNIQUE : `sparda gate` — le réflexe rachidien de l'agent

- **La chose.** Un hook agent-natif (Claude Code `PostToolUse`/pre-commit, plugin
  marketplace ; même mécanique pour Cursor) qui exécute la passe baseline-diff
  d'`apocalypse` après chaque edit et renvoie à l'agent, en < 2 s : `GUARD_REMOVED`,
  `ENTRYPOINT_REMOVED`, blast radius. 90 % du code existe (`apocalypse --save-baseline`,
  `sparda_prove`, `verdictState`) ; il manque ~200 lignes d'emballage hook + la doc.
- **La preuve.** Mesuré cette session : sabotage réel sur dub → `GUARD_REMOVED`
  [critical] en 1,785 s. C'est la démo qui se raconte toute seule, reproductible en une
  commande (à scripter dans `bench/`).
- **La douleur, chiffrée.** 96 % de méfiance / 48 % seulement vérifient (Sonar 2026) ;
  43 % de changements IA débuggés en prod (New Stack 2026) ; Qodo lève 70 M$ dessus.
- **Qui occupe le coin.** Qodo (LLM, minutes, $$, enterprise), CodeQL (CI, minutes,
  setup), GitHub/GitGuardian MCP (secrets seulement), Heeler (policies). Le créneau
  « déterministe + < 2 s + local + zéro clé + dans la boucle d'édit » : vide (recherche
  croisée du 2026-07-19).
- **Pourquoi SPARDA gagne CE coin.** Le seul à avoir déjà le graphe + le contrat de
  solidité (jamais de faux PROVEN, `docs/SOUNDNESS.md`) + la vitesse mesurée. Un
  concurrent LLM ne peut pas garantir le déterminisme ; un SAST ne tient pas en 2 s
  zéro-config dans un hook.
- **Première action (cette semaine).** (1) Shipper `sparda gate` + plugin Claude Code ;
  (2) réparer le listing registre MCP (0.64.0 + pitch trust-layer) — c'est un canal à
  coût zéro qui diffuse aujourd'hui la mauvaise identité ; (3) fixer `review` monorepo
  (bug mesuré, tueur du time-to-wow) ; (4) scripter le sabotage-replay dub dans `bench/`.

## 3. PIONNIER vs ADOPTION → ADOPTION, tranché

Le vide pionnier est déjà comblé **techniquement** (l'organe existe, mesuré) ; il n'est
pas comblé **là où vivent les acheteurs**. Le goulot mesuré n'est pas l'idée : 41
visiteurs uniques/14 j (playbook §4) contre un moteur qui tient dub en 2,5 s. Donc voie
ADOPTION, avec une torsion : **distribuer aux agents, pas aux humains** — les canaux
agent-natifs n'exigent aucune audience préalable : registre MCP officiel (déjà listé,
mais périmé), marketplace de plugins Claude Code, listes awesome-claude-code /
awesome-mcp (des PR), GitHub Action Marketplace (`action.yml` prêt, non publié). Le
« aha » en 60 s est le sabotage-replay : l'utilisateur regarde SPARDA attraper son agent
en train de dé-protéger une route. L'artefact partageable (badge, commentaire PR sticky)
est déjà livré (v0.53/0.54) — il manque le canal, pas l'artefact.

## 4. LA DONNÉE-MOAT — la vérité d'abord

L'immunité collective (`docs/COLLECTIVE-IMMUNITY.md`) est le bon design de moat — les
deux bouts génotype/phénotype + l'adresse `behaviorHash` sont réels et shippés (Bricks
1/1.5/2). Mais un effet de réseau à **zéro nœud vaut zéro** : aujourd'hui la seule
donnée accumulée est `corpus.snapshot.json` (7 géants). Le moat ne peut pas CAUSER
l'adoption ; il la CAPITALISE. Amorçage honnête, dans l'ordre : (1) le wedge tourne ;
(2) publier `sparda-genome` v0 seedé avec les fingerprints + verdicts des géants OSS
(coût 0, git = backplane, déjà designé Brick 3) ; (3) chaque `gate`/CI run fait un
lookup — le hit « ce behaviorHash a déjà été vu N fois » devient visible et le push
opt-in nourrit le repo. La donnée non-copiable finale : la matrice
comportements × verdicts × fixes prouvés à l'échelle — mais elle n'existe qu'après des
milliers de repos actifs.

## 5. THÈSE ANTHROPIC (Cursor/GitHub) — honnête

En l'état : **rien ne déclenche un rachat.** 3 stars, 0 dogfooding, canal principal
périmé — une due diligence s'arrête à la ligne « dogfooding : 0 app » du playbook. Ce
qui déclencherait « buy, not build » : (a) le gate devient un réflexe répandu dans les
boucles d'agents (métrique nord du playbook : repos avec `.sparda/` committé — c'est
EXACTEMENT la métrique qu'un acquéreur lirait) ; (b) SBIR consommé par au moins un outil
tiers (le play LSP/OCI : posséder le format) ; (c) le genome à l'échelle (le dataset
qu'on ne peut pas réécrire en 6 mois, contrairement au code — 21 k SLOC se
réimplémentent). La RFC « cheval de Troie » vers `modelcontextprotocol/specification`
(ROADMAP M6) est prématurée : sans usage, c'est un signal de faiblesse, pas de force.
Précondition chiffrée réaliste avant d'en reparler : ~1 000 repos actifs ou 1 design
partner nommé qui gate ses déploiements avec `apocalypse`.

## 6. KILL LIST

1. **L'identité MCP-runtime en vitrine des canaux.** Le registre MCP vend encore
   « expose ton app en MCP » (v0.10.1). C'est l'ancienne histoire ; elle recrute les
   mauvais visiteurs. À réécrire autour de `sparda_prove`/gate. (Les organes runtime
   restent du code — c'est la VITRINE qui meurt, pas le code.)
2. **La demo bundlée actuelle** — mesurée SURFACE ONLY / 0 % : elle démontre l'inverse
   du produit. La remplacer par le sabotage-replay.
3. **Tout travail moteur** (déjà gelé par le playbook — je contresigne : Wave 2b/3,
   BOLA étage 2, effect cardinality : rien de tout ça ne bouge l'aiguille à 41
   visiteurs/14 j).
4. **La RFC Anthropic / le narratif acquisition** comme objectif pilotant (voir §5).
5. **Les synthèses non commitées.** Cette session a démarré sur deux fichiers maîtres
   fantômes. Une analyse qui n'est pas dans git n'existe pas.

## 7. PLAN 30 JOURS (du levier le plus fort au plus faible)

- **S1 — le gate + les canaux réparés.** `sparda gate` (hook Claude Code + pre-commit,
  plugin marketplace) ; fix `review` monorepo ; registre MCP → 0.64.0 + pitch
  trust-layer ; publier l'Action au Marketplace ; `bench/guard-removal-replay.mjs`
  (le sabotage dub scripté, chiffres dans le README).
  *Vérifiable : plugin installable en 1 commande ; replay reproductible ; listing à jour.*
- **S2 — dogfood + présence.** `gate` actif sur 3 vrais repos Residual Labs (tuer le
  « dogfooding : 0 ») ; 5-10 PR vers awesome-claude-code / awesome-mcp / listes hooks ;
  3 mini case studies chiffrées. *Vérifiable : `.sparda/` committés, PR mergées.*
- **S3 — le lancement.** Show HN : « My AI agent removed an auth check. A deterministic
  2-second gate caught it. » — la démo EST le post ; angle repro-en-1-commande.
  (Attention : les findings dub réels relèvent de la responsible disclosure — le
  marketing utilise le SABOTAGE, jamais les vrais findings d'un tiers non prévenu.)
  *Vérifiable : GitHub uniques ×5 vs baseline 41/14 j (objectif playbook).*
- **S4 — mesurer, puis seulement capitaliser.** Repos actifs (métrique nord) ; si le
  gate mord : seeder `sparda-genome` v0 (§4) ; si le gate ne mord pas après un vrai
  lancement : le dire, et réévaluer le segment (le prochain candidat mesurable :
  plateformes d'agents qui déploient du code généré — Replit/Lovable-class — où le gate
  est une feature de plateforme, pas un outil de dev).

*Rédigé par la session Fable 5 du 2026-07-19. Tout chiffre de ce document a été mesuré
pendant la session ou est sourcé (Qodo/TechCrunch 2026-03-30 ; Sonar State of Code 2026 ;
The New Stack 2026).*
