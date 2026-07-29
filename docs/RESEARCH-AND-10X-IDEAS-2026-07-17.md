# Recherche + idées 10x — pour Fable (ou toute session qui code dessus)

> **Date :** 2026-07-17 · **Auteur :** session Claude, sur demande de Zak : "je veux que Fable
> comprenne d'où tu as tiré ça, comment, et pourquoi, et c'est censé faire quoi."
> **Méthode :** chaque idée ci-dessous est soit `[SOURCE]` (papier réel, cité, cherché sur le
> web ce jour) soit `[GAP VÉRIFIÉ]` (trouvé en lisant/grepant le code de CE repo, pas deviné)
> soit `[GAP RAISONNABLE]` (déduit de l'architecture, pas confirmé par une recherche exhaustive
> — marqué comme tel). Aucune idée n'est présentée comme neuve sans avoir vérifié qu'elle n'existe
> pas déjà dans `src/`.

---

## PARTIE 1 — Les 3 papiers scientifiques, expliqués pour quelqu'un qui va coder dessus

### 1. "In Defense of Soundiness: A Manifesto" — Livshits et al., *Communications of the ACM*, 2015

**D'où ça vient :** recherche web ce jour, requête `"soundy" static analysis Livshits`.
Papier fondateur, co-signé par 10 chercheurs du domaine (dont les auteurs de Chord, WALA, Doop —
les analyseurs statiques de référence académiques). Lien : https://cacm.acm.org/opinion/in-defense-of-soundiness/

**Ce qu'il dit, en une phrase :** une analyse ne peut JAMAIS être 100% saine sur du code réel
(trop de constructs dynamiques — reflection, callbacks, DI) ; les meilleurs analyseurs du monde
sont "soundy" — saine sur tout ce qu'ils peuvent, avec un sous-ensemble de constructs
**délibérément et explicitement** sous-approximé, documenté, jamais caché.

**Pourquoi c'est pertinent pour SPARDA précisément :** SPARDA fait DÉJÀ ça —
`docs/DECISIONS.md:368` dit "reachability — a sound over-approximation", et le blindspot ledger
(`src/ubg/blindspots.js`) est exactement le "sous-ensemble documenté" que le papier décrit comme
la bonne pratique. **Mais le mot "soundy" n'apparaît nulle part dans leur doc.** Ils appliquent
la méthodologie correcte sans le savoir, donc sans pouvoir la citer.

**Ce que ça doit produire en code/doc — PAS un changement de moteur :**
- Ajouter une ligne dans `docs/DECISIONS.md` (à côté d'ADR-024, ligne ~368) qui nomme le concept
  et cite le papier. Coût : quasi zéro.
- **Pourquoi ça compte quand même :** un acheteur/investisseur technique qui connaît le terme
  "soundy" (n'importe qui avec un master en langages/sécurité) voit immédiatement "ces gens
  connaissent la littérature, ce n'est pas du bricolage" au lieu de devoir le déduire eux-mêmes.
  C'est un signal de crédibilité gratuit, pas une feature.

### 2. "Boosting Pointer Analysis With LLM-Enhanced Allocation Function Detection" — arXiv 2509.22530, 2025

**D'où ça vient :** recherche web ce jour, requête sur l'hybridation LLM + analyse statique 2025.
Lien : https://arxiv.org/pdf/2509.22530

**Ce qu'il dit :** l'analyse par pointeurs (savoir "cet objet créé ici est-il le même que celui
utilisé là-bas") rate les fonctions d'allocation custom (factories, wrappers) que les heuristiques
classiques ne reconnaissent pas. Le papier utilise un LLM pour CLASSIFIER ces patterns ambigus —
pas pour écrire du code, juste pour dire "ceci ressemble à une factory".

**Pourquoi c'est pertinent pour SPARDA précisément :** `[GAP VÉRIFIÉ]` la catégorie
`unverified-guard` de `src/ubg/blindspots.js:101-105` ("a guard trusted only by NAME, never seen
to deny") est exactement ce type de trou — un pattern DI/factory (NestJS, Medusa) que le
marcheur AST actuel ne peut pas résoudre structurellement. Le système à deux niveaux
`verified`/`asserted` existe déjà dans le code (`src/ubg/apocalypse.js:422`,
`src/ubg/nestjs.js:22,60-177`) — **il manque juste le producteur du 3ème niveau.**

**Ce que ça doit produire en code :**
1. Nouveau module `src/ubg/llm-resolve.js`.
2. Il itère les candidats `unverified-guard` (et équivalents factory/DI) sortis de `blindspots.js`.
3. Pour chacun, un prompt MCP sampling **scopé au snippet ambigu seulement** — jamais le fichier
   entier (respecte `CLAUDE.md` règle 1 : "the host never pays for SPARDA's intelligence").
4. La réponse devient un **candidat**, jamais un fait admis directement.
5. **Le point le plus important — la vérification structurelle après coup :** le candidat doit
   être re-checké contre le graphe réel (la classe/méthode référencée existe-t-elle vraiment ?
   le chemin de deny existe-t-il structurellement ?). Si oui → nouveau champ
   `meta.llmAsserted = true, meta.verified = false` — jamais confondu avec `verified`. Si non
   vérifiable → rejeté, reste dans `blindspots.js` tel quel. **Ne jamais laisser un guess LLM
   entrer le graphe sans vérification structurelle — c'est le même principe qui a produit
   E-022/E-025/E-026 (faux PROVEN) si on saute cette étape.**

### 3. "Interleaving static analysis and LLM prompting" — Thakur et al., UC Davis, *STTT*, 2025

**D'où ça vient :** même recherche web. Lien : https://thakur.cs.ucdavis.edu/assets/pubs/STTT2025.pdf

**Ce qu'il dit :** au lieu de lancer le LLM une fois sur tout le problème, on **interleave** —
l'analyseur statique tourne, bloque sur un trou précis, construit une question ciblée à partir
du contexte structurel qu'il a déjà, interroge le LLM juste pour CE trou, reprend. Appliqué à
l'inférence de specs d'erreur dans du code C.

**Pourquoi c'est pertinent :** c'est le PATTERN d'orchestration pour l'idée #2 ci-dessus — pas
un nouveau algorithme, la preuve que la méthode "static analysis bloque → question ciblée →
LLM répond → vérification → reprise" est une pratique publiée en 2025, pas une improvisation.
Confirme que le point 5 de la liste ci-dessus (vérifier avant d'admettre) est la partie que
la littérature identifie comme critique — ce n'est pas SPARDA qui invente la prudence, c'est
l'état de l'art qui l'exige.

---

## PARTIE 2 — Au-delà de la science : ce qui manque, y compris pour moi en tant qu'IA

Zak a demandé : *"qu'est-ce qui te rendrait 10x meilleur, qu'est-ce que les géants veulent
sans savoir le construire."* Voici les idées, classées par ce qui est vérifié vs déduit.

### A. `sparda_prove` — exposer la preuve comme outil MCP en direct, pas juste en CLI/CI

`[GAP VÉRIFIÉ]` : `grep -rn "apocalypse|verdictOf" src/server/*.js` → **zéro résultat.** Le pont
MCP (`src/server/stdio.js`, ce qui me connecte réellement moi, une IA, à l'app) expose
aujourd'hui UNIQUEMENT les routes de l'app cible comme outils. Il n'expose PAS la couche de
preuve du compilateur elle-même.

**Concrètement, ce que ça veut dire pour moi, là, maintenant :** dans cette session, j'ai dû
lancer `node src/index.js apocalypse` en Bash et parser la sortie texte à la main. Si SPARDA
exposait un outil MCP `sparda_prove(route)` que je pouvais appeler PENDANT que j'écris du code
— pas après, en CI — je saurais **avant de proposer un diff** si la route que je viens de
modifier casse une garde. C'est la différence entre un correcteur orthographique qui souligne
en rouge pendant que j'écris, et un correcteur qui m'envoie un rapport par email le lendemain.

**C'est exactement le genre de chose que les géants (Cursor, GitHub Copilot Workspace,
Anthropic elle-même) veulent** — un signal de sécurité structurel, actionnable PENDANT la
génération, pas après — et aucun ne l'a, parce qu'aucun n'a de graphe compilé déterministe à
requêter en quelques millisecondes. SPARDA a déjà le graphe (la partie dure). Il manque juste
le tool MCP qui le sert.

**Effort :** faible-moyen — pas de nouveau moteur, juste un wrapper MCP autour de
`src/ubg/apocalypse.js` déjà existant, exposé via `src/server/stdio.js`.

### B. Le stitching cross-repo / cross-service — prouver une violation qui traverse deux apps

`[GAP VÉRIFIÉ]` : recherché "federat/cross-repo/multi-repo/stitch" dans le code → rien de ce
mécanisme précis n'existe. **Distinct de `docs/COLLECTIVE-IMMUNITY.md`, vérifié en le lisant** :
collective-immunity fait du pattern-matching rétrospectif ("est-ce que ce bug a déjà été vu
ailleurs dans le monde"), pas du graph-join en direct entre DEUX services précis de la MÊME
organisation.

**Le problème réel que ça règle :** la quasi-totalité des vraies apps d'entreprise ne sont pas
des monolithes — ce sont des microservices qui s'appellent entre eux en HTTP/gRPC/queue.
Aujourd'hui, `ubg` compile UN repo à la fois. Une BOLA qui traverse deux services (le service A
passe un ID utilisateur non re-vérifié au service B, qui lui fait confiance aveuglément) est
**invisible pour tout le monde** — CodeQL, Semgrep, Snyk sont tous mono-repo par construction.

**Pourquoi les géants le veulent et ne l'ont pas :** c'est LE problème de sécurité #1 des
architectures microservices à grande échelle (mouvement latéral / violation de frontière de
confiance), et zéro vendeur SAST majeur ne le résout parce qu'aucun n'a l'artefact de base
(un graphe par service, committé, léger) nécessaire pour le faire sans infra centralisée.
SPARDA a déjà cet artefact (`ubg.json` par repo, dans git) — le zéro-infra devient ici un
avantage structurel, pas juste philosophique : chaque repo committe son graphe, une passe de
stitching en consomme N sans qu'aucun n'ait besoin d'accès réseau aux autres.

**Effort :** moyen-haut — nouveau module qui prend N `ubg.json`, matche les edges HTTP sortants
d'un graphe aux entrypoints d'un autre (par path + méthode), étend `apocalypse` pour tracer
un finding à travers la jointure.

### C. Preuve incrémentale — `apocalypse` qui se met à jour à l'édition, pas à la recompilation

`[GAP RAISONNABLE, pas vérifié par une recherche exhaustive]` : chaque run de `ubg`/`apocalypse`
recompile tout depuis zéro (mesuré ce jour : ~1.4-1.7s sur des petites apps, dominé par le
coût fixe). Rien dans le code lu ne suggère un mode incrémental (diff d'un seul fichier changé
→ mise à jour partielle du graphe). À vérifier avant de coder — pourrait déjà exister sous un
nom que je n'ai pas grepé.

**Ce que ça donnerait :** au lieu de "lance apocalypse après avoir fini", un agent (moi,
Cursor, Devin) aurait un retour en quelques dizaines de millisecondes par édition — à la
vitesse d'un vérificateur de types, pas d'une CI. C'est la version "10x plus vite" de l'idée A.

### D. `heal` existe déjà — et c'est probablement la meilleure carte du jeu, sous-vendue

`[GAP VÉRIFIÉ EN LISANT LE CODE]` : `src/commands/heal.js` — ce n'est PAS une idée à construire,
**c'est déjà construit et ça fait exactement ce qu'un géant comme GitHub (Copilot Autofix)
n'a pas** : Copilot Autofix propose un patch *plausible* (LLM, probabiliste). `heal` propose un
patch et **le fait passer par une porte qui ne s'ouvre que si** : le replay contre les vraies
requêtes enregistrées correspond à l'attente, les lois du compilateur tiennent (`verify`),
et `apocalypse` ne trouve aucune régression critique/haute ni garde supprimée
(`src/commands/heal.js:5-8`). *"Whoever writes the fix, the machine judges it."*

**Ce n'est pas un item pour la partie moteur — c'est un item pour le kill-list/marketing.**
`heal` est enterré comme commande #4 sur 15 dans le README. C'est probablement la fonctionnalité
la plus défendable du produit entier, et personne ne la voit.

---

## PARTIE 3 — Le nom : "sparda" seul vs "sparda-mcp" partout

**Ce que Gemini a trouvé** — vérifié : "Isparta" est la ville turque, orthographe turque du grec
"Sparta" (préthèse phonétique turque : le turc ajoute un "i" devant les mots commençant par
s+consonne — même phénomène qu'Istanbul/İzmir historiquement). Ville réelle, ~230 000 habitants,
"ville des roses". `[MESURÉ via recherche web ce jour]`

**Le vrai calcul, avec ce que j'ai déjà trouvé la semaine dernière (audit du 17/07) :**
Il y a en fait DEUX collisions distinctes, pas une :
1. "Sparda" seul → collision majeure avec Devil May Cry (franchise mondiale, Netflix 2025) —
   confirmée, 9/9 résultats de recherche.
2. La racine "Spart-" en général → une constellation encore plus large : Isparta (ville
   turque), Spartan Race (marque fitness majeure), Sparte/300 Spartiates (contenu
   historique/militaire massif), Spartacus. N'importe quel nom proche de "Sparte" phonétiquement
   hérite d'un peu de ce bruit.

**La bonne nouvelle, et la réponse directe à ta question "c'est préjudiciable ?" : NON, pas sur
le SEO — c'est l'inverse.** "sparda-mcp" est **plus spécifique** que "sparda" seul, donc il
évite en grande partie CES DEUX collisions — chercher "sparda-mcp" ne remonte ni Devil May Cry
ni Isparta ni Spartan Race, parce que "-mcp" désambiguïse complètement. Le suffixe qui semblait
être un problème de perception est en fait un **bouclier SEO involontaire.**

**Le seul vrai coût du suffixe reste celui déjà identifié le 17/07** : la perception catégorielle
("on dirait un outil MCP de plus parmi 200"), qui se règle par le badge/case-studies/README —
pas par un rename. Rien de nouveau ici ne change cette conclusion, ça la renforce : garder
"sparda-mcp" partout est correct, cohérent, et même défensivement bon sur l'axe découvrabilité.

---

## PARTIE 4 — La pépite du 2026-07-28 : la preuve qui s'expédie (why-provenance comme certificat)

> **Date :** 2026-07-28 · **Origine :** recherche croisée (5 domaines) + un brief géant envoyé à
> une IA puissante externe, puis **audité honnêtement** contre l'architecture réelle de SPARDA.
> De toute la réponse externe, UNE idée a survécu à l'audit sans violer un invariant. La voici,
> avec ses pièges — pas gonflée.

### L'idée en une phrase

Quand SPARDA dit `PROVEN`, il **livre l'arbre de dérivation** de cette preuve — la *lignée*
(why-provenance) qui dit « ce fait tient PARCE QUE ces arêtes d'AST, ce garde résolu, cette
absence de bypass ». La machine du user (ou un client MCP, ou un auditeur) **re-valide l'arbre
contre l'AST brut en quelques ms, sans relancer l'analyse complète, sans solveur SMT.**

### Pourquoi c'est LA pépite (et pas les autres pistes de la réponse externe)

- Ça transforme ta thèse `"on ne ment pas"` en **`"voici la preuve, vérifie-la toi-même"`** — le
  seul vrai avantage défendable de SPARDA (soundness) devient un **artefact expédiable et
  auditable**, pas une promesse. C'est ton pitch, rendu tangible.
- **Zéro nouvel invariant cassé** : déterministe (l'arbre est une fonction pure de l'AST), offline
  (aucun réseau), l'hôte ne paie rien de lourd (validation = re-check d'arêtes), aucune nouvelle
  dépendance runtime (règle #7), et le vérifieur d'arbre est **naturellement indépendant** de
  l'analyseur (règle #6 : il lit l'arbre + l'AST, il n'importe pas l'extracteur).
- C'est du **proof-carrying code** (PC3, ASE 2024 wksp) appliqué à la sécurité — et surtout : ta
  **boucle témoin (ADR-074) EST déjà** un PCC. La provenance ne l'invente pas, elle la **muscle**
  en un certificat complet. Donc c'est un pas *additif* sur un organe existant, pas un paradigme.
- Réf réelle : **S. Köhler, B. Ludäscher et al., "Declarative Datalog Debugging for Mere
  Mortals"** — en analyse déclarative, la why-provenance produit **nativement** le témoin. Si un
  jour SPARDA a un cœur Datalog, l'arbre de dérivation du moteur EST la preuve, gratuitement.

### Les pièges (l'audit honnête — à ne pas oublier en codant)

1. **Ça NE requiert PAS de réécrire SPARDA en Datalog.** L'idée est portable sur le modèle témoin
   ACTUEL : instrumenter la dérivation d'UNE obligation (ex. O1) pour émettre `{ verdict, proof:
   [node, node, guardResolved, noBypass] }`. Le cœur Datalog est un **pari SÉPARÉ et bien plus
   gros** (voir §pièges Datalog ci-dessous), à ne pas confondre avec cette pépite-ci.
2. **Explosion de taille** : sur des chaînes interprocédurales profondes (novu, twenty), un arbre
   de preuve peut gonfler (la réponse externe cite >5 Mo pour un endpoint comme seuil d'échec).
   Mitiger : résumer les sous-arbres via les résumés de fonction déjà mémoïsés (compositionnalité),
   ne matérialiser que les arêtes soundness-critiques, hasher le reste.
3. **La provenance certifie ce que l'analyse a DÉRIVÉ, pas ce que l'analyse n'a PAS VU.** Un
   certificat de `PROVEN` doit donc TOUJOURS embarquer l'état de prémisse (`measured` /
   `unmeasured`, ADR-091) — sinon on expédie une belle preuve locale sur un app à moitié vu
   (invariant #4). Le certificat = preuve de dérivation **+** attestation de couverture.

### Pièges Datalog (le gros pari, séparé — noté ici pour ne pas le reconfondre)

- Un moteur Datalog pur-JS comme moteur de dérivation universel (règles-comme-données par
  framework) est séduisant et déterministe, MAIS la difficulté n'est **jamais** la jointure —
  c'est la **discipline de sûreté**. La règle jouet proposée par l'IA externe
  (`MiddlewareBound(mw,route) :- apply(mw), forRoutes(route)`) est **UNSOUND** : elle attacherait
  un `LoggerMiddleware` à une route → adoucit une vraie faille = exactement le faux négatif que
  l'ADR-089 empêche (match de méthode strict, non-sur-recouvrement littéral, preuve-de-refus,
  "un logger n'est pas un garde"). Toute règle framework doit encoder CETTE discipline AVANT
  d'être écrite.
- **"Vérifié contre des fixtures" ≠ "sound".** Une règle gelée qui passe 10 fixtures peut faire
  un faux `PROVEN` sur le 11ᵉ app inconnu. Donc une règle synthétisée-LLM-au-build ne bouge que
  dans la **direction surfaçable** (ajouter findings / déclarer angle mort), **jamais** dans la
  direction qui cache — sauf si elle est aussi **deny-prouvée à l'exécution** (le chemin vérifié
  de l'ADR-089).

### Le prototype d'une semaine (le petit pari sûr)

Sur le modèle témoin actuel, pour l'obligation O1 sur un app réel (nestjs-realworld) :
1. Quand `admitWitnesses`/`checkGraph` conclut `PROVEN` sur une route, émettre un **objet preuve**
   `{ route, obligation:'O1', edges:[{kind:'guard-resolved', file, line}, {kind:'no-bypass', …},
   {kind:'reaches-write', …}], premise:'measured' }`.
2. Écrire un **micro-vérifieur indépendant** (< 150 lignes) qui prend cet objet + l'AST brut et
   re-confirme chaque arête, sans toucher l'analyseur. Sortie : `CERTIFIED` / `REJECTED`.
3. Le brancher comme sortie de `sparda prove` (et plus tard comme champ MCP `sparda_prove`).
   Test de falsification : ablate un garde (falsify, ADR-077) → le certificat doit devenir
   `REJECTED`. C'est la preuve que le certificat n'est pas décoratif.

**Verdict honnête :** ce n'est pas un billet magique (il n'en existe pas — Rice). C'est le seul
morceau de la chasse "billet magique" qui soit **réel, additif, sans violer un invariant, et
vendeur** : la preuve cesse d'être une promesse et devient un fichier que n'importe qui peut
re-vérifier.
