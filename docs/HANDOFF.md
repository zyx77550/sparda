# HANDOFF — current state

> Living document. Describes the **present**. Rewritten at the end of every
> session that changes anything (history goes to `sessions/`, not here).

**Last updated:** 2026-07-29 · **Dernière brique : #37 (ADR-094, E-107) — voir plus bas.** · **Brique #37 — La porte de release vérifie l'état distant, publication automatisée.** La version 0.71.0 est passée au travers d'une faille de la porte de release : le tag existait localement et pointait sur HEAD, mais n'avait pas été poussé sur `origin`. Conséquence : la porte l'a laissé passer, mais l'arbre distant était invisible pour le reste du monde. **Correctif (ADR-094) :** `scripts/release-gate.mjs` vérifie désormais via `git ls-remote` que le tag existe sur `origin` et qu'il pointe **exactement** sur les mêmes octets que le HEAD local. Cette règle ferme l'échappatoire locale. De plus, une intégration GitHub Actions `.github/workflows/release.yml` a été ajoutée pour publier sur NPM et le VS Code Marketplace automatiquement dès qu'un tag est poussé (Mission 2). **Version 0.71.1.**
**Brique #31 — Le corpus rejoué avec la prémisse : le seul `PROVEN` sur du vrai code est retiré, par mesure.** La brique #30 avait câblé `premiseFor` sur les 5 commandes de `src/commands/` et scellé le tout par une règle. **La règle regardait un RÉPERTOIRE** — donc elle reproduisait le défaut qu'elle scellait, un cran au-dessus. Scan élargi à `src/`, `scripts/`, `bench/`, `tools/` : **deux consommateurs de plus notaient sans oracle**, que personne n'avait comptés (E-086) — `proveApp` dans `src/server/stdio.js`, c'est-à-dire l'outil MCP `sparda_prove`, **le seul consommateur qui AGIT sur le mot sans lire le code** (un agent demande, reçoit `PROVEN`, commit), et `bench/repro.mjs`, qui écrit un verdict dans `bench/route-proof.json`, le fichier de preuve que le README cite. Plus `scripts/corpus-oracle.mjs`, le trou connu. Les trois appellent `premiseFor`. Un « noteur » est désormais identifié par son IMPORT de `verdictOf`/`badgeFor` (le définisseur n'est plus pris pour un consommateur, et aucun futur noteur n'est exclu par son nom) ; chaque exemption porte une raison et est **vérifiée par la machine** (un module exempté pour « n'énonce aucun mot » casse la suite dès qu'il en énonce un). **Le rejeu du corpus, qui est ce qui rend tout ça réel :** les 7 géants re-clonés, re-mesurés, chaque arbre noté DEUX FOIS (prémisse off / prémisse on) pour que l'effet de la prémisse ne puisse jamais être confondu avec la dérive amont. Résultat : **les 7 lowerings ont un oracle** (convention, boot-free) ; six ne contredisent rien ; **nocodb — l'app qui portait l'unique `PROVEN` du dépôt sur du vrai code — est `PREMISE_GAP`**, sur une route nommée que le framework sert et que le compilateur n'a jamais vue : `POST /auth/google/genTokenByCode`, un endpoint de login. **Le corpus ne contient plus aucun `PROVEN`** — c'est l'état honnête du produit sur du code qu'il n'a pas écrit. **Cause racine trouvée PAR l'oracle** (E-087, OUVERTE volontairement) : `oracle-static.js` lit un template literal sans substitution (le framework sert cette route, point), `nestjs.js` ne gère pas `TemplateLiteral` du tout — 16 décorateurs backtick dans nocodb, 15 avec `${…}` (écartés par conservatisme), le 16e = le gap, l'arithmétique confirme. Le correctif est monotone dans le sens sûr mais **bougerait les chiffres du corpus une 2e fois** : il ship seul, avec fixture + mutant. C'est exactement la règle d'indépendance ADR-082 qui se paye : un oracle qui réutiliserait la marche de l'extracteur aurait reproduit l'omission des deux côtés du diff. **Baseline re-gelée avec ce qui manquait** (E-088) : `premiseOracle`/`premiseProbed`/`premiseGaps` par app (un oracle qui devient silencieux est une régression de l'organe d'honnêteté lui-même ; et « 0 gap » ne veut pas dire la même chose à 591 routes énumérées qu'aux **1** de cal.com), et `_pinned: {commit, date}` par app — sans quoi une dérive est ININTERPRÉTABLE (« dub 579 → 593 : on s'est amélioré, ou dub a livré 14 routes ? ») et se re-baseline par réflexe, ce qui est exactement comment une régression devient la norme. L'entrée `nocodb` pointait la RACINE du monorepo, qui ne détecte plus rien en amont → `packages/nocodb`. Suite **1099** (+5), mutants **83/83** (+2), ESLint clean, 4 deps. **Honnêteté sur ce rejeu :** l'ancien `PROVEN` de nocodb n'est pas re-jouable à l'identique — aucun commit n'avait été enregistré, et le répertoire d'app a changé ; ce qui EST isolé proprement, c'est l'effet de la prémisse (même arbre, deux notations). **Prochaine brique : E-087**, le `TemplateLiteral` de `nestjs.js`. 

**Brique #32 — Première infiltration d'un géant : `applyDecorators` (ADR-084).** Cible choisie en notant les RAISONS des 7 verdicts, pas les verdicts : sur novu, **1003 étapes de garde, 71 prouvées (7 %)**, et les 932 non prouvées sont **exactement quatre noms de décorateurs**. L'A/B qui nomme la cause : immich, même framework, **459/459** — immich enregistre sa garde **globalement** (déjà géré), novu l'applique **par contrôleur** via l'API de composition officielle de NestJS, `applyDecorators(UseGuards(CommunityUserAuthGuard))`. SPARDA appariait `RequireAuthentication` sur son NOM et s'arrêtait : la résolution de garde ouvre une CLASSE, ce symbole est une FONCTION. Le `canActivate` deux sauts plus loin étend `AuthGuard` de `@nestjs/passport` **et** lève `UnauthorizedException` — la chaîne de preuve existait de bout en bout, seul le premier maillon était infranchissable. **Correctif :** un décorateur est ce qu'il FAIT, pas ce qu'il s'appelle (même principe qu'E-060, un cran plus haut). Union des gardes sur toutes les branches ; une branche dont le décorateur retourné est illisible est **DÉCLARÉE en risque high** — les 340 gardes de novu sont créditées (vrai de la configuration lue) ET novu ne peut plus atteindre PROVEN sur leur force (une configuration sœur n'a pas été ouverte). **`SetMetadata` cesse de compter comme garde**, mais uniquement là où aucune garde globale prouvée ne lit la clé : la règle générale **effacerait tout le modèle d'auth d'immich** (253 gardes vérifiées supprimées, 253 routes non gardées inventées) — attrapé par un test écrit deux sessions plus tôt pour une autre fonctionnalité. **Mesuré, isolé (même clone, même commit, extracteur permuté) : novu 1003 gardes / 71 prouvées → 782 / 411 ; immich 459/459 inchangé** (témoin de non-régression). Routes, couverture et findings intacts : ce changement déplace ce que SPARDA sait PROUVER de la protection, rien d'autre. Suite **1111** (+12), mutants **88/88** (+5), 4 deps. **Prochain verrou de novu : la couverture à 14,8 %** — les gardes sont à moitié réglées, l'autre moitié est que 85 % de son comportement reste non résolu (profondeur DI, paquets workspace, entrées `dist` non construites). twenty est la cible la moins chère ensuite : une seule règle (14× IRREVERSIBLE_OBSERVABLE) le sépare d'un verdict propre.

**Brique #33 — Twenty : le brief était faux, et c'est la mesure qui l'a dit (ADR-085).** La mission était « une seule règle, 14× IRREVERSIBLE_OBSERVABLE, sépare twenty d'un verdict propre ». Avant de toucher à la règle, deux chiffres : **SPARDA parsait 33 des 6090 fichiers de twenty et voyait 147 de ses 579 routes — 25 %.** « Une seule règle » était un artefact d'aveuglement quasi total. **E-092 :** `CANDIDATE_RE` listait des NOMS de décorateurs ; twenty enregistre **54** resolvers en `@MetadataResolver`/`@CoreResolver`/`@AdminResolver` et **un seul** en `@Resolver`. Rien ne s'en plaignait parce qu'**un fichier jamais ouvert ne produit ni route, ni skip, ni unknown handler** — la forme de perte exacte de la Direction 3. **E-093 :** `@Post(['a','b'])` retombait sur le préfixe du contrôleur, écrasant quatre contrôleurs de webhooks sur un `POST /` fantôme — la route qui portait les deux findings `high` tenant le verdict. Correctif : match par SUFFIXE (`[A-Za-z]*Controller|[A-Za-z]*Resolver`, la règle ADR-055 qui n'avait jamais atteint le pré-filtre) et **une route par élément** du tableau — jamais `elements.find(...)`, qui perdrait un endpoint vivant en silence. **Résultat : 147 → 579 routes, 441 → 1868 gardes (157 → 583 prouvées), 14 → 65 findings (2 → 28 high), 33 → 128 fichiers parsés en 4,0 s.** twenty va donc **plus mal**, et c'est le bon résultat : les 26 nouveaux high sont réels — dont **`POST /graphql/deleteCurrentWorkspace`, un vrai saga hole** (annulation de l'abonnement Stripe, irréversible, hors transaction, puis soft delete ; si l'écriture échoue le client n'a plus d'abonnement et garde un workspace actif), qui dormait dans un fichier jamais ouvert. **Refusé volontairement :** la suppression des findings de webhook au motif qu'un orchestrateur externe les compense par retry — sain comme argument, inadmissible comme règle : elle repose sur trois prémisses que SPARDA ne peut pas vérifier (l'orchestrateur réessaie, le handler remonte bien un 5xx, l'appel externe est idempotent). Créditer une compensation non vue, c'est inventer de la protection (Direction 2, sens interdit). Corpus décomposé grâce à `_pinned` : twenty re-épinglé (le déplacement du pin vaut à lui seul `couverture 81,6 → 81,4`, le reste est ce changement) ; **nocodb gagne aussi : 358 → 566 routes, couverture 40,3 → 47,7 %.** Suite **1119** (+8), mutants **92/92** (+4), 4 deps. **Ni twenty ni nocodb n'approchent PROVEN, et ce n'est plus un problème de parsing** : 28 high et 139 angles morts high sur twenty. La question suivante est de savoir si ces 28 sont réels, famille par famille.

**Brique #34 — Les 28 high de Twenty, triés (ADR-086).** Avant de toucher à quoi que ce soit : 28 findings high, mais **14 routes distinctes**, et **une seule route en portait 12**. `POST /graphql/sendEmail` se résout, à travers un graphe DI de stratégies (Gmail / Microsoft / IMAP-SMTP / groupe), en autant de feuilles — chacune un nœud d'effet, chacune un finding. **43 % des high de l'app étaient un seul problème compté douze fois.** `collapseFloods` (ADR-071) encode déjà « un signal qui se répète perd son contraste », mais il replie une règle qui tire sur BEAUCOUP DE ROUTES ; il n'a aucune notion de la même règle tirant plusieurs fois sur UNE route — ce que produit exactement un fan-out DI. **Correctif (E-094) : un finding par (route, règle).** L'unité d'un finding est l'unité de sa CORRECTION : réparer cette règle, c'est envelopper l'envoi et l'écriture ensemble, ou ajouter un undo — un changement par ROUTE. Compter par feuille décrivait la profondeur de résolution de l'analyseur, pas le problème de l'utilisateur. **twenty 28 → 14 high, nocodb 22 → 13 — et l'ensemble des routes signalées est IDENTIQUE avant/après.** C'est tout l'argument : correction de contraste, pas suppression — mêmes routes, même sévérité, même porte, chaque appel nommé dans le message et chaque nœud conservé dans `evidence`. Le rung d'immunité innée (ADR-072) survit : plusieurs appels génériques ne fabriquent jamais un `high`. **Ce qui n'est PAS corrigé : les 14 restants sont réels** — chacun est une route qui fait un appel externe irréversible (paiement Stripe, envoi d'e-mail) tout en mutant l'état, sans chemin de compensation, dont `POST /graphql/deleteCurrentWorkspace`. twenty reste NOT_PROVEN : le comptage honnête a rendu le rapport lisible, il n'a pas rendu l'app sûre, et ce n'était pas son rôle. **E-095 — la PR #30 n'a fusionné que la moitié d'elle-même** : elle portait deux commits, le merge n'a pris que le premier ; GitHub avait fusionné une tête de PR non rafraîchie. Attrapé en **re-mesurant après le merge au lieu de lui faire confiance** (`git merge-base --is-ancestor` → non). Rejoué en PR #31. L'habitude à garder : « mergé » est une affirmation comme une autre, elle se vérifie en une commande. Suite **1128** (+9), mutants **95/95** (+3), 4 deps.

**Brique #35 — La porte de RELEASE, puis le verrou de novu : les deux fois, c'était une lecture fausse (ADR-087, ADR-088).**

**(1) La porte de release.** v0.69.0 a été publiée depuis un commit qui n'était pas la tête de ce qui était fusionné : elle portait ADR-084 et ni ADR-085 ni ADR-086, donc pendant quatre heures le paquet sur npm analysait une app NestJS à un quart de sa taille. **Rien n'était cassé : tous les tests passaient au commit publié.** `prepublishOnly` lançait `vitest run`, et `vitest run` était vert, parce que le défaut n'était jamais dans le CODE — il était dans QUEL COMMIT partait, et dans les artéfacts que personne n'avait mis à jour (pas d'entrée CHANGELOG, aucun tag depuis v0.68.0). C'est le contrat du projet retourné contre le projet : « on n'a pas pu mesurer » et « on a mesuré et rien ne cloche » sont deux états, un cran au-dessus du code. `scripts/release-gate.mjs` demande désormais : arbre propre, sur `main`, HEAD identique à `origin/main`, version absente du registre, `server.json` (×2) + `glama.json` d'accord, titre `## [version]` au CHANGELOG, tag `v<version>` sur HEAD, puis suite + mutants + corpus. **Aucune échappatoire**, et c'est une affirmation sur les ENTRÉES, pas sur des chaînes : la porte ne lit aucun `process.argv` et exactement une variable d'environnement, `SPARDA_CORPUS`, qui ne peut qu'AJOUTER une vérification. Les décisions vivent à part (`scripts/release-checks.mjs`, pures) pour que les tests leur tendent l'état exact d'où 0.69.0 est partie et exigent le refus — une porte qui n'existe qu'en script ne se teste qu'au grep, et son propre en-tête contient le mot `--force` pour le refuser. Ce qu'elle ne peut pas mesurer, elle le nomme : `SKIPPED` (corpus sans clones), `UNVERIFIED` (registre injoignable, distingué d'un E404 qui, lui, passe).

**(2) Le verrou de novu — la couverture à 14,8 % n'était pas le problème.** Avant de la « remonter », la mesure : sur **2039 sauts de DI par constructeur, 1479 ne résolvaient rien** — `PinoLogger` 307 fois, puis `IntegrationRepository`, `EnvironmentRepository`, `SubscriberRepository`, tous les dépôts par lesquels l'app écrit. Tous échouaient pareil : un paquet du monorepo (`@novu/dal`, `@novu/application-generic`) résout vers son point d'entrée, et ce point d'entrée est un **barrel** — soixante `export * from './repositories/…'` et pas une déclaration de classe. `resolveExportedFunction` traverse les barrels depuis l'ère `lib/auth/index.ts` ; **les classes n'ont jamais eu le jumeau** (E-097). **Pourquoi c'est de la soundness et pas de la précision :** un saut de DI non résolu ne laisse AUCUNE trace, donc une route dont tout le comportement vit derrière le barrel se résout à zéro comportement — et une route sans comportement n'a rien à signaler. La fixture le dit : `POST /orders/purge/:tenant` supprime toutes les commandes d'un tenant sans garde et ne produisait **aucun finding**, en couverture `unknown` (0/0) et verdict `SURFACE`. **Mesuré, isolé** (mêmes clones, mêmes commits épinglés, résolveur permuté, corpus joué deux fois) : **novu PARTIAL → NOT_PROVEN, écritures 52 → 132, lectures 792 → 1464, findings 0 → 4** ; twenty / immich / nocodb / ghostfolio **octet pour octet identiques** (immich est le témoin : même framework, pas de barrel d'espace de travail non construit). **novu va donc plus mal, et c'est le résultat** : son `PARTIAL` propre reposait sur 80 écritures en base que ses routes effectuent et que SPARDA ne voyait pas. La couverture, elle, bouge à peine (14,8 → 15,1 %) — ouvrir les dépôts révèle aussi leurs propres appels non résolus. C'est la réponse honnête à « remonte la couverture » : le chiffre n'a jamais été le problème, le sujet manquant l'était.

**E-098 — le snapshot du corpus était périmé depuis quatre releases et rien ne le disait.** En isolant E-097, cal.com dérivait (`routes 175 → 177`) **avec ET sans** le changement : sa baseline datait du 22/07, ADR-084/085/086 ont toutes atterri après, et aucune de ces sessions n'avait de clone cal.com — l'oracle affichait `SKIP` et le changement partait non mesuré sur elle. Ce n'est pas un bug de l'oracle (sauter une app absente **en le disant** est correct) : le manque, c'est que « SKIP » ne s'accumule nulle part. Les six géants clonables ont été épinglés sur leur commit de baseline et re-mesurés en une passe ; **dub n'a pas pu être cloné ici et reste non mesuré — dit, pas caché.** Règle : **une vérification sautée est une dette, pas un feu vert.**

Suite **1154** (+9), mutants **102/102** (+7), ESLint 0, Prettier clean, 4 deps. **Ce qui reste ouvert, précisément :** 750 des angles morts de novu sont des `.execute(command)` sur des use cases injectés, comptés comme `db_read` à table inconnue — le repli SQL brut se déclenche sur le NOM de la méthode sans aucune provenance base de données, donc une app CQRS voit chacun de ses sauts de DI facturé comme une requête illisible. **Corriger l'étiquette ne suffit pas seul** : ce fantôme est aujourd'hui la seule trace qu'un saut non résolu laisse où que ce soit, donc il doit être REMPLACÉ par un vrai angle mort `unresolved-call` dans le même changement, jamais simplement supprimé (Direction 1). C'est la prochaine brique, avant les 139 angles morts high de twenty.

**Brique #36 — La famille du mot « non mesuré », et le correctif qui n'était branché nulle part (ADR-091, ADR-092, ADR-093).**

**(1) `PROVEN` était atteignable sur une prémisse que personne n'avait mesurée (E-104).** Un oracle qui **n'a pas tourné** et un oracle qui **a tourné et n'a rien trouvé** produisaient un état aval identique octet pour octet : `available: false` était honnête, et `premiseGaps: 0` — le nombre que le verdict lisait — ne pouvait pas distinguer les deux. C'est la règle 7 du contrat (« n'a pas pu mesurer » ≠ « a mesuré, rien à signaler ») violée **à l'endroit le plus cher que SPARDA possède : le mot `PROVEN`**. Personne ne l'avait vu parce que les 7 géants du corpus sont tous `CONVENTION_ROUTED` : leur prémisse EST mesurée à chaque passage. Le trou était exactement dans les frameworks que le corpus ne contient pas et que les fixtures contiennent — **Express et FastAPI**, les backends les plus courants sur lesquels SPARDA est pointé. Le filet de régression et le terrain sont aveugles à des endroits complémentaires. **Correctif :** la prémisse porte un `basis` — `measured` / `declared` (OpenAPI : le document EST la table des routes, exiger un second témoin serait exiger qu'une carte se vérifie contre elle-même) / `unmeasured` — et `unmeasured` est un barreau PARTIAL. **Jamais un échec de porte** : SPARDA n'exige pas ce qu'elle n'a pas pu mesurer. Mesuré : fixtures lisant `PROVEN` **8 → 1** (celle-là mesurée), `PROVEN` sur prémisse non mesurée **7 → 0**, corpus **0 dérive**.

**(2) Quatre autres surfaces, trouvées en auditant la RÈGLE au lieu des suspects (E-105).** `falsify` notait `score: 1` avec zéro contrôle, `gate` renvoyait `ok: true` en s'abstenant, `speculate` et `immunize` imprimaient `✓ PROVEN` depuis une capsule dont la prémisse n'avait jamais été vérifiée. **Dans les cinq cas le champ honnête était PRÉSENT** — `note`, `abstained`, `(by lookup)`, `available: false`. L'aveu était placé **À CÔTÉ** du titre au lieu d'être **DEDANS**, et c'est le titre qu'un lecteur suit, qu'un tableau de bord trace, sur lequel un job CI branche. La note s'adresse à celui qui soupçonne déjà quelque chose — exactement celui qui n'en a pas besoin. **Un test avait CODIFIÉ l'un d'eux** : `tests/falsify.test.js` portait un cas nommé littéralement *« (vacuously 1) »*. La suite défendait le bug. **Règle gravée :** `null`, et surtout pas `0` / `false` / `[]` — ceux-là sont des RÉPONSES (« on a mesuré, il n'y en a pas ») ; seul `null` dit « il n'y a pas de réponse ici ». Mécanisé dans `tests/unmeasured-is-not-a-pass.test.js`, qui est un **REGISTRE** : tout nouveau champ de titre y ajoute une ligne.

**(3) Et le correctif (2) n'était branché nulle part (E-106) — la vraie leçon de la brique.** ADR-092 a donné à la capsule un `proven` à trois états. Le test passait. Le mutant mourait. Et **aucun des quatre sites d'appel ne passait `premiseBasis`** : dans le produit, le champ valait toujours `null` par défaut, la branche ne se déclenchait jamais, et `sparda immunize` sur une app Express imprimait `✓ PROVEN` exactement comme avant. `immunize` affichait un message `◑ UNMEASURED PREMISE` **qu'aucune entrée ne pouvait produire**. `prove` avait la valeur en portée deux lignes plus haut ; `dossier` construisait la capsule **trois lignes avant** de calculer la prémisse. `immunize` et `genome` n'avaient **jamais** appelé `premiseFor` — violation nue de la règle dure 11 — et `genome` est le pire endroit possible pour ça : il note un graphe, **signe** le résultat en Ed25519 et le fusionne dans un fichier que des inconnus tirent par git. **Pourquoi la règle ADR-083 ne l'a pas attrapé :** elle cherche les consommateurs de `verdictOf`/`badgeFor`. `buildCapsule` est un **second noteur** — il transforme un graphe compilé en `proven`, la même affirmation dans l'artéfact qui VOYAGE. La première version de cette règle était cadrée sur un RÉPERTOIRE, l'amendement l'a élargie au dépôt ; celle-ci était cadrée sur un NOM DE FONCTION. **Les deux fois, le trou faisait exactement la taille du cadrage.**

**Deux bugs de plus, trouvés en corrigeant le premier.** (a) ADR-092 écrivait `premiseUnmeasured ? null : …`, ce qui efface un `false` légitime : la prémisse borne l'ENSEMBLE des routes, et une route absente du graphe ne peut pas racheter une route présente et exposée. Effacer `false` transforme « cette app a une mutation non gardée » en « on ne sait pas » — le même mensonge, pointé dans l'autre sens. **Seul le positif est retenu.** (b) `immunize` fermait la porte CI sur `if (!capsule.proven …)` : `null` est falsy, donc au moment même où le correctif marchait il aurait fait échouer des builds **parce qu'aucun oracle n'était DISPONIBLE** — ce que `premise.js` interdit dans ces mots-là. `=== false` désormais.

**Trois autres commandes rapportaient une mesure partielle comme complète**, trouvées en poursuivant le même audit sur les surfaces restantes (`stitch`, `mirror`, `timeless`, `heal`, `genome`) : `stitch` avalait un service qui ne compile pas et imprimait « no cross-service calls resolved (targets may be dynamic or unrelated) » — la phrase la plus rassurante disponible pour « on a lu la moitié de votre système », alors qu'un BOLA inter-services se trouve **en JOIGNANT** ; `heal --check` annonçait « zero protection lost » sans `baseline.json`, donc sans que `diffGraphs` ait tourné une seule fois ; `timeless replay` annonçait « every tap consumed, zero divergence » sur un vol à **zéro tap** — rien n'avait été virtualisé, donc l'égalité dit que l'environnement d'aujourd'hui a répondu pareil, pas que le code n'a pas changé (le bug de `falsify`, relocalisé).

**Ce qui est gravé, et c'est le livrable durable :** `basisFrom(premise)` est la seule source du basis (neuf copies du même ternaire ont disparu ; son défaut est `'unmeasured'`, donc **oublier de mesurer tombe vers le mot faible**, et cette ligne a son propre test parce qu'elle existe pour l'appelant pas encore écrit) ; la règle structurelle nomme la PROPRIÉTÉ via une liste `GRADERS` au lieu d'un nom de fonction ; et **chaque ligne du registre doit désormais DEUX assertions — EXPRESSIBLE (le champ peut porter `null`) et ATTEIGNABLE (un vrai chemin d'appel le produit)**. Sans la seconde, une suite verte certifie un fil qui n'est pas branché — exactement l'échec que ce projet existe pour refuser, commis par son propre filet de régression. SOUNDNESS 3e/3f, règle dure 11 et 13 mises à jour.

Suite **1216** (+62 sur la brique #35), mutants **124/124** (+22), ESLint 0, Prettier clean, 4 deps. Version **0.71.0** sur les quatre manifestes. **Conséquence assumée pour l'utilisateur :** `sparda immunize` et `sparda prove` sur une app Express/FastAPI retiennent `PROVEN` jusqu'à `--probe`. Code de sortie 0 : le mot est retenu, aucune faute n'a été trouvée, et ce sont deux résultats différents.

**État de publication :** `main` est à `3dab129` ; la branche `claude/sparda-hq-robustness-fy1ttv` porte tout ce qui précède et n'est pas fusionnée. La publication de 0.71.0 demande, dans l'ordre : merge → `git tag -a v0.71.0` sur `main` → `npm run release:check` → `npm publish` → `npm run publish:vscode`. **Toujours ouvert et jamais décidé : `npm run publish:vscode` ne passe pas par la porte** — l'extension part au Marketplace sans que quoi que ce soit vérifie autre chose que son numéro de version. **E-099 reste OUVERTE** (les localisations d'angles morts pointent la mauvaise ligne). Le fantôme `.execute()` (750 angles morts de novu) reste la prochaine brique moteur, et il doit être REMPLACÉ par un vrai angle mort `unresolved-call` dans le même changement, jamais supprimé seul.


**Brique #37 — Un résidu de mutation avait désactivé une porte de soundness sur `main` (ADR-094, ADR-095).**

**Le fait.** `src/ubg/apocalypse.js` portait sur `main` un `if (false)` à l'endroit où `assertedOnlyMutationRoutes` décide si une route n'est gardée que par confiance. Ligne morte ⇒ `assertedMutations` vaut toujours 0 ⇒ le barreau PARTIAL ne se déclenche jamais ⇒ **une route protégée uniquement par une garde NON VÉRIFIÉE lit `PROVEN`**. C'est le générateur de faux PROVEN exact qu'ADR-070 existe pour supprimer, et il est arrivé dans un commit dont le périmètre annoncé était l'automatisation de release. Corrigé à la main dans `3bd59ed` par Zak, qui a lu le diff.

**Personne ne l'a écrit, et c'est ça l'entrée.** `if (false)` est **octet pour octet** la chaîne `repl` d'un mutant qui vit dans `tests/mutation/run.mjs` depuis ADR-070. Le harnais mute un fichier, lance un test, restaure dans un `finally` — et `finally` couvre une exception, pas un processus tué. Ctrl-C, un timeout CI, un OOM : la mutation reste sur le disque et le `git add -A` suivant la commit. **La suite ne pouvait pas le voir** : un mutant qui SURVIT est par construction une mutation qu'aucun test ne détecte. Le seul organe capable de l'attraper était `npm run mutation`, qui coûte dix minutes et n'est pas ce qu'on lance avant un commit.

**Reproduit pendant le correctif, par accident — la meilleure preuve disponible.** Un SIGKILL en cours de course a laissé `src/ubg/llm-resolve.js` muté **avec les handlers de signaux déjà en place** : le harnais passe sa vie dans un `execFileSync` BLOQUANT, donc un signal n'atteint JS qu'au retour de l'enfant, et un SIGKILL ne l'atteint jamais. Le nouveau garde de suite a nommé le mutant exact du premier coup.

**Correctif en trois couches, chacune couvrant ce que la précédente ne peut pas** (ADR-095) : (1) un **journal** écrit AVANT de toucher le fichier, rejoué par la course suivante — une récupération qui dépend du processus mourant n'est pas une récupération ; un journal illisible est FATAL, jamais sauté ; (2) des **handlers de signaux** pour les sorties polies ; (3) **`tests/no-mutant-left-behind.test.js` dans la suite ordinaire** — le harnais connaît déjà toutes ses mutations, donc « l'arbre est-il muté ? » est un lookup, pas un jugement, et ça coûte des millisecondes. Prédicat exact et non une chasse au `repl` : un fichier est muté quand le `find` est ABSENT **et** le `repl` PRÉSENT. Le même fichier échoue aussi quand un `find` ne matche plus — Prettier déplaçant une ligne suffit.

**Et la porte de release ne pouvait publier rien du tout.** `actions/checkout` sur un push de tag produit un HEAD **détaché**, `git rev-parse --abbrev-ref HEAD` répond littéralement `HEAD`, et `treeChecks` le refusait comme « pas sur main » : la toute première exécution du workflow serait morte là. Un HEAD détaché est désormais accepté **uniquement** s'il est octet pour octet `origin/main` — la propriété dont le nom de branche n'a jamais été qu'un proxy ; un checkout détaché de n'importe quel autre commit est toujours refusé (mutant dédié). Et l'origin **injoignable** ne se lit plus comme un tag non poussé : les deux bloquent — une porte qui ne peut pas vérifier ne doit pas certifier — mais le cas injoignable dit `UNVERIFIED` au lieu d'envoyer chercher un tag déjà présent (règle 13, ADR-095 amendant ADR-094).

**Réparé au passage :** `docs/DECISIONS.md` n'était plus de l'UTF-8 valide — le titre d'ADR-094 portait un octet tiret-cadratin Windows-1252 et un retour chariot égaré qui avait mangé une lettre de son propre titre. ADR-094 et E-107 réécrits en entier ; `npm run publish:vscode` et le workflow utilisent maintenant le même `@vscode/vsce` épinglé ; les secrets passent par `env:` au lieu d'être interpolés dans le shell.

Suite **1228** (+12), mutants **128/128** (+4), ESLint 0, Prettier clean, 4 deps, version **0.71.1** sur les quatre manifestes. **La CI GitHub est rouge pour cause de rate limit du compte, pas de défaut de code** — vérifié : les jobs meurent en 2-11 s sans produire de logs, y compris sur des commits antérieurs à ce travail.

**Reste à faire pour publier 0.71.1 :** `git tag -a v0.71.1` + `git push origin v0.71.1`, ce qui déclenche le workflow. **Toujours ouvert :** E-099 (localisations d'angles morts sur la mauvaise ligne) ; le fantôme `.execute()` (750 angles morts de novu) qui doit être REMPLACÉ par un vrai angle mort `unresolved-call` et jamais supprimé seul ; le logo VS Code fait 1536×1024 non carré pour 2,11 des 2,12 Mo du paquet — `vsce package` l'accepte (vérifié), donc c'est de la qualité, pas un bloquant.

**Brique #38 — L'oracle runtime ne marchait sur aucune app Express en ESM, et c'est le test le moins cher qui l'a trouvé (ADR-097).**

**Le fait.** `sparda prove --probe` sur la `demo-app` **que SPARDA embarque lui-même** — 5 routes, Express, qui boote et répond en HTTP sur `:3456` (vérifié au curl) — répondait `timeout waiting for Express routes`, laissait `premise.basis = unmeasured`, et donnait comme raison « the app did not boot, or exposes none ». L'app avait booté parfaitement.

**La cause, mesurée et non déduite.** Le shim intercepte `require('express')` en patchant `Module._load`. **Sur Node 22, un `import express from 'express'` en ESM ne passe jamais par `Module._load`.** Expérience minimale : hook installé via `--import`, import ESM → rien ; même hook via `--require` avec `require('express')` → intercepté immédiatement. Le shim s'installait et n'interceptait plus rien, définitivement.

**Le commentaire confiant ÉTAIT le bug.** `express-shim-esm.mjs` affirmait l'inverse dans son propre en-tête : *« most Express apps — even those using ES module syntax — still resolve 'express' through the CJS loader … regardless of whether the entry is .mjs or .js with type:module »*. Faux sur Node 22. Exactement ce que `BRIEF-FOR-A-BREAKER.md` annonce : *le bug vit là où se trouve le commentaire confiant.*

**Pourquoi ça a survécu.** Le seul test de sonde vivante écrivait sa fixture en `const express = require('express')`. **Le chemin ESM n'avait jamais été exercé une seule fois.** Une fixture, un système de modules, une capacité entière non testée.

**Ce que ça coûtait.** ESM est le défaut moderne pour Express, et Express n'est pas routé par convention — la sonde runtime est son **seul** oracle. Donc depuis ADR-091, **une app Express en ESM ne pouvait jamais atteindre `PROVEN`**, et l'utilisateur était envoyé déboguer son propre code.

**Aggravant :** `probe.js` faisait `child.stderr?.on('data', () => {})`. L'erreur de boot de la cible n'est écrite nulle part ailleurs, donc il n'existait aucun moyen de savoir pourquoi la sonde ne voyait rien. 2 minutes de diagnostic transformées en 20.

**Correctif (ADR-097) — un mécanisme, pas deux.** express est du CJS, et un module CJS atteint via le pont ESM vient du **même `require.cache`** : le shim requiert donc express **lui-même**, résolu depuis la racine du fichier d'entrée, avant que l'app tourne — l'`import` de l'app reçoit l'instance déjà patchée (vérifié : un marqueur posé avant l'import est visible après). Résolu depuis l'ENTRÉE et jamais depuis le dossier du shim : SPARDA porte express en devDependency, et patcher sa copie pendant que l'app importe la sienne instrumenterait un module que personne n'utilise. **Et le correctif « évident » a été REFUSÉ parce qu'intestable** : détecter `"type":"module"` pour basculer sur `--import` ne change rien de mesurable, son mutant a SURVÉCU, donc la ligne est partie. Un second mécanisme qu'aucun test ne distingue est du poids mort — E-106, vieux d'une semaine, dit ce que ça coûte de le garder.

**Plus : la sonde dit POURQUOI elle n'a rien vu.** Quatre états nommés — `observed` / `not-instrumented` / `no-routes` / `did-not-start` — là où trois s'imprimaient comme le quatrième. Et le stderr de l'enfant est conservé. Dire « the app did not boot » d'une app en bonne santé n'est pas un détail manquant, c'est un **diagnostic faux** : ça envoie l'utilisateur déboguer son code alors que la cause est que SPARDA n'a pas pu regarder. Règle 13, appliquée à un diagnostic et non à un verdict.

**Comment c'est sorti — et c'est la leçon de méthode.** Premier test de fumée du LABO qui était construit **sur cet oracle**. Le labo aurait produit 20 × `did-not-boot` et quelqu'un aurait conclu « les vraies apps ne bootent pas ». **La cible la moins chère a trouvé le défaut que la nuit de calcul aurait masqué.**

Suite **1231** (+3), mutants **131/131** (+3), ESLint 0, Prettier clean, 4 deps, 0.71.1.

**Le préfixe de montage, corrigé dans la même session (ADR-098, E-110).** La sonde émettait chaque route à l'ENREGISTREMENT — or le point de montage d'un routeur est établi PLUS TARD (`app.use('/api/users', router)`). Donc `router.get('/:id')` sortait comme `GET /:id`, diffé contre le `/api/users/:id` correct du compilateur : **deux faux gaps sur trois** sur `demo-app`. Un faux gap est dans le sens SÛR pour un verdict — il ne peut que retenir `PROVEN`, jamais l'accorder — et c'est exactement comme ça qu'il a survécu ; il n'est faux que pour un consommateur qui lit les gaps comme des FINDINGS, et le premier de ces consommateurs allait être le labo, dont la règle prioritaire est précisément « premise gap mesuré ». Correctif : les routes sont MISES EN ATTENTE avec l'objet sur lequel elles ont été déclarées, `use` enregistre les arêtes de montage, et les chemins complets sont résolus une fois l'app câblée (au `listen`, ou à l'inactivité). Un routeur monté deux fois donne les deux chemins — ce n'est pas un doublon, le framework le sert vraiment aux deux adresses. **Mesuré : demo-app 3 gaps → 1, et celui qui reste est le vrai** (`GET /v2/meta`, le chemin dynamique). Deux bugs à moi dans le même changement, tous deux trouvés en LANÇANT le code : un `module.exports` qui référençait l'ancien nom (le shim plantait au chargement, et c'est le correctif stderr d'E-109 qui l'a révélé), et un `settle` sur `exit` qui court avec la livraison du dernier morceau de stderr — le test passait seul et échouait dans la suite parallèle ; `close` est déterministe, vérifié sur trois runs complets consécutifs.

**Brique #39 — Trois défauts de release trouvés en essayant de publier, et la porte les a tous arrêtés (ADR-099).**

**E-111 — le CHANGELOG nommait une version qui ne contenait pas ses correctifs.** `v0.71.1` était tagguée sur `29d8169` et publiée sur npm ; les correctifs de sonde E-109/E-110 sont arrivés APRÈS, et j'avais ajouté leurs entrées sous `## [0.71.1]`. Le registre promettait donc une sonde ESM fonctionnelle à des gens qui tournent sur une version qui ne l'a pas. Même forme que v0.69.0 prise par l'autre bout : là le registre manquait, ici il sur-promettait. **Mécanisme, et c'est lui qu'il faut retenir :** j'avais vérifié « cette version est-elle publiée ? » au début du travail (npm répondait 404) et j'y ai ajouté des lignes des heures plus tard sans revérifier — elle avait été publiée entre-temps. **Une précondition vérifiée une fois est un souvenir, pas une précondition.** Corrigé, et la règle gravée dans le playbook §4 : on écrit l'entrée de la version qu'on va COUPER, jamais de celle qu'on vient de couper ; un tag poussé GÈLE son entrée.

**E-112 — la porte refusait tout tag ANNOTÉ.** `git ls-remote --tags origin v0.71.2` ne renvoie **que l'objet-tag** : filtrer sur le nom exact supprime la ligne déréférencée `refs/tags/v0.71.2^{}`, qui ne correspond pas au motif. La porte comparait donc un sha d'objet-tag à un sha de commit, et déclarait « not on origin » un tag correctement créé et correctement poussé. **`v0.71.1` n'était passée que parce qu'elle avait été créée en lightweight**, où les deux shas coïncident : la vérification n'avait jamais tourné une seule fois sur la forme de tag que le playbook demande d'utiliser (`git tag -a`). Correctif ADR-099 : `tagChecks` reçoit les DEUX shas que le tag local est légitimement et accepte l'un ou l'autre — ça ne dépend plus d'aucun comportement de peeling de git. **Deux correctifs proposés ont été refusés** : recréer le tag en lightweight changerait l'ARTEFACT pour s'adapter à une VÉRIFICATION cassée (l'inversion exacte que le playbook interdit), et ajouter un `*` seul aurait marché par accident en laissant la comparaison dépendre du peeling.

**E-113 — un ENOENT intermittent, deux tests corrects, une fixture partagée.** `tests/sparda.test.js` fait son aller-retour d'injection DANS `tests/fixtures/express-demo` — volontairement, c'est ce qui prouve que `remove` restaure l'octet près dans un vrai arbre — pendant que `tests/gossip.test.js`, dans un autre worker vitest, copie cette même fixture. Un fichier `.sparda/backup/` qui apparaît et disparaît en cours d'énumération, c'est un `ENOENT`. **Aucun des deux tests n'est fautif**, et c'est ce qui vaut l'entrée : il n'y a pas de coupable, seulement un couplage à supprimer. Correctif sur le LECTEUR, parce que ça tient quoi que fasse l'écrivain : `tests/helpers/copy-fixture.js` n'énumère jamais `.sparda/`, `node_modules/` ni `.git/` — du résidu généré, jamais une entrée de fixture. Appliqué aux **dix** sites de copie dans neuf fichiers : la classe est fermée, pas l'instance.

**Deux dégâts collatéraux de ma réécriture mécanique, tous deux attrapés tout de suite** : `tests/nextjs.test.js` avait déjà un `copyFixture()` LOCAL à zéro argument, donc le remplacement l'a rendu récursif (renommé `freshFixture`) ; et déplacer une ligne de `release-checks.mjs` a déplacé la cible d'un mutant, ce que `no-mutant-left-behind` a signalé **dans la suite rapide** au lieu de dix minutes après le début du run de mutation. **Le garde d'E-108 s'est payé tout seul ici.**

**État de publication, honnête.** npm et le registre MCP portent **0.71.1**, tous deux vérifiés. L'extension VS Code porte **0.71.1** aussi (vérifié par Gemini via `vsce show` — je ne peux pas l'atteindre, le proxy de ma session refuse `marketplace.visualstudio.com` en 403). **`v0.71.2` est tagguée sur `90627b7` et n'a jamais été publiée** : la porte l'a arrêtée sur E-112 et E-113. Le tag est laissé en place plutôt que re-pointé — un tag nomme des octets, et renommer ce qu'il désigne est précisément la panne que cette porte existe pour empêcher. **La release en cours est donc 0.71.3.**

Suite **1232** (stable sur trois runs consécutifs), mutants **133/133**, ESLint 0, Prettier clean, 4 deps.

> **🔴 2026-07-17 — PRIORITÉ ABSOLUE : lire `docs/URGENT-ADOPTION-PLAYBOOK.md` AVANT tout travail.**
> Mandat de Zak : adoption d'abord. Les vagues moteur (Wave 2b/3) sont GELÉES jusqu'à la fin de
> sa Phase 1 (time-to-wow → badge partageable → distribution → dogfooding → lancement). Le playbook
> contient les faits mesurés (3 618 dl/mois vs 3 stars), la kill list et le plan 7 jours.
> Déjà livré de la Phase 1 : J1 #1 (fix détection Medusa structurelle, E-043), le tripwire
> honnêteté "PROVEN sur 8%" (E-044, verdict PARTIAL), J1 #2 (jamais "0 routes" en silence →
> `suggestAppDirs`, diagnostic monorepo actionnable dans prove/ubg/erreur), et J3-4 #4 (`sparda
badge` — SVG auto-contenu + markdown, mot/couleur via `verdictState` partagé, ne peut pas
> sur-vendre) — v0.51→0.53. et J5 #7 (GitHub Action mode `prove` +
> `prove --markdown` → commentaire PR sticky avec verdict + badge, la surface de découverte) —
> v0.51→0.54. Métrique nord révisée (audit d02f9c0) : les 3618 dl npm sont surtout des bots ; le
> vrai signal = vues/uniques GitHub (baseline 41/14j). et J1 #3 (`bench/repro.mjs`
> clone Dub/Immich/Medusa → 1337 routes, 0 crash, évidence `bench/route-proof.json` ; README
> "3700 proved" corrigé en chiffre honnête scriptable) — et J3-4 #5 (`dossier` public : verdict
> `verdictState`/PARTIAL, score coverage, blindspots en vitrine, page screenshotable) — v0.51→
> 0.56. Reste Phase 1 : J5 #8 (registres MCP + publier l'Action au Marketplace — actions UI/npm,
> hors code), J6 (dogfooding 3 case studies), J7 (README + lancement). **Presque toute la Phase 1
> codable est faite.**

> **▶ Vagues moteur DIFFÉRÉES (post-Phase 1), archivées dans `docs/NEXT-WAVES-PLAYBOOK.md` :** la
> BOLA étage 2 (suivre le binding de clé de groupe à travers le wrapper d'auth), l'ORM import-root
> increment, le taint dataflow (ADR-P1), le golden bench (ADR-P5), guard dominance (ADR-046 cran 2),
> la Reyna loop. n8n plafonne honnêtement à 21.7 % (profondeur d'effet ORM). NE PAS reprendre avant
> que la boucle d'adoption tourne (KILL LIST du playbook).

**Version:** **0.36.0** (0.32.1 engine byte-identity; 0.33 convergence + E-034; 0.34 Python depth; 0.35 UNBOUNDED_WRITE_TARGET / Wave 3a; 0.36 ADR-055 protocol-not-brand recognition + guarded-by-default). Brand-free decorator ingestion (Nest, GraphQL, n8n's `@RestController`, any home-made framework) + deep Express/Next/FastAPI + Medusa + any-lang via OpenAPI; full collective-immunity stack; the honesty organ threaded through capsule/genome/immunize/review/dossier. Not yet published (Gemini's job).
**Branch state:** `claude/current-task-u45a4d`. Tests **614 ✓ Vitest (3 skip)** green; corpus oracle: 7 giants pinned (dub guards=513), 0 drift; ESLint 0 errors, Prettier-clean. Verdict states: PROVEN / NOT PROVEN / SURFACE ONLY / NO PROOF, each carrying a coverage % and blind-spot count. Guards carry verified/asserted provenance (+ inferred guarded-by-default posture); ORMs: SQL, Prisma, supabase/knex, Kysely, Mongoose, Drizzle, TypeORM, Sequelize, SQLAlchemy (1.x + 2.0); tables resolve symbolically (`:collection`) and across class boundaries; GraphQL reads onto the graph's verbs; taint: UNBOUNDED_WRITE_TARGET (symbolic-table write, no guard).

## 🎬 Marketing system (2026-07-21) — never start from zero again

`marketing/` is now the permanent marketing machine:

- **`marketing/BRAND-KIT.md`** — the source of truth: the two palettes (BRAND = light
  lavender + hero purple `#7030F8` eyedropped from the logo; VERDICTS = the 5 badge colors,
  never mixed), signatures, real numbers, asset pointers.
- **`marketing/GPT-IMAGE-BRIEFS.md`** — the 3 validated ChatGPT blocks (master brief,
  anti-generic execution protocol, 8-slide carousel prompts). Paste + logo upload = on-brand
  images forever. The validated "image mère" exists; known v2 tweaks listed at the bottom.
- **`marketing/launch-video/`** — the launch video AS CODE (Remotion): 36s, 9:16, FR+EN,
  5 scenes (AI types → guard struck → `sparda gate` BLOCKS with impact → `prove` lands
  PROVEN 96%/579 routes → outro with the real S + wordmark), synthesized sound design in
  `public/*.wav`. New video = edit `src/copy.ts`/`Video.tsx` + `npm run render:fr|en`.
  On headless machines point `remotion.config.ts` at a chrome-headless-shell.
- **`marketing/renders/`** — the shipped MP4s (sparda-launch-fr/en.mp4), ready to post.

## 🐍 Flask support (2026-07-20) — the 5th native framework, closing the biggest first-user gap

Coverage-wall work #1 (from the market due-diligence: our 4 covered the JS/TS world + modern Python,
but a Django/Flask dev could land uncovered). **Flask now compiles natively** — it reuses the ENTIRE
Python extractor (SQLAlchemy effects, guard/deny detection, the shared UBG analysis: O1, guard-
dominance, G2, the gate); only route DISCOVERY is Flask-specific and was folded into
`fastapi_extract.py` (the extractor is now framework-agnostic): `Flask()`/`Blueprint()` app vars,
`@app.route(methods=[…])` (multi-method) + `@app.get/post`, `register_blueprint(url_prefix=…)`, and
`@login_required`/`@jwt_required` as verified guards. `detect.js` gains Flask detection + entry-finder;
`compile.js` routes `flask` → the Python extractor. Verified end-to-end on a real Flask app (app +
blueprint routes, unguarded mutations flag, `@login_required` route stays clean, read-only clean); **no
FastAPI regression** (fastapi-deep green). **+ Flask class-based views** (adversarial-hunt follow-up):
MethodView + `add_url_rule(view_func=Cls.as_view())` and Flask-RESTful `Resource` + `add_resource`
resolve — each verb method is a route, class-level `decorators`/`method_decorators` + per-method auth
decorators gate it. **+ Flask-SQLAlchemy write resolution** (`db.session.add(u)` via a var→model map,
`Model.query.delete/update` via `query_model_of`) so the DOMINANT Flask writes flag instead of reading
SURFACE ONLY. Fixtures `ubg-flask` + `ubg-flask-cbv` + `flask.test.js`/`flask-cbv.test.js` + mutation
guards.

## 🔒 E-NEXT-MW closed (2026-07-20) — Next `config.matcher` is part of the guard's reach

Integrated from Fable 5's branch `claude/sparda-compiler-analysis-3qvx9b` (its re-verification pass
found a **false PROVEN**: a denying middleware scoped `config.matcher: /dashboard` was credited as a
guard on `/api` routes it never runs on — the cardinal sin on the dominant next-auth pattern).
`nextjs.js` `readMatcher()`/`matcherCovers()` decide coverage for the two dominant forms (positive path
glob, negative-lookahead exclude); `translate.js` attributes a global middleware guard ONLY to routes
its matcher provably covers, and **abstains** on an undecidable matcher (never fabricate a guard). The
change is **monotonic in the safe direction** — it can only withhold guard credit, never add it, so it
cannot manufacture a false PROVEN. E-053. Fixture `ubg-next-matcher` + unit + 2 end-to-end tests
(the `/api` route flags, `/dashboard` keeps its guard) + a mutation guard. Fable's C3/server-actions
sibling (E-NEXT-SA) was already closed on our side. **712 Vitest, mutation 20/20, eslint clean.**
**Next coverage brick: Django** (urls.py routing + CBVs + ORM).

## 🛡️ C2 closed (2026-07-20) — guard-dominance: no more false PROVEN by non-dominance

The perfection audit's grave finding (a false PROVEN — the cardinal sin) is fixed. A guard on a route
no longer covers a mutation that runs BEFORE it: an early-return branch that mutates then checks auth,
or a write in a branch a sibling guards, is now caught (`guardBypass`, hard critical). Computed at
SCAN time (recursive spine walk tracking guard-on-path; branch-aware; promoted only when the SAME body
holds a guard — so cross-procedural service ordering never flags the route), auth-specific barrier
(not the broad GUARD_NAME), and `bypassesGuard` stripped at `mergeScan`. **Sound by construction (only
subtracts guard credit — can't fabricate a false PROVEN). Measured: catches both bypass shapes; 0 false
positives on dub/immich/nocodb/medusa/ghostfolio/+4.** Also un-holes the gate (it inherited this blind
spot). Fixture + `tests/guard-dominance.test.js` + 2 mutation guards. 692 Vitest, mutation 16/16.
Details: `docs/ERRORS.md` E-051. **Both audit soundness holes now CLOSED** — C3 (server actions) fixed
the same way (2026-07-20): `nextjs.js` extracts `'use server'` exports as POST entrypoints, so an
unguarded mutating action flags as UNGUARDED_MUTATION instead of hiding behind a false 100% coverage.
Measured: dub +2 / rallly +1 real actions, 0 false criticals; fixture + `tests/server-actions.test.js`

- mutation guard. `docs/ERRORS.md` E-052. **The audit's two soundness findings (C2 false-PROVEN, C3
  false-coverage) are both closed; C1 was already fixed. 696 Vitest, mutation 17/17.**

## ⚡ `sparda gate` integrated (2026-07-19) — the agent edit-loop wedge is now IN SPARDA

The BUILD-ORDER's #1 wedge (built by another Fable on `claude/sparda-compiler-analysis-3qvx9b`) is
folded into the release line: `src/commands/gate.js` + `tests/gate.test.js` (4) +
`bench/guard-removal-replay.mjs` + `docs/ARBITRE2-PLAYBOOK`. `sparda gate` proves THIS edit lost no
guard / dropped no route / grew no blast radius — **delta-only** (pre-existing state never blocks an
edit; that noise would kill adoption — the false-positive work is its prerequisite), reuses
`diffGraphs` + `checkGraph` (same composition as `review`), `--arm` freezes a baseline, `--hook` is
the Claude Code PostToolUse contract (silent when clean, stderr + exit 2 on regression, self-arming).
Reconciled `src/index.js` by hand (flags + case + help + listing) — no overlap with `--proof`.
**Verified end-to-end:** the replay bench clones real dub (580 routes), removes the `POST /api/links`
auth wrapper, and `sparda gate` catches `GUARD_REMOVED [critical]` in **1166 ms** — deterministic,
offline, no key. 687 Vitest green (+4), ESLint/Prettier clean.
**Version decided (Zak): 0.66.0.** 0.65.0 was never published to npm, so its delta is folded in and
the whole branch ships as **0.66.0** — one clean publish on top of the published 0.64.0. Version
bumped everywhere (package.json, package-lock.json, server.json ×2, CHANGELOG, GEMINI.md). The gate's
launch bundle (the 3 BUILD-ORDER fixes: re-list MCP registry, `review --base` from a monorepo subdir,
replace the SURFACE-ONLY demo + the 1-command Claude Code plugin from `integrations/claude-code/`) is
the immediate follow-on, not a blocker for the 0.66.0 publish.

## 🧭 Branch consolidation (2026-07-19) — main is now the single anchor

Every scattered strategy/research branch was folded into the release line so **no session starts
from zero again** — main will carry them after the 0.66.0 merge. All additive (new files under
`docs/` + `integrations/`), zero product-code/verdict impact, all MOAT (never public-synced):

- **Direction/strategy:** `_MASTER-MAP-AND-DIRECTION`, `THESIS-BEHAVIOR-COMPILER-FOR-AGENTS`,
  `BUILD-ORDER-SPARDA-GATE` (← the current top priority: build `sparda gate`), `ARBITRE-VERDICT`,
  `SECRET-ROADMAP`, `CROSS-SERVICE-QUEUE-BOLA`, `RESEARCH-AND-10X-IDEAS`, `VISION`, `TECHNICAL-BRIEF`.
- **FP/guard work:** `TWO-FALSE-POSITIVE-CLASSES`, `GUARD-TAXONOMY-CLOSE-THE-CLASS`,
  `CORROBORATION-AND-PROOF-OBJECTS`, `FIELD-TEST-AND-GAP-MAP`, `TWO-ADDITIONS-API2-API3-SPEC`,
  `_STRATEGY-PACK-INDEX`.
- **CSOP research:** `docs/csop-handoff/**` (self-contained prototype; excluded from Vitest+ESLint).
- **Plugin seed + assets:** `integrations/claude-code/**` (the edit-loop gate the BUILD-ORDER builds
  on), `docs/marketing/**`, the 2026-07-14 session records + audit, `KIMI-SPEC-*`, `EVOLUTION-PROTOCOL`,
  `ADR-P2-PLAN`, `URGENT-ADOPTION-PLAYBOOK` (zero-paywall monetization note).

**Branches now redundant (safe to delete AFTER the 0.66.0 merge lands them in main):**
`docs/{build-order-sparda-gate,master-map,thesis-behavior-compiler,cross-service-queue-bola,
false-positive-classes,secret-roadmap,kimi-csop-spec,sparda-strategy-pack,strategy-free-first-and-10x,
csop-handoff}`, `claude/sparda-compiler-analysis-3qvx9b`. **Held back (needs a call):**
`claude/weak-dossier-context-qm0bb2` — its additive assets are salvaged; its edits to core files
(README/CLAUDE.md/ROADMAP/…) and `.github/workflows/bench.yml` were NOT pulled (pre-0.65 state /
operational). Already-in-main (0 ahead), deletable: `docs/urgent-adoption-playbook`,
`claude/fable5-system-audit-idtfzw`, `claude/new-session-5yhx6t`.

## 🆕 This session (2026-07-19) — G2 phase 2: first-run + API-key families, through the call graph

Closed the two false-positive families G2 phase 1 could not reach — first-run/admin-setup and
API-key — after measuring the shared root cause: the refusal (`throw`, 4xx, or a named
`unauthorizedResponse()` helper) lives ONE CALL AWAY from the entrypoint, and three separate places
were dropping the signal. All three plugged, all advisory-only (downgrade critical→advisory, never
prove, never silence): `resolve.js mergeScan` was dropping `credentialSignals`/`ownerAsserted` on
DI merges (immich); `translate.js attachBody` now tags each reached body with its own refusal;
`state-minimization mergeNodes` now carries the advisory signals when a thin delegator is coalesced.
Plus a named-refusal detector (the Next.js deny idiom), the stored-credential family broadened to API
keys/PATs, and a first-run family bounded to bootstrap PATHS that still requires a real refusal.
**Field test (13 apps): immich 5→1, formbricks 1→0, total 9→4** — every downgrade manually verified
genuinely gated. Then **Class 1 (public-by-design re-label, `expectedPublic`)** per the master map's
item #1 + the FP-classes spec: a curated PATH signature (login/register/oauth/callback/health/metrics)
re-labels critical → info "confirm intent" — triage by convention, distinct from the evidence-based
`credentialFamily`, never hidden/PROVEN. Closes immich `/auth/login` (the only corpus route needing
it). Both FP classes (Class 2 = first-run/state-guard = the G2-phase-2 families; Class 1 = public-by-
design) now shipped. **683 Vitest (+5), mutation 14/14 (+3), lint/prettier clean.** Commits `278eec5`

- Class 1. Details: `docs/sessions/2026-07-19-g2-phase2-firstrun-apikey.md`, `docs/ERRORS.md`
  E-049/E-050. Part of the 0.66.0 release. **Direction reframe absorbed** (master map, branch
  `docs/master-map`): SPARDA = the behavior compiler agents query; security = one query; the #1 wall is
  PARSER COVERAGE; the only moat is collective immunity, behind adoption.

## 🆕 This session (2026-07-18) — the monorepo power jump, from a giant test (0.64.0)

Ran an Anthropic-style "test the limits" pass: SPARDA vs **cal.com** (351 MB, 7693 files, 3878 TS,
multiple backends) — 0 crashes, ~2s each. It exposed the real ceiling and three fixes shipped on
`claude/current-task-u45a4d` (3 commits above the merged 0.63.0 `main`; **v0.64.0**):

- **E-047** — a bare PROVEN is qualified to `PROVEN (PARTIAL)` when high-risk blind spots remain,
  not just on low coverage ratio (cal.com/api/v2 read PROVEN at 71% with 46 blind guarded
  mutations). Fed uniformly to every verdict surface + the `sparda_prove` MCP tool. Sound: only
  softens PROVEN→PARTIAL.
- **E-048 — workspace-package resolution (the mycorrhizal network).** The resolver now follows
  `@scope/pkg` imports into their real workspace-package source. **One mechanism, two blind spots:**
  effects (cal.com/api/v2 coverage **71%→87%**, a real unguarded mutation surfaced) and state
  (**P4** — an app depending on a shared `@scope/prisma` gets that schema; cal.com/web **0→100
  tables**, coverage **87%→95%**).

Verified: **670 Vitest green**, mutation **8/8**, publish-gate 23, `npm pack` clean. Handoff for
Gemini (merge + valve sync + tags + `npm publish 0.64.0`) is in `GEMINI.md` → "Current release".
The known deferred fix is **P2** (brand-free structural guard detection — the one that touches the
false-PROVEN direction, so measure-first before touching the guard detector) and the creative lead
**effect cardinality** (unbounded mutation blast-radius as a closed form — measure on cal.com/dub
before building).

## 🆕 This session (2026-07-17) — `sparda_prove` shipped + made discoverable (PR #17)

`sparda_prove` is now a **live MCP tool** (branch `feat/sparda-prove-mcp`, on top of the merged
0.62.0 `main`): an editing agent compiles + discharges the same static obligations as `sparda
apocalypse` the moment it writes, and — when a baseline exists (`apocalypse --save-baseline`) —
gets `regression:true` on any finding whose edit removed a guard / dropped a route / grew the
blast radius. Reuses `verdictState` **verbatim** (no-false-PROVEN holds: blind app → `NO_PROOF`,
low-coverage clean → `SURFACE`, never a bare `PROVEN`); read-only, off the host request path
(Law 1); baseline path matches `apocalypse.js` exactly (`.sparda/ubg.baseline.json`).

This part closed the discoverability that PR #17 left open: **SKILL.md** ("Prove your own edit"
section + tool listing), **README** ("Prove the edit before you commit" under _What SPARDA gives
your AI_), and a **built-in MCP prompt `prove-my-edit`** (`BUILTIN_WORKFLOWS` + `mergeWorkflows`
in `stdio.js` — served by every server, app workflows still win on a name clash). Also fixed the
one red CI job (Prettier format-only on the two PR files; all test jobs were already green).
Tests: **657 → 660** (3 new prompt tests), lint/format clean.

## 🆕 This session, part 48 (2026-07-15) — bare-call following, effects-only (0.50.0)

Zak: "Go" (ré-appliquer le suivi des appels nus, E-042 réglé). `resolve.js` `followCalls` suit
maintenant les callees `Identifier` bare (→ `mod.functions` / imports via barrels). Mais mesuré, il
révèle un DEUXIÈME mécanisme de fabrication de garde : `assertIntegrationEnvironmentScope` (un vrai
`throw 403`) atteint TRANSITIVEMENT depuis `auth/register` (endpoint public) le gardait à tort →
**novu NOT_PROVEN → PROVEN (faux PROVEN, le péché capital)**, attrapé par l'oracle.

**Correction — un helper nu contribue ses EFFETS, jamais une garde** : pas enregistré comme node
(E-042 : le nom ne fabrique pas), ET son signal de deny est retiré avant merge (un `throw 403`
transitif ne garde pas l'appelant — la garde d'une route est un chain step ou un vérificateur résolu
DIRECTEMENT, jamais une fonction qui refuse quelque part dans sa clôture transitive). Les effets
mergent ; les gardes non.

Résultat SAIN : **twenty coverage 48 → 70 %**, cal.com 0 → 8 writes (PROVEN plus fort), immich reads
+42, nocodb +19 — **zéro flip de verdict, zéro finding fabriqué**. immich admin-sign-up reste flaggé
(6), novu reste NOT_PROVEN (2). Oracle re-baseliné. **608 green.** (Régression gardée par l'oracle —
twenty coverage=70, novu NOT_PROVEN ; un fixture minimal reste impraticable comme E-042.) Note : dub
inchangé — Next.js scanne les handlers en shallow, ne passe pas par le resolver ; le re-router
proprement (ciblé, pas blanket deep-scan) reste ouvert.

## This session, part 47 (2026-07-15) — E-042 fixed: called helpers are deny-only guards (0.49.0)

Zak: "Go" (corriger E-042, le prérequis du suivi des appels nus). `translate.js` : un helper APPELÉ
(role `function`) n'est une garde que par un **deny prouvé** (`deniesWithStatus`), jamais par son nom
— le name-trust reste pour les chain steps explicites (`ensureChainNode`). **dub gardes 514 → 513**
(une garde-helper fabriquée corrigée), zéro changement de finding/verdict — un resserrement propre du
bon côté. Oracle re-baseliné (dub gardes=513 épingle le fix).

Un repro minimal in-repo s'est révélé impraticable (4 formes essayées : la fabrication demande une
reachability/linking qui ne se manifeste que sur du vrai code), donc **l'oracle corpus EST le garde de
régression** ici — exactement ce pour quoi il a été construit (E-039). Un revert d'E-042 ferait dub
513 → 514 → DRIFT → attrapé.

**Débloque le suivi des appels nus** : maintenant que les noms de helpers ne peuvent plus fabriquer de
gardes, suivre `helper()` est sûr (le cas immich `mapUserAdmin` ne peut plus cacher admin-sign-up).
Prochaine étape : ré-appliquer le suivi des appels nus (son gain mesuré tient : twenty coverage 48 →
71 %) + re-router Next.js prudemment (le deep-scan brut explosait — approche ciblée à trouver). **608
green.**

## This session, part 46 (2026-07-15) — bare-call following tried, reverted; found E-042 (no version bump)

Zak: "Go" (le suivi des appels nus — le levier maximal identifié). Construit dans `resolve.js`
(`followCalls` suit les callees `Identifier` bare vers `mod.functions` / imports), mesuré, puis
**reverté**. Résultat mesuré :

- **Gain réel sur Nest/Express** : twenty coverage 48 → 71 %, cal.com 0 → 9 writes (PROVEN plus
  fort), nocodb writes +25 — aucune nouvelle finding dure. Le suivi des appels nus MARCHE et
  améliore la couverture.
- **MAIS il expose un bug de solidité latent (E-042)** : immich `POST /auth/admin-sign-up` (route
  bootstrap PUBLIQUE) est devenue "gardée" par `mapUserAdmin` — un MAPPER, classé garde parce que
  son nom contient "admin" (`GUARD_NAME`). Garde fabriquée → finding réel caché = violation
  Direction 2 (l'erreur impardonnable). Reverté.
- **Aussi** : router les handlers Next.js à travers le resolver (pour dub BOLA) EXPLOSE (writes
  248 → 1142, findings dures 9 → 145) — sur-approximation catastrophique, reverté aussi.

**Le prérequis (E-042), pas encore fait** : un helper APPELÉ (role `function`) ne doit être une garde
que par un **deny prouvé**, jamais par son nom (le name-trust reste pour les chain steps explicites —
`@Authenticated`). C'est la SAFE direction (moins de gardes → possiblement plus de findings, en
dé-cachant des routes qu'un helper mal nommé masquait). Une fois E-042 corrigé + re-baseliné, le suivi
des appels nus ship (son gain tient). État inchangé : **608 green, oracle 0 drift, v0.48.0**.

## This session, part 45 (2026-07-15) — the first BOLA/IDOR advisory, tested on giants (0.48.0)

Zak: "Go alors on règle ça, en teste avec les vrais géants — y a qu'eux qui nous diront notre niv."
Construit `OBJECT_SCOPE_UNPROVEN` (apocalypse O7) : accès à un objet par un id de la requête sans
aucun scope d'ownership prouvé sur le chemin **résolu**, sous garde, hors admin/system. **Advisory
par design** (`advisory: true`, info) — l'absence de scope visible est FP-prone (client scopé, RLS,
`where` d'un helper invisible), donc ça **ne gate jamais le verdict** (`verdictOf` : `hardCount`
exclut les advisories ; cal.com/nocodb restent PROVEN). C'est une liste de revue honnête ("je n'ai
pas pu prouver le scope ici — vérifie"), pas une accusation de vuln.

**Testé sur les géants (le vrai juge) :** dub **60**, ghostfolio **8** ; immich/twenty/novu **0**
(TypeORM query-builder → pas de `where` prisma encore). Verdicts inchangés. L'oracle corpus track
désormais `advisories` séparément des `findings` durs.

**Le gap de précision, honnête :** une part des 60 de dub sont scopées par un helper en **appel nu**
(`getCustomerOrThrow({ workspaceId })`) que le resolver ne suit pas (il suit `x.method()`, pas
`helper()`). **Suivre les appels nus importés** — le même angle mort derrière les limites taint/deny
— est le prochain enabler : il coupe ces FP, débloque le taint inter-fonction, ET augmente la
couverture d'effets. C'est LE prochain gros levier (mais changement de resolver, impact corpus-wide,
à mesurer/re-baseliner soigneusement). Fixture `ubg-object-scope` étendue + 2 tests. **608 green.**

## This session, part 44 (2026-07-15) — object-scope provenance, the BOLA substrate (0.47.0)

Zak: "Go" (Phase A). En sondant, deux découvertes ont réorienté vers Phase B (le plus rentable) :
(1) le vrai chemin taint/scope passe par le DI **mémoïsé** — la taint doit rejoindre la clé du memo
bundle (comme `symSig(thisSymbols)`), délicat, foundation-risk ; (2) SPARDA résout DÉJÀ le chemin
complet (controller→service→repo) — ma sonde BOLA d'avant était file-locale.

Livré (Phase B substrate) : extraction `idScoped` (requête ciblant un `id` nu) + `ownerScoped`
(filtrée par une clé d'ownership `userId`/`workspaceId` ou une valeur de session) sur les effets
prisma (`whereOwnerScoped`/`whereHasIdKey`). Candidat BOLA = accès idScoped SANS aucun accès
ownerScoped sur le chemin **résolu** (`reachOf` leak-free d'apocalypse). Mesure (measure-first) :
file-local = **1019 faux candidats sur dub** ; graphe résolu + fix E-041 + admin/cron exclus =
**~71** — tractable, encore trop bruyant pour un finding dur → reste substrat (les routes admin sont
privilégiées, pas du BOLA-objet ; des scopes restent invisibles). Flags additifs, aucun verdict ne
bouge.

**E-041 (trouvé en mesurant) :** `PRISMA_OPS` ignorait `findUniqueOrThrow`/`findFirstOrThrow`
(exactement le fetch d'autorisation !) ET `createManyAndReturn` (une ÉCRITURE non vue — angle mort
Direction 1). Complété. dub reads 435 → 539, aucun verdict/finding ne change ; oracle re-baseliné.
Fixture `ubg-object-scope` + 3 tests. **606 green.**

**Reste (ADR-058) :** le finding BOLA advisory lui-même (exclusion admin-guard via le graphe, plus de
précision scope) ; Phase A/C (provenance REQUEST/VALIDATED inter-fonction — le DI mémoïsé demande la
clé de memo taint).

## This session, part 43 (2026-07-15) — BOLA measured dead-local; the provenance engine designed (ADR-058)

Zak: "Go" (BOLA). Mesure d'abord (leçon du taint) : `scratchpad/bola-surface.mjs` — dub **1019
"candidats"** (requête scoped par id, pas de clé d'ownership dans le même `where`), mais
l'échantillon montre qu'ils sont quasi tous SAINS : l'id est déjà possédé (`where:{id:user.id}`),
scopé par le wrapper (`withWorkspace`), ou par un fetch-then-act amont. **Le `where` local est une
fenêtre trop petite** — l'ownership est enforced ailleurs sur le chemin. Shipper = dub-152 × 10. Rien
produit ; mesurer a tué la version naïve.

**Le constat structurel :** DEUX "mesure → local = bruit" d'affilée (taint, BOLA). Racine commune —
SPARDA voit les effets et les gardes, pas **d'où vient une valeur**. Les deux lentilles restantes
exigent le même moteur manquant : le **dataflow inter-fonction** (provenance source-requête/session →
sink, à travers le graphe d'appels).

**Livré : ADR-058 (design)** — le moteur de provenance. Labels de provenance sur les valeurs
(REQUEST/SESSION/CONSTANT/DERIVED + modificateurs VALIDATED/SCOPED), arêtes `data_flow` source→sink
sur l'UBG, propagées par LE resolver (ADR-054), analysis-time, 0 dep. Posture de solidité DUALE : taint
= MAY (sur-approx, sûr), scoping = MUST (sous-approx) → **BOLA reste ADVISORY** ("scope non prouvé
ici", jamais "vulnérable" — un client prisma scopé / RLS est invisible). Phasé : A) provenance + arêtes
(débloque le taint inter-fonction) ; B) SCOPED + BOLA advisory (re-mesurer : les 1019 doivent
s'effondrer ou B ne ship pas) ; C) VALIDATED inter-fonction (tue le faux "unvalidated"). Chaque phase
mesurée sur le corpus avant de shipper. **Pas de code cette fois — le design d'abord, comme demandé.**

## This session, part 42 (2026-07-15) — verified global guards, the BOLA socle (0.46.0)

Zak: "Goooo" (étape 1 vers BOLA). L'audit des findings survivants avait montré que la lentille
"unguarded-mutation" est saturée — signal honnête mais bénin — et que le vrai saut est
l'autorisation au niveau objet (BOLA/IDOR, OWASP API #1). Prérequis : savoir qu'une route EST
authentifiée. immich montrait 253 gardes / **0 vérifiée** parce que son auth est app-wide
(`{ provide: APP_GUARD, useClass: AuthGuard }`), invisible à un scan par-décorateur, et le refus
vit un cran plus bas (`AuthGuard.canActivate` → `this.authService.authenticate()` → throw).

Livré : `detectGlobalDenyGuard` (nestjs.js) — détecte le garde global (APP_GUARD / useGlobalGuards),
résout son `canActivate` À TRAVERS le DI (`handlerScan` suit `this.authService`) jusqu'à un refus
prouvé, et quand c'est prouvé, chaque garde auth-nommée de l'app gagne `verified`. **immich :
253 gardes 0 → 253 vérifiées**, coverage 91.5 → 93.9 ; findings + verdict inchangés (pur
raffinement de crédibilité, SOUNDNESS Direction 2 — asserted→verified sur des routes déjà
gardées, jamais un garde inventé). twenty/novu/dub/cal.com/nocodb inchangés. L'oracle corpus a
attrapé la dérive immich comme _intentionnelle_ et a été re-baseliné (belle démo du filet en
action). Fixture `ubg-nest-global-guard` + 2 tests. **603 green.**

**Reste ouvert :** nocodb PROVEN 898/0 vérifiées — son auth n'est PAS un APP_GUARD Nest (framework
custom / middleware), donc non touché ; hollow-PROVEN toujours à auditer. **Prochaine étape : BOLA**
(la nouvelle lentille) — une route qui lit/écrit par un `:id` de la requête, gardée par de l'auth
générique mais SANS prédicat de propriété liant l'objet à la session. Le socle (verified auth) est
maintenant en place.

## This session, part 41 (2026-07-15) — the corpus oracle (0.45.0)

Zak: "Go" (l'oracle corpus — le mal nécessaire qui protège les gains). Jusqu'ici on trouvait
les faux positifs un géant à la fois, à la main, et **rien ne gelait les corrections** — le
bug tsconfig (E-039) avait fait passer dub de 514 à 1 garde en silence. Livré :
`scripts/corpus-oracle.mjs` + `corpus.snapshot.json` (commité) — pour 7 géants qui compilent
proprement (dub, novu, cal.com, twenty, immich, nocodb, ghostfolio), il fige verdict +
findings par règle + db_writes/reads + gardes vérifiées + coverage, et **diffe** ; toute
dérive sort en non-zéro avec un delta par champ. Vérifié : catch d'une régression simulée
(novu writes 24→636) = DRIFT + exit 1. Les géants ne sont pas commités (éphémère) — le
snapshot l'est ; `SPARDA_CORPUS` pointe les clones, les absents sont **skippés proprement**
(jamais failed). `npm run corpus` / `corpus:update`. `tests/corpus-snapshot.test.js` garde
le baseline bien formé sous `npm test`. Baseline gelé : dub NOT_PROVEN 9 findings / 514
gardes ; novu 2 / 24 writes ; twenty 156 verified ; cal.com PROVEN ; nocodb PROVEN. **601
green.** (À surveiller : nocodb PROVEN avec 108 writes / 0 verified — possible hollow PROVEN
à auditer ; l'oracle le gèle en attendant.)

## This session, part 40 (2026-07-15) — taint foothold + CQRS phantom-write fix (0.44.0)

Zak: "Go" (le premier consommateur du contrat de solidité = le taint). Mesure AVANT de
construire (le vieux raccourci taint était mort) : surface réelle mais modeste (0–10 %), et
un détecteur naïf au site d'écriture est imprécis (faux positifs sur `ctx`/`payload` =
webhooks Stripe ; faux "unvalidated" car la validation vit dans une couche service qu'un
scan par fonction ne voit pas). Donc **pas de finding taint autonome** — ça trahirait le
contrat. À la place :

1. **Taint comme ENRICHISSEMENT** (ADR-P1 foothold). Quand la charge d'une écriture est
   prouvablement dérivée de la requête (`prisma.x.create({ data: req.body })`,
   `Model.create(req.body)`), l'effet porte `tainted` et le `UNGUARDED_MUTATION` déjà émis
   porte `tainted: true` + un message affûté. **Jamais un finding à lui seul** → zéro
   nouveau faux positif ; sous-approximé (un tag manqué ne cache rien). Volume corpus faible
   aujourd'hui (grandit avec le dataflow inter-fonction, la vraie ADR-P1 = plusieurs
   sessions). C'est le rail sain et testé sur lequel B roulera.

2. **E-040 — le désastre des phantom-writes CQRS.** En mesurant le taint, découverte : sur
   novu, **612 des 636 db_writes étaient faux** — des factories CQRS `SomeCommand.create({…})`
   lues comme des écritures de modèle (récepteur capitalisé). Gate `NON_MODEL_RECEIVER`
   (suffixes DI/CQRS qui ne nomment jamais un modèle ORM). **novu 636 → 24 db_writes,
   UNGUARDED 21 → 2** ; dub/twenty/immich/cal.com inchangés, aucun verdict ne devient plus
   propre (aucun faux négatif introduit — les noms ambigus `Event`/`Entity` restent des
   écritures, cf. SOUNDNESS Direction 1).

**Connu, différé :** les 2 UNGUARDED résiduels de novu sont `mutates sha256` —
`createHash('sha256').update(x)` lu comme write knex (`builderTableOf.isBaseCall` traite tout
`func('str')` comme une table). C'est le bon côté du faux (bruit) ; le corriger sans cacher
un vrai `knex(alias)` est délicat → différé (E-040 note). Fixtures `ubg-taint-write` +
`ubg-cqrs-command` + 6 tests. **599 green.**

## This session, part 39 (2026-07-15) — the soundness contract (0.43.0)

Zak, après la chasse dub : "on peut utiliser leurs recherches pour se perfectionner ? … B, mais un
truc parfaitement homogène avec SPARDA, pas une trahison des promesses." Réponse : oui — on emprunte
la **discipline** de l'interprétation abstraite (Cousot 1977 ; la théorie derrière Astrée/Airbus,
Infer/Meta), **pas la machinerie** (aucun solveur, 0 dep, 0 runtime, analysis-time only).

Livré : **`docs/SOUNDNESS.md`** — le contrat que toute feature d'analyse doit respecter, énoncé
comme une interprétation abstraite : **effets sur-approximés** (un effet réel est dans l'UBG ou
imputé à un blindspot — jamais perdu en silence) + **gardes sous-approximées** (`verified` seulement
sur un deny prouvé — jamais fabriqué). Corollaire (le théorème de sûreté) : toute imprécision pousse
le verdict vers NOT_PROVEN / plus de findings (crier au loup), jamais vers PROVEN / moins (aveugle).
Les hypothèses conditionnelles honnêtes sont nommées (profondeur bornée = widening ; dispatch non
résolu → blindspot ; contrats Hoare futurs ; LLM advisory-only) avec la règle qui les lie : **une
hypothèse doit être VISIBLE, jamais silencieuse** — la classe exacte du bug E-039.

**`tests/soundness.test.js`** mécanise les deux directions sur les fixtures (aucune garde `verified`
n'est `opaque` ; une mutation non gardée est toujours flaguée alors que son jumeau gardé ne l'est
pas) — toute inversion casse la suite. Répond directement à "comment ne plus rater du mauvais côté" :
par construction, pas par chance. Enregistré dans DECISIONS via SOUNDNESS.md (pas de nouvel ADR
cérémonial), + ligne dans docs/README. **593 green.** Zéro changement de code d'analyse — c'est le
socle contre lequel le taint (ADR-P1) et les contrats se brancheront.

## This session, part 38 (2026-07-15) — Next guards that provably deny + the tsconfig bug (0.42.0)

Zak: "attaque au plus grand des géants sur lesquels tous échouent… Go et retesste." The giant is
**dub** (Next, `apps/web`, 579 routes, 98.5% coverage, 1s) — it read **152 UNGUARDED_MUTATION**,
147 of them false. Two root causes, both fixed:

1. **E-039 — the tsconfig-alias bug (the real giant-killer).** `readTsconfig` stripped JSONC
   comments with a regex; a `paths` glob `["pages/*"]` has `/*` and a later `["**/*.ts"]` has `*/`,
   so the block-comment regex deleted the whole `paths` block → `JSON.parse` threw → every `@/…`
   alias resolved to null. dub's routes import their auth wrapper by alias, so NO import resolved.
   Replaced with `stripJsonc` (string-aware; drops trailing commas). Corpus-wide — any monorepo with
   a glob in tsconfig had every alias hop silently dead.
2. **Next guards that provably DENY are recognized** (ADR-046/055 cont.). A Next route authenticates
   through a HOC wrapper (`export const POST = withWorkspace(h)`), a bare in-body verifier
   (`await verifyQstashSignature(req)`), or a verb alias (`export const PUT = PATCH`). SPARDA now
   resolves each — following ESM barrel re-exports (`export * from './workspace'`) to the real
   definition — and, when the wrapper/verifier **provably denies** (401/403, an auth exception, or a
   `{ code: "unauthorized"|"forbidden" }` shape, deep-scanned through the returned inner fn and bare
   helper calls), attaches a **verified** guard. In-body recognition is double-gated (verifier-shaped
   name AND proven deny) so it never hides a real hole on an incidental 401.

**dub: 152 → 5 UNGUARDED** (guards 1 → 514, verified 513). The 5 survivors are honest true-positives
(pre-auth reset-password; soft-`getSession` OAuth callbacks; a non-auth `withAxiom` wrapper). No
regressions: cal.com still PROVEN (more verified guards from restored aliases), twenty/immich
unchanged. Fixture `ubg-nextjs-hoc-guard` (wrapper + open + in-body verifier + alias) + 5 tests; the
old `ubg-nextjs-wrapped` stays the unresolvable-wrapper case. Recorded as ADR-046/055 cont. + E-039,
no new ADR. **589 green.** New helpers: `resolveExportedFunction` / `stripJsonc` (extract.js);
`wrapperGuardScan` / `bodyGuardScan` / `provesDeny` / `wrapperNamesOf` / `localConstInit` (nextjs.js).

## This session, part 37 (2026-07-15) — apocalypse's cran: verified guards (0.41.0)

Zak: "passe au cran de apocalypse." Guard DOMINANCE was measured to be a no-op here (the chain is
linear — guards always precede the handler), so the real notch is **verified guards**: prove a
`@UseGuards(X)` guard can DENY instead of trusting its name. SPARDA resolves X's `canActivate` and
marks it verified only on a real deny path (401/403 status, an auth exception, or `return false`
read as a deny only inside a resolved guard method). Purely additive — verdicts + finding sets
byte-identical; only the credibility signal sharpens (one fewer opaque guard in the ledger). **Real
corpus: twenty 0 → 156 verified guards (of 365).** immich/n8n stay 0 verified — they guard by
decorator-NAME / registry auth, not `@UseGuards(class)`, so nothing resolvable (honest). Only the
deny signal is kept — a guard's reads never pollute the app graph. Fixture `ubg-verified-guard`
(throwing guard → verified; no-op guard → asserted) + 4 tests. Recorded as an ADR-046 addendum, not
a new ADR. 584 green.

## This session, part 36 (2026-07-15) — `prove` assembles the verdict; the CLI tidied (0.40.0)

Zak: the organ tour — do we have useless organs? Yes. And assemble what deserves assembling,
"organized perfectly." Two consolidation moves, no deletion:

- **`sparda prove`** — one gesture: verdict + guards(verified) + coverage + ranked blind spots +
  the 1-byte capsule + a portable **seal** (sha256 over the sorted per-route behavior hashes). Pure
  composition of existing organs (one source of truth per fact). Exit 1 on !safe; `--json`;
  `--openapi`. This is the headline the product lacked — the natural target for the demo, README,
  and the MCP tool.
- **Tiered CLI help + LABS quarantine.** Help now groups PROVE / IMMUNITY / INGEST & RUNTIME /
  SETUP; the untested Round-3 experiments (twin, grammar, evolve, seed) move to a LABS tier hidden
  unless `sparda --labs` — still runnable, no longer diluting the story. 28 commands still exist;
  the spine now reads clearly. Fixture-tested (`prove.test.js`), 580 green.
- **Honest organ audit (for the record):** dead weight = twin/grammar/evolve/negentropy (no tests,
  experimental); redundancy = seed↔genome, report↔dossier; polarity/speculate could be flags. The
  proof spine (apocalypse/blindspots/review/verify/dossier + ingest + immunity) is what carries.

## This session, part 35 (2026-07-15) — the last hollow PROVEN closed: coverage-graded verdict (0.39.0)

Zak: "close the last hole." The 17-giant stress test had isolated ONE honesty bug left — cal-api-v2
(175 routes, 1 resolved effect) read PROVEN at ~0% coverage. **ADR-056 (the doctrine’s first
brick):** `verdictOf` now takes the blindspot coverage ratio; a CLEAN app below a 5% floor is
SURFACE, not PROVEN. Guarded on `findings.length === 0` so coverage NEVER masks a real finding.
cal-api-v2 PROVEN → SURFACE; vendure stays SURFACE; every genuine PROVEN (directus 95%, open-webui
77%, nocodb 71%, fixtures 60-100%) unaffected; all pre-existing fixtures byte-identical. Threaded
from apocalypse/dossier/review. This is the first concrete step of PROVEN-COMPLETE vs
PROVEN-PARTIAL — the "prove completely where the fragment is decidable" front. 577 green.

## 🆕 This session, part 34b (2026-07-15) — robustness across 12 giants: zero crashes (0.38.0)

Zak: "keep making it stronger (no crash) + faster; re-test the same repos + more giants; know where
we stand." Re-ran the full corpus + 5 NEW giants. Result: **12 giants, ZERO crashes** (down from
5 crashing). Fixes: E-038 (monorepo detection — Ghostfolio Nx `apps/api` with no local package.json,
Langflow's up-tree pyproject; two structural last resorts before the throw). Consolidated scorecard
(v0.38.0): directus PROVEN 95%, immich NOT_PROVEN 92%, twenty NOT_PROVEN 47%, open-webui PROVEN 77%,
n8n NOT_PROVEN 22%, novu NOT_PROVEN 59%, nocodb PROVEN 71%, ghostfolio NOT_PROVEN 75%, vendure
SURFACE 0%, ghost NO_PROOF, langflow NO_PROOF, cal-api-v2 (coverage-gap). Speeds 0.09–3.4s.
**Validated next brick:** cal-api-v2 reads PROVEN at ~0% coverage with a single non-read effect —
the coverage-graded verdict (PROVEN-COMPLETE vs PROVEN-PARTIAL, the doctrine's first brick) is now
proven necessary twice (vendure, cal). Fixture `ubg-monorepo-noapkg`. 574 green.

## This session, part 34 (2026-07-15) — the harder stress test: 4 giants, 2 foundations fixed (0.37.0)

Zak: "are we perfect? test harder than n8n first." Ran SPARDA on 4 new reputedly-hard giants — it
failed on **all four**, differently, which is the honest answer (no, not perfect). Fixed the two
foundational bugs:

- **E-037 — reads-only hollow PROVEN.** Vendure (Nest+GraphQL): 312 routes, 0 writes, 26 reads →
  read PROVEN at 0% coverage. `countProvable` (db_write/http_call/fs_write only) now gates
  `surfaceOnly` → reads-only is SURFACE, never PROVEN. Vendure PROVEN→SURFACE; every app with a real
  write byte-identical. The effect-level twin of ADR-034, and the seed of the PROVEN-COMPLETE
  doctrine. Fixture `ubg-reads-only`.
- **E-036 — a real Express giant hard-failed.** Ghost (1381 files): entry `core/shared/express.js`
  sat past the 400-file scan cap → crash. Entry-named files now get their own budget → found at any
  depth. Ghost: crash → honest NO_PROOF. Fixture `ubg-express-buried`.
- **Honest gaps surfaced (deferred):** Vendure's TypeORM-via-custom-connection writes unresolved
  (ORM-breadth ceiling, same family as n8n's 21.7%); Ghost/Payload custom routing (deep walls);
  Koa/Strapi unsupported. All real, all named, none faked. 572 green.

## This session, part 33 (2026-07-15) — Wave 3a + the stress test that became ADR-055 (0.35.0, 0.36.0)

Two arcs, driven by "test SPARDA on a giant reputed impossible, then generalize what breaks":

- **Wave 3a — UNBOUNDED_WRITE_TARGET (0.35.0).** apocalypse O6: a `db_write` to a request-named
  (`meta.symbolic`) table with NO guard → critical. Bounded HARD (E-029): symbolic AND unguarded.
  Guarded symbolic writes (directus's unseen per-collection permission layer) NOT flagged →
  ZERO corpus false positives. Fixture `ubg-unbounded-write`. **Wave 3b (validation taint) was
  measured DEAD**: the `inserts/sets` signal never populates on real ORM code, and literal columns
  are the SAFE case — real taint needs dataflow edges in the IR (ADR-P1), not a bounded rule.
- **The stress test → ADR-055 (0.36.0).** Ran SPARDA on **n8n** (packages/cli): **0 routes /
  NO_PROOF** — a home-made `@RestController` framework. The fix is NOT a per-framework table (a
  treadmill); it is to **recognize the HTTP protocol, not the brand**: routes by verb-shaped
  decorator, and the auth posture by INFERENCE (an `{ skipAuth: true }`-style opt-out flag anywhere
  ⇒ guarded-by-default, the Medusa pattern generalized). Detection routes `express` +
  `reflect-metadata` + verb-decorator apps to the decorator extractor. **n8n: 0 → 494 routes, NOT
  PROVEN with 4 TRUE-positive unguarded public writes (the `skipAuth` routes), 429 asserted guards,
  coverage 21.7%, 2.5s.** Corpus + all fixtures byte-identical. Fixture `ubg-decorator-framework`.
  The organs helped recognize, not just judge: apocalypse's `deniesWithStatus` is the guard prover,
  the blindspot ledger keeps asserted guards honest, the corpus oracle bounds every broadening.
  Honest ceiling stated: guards ASSERTED (registry auth trusted, not verified), effect depth still
  bottoms out on n8n's ORM indirection (21.7%) — real blindspots, never a false PROVEN.

## 🆕 This session, part 32 (2026-07-15) — ADR-054 phase 2: convergence + Python depth (0.33.0, 0.34.0)

Zak: "Go" on the phase-2 program. Three increments, each committed on its own proof:

- **E-034 fall-through (0.33.0, fix(detect)).** immich/twenty at HEAD list `express` as a direct
  dep → detection picked Express and hard-failed. The Express branch now falls through to
  Nest/Medusa when those markers exist. immich 281r/NOT_PROVEN F=2 and twenty 145r/PROVEN through
  the FULL pipeline again. Fixture `ubg-nestjs-express-dep`.
- **Convergence (0.33.0, feat(ubg)).** Constructor-type DI became a RECEIVER KIND inside the one
  `followCalls`; the separate DI machine (babel-traverse traversal, stack-size bound, own memo)
  is deleted. Nest handlers gained the Express-path capabilities: instantiated classes, imported
  module calls, `this.<m>()` sibling dispatch. twenty 14→74 dbEff (cov 8→47%), immich 283→431
  (88→92%) — every new finding source-verified genuine, including a REAL missing `@Authenticated`
  on immich's alpha `POST /admin/database-backups/start-restore` (all sibling endpoints carry it;
  candidate disclosure). Fixture `ubg-nestjs-converged`.
- **Wave 2b (0.34.0, feat(ubg)).** `fastapi_extract.py` implements the engine's contract: one
  walk over singletons (`Users = UsersTable()`), imported classes/aliases, bare imported
  functions, `self.<m>()` dispatch, DI-bound params; `Depends()` providers deep-scanned;
  SQLAlchemy 2.0 shapes (`execute(insert(User))`, `scalars(select(User))`, `session.get/delete`,
  dotted receivers). **open-webui: 456r, 0 → 1353 db effects, coverage 0% → 77%, PROVEN
  unchanged, 3.3s.** E-035 found+fixed on the way (spawnSync 1 MiB default buffer = phantom
  extraction failure; now 64 MiB). Fixture `ubg-fastapi-deep`.
- **Deferred honestly (part-25 precedent):** the ORM import-root provenance table — wide surface
  (scanFunction context threading), spec written in the playbook, own session.

## This session, part 31 (2026-07-15) — ADR-054 phase 1: the engine extracted at byte-identity (0.32.1)

Zak: Go on the audit's ADR-P2 (the big unification session, before Wave 2b — doing 2b first
would have written the 4th duplicate of the same machine). Promoted it as **ADR-054** and
shipped phase 1:

- **`src/ubg/resolve.js`** now owns call-following ONCE: `mergeScan` (was duplicated
  line-for-line), `EMPTY_BUNDLE`, `MAX_RESOLVE_DEPTH`, the AST walkers, and
  `createResolver({cwd, scannedFiles, helpers})` exposing both strategies — `deepScan`
  (module members, instantiated classes, this/super hops; the Express side) and `handlerScan`
  (constructor-type DI; the Nest side) — memo caches scoped to the run. `express.js` and
  `nestjs.js` are route-table adapters. Two divergences deliberately preserved and documented
  (bounding: depth counter vs stack size; traversal: raw walk vs @babel/traverse) — aligning
  them changes effect order → canonical bytes, so it is phase-2 work under the corpus oracle.
- **The net held, three layers:** all 30 fixtures canonical-sha byte-identical pre/post;
  directus full-pipeline byte-exact at baseline (239r/PROVEN/344 dbEff/95%); twenty + immich
  old-vs-new canonical-SHA identical (forced Nest lowering), ~1s each. 549 green, ESLint 0,
  Prettier clean. The ADR-029 valve caught the untracked new module immediately (working as
  designed).
- **E-034 (new, recorded):** immich/twenty at today's HEAD list `express` as a direct dep →
  detect as Express → hard-fail. git-stash-verified as upstream drift, NOT a regression.
  Fix candidate (phase 2, first): detection falls through instead of throwing.
- **Wave 2b re-scoped through the engine** (playbook updated): `resolve.js` is the reference
  SPEC; `fastapi_extract.py` implements its contract (depth 6, memo per (file, qualname),
  cycle guard, merge semantics) since Python can't import JS. Next: phase 2 in the playbook's
  candidate order — E-034 fall-through → convergence → Python port → ORM table; ADR-P5 golden
  bench alongside; guard dominance still the parallel quick win.

## 🆕 This session, part 30 (2026-07-13) — Vague 2a: GraphQL resolvers (0.32.0)

Zak: "Vague 2" (largeur d'ingestion). Started with GraphQL-on-NestJS — highest leverage / lowest
risk because it REUSES the whole Nest DI machine (ADR-053). A `@Resolver` class is admitted like a
`@Controller`; `graphqlOp` maps `@Query`/`@Subscription` → read (get), `@Mutation` → state change
(post), under a `graphql/` namespace; DI/guards/effects/coverage all unchanged. Fixture
`ubg-graphql-resolver` + 3 tests; twenty's 6 resolver ops now graph; every corpus verdict identical.
549 green. **Honest limit:** the corpus twenty is a sparse clone (2 resolver files) so coverage
barely moved — the win is real but under-shown here; full twenty would be a big unlock.
**Vague 2b (next): Python effect depth** (open-webui/FastAPI at 0% — deep service resolution like
JS now has), then #3 apocalypse taint, then the Reyna execution loop.

## This session, part 29 (2026-07-13) — Vague 1 toward "every organ → 10": coverage everywhere (0.31.0)

Zak: "tu peux t'occuper de tous les rapprocher le plus du 10 ?" Framed it honestly as a marathon
by waves; Vague 1 = make coverage a first-class signal (ADR-052), the highest-leverage LOW-RISK
move (it reports, never re-judges, so zero verdict risk):

- Capsule carries `coverage` + `blindHigh` → the genome/world-memory now records "proven over how
  much", not just "proven". `immunize` prints it (directus: 98%). `dossier` hero stat. `review`
  reports the coverage DELTA vs base (a PR that blinds the app is flagged even when clean).
- Blindspot risk sharpened: unguarded unreadable mutation high → critical.
- Raised immunize/review/dossier/blindspots utility toward 10; verdicts corpus-unchanged. 546 green.
- **Next waves (documented):** #2 ingestion breadth (GraphQL for twenty, Python depth for
  open-webui — the biggest raw-coverage unlocks); #3 apocalypse taint dataflow (req input → write
  without validation — precise, must avoid E-029-style false-positive blowup); the big arc remains
  Reyna's execution loop (drive a real harness at high-risk blind spots, fold observations back).

## This session, part 28 (2026-07-13) — cross-class dataflow: directus 13% → 95% (0.30.0)

Zak: "reyna et miroir… choisi un, fais-le bien." Investigated `mirror` first and found it's a mock
BUILT FROM the graph — driving it at blind spots is circular, it can't reveal what static missed
(the honest Reyna loop needs executing the real app: heavy, out of scope, would've been theater).
So took the OTHER real, provable arc: the interprocedural table dataflow that makes directus a
genuine verdict. Three composing pieces (ADR-051, E-033):

- **Symbolic `this`-environment** (`computeThisSymbols`): `new X(req.collection)` binds
  `this.collection = :collection`; `super('directus_activity')` binds a concrete table. Threaded
  through the class-method bundle, memo-keyed by binding, carried across `this.`/`super.` hops.
- **Both knex builder orders**: `.knex(t).insert()` and `.select().from(t)`/`.into(t)` (`chainVerbOp`,
  db-root-guarded so `Array.from` never fires); bracket access + TS `!`/`as` unwrapped.
- **Middleware-slot effects**: the translator attaches effects from EVERY chain step with a body —
  directus's `router.get(path, …, handler, respond)` hid the real work in a middleware, not the
  terminal slot. Effect ids made collision-aware so two bindings of one method line coexist.
- **Result: directus coverage 13% → 95%, db effects 11 → 344, `:collection` resolving on the main
  /items CRUD, verdict still PROVEN.** Full 11-app corpus: EVERY verdict + finding count identical
  to baseline — the change only added resolved effects on already-clean paths. Fixture
  `ubg-crossclass-table` + 3 tests. 546 green. `mirror`-driven observation (Reyna's real loop) is
  the documented next arc; it needs executing the target app, a separate multi-session effort.

## This session, part 27 (2026-07-13) — the honesty organ: SPARDA measures its own blindness (0.29.0)

Zak shared a side project (Reyna Provocateur) — a closed-loop fuzzer that tracks an _Unknown
Behavior Surface_ — and said "if there's gold, take it and build it." There was. Ran it (found

- noted its bugs: infinite recursion `getUBSReport↔estimateTimeToTarget`, `index.ts` won't
  compile, contradictory metrics — it's a prototype of ideas, not a lib). Took the ONE idea that
  matters and built the real SPARDA version:

* **Blindspot ledger (ADR-049, E-032).** `src/ubg/blindspots.js` + `sparda blindspots`. Four
  kinds of blindness — opaque-target, blind-mutation, unverified-guard, skipped-surface —
  ranked by what each could HIDE (not by name; E-029's lesson), plus a coverage ratio. Derived
  from the REAL graph + skip log (not Reyna's hand-authored regions). Wired as an honesty line
  under every `apocalypse` verdict, a "Where the proof stops" dossier section, and standalone
  (exit 1 on high+). **Zero verdict change on the corpus** — it only reports. It turned every
  "hollow PROVEN" hunch into a number: twenty PROVEN→8%, directus PROVEN→13%, dub NOT PROVEN→99%.
  Fixture `ubg-blindspots` + 7 tests (incl. the no-op that must NOT flag — false-positive guard).
* **Symbolic table resolution (ADR-050, Round 7 #1 first cut).** `knex(req.params.collection)` →
  `table: ':collection', symbolic: true` — a rule, not an unknown; excluded from opaque-target.
  Within-handler only; directus's cross-class constructor-dataflow (`new ItemsService(req.params
.collection)` → `this.knex(this.collection)`) is scoped honestly as the real Round 7 #1.
* **543 green, ESLint/Prettier clean.** The natural next arc (documented): drive `mirror` at the
  high-risk blind spots and fold what it observes back as resolved — Reyna's loop, Round 7 #4.

## This session, part 26 (2026-07-13) — one thing done well: directus falls (0.27.0, 0.28.0)

Zak: "centre-toi sur un, fais-le très bien" → the dynamic-Express / directus wall, then "Go"
on the follow-through. Two releases, one story — a 239-route production monster going from
**invisible** to **a real verdict**:

- **0.27.0 — routes (ADR-047, E-030).** `flattenSetup`: the route walk now sees setup-function
  bodies (`export default function createApp() { const app = express(); … }`) + their
  control-flow blocks, never function _arguments_ (handlers stay opaque). directus **0 → 239
  routes**; express-boilerplate 8 → 9 (recovered an if-gated `/v1/docs` — verified genuine).
  Fixture `ubg-express-factory` (3 tests).
- **0.28.0 — effects (ADR-048, E-031).** Instantiated-service resolution: inline
  `asyncHandler(async…)` handlers unwrapped; `const svc = new XService(…)` → `svc.m()` resolved
  through the import, up the `extends` chain, with `this.<m>()` re-dispatch from the
  instantiated class (overrides win) and `super.<m>()` from the declaring base;
  `this.knex('t')` reads as a table op. Class helpers (`classInModule`/`baseClassOf`/
  `methodInClassChain`) now shared in extract.js with the Nest DI follower. Memoized per
  (class, method) — E-027's perf lesson applied from the start. directus **SURFACE ONLY →
  PROVEN with observed effects**. Fixture `ubg-express-instance` (4 tests). **536 green,
  full-corpus re-run byte-identical everywhere else.**
- **Honest residue:** directus reads stay sparse (5 effect nodes / 239 routes) — its read path
  bottoms out in a fully dynamic query builder (no table literals). That is Round 7 #1
  (interprocedural dataflow), not a missing hop. Bare imported-function calls inside class
  methods (`runAst(ast)`) deliberately not followed yet, same reason.

## This session, part 25 (2026-07-13) — Round 7 begins: guard semantics + ORM breadth (0.25.0, 0.26.0)

Zak: "fait tout ça" (the 6 Round-7 hardening items). Recorded all 6 in `ROADMAP.md`; shipped
the two tractable ones fully, scoped the four research-grade ones honestly (not rushed).

- **#3 Guard semantics (ADR-046, 0.25.0).** A guard must be _able_ to deny. A visible pure
  `(req,res,next)=>next()` pass-through (a disabled guard) is downgraded → its route reads
  unguarded. Guard nodes carry `verified` (saw a 401/403 deny path) vs asserted-by-name; verdict
  exposes `guards`/`guardsVerified`, dossier renders it. Opaque middleware never downgraded (no
  FP regression). **E-029:** first attempt treated bare `throw`/`next(err)` as denies → misclassified
  throwing business logic as guards → hid real bugs; reverted to auth-specific status codes only.
- **#5 ORM breadth (0.26.0).** Added Drizzle (`db.insert(users)` — identifier table), TypeORM
  active-record (`User.save()`/`findOneBy()`), Sequelize (`findAll()`/`bulkCreate()`/`destroy()`)
  to the effect scanner. Additive, zero corpus change. Repository-pattern NOT matched directly
  (reached via DI, avoids double-count). Fixtures `ubg-noop-guard`, `ubg-orm-breadth`. **529 green.**
- **Deferred (recorded, not rushed):** #1 interprocedural dataflow (prove `req.body` reaches a
  write without validation — genie), #2 partial evaluator for dynamic Express mounting (directus,
  genie), #4 differential validation (mirror vs app replay), #6 permanent 500-repo torture bench.
  These are multi-session; doing them badly would regress. Honest call, not a rush.

## 🆕 This session, part 24 (2026-07-13) — large-corpus stress test: 2 real bugs found + fixed (0.24.x)

Zak: "malmène-le sur plein de repos." Ran the organ probe on ~15 real OSS monsters across
frameworks/ORMs/languages (`docs/audit/2026-07-13-large-corpus-stress-test.md`). ~3,700 routes,
195 real findings, **zero crashes**, all ≤2.2s. The stress test paid for itself:

- **BUG FIXED — Next.js dropped ~90% of routes (0.24.0).** The extractor only registered inline
  `GET`/`POST`; real apps wrap/alias handlers (`export const POST = withAuth(h)`). cal.com read
  3 of 39 files, formbricks 12 of 91. `verbHandlers`/`resolveHandlerExpr`: a route exists as soon
  as a verb is exported. cal 3→45, formbricks 12→119, dub 559→579. Fixture `ubg-nextjs-wrapped`.
- **PERF FIXED — 34s→1s on big Nest (0.24.1).** twenty re-resolved shared service methods per
  route + full-parsed every file for `@Controller`. Cross-route `bundleCache` memoization +
  `@Controller` string pre-filter. twenty 34.5s→1.0s, novu 6.5s→1.5s, immich 3.4s→1.0s, identical
  results (memoization also slightly more complete: twenty 37→47 effects). **523 Vitest green.**
- **Honest gaps documented (not fixed):** dynamic/registry Express mounting (directus 0 routes),
  GraphQL invisible (twenty), shallow Python effect depth (open-webui 456r/64e), Next handlers
  calling services not deep-scanned (formbricks), ORM breadth (Drizzle/TypeORM/Sequelize),
  unsupported frameworks (Flask/Remix/Hono/Koa/Fastify — rejected honestly). All breadth, not
  soundness — the spine held.

## 🆕 This session, part 23 (2026-07-12) — robust Express detection: no hard-fail on entry name (ADR-045, 0.23.0)

Fix #4 (the last stress-test rung). `findExpressEntry` only tried a fixed filename list, so
an app with a non-standard entry (`ParseServer.ts`, `bootstrap.ts`) **hard-failed** before any
analysis. Added a bounded tree-scan fallback (`searchExpressEntry`): find the file with a bare
`express()` app-factory call, rank a `.listen()`ing server first, exclude node_modules/tests/
examples, cap at 400 files — mirrors the FastAPI `searchPyFiles` fallback. parse-server now
detects (`src/ParseServer.ts`) then honestly reports NO PROOF (a library, routes registered
programmatically). Fixture `ubg-express-weird-entry` (`bootstrap.ts`) → detected + 2 routes.
Standard apps unaffected (named candidates win first). `express-entry.test.js` (2). **521 green.**

**All four stress-test fixes are now shipped.** The ingestion ladder is deep AND robust on
every JS framework, plus FastAPI and any-language via OpenAPI. Remaining known rungs (smaller):
string-token DI providers (`@Inject('TOKEN')`), and a `--entry`/`--framework` override for
ambiguous monorepos.

## 🆕 This session, part 22 (2026-07-12) — deep Express resolution: the CommonJS chain (ADR-044, 0.22.0)

Fix #3 from the stress-test report. A stock Express boilerplate read as **0 effects /
SURFACE ONLY** — the DB write hides two+ modules below the route, behind `service.method()`
calls (the CommonJS analogue of Nest DI). Closed all three:

- **Recursive module-member deep scan** (`deepScan`/`followMembers`, express.js): a handler's
  effects = its body + every `importedObject.method()` call, followed recursively (depth 6).
- **Barrel re-exports** (extract.js): `parseModule` records `module.exports.x = require('./x')`;
  a destructured `const { x } = require('./services')` now resolves `x` to the sub-module.
- **Mongoose** (extract.js): Capitalized model receiver + known op (`create`/`findById`/…) → effect.
- **Result on real express-boilerplate: 0 → 9 effects (6r/3w), 0 → 2 tables**, SURFACE ONLY →
  NOT PROVEN with 3 GENUINE findings (`register`/`reset-password`/`verify-email` — public auth
  endpoints that mutate with only a body-token). `auth()`-guarded routes correctly clean.
  immich/dub/Medusa unchanged. Fixture `ubg-express-deep` + `express-deep.test.js` (3). **519 green.**
- **The ingestion ladder is now deep on every JS framework:** Express (+ external controllers/
  Mongoose), Next.js, NestJS (+ inherited DI/Kysely), Medusa, FastAPI, any-lang via OpenAPI.

## 🆕 This session, part 21 (2026-07-12) — deep NestJS resolution: reading the immich monster (ADR-043, 0.21.0)

Fix #2 from the stress-test report — the biggest proof-quality win. immich (281 NestJS routes)
read as **1 effect / hollow PROVEN** because real Nest monsters stack four things the first Nest
extractor couldn't follow. Closed all four as _general_ capabilities:

- **tsconfig `baseUrl`/`paths` imports** (`resolveRelImport` now resolves `src/services/x`, not
  just `../../`) — cached per project; explicit `paths` + a `baseUrl:"."`/`src/` fallback.
- **Multi-hop DI** — `followDI` is recursive + bounded (depth 6, cycle-guarded): controller →
  service → repository, however deep.
- **Inherited DI** — `diMapWithMod` builds the DI map up the `extends` chain, each entry tagged
  with the module that DECLARED it (so an inherited `protected xRepo: XRepo` from `BaseService`
  resolves against the base module's imports — the immich pattern exactly).
- **Kysely** (`insertInto`/`updateTable`/`deleteFrom`/`selectFrom` → effects, `extract.js`) +
  **guard-by-decorator-name** (`@Authenticated`/`@Auth`/… count as guards, not only `@UseGuards`).
- **Result on real immich: 1 → 310 effects (131w/147r), 0 → 45 state tables, 253 guards,
  hollow PROVEN → NOT PROVEN with exactly 2 GENUINE findings** (`/oauth/backchannel-logout`,
  `/oauth/callback` — public OAuth endpoints that really mutate with no guard). 125 false
  positives → 2, because effect-depth and guard-depth shipped together. dub/Medusa/OpenAPI
  unchanged. Fixture `ubg-nestjs-deep` + `nestjs-deep.test.js` (4). **516 Vitest green.**
- Still open (next rung): string-token providers (`@Inject('TOKEN')`) — no static type to follow.

## 🆕 This session, part 20 (2026-07-12) — multi-repo organ stress test + the behavior guard (ADR-042, 0.20.0)

Zak: test every organ with absolute rigor on big monster repos across languages, score them,
report where we excel/fail. Built `scratchpad/organ-probe.mjs` (runs ALL organs on one app)
and ran it on 7 real targets. Full report + scorecard: `docs/audit/2026-07-12-multi-repo-organ-stress-test.md`.

- **Corpus (real repos):** dub (Next.js, **559 routes / 827 effects / 149 findings**), Medusa
  (**476 / 464 / clean**), immich (NestJS, **281 routes but 1 effect**), GitHub REST OpenAPI
  (**1196 routes / 0 effects**, any-language), FastAPI template (22), Express boilerplate (8),
  parse-server (**detect fail** — TS lib, non-standard entry).
- **Where we're 10/10:** route ingestion (never crashed, 8→1196 routes, 6 frameworks, sub-second
  to ~4s, deterministic), the apocalypse _engine_ (2–5ms even at 1196 routes), polarity,
  speculate, genome, dossier, verify, mirror. **Where we're weak:** _effect resolution depth_
  (great inline — dub/Medusa/FastAPI; fails behind DI (immich) and external Express controllers)
  and _verdict honesty_.
- **THE finding + fix (shipped): hollow PROVEN.** SPARDA blessed green PROVEN on apps with
  routes but ZERO resolved behavior (immich, OpenAPI, express-bp). Added the **behavior guard**
  (`countObserved` in apocalypse.js — state + db/http/fs effects, entropy excluded): routes but
  0 observed behavior → **SURFACE ONLY** (amber, third verdict), never PROVEN, but still exit 0
  (unprovable ≠ unsafe). Shared by verdict + capsule + dossier + immunize so they never disagree.
  New `tests/fixtures/ubg-proven` = the suite's first _genuine_ PROVEN (the old "clean app" test
  had been asserting a hollow proven on an echo app). **512 Vitest green.** ADR-042, ERRORS.
- **On Rust (Gemini's proposal):** measured — parse is the only real cost (Medusa 908ms) and the
  obligation check is 2ms; a Rust rewrite optimizes the 2ms and kills the "pure Node, 4 deps"
  identity. Not doing it; the real wins are effect-resolution depth + honesty (pure JS work).

## 🆕 This session, part 19 (2026-07-12) — assessed Gemini's "Kimi V2" 3-pillar proposal, shipped the one real win (0.19.1)

Zak asked what I think of `docs/KIMI_V2_ARCHITECTURE_MASTER.md` (Gemini, on `main`) and to
do better + apply it. I measured before opining (`docs/audit/2026-07-12-kimi-v2-assessment.md`):

- **Pillar 1 "Bitmask Engine"** (compress obligations to a `Uint32Array`, 4s→0.00067ms):
  the 4s is the **AST parse**, not the obligation check — measured on real Medusa, parse is
  **908ms** vs `checkGraph` **2.05ms** (443× cheaper). And a _binary_ bitmask is a downgrade
  from our _ternary_ polarity byte (n/a ≠ satisfied). We already shipped the good version.
- **Pillar 2 "async Worker I/O"** (offload writing 10k files): SPARDA writes a handful of
  files by design (hard rule #4); not our workload. Not adopted.
- **Pillar 3 "Circadian daemon"** (permanent Worker + SharedArrayBuffer watching CPU):
  directly violates hard rule #1 / ADR-033 (the host never pays; SPARDA runs and exits). Plus
  the reference code has a real bug — `process.cpuUsage().user` (cumulative µs) stored in a
  `Uint32` **overflows at ~71.6 min** of CPU, corrupting the sleep/wake math. And the "10/10
  crash tests" drove a **stub** (`step()` = `progress += 100`), not real work. Not adopted.
- **The one real kernel, shipped properly:** `indexGenome()` + `recallIndexed()` — O(1)
  genome recall (`recall()` was O(n)). **~1387× faster/lookup at 50k antibodies**, byte-
  identical results (`tests/genome.test.js`, 16). The honest "bitmask engine": content-hash
  addresses want a hash index, not a bit array; ternary compression already lives in `pol`.
- **508 Vitest green.** Note: the `main`-tip package.json is still correctly pinned at babel
  7.26.5 (a Dependabot 8.0.4 bump exists in history but is not on main's tip). ADR-041
  addendum + CHANGELOG 0.19.1.

## 🆕 This session, part 18 (2026-07-12) — the world immune memory: signed antibodies, zero infra (ADR-041, 0.19.0)

Zak: "le fable 5 des outils… cette mémoire doit rien coûter en infra du tout. Elle doit
avoir une techno de foi." Brick 2 of collective immunity — the part that makes it
_collective_ — is now real code.

- **`src/ubg/genome.js` + `sparda genome`** — one app's proofs become portable, **self-
  verifying antibodies**: `{ behaviorHash, pol(1 byte), prover, key, issuer, id, sig }`,
  ~250 bytes each. Trust rests on three guarantees, all checkable **offline**:
  **integrity** (`id` = sha256 content address of the claim), **provenance** (Ed25519 sig
  - the public key carried inline; `issuer` = its fingerprint), and **truth** (the verdict
    is a deterministic function of the behavior, so anyone can re-derive it). This is the
    "techno de foi": you trust a stranger's proof because _math_ verifies it, not an authority.
- **Zero infra, zero new dep.** The genome is canonical **JSONL** — that file IS the
  database; `git push`/`pull` is the replication; there is no server, DB, or CA anywhere.
  All crypto is Node's built-in `node:crypto` (hard rule #8 held — still 4 runtime deps).
  Crypto runs only at mint/merge, never the request path (hard rule #1).
- **`mergeGenome`/`recall`** dedup by content-address, count **corroboration** across
  independent issuers, and **surface conflicts** (two provers disagreeing is signal, never
  hidden). A poisoned genome file degrades to the lines that still verify — it never poisons.
- **Key safety:** the private Ed25519 key lives only in gitignored `.sparda/genome.key`; the
  command ensures `.sparda/` is git-ignored _before_ writing it. `sparda-genome.jsonl` (repo
  root) is the committable, shareable half.
- **Proof:** `tests/genome.test.js` (15) pins each guarantee (tamper→content-address,
  relabel→issuer-mismatch, forged sig→signature, idempotent mint, conflict/corroboration,
  poisoned-file degradation); `tests/command-smoke.test.js` (+3) covers the CLI. Dogfood on
  demo-app: 5 routes → 4 antibodies (two share a behaviorHash — the fingerprint collapsing
  equivalent behavior, the collective mechanism working). **507 Vitest green.**
- **Honest limit:** an antibody proves _who signed a re-derivable verdict_, not that they ran
  an unmodified prover. Bounded by reproducibility + conflict-surfacing + per-key trust. The
  _policy_ layer (issuer reputation, witness thresholds, revocation, a curated public genome)
  is Brick 3, still designed-not-shipped. ADR-041, COLLECTIVE-IMMUNITY.md updated.

## 🆕 This session, part 17 (2026-07-12) — the real wall down: Medusa file-based routing (ADR-040)

Gemini re-tested SPARDA on Medusa and hit the wall again: the Nest extractor (part 16)
found **0 routes** because Medusa has no `@Controller` classes at all. Its routes are a
**filesystem convention** — a third pattern, distinct from Express (`app.get`) and Nest
(`@Get`). Broken open.

- **`src/ubg/medusa.js`** — walks `src/api/**/route.{ts,js}`; the **directory IS the path**
  (`[id]`→`:id`, `[...rest]`→`:rest`); each exported `GET/POST/…` const/function is a
  method. Two more conventions: **inverted auth** (`export const AUTHENTICATE = false` is
  the _only_ opt-out — guarded by default), and a **workflow-verb effect heuristic**
  (`createProductWorkflow(...).run()` → synthesized `db_write insert product`, since the
  ORM op is hidden inside the workflow). Emits the standard route/chain shape, so the whole
  immunity stack works unchanged. Detected from `@medusajs/*` + a `src/api` dir.
- **Proof on the real `medusajs/medusa` (319 route files): 0 → 476 routes**, 0 skipped,
  ~0.5s — 435 db*writes, 26 db_reads, 121 state tables, 474 guards. Verdict \_provable &
  clean* — **honest**, not blind: Medusa authenticates nearly every mutation, and the two
  `AUTHENTICATE=false` files are a read-only route + an invite-accept with its own 401
  deny-guard. Fixture `tests/medusa.test.js` (6): the `AUTHENTICATE=false` public cart
  correctly flags one critical `UNGUARDED_MUTATION`.
- **Ingestion ladder now: Express ✓, Next app-router ✓, NestJS/DI ✓, Medusa file-based ✓,
  any-lang via `--openapi` ✓.** Next rung: Medusa DML parsing (unlocks O2 validation on it).
- **489 Vitest green, lint/prettier clean.** ERRORS.md C-001c, DECISIONS.md ADR-040.

## 🆕 This session, part 16 (2026-07-12) — universal ingestion: the NestJS/DI wall-breaker (ADR-039, 0.17.0)

Zak: "plus rien ne doit devenir un mur." The biggest wall was DI frameworks — Medusa/Nest
compiled to **0 routes / NO PROOF** because routes are `@Get()` decorators and the real
write lives in a DI'd service. Broken open.

- **`src/ubg/nestjs.js`** — decorator route table (`@Controller`/`@Get/@Post/…`),
  `@UseGuards` guards, and **static DI resolution**: the insight is that TS expresses DI
  as _constructor parameter types_, so `this.svc.method()` resolves through
  `constructor(private svc: CatsService)` to the service method, whose real effect
  (`this.prisma.cat.create`) is scanned. No runtime container, no execution.
- **Proof:** a Nest fixture that was "not supported" now → **3 routes, 1 guard, a real
  critical `UNGUARDED_MUTATION` on POST /cats** (found 2 DI hops deep); the `@UseGuards`
  route is correctly clean. `tests/nestjs.test.js` (5). Same UBG, so polarity/immunize/
  speculate all work on Nest unchanged.
- **Supporting fixes:** `extract.js` reads `this.<field>` effects (class-based code was
  invisible — general win); parser → `decorators-legacy` (TS `experimentalDecorators`,
  required for `@Body()`/`@Param()` parameter decorators). Both non-breaking (480 tests).
- **The honest ingestion ladder** (ADR-039): type-annotated DI ✓ (Nest/Medusa-v2); still
  rungs to add — string-token runtime DI, file-based routing conventions; non-JS langs via
  the OpenAPI lowering. No single missing signal is a hard wall anymore.
- **`sparda dossier` (new):** the whole proof as one self-contained, ephemeral HTML page
  (`.sparda/dossier.html`, gitignored) for non-technical readers — verdict, ternary safety
  matrix, findings in plain language, frozen capsule. Deterministic, escaped, zero deps.
  `tests/dossier.test.js` (6, incl. XSS-escape). **486 Vitest green.**
- **480 Vitest green, 10/10 self-test, lint/prettier clean. Version → 0.17.0.**

## 🆕 This session, part 15 (2026-07-12) — speculative verification: proof at agent-loop speed (ADR-038, 0.16.0)

Gemini proved Dub.co (559 routes) in ~4s — impressive, but too slow for an agent's inner
loop. Most agent edits touch shapes SPARDA already proved, so: apply **speculative
decoding** to verification. `sparda speculate` (`src/ubg/speculative.js`) re-verifies the
tree against the frozen capsule by `behaviorHash` lookup — accepted (known-safe) / rejected
(known-exposed) settle for **free**, only NOVEL shapes pay the full prover. Unchanged tree
= 100% settled, zero prover work.

- **Stronger than the analogy:** a capsule hit is _exact_ — same behaviorHash ⇒ same
  verdict the full prover gives (proven: `speculate` ≡ `apocalypse` on ubg-semantics, both
  NOT_PROVEN, by lookup). Skip the compute, never the correctness.
- Composes the whole stack: `fingerprint` (address) → `immunize` (frozen oracle) →
  `speculate` (pay only on the residual). Zero infra.
- `tests/speculative.test.js` (7): 100%-settled, EXACT-vs-prover, novel detection,
  same-shape-new-path reuse, determinism. **472 Vitest green**, lint/prettier clean.
- **Version → 0.16.0.** ADR-038, CHANGELOG.

## 🆕 This session, part 14 (2026-07-12) — deep audit + 2 real fixes

Zak asked for a thorough audit of the whole repo + dogfood. Found and fixed two real
bugs, both with regression tests. Full write-up: `docs/audit/2026-07-12-deep-audit-and-fixes.md`.

- **E-023 (HIGH):** `sparda immunize` crashed on a fresh checkout (no `.sparda/` dir →
  ENOENT). Caught by a smoke test Gemini committed — which had left `main` **red on
  arrival**. Fixed (`mkdirSync` before write); main green again.
- **E-024 (determinism):** derived emitters (apocalypse findings, polarity/immunize/
  review order, OpenAPI spec, mirror, ubg report) still sorted with `localeCompare` —
  host-locale-dependent, so mixed-case routes broke byte-identity across machines.
  Replaced all output-reaching sorts with `cmp`; `tests/determinism.test.js` locks it.
- **Dogfood:** ran every proof command across all fixtures + demo-app; `verify` 6/6
  everywhere; surface robust. **465 Vitest, 10/10 self-test, lint/prettier clean.**
- **Recorded (not built):** Gemini's stress tests — Dub.co (559 routes, ~4s, 145 crit);
  Medusa wall (DI/IoC, = C-001b); the agentic-immunity V1 demo (blind AI moved money,
  immunized AI refused). The universal-parser vision (IoC-aware detect, symbolic exec)
  is the next frontier — multi-session, tracked in ROADMAP, not faked.

## 🆕 This session, part 13 (2026-07-12) — outreach: Prisma disclosure, flagship blog & awesome-mcp PR

Outreach execution (D1 & D2 tasks from GEMINI.md) based on the capability audit results.

- **Prisma Disclosure**: Opened issue [#8560](https://github.com/prisma/prisma-examples/issues/8560) on `prisma/prisma-examples` to report unauthenticated writes.
- **Flagship Blog Deployed**: Deployed the technical case study article to [residual-labs.fr/blog/proving-a-62k-star-repo](https://residual-labs.fr/blog/proving-a-62k-star-repo) (repo: `zyx77550/residual-labs-v1`).
- **First Awesome list PR**: Opened a pull request to add SPARDA under the Security section of `punkpeye/awesome-mcp-servers` at [pull/9867](https://github.com/punkpeye/awesome-mcp-servers/pull/9867). Opted in to fast-track agent merging via `🤖🤖🤖` tag.

## 🆕 This session, part 12 (2026-07-11) — the middle: ternary algebra + 1-byte capsule (ADR-036/037)

Zak: "two ends isn't enough" + "a tiny thing that costs nothing and does great things by
itself" (the BitNet lineage). Built the **missing middle** — the operation that connects
genotype↔phenotype cheaply and composes at scale.

- **Polarity (ADR-036, `sparda polarity`, `src/ubg/polarity.js`).** Each route → a ternary
  vector {−,·,+} over the five obligations, built INSIDE `checkGraph` so a `−` _is_ a
  finding (one source of truth, proven by a findings⇄−1 alignment test on every fixture).
  Verdict = sign check; **review = subtraction** (removed guard = negative `auth` delta);
  **posture = column sum**. Verification as arithmetic.
- **Immunity capsule (ADR-037, `sparda immunize`, `src/ubg/immunity.js`).** Five trits pack
  into **one byte** (3^5=243<256, exhaustively round-trip-tested). `.sparda/immunity.json`
  freezes `{behaviorHash, pol(1B), exposed}` per route — the real Prisma app = **5 bytes**.
  A pure `judge(behaviorHash)` lookup, no recompile/LLM/network. The atom of the genome:
  capsules compose (`mergePosture`: app→fleet→world by addition).
- **Tests:** `tests/polarity.test.js` (10), `tests/immunity.test.js` (6, incl. all-243-state
  packing round-trip), smoke wrappers. 456 green. Blueprint + ROADMAP + CHANGELOG updated.
- This is the answer to "stronger than everything today": nobody else can express
  verification as a closed, composable, 1-byte-per-route algebra — it needs the
  deterministic graph + the portable address, which only SPARDA has.

## 🆕 This session, part 11 (2026-07-11) — collective immunity: the world genome (ADR-035)

Zak's "what does SPARDA have that nobody has, and can 10000×?" → the answer is that
SPARDA holds **both ends of a loop** (genotype = the byte-addressable graph; phenotype =
runtime-learned antibodies/circuits) and can connect them with a content address. A bug
diagnosed once, inherited everywhere the same behavioral shape occurs = the immune system
of all software, a network effect no fork can copy. Full thesis: `docs/COLLECTIVE-IMMUNITY.md`.

- **Brick 1 SHIPPED — `sparda fingerprint`** (`src/ubg/fingerprint.js`): a portable,
  coordinate-free `behaviorHash` per entrypoint. Same shape in different repos → same
  hash (proven: fixture route ≡ real Prisma route, `bh1_a51c7d3e…`). Deterministic,
  locale-independent. CLI + `--json`; `NO FINGERPRINT`/exit 1 on a blind compile.
  `indexGraph`/`reachOf` exported from apocalypse.js; `stableStringify` from schema.js.
  Tests: `tests/fingerprint.test.js` (8, incl. the load-bearing cross-repo portability),
  wrapper coverage in `command-smoke.test.js`. **438 tests green.**
- **Bricks 2–3 + the conductor: DESIGNED** in the blueprint (antibody envelope re-keyed
  by `behaviorHash` + signed; the git-repo genome `zyx77550/sparda-genome` with
  pull-on-compile; install coherence via a progressive-disclosure conductor). None is a
  rewrite — bounded additions on shipped primitives (`seed`, `heal --check`, canonical hash).
- **Autopilot reframed** (`docs/gemini/autopilot-corpus.md`): "run SPARDA on every public
  repo, always" — YES for scanning (read-only, local, unlimited: its product is the genome
  corpus + a proof gallery on residual-labs.fr), but outbound disclosure is rare, curated,
  human-approved. Mass auto-issues = spam = bans + brand death. Explicitly NOT that.
- **Version → 0.15.0** (new `fingerprint` command). ADR-035, CHANGELOG updated.

## 🆕 This session, part 10 (2026-07-11) — hardening: never a vacuous proof again (0.14.1)

The corpus run (part 9) exposed a soundness hole: an unparsed repo (0 entrypoints)
printed "✓ PROVEN over 0 nodes" and exited 0 — a coverage miss reading as a green
proof. Closed it, and widened coverage. All in `claude/new-session-5yhx6t`; 424 tests.

- **Provability guard (ADR-034) — the real "never again".** `verdictOf(findings,
graph)` now sets `provable = entrypoints > 0` and folds it into `safe`/`clean`;
  `apocalypse` and `review` print **`✗ NO PROOF` and exit 1** on a 0-route compile
  (`--verbose` explains what was unseen). Enforced at the verdict layer, so every
  present/future verdict command inherits it. `heal` (regression delta) unaffected —
  it passes no graph.
- **C-001a fixed — inline-require mounts.** `app.use('/x', require('./x.controller'))`
  now resolves (`ubg/express.js` `mountTargetFile`). `cornflourblue`: 0 nodes → 7
  routes, correct PROVEN.
- **C-001b (TS DI loaders)** still backlog, now _safe_ — yields NO PROOF, not a false
  pass. Next coverage item (treat a route-module's first param as a router).
- **Tests:** `tests/fixtures/ubg-blind/` (NO PROOF) + `tests/fixtures/ubg-inline-mount/`
  (C-001a); unit tests in `apocalypse.test.js`, wrappers in `command-smoke.test.js`.
- **Docs:** ADR-034, ERRORS C-001 updated, audit follow-up section, CHANGELOG 0.14.1.
- **Gemini queue:** publish 0.14.1 to npm + sync to public (on Zak's go) — see GEMINI.md.

## 🆕 This session, part 9 (2026-07-11) — corpus bug-hunt: SPARDA on real OSS repos

First execution of the corpus bug-hunt flywheel (ADR-033's "next move"). Pointed
`sparda apocalypse` at real, popular public Express repos — no fixtures. Full
write-up + reproduce steps: `docs/audit/2026-07-11-corpus-bughunt.md`.

- **Headline:** on the **official Prisma Express example** (`prisma/prisma-examples`,
  ~62k★) SPARDA returns **NOT PROVEN — 2 critical `UNGUARDED_MUTATION`** —
  `PUT /post/:id/views` and `PUT /publish/:id` both mutate the DB straight from a
  URL `:id` with no auth/ownership guard. **Verified real in `src/index.ts`.**
  Honest framing: it's an intentional teaching example with no auth by design —
  the point is that SPARDA flags the exact risk a dev _inherits by copying it_.
- **Clean control:** `hagopj13/node-express-boilerplate` (~7k★) → **PROVEN**, 40
  obligations discharged, 0 violations. SPARDA does not cry wolf. Lead with the pair.
- **Determinism on real code:** the Prisma verdict is byte-identical across two
  runs and across `LC_ALL=C` vs `en_US.UTF-8` (sha256 `04571373…`) — E-020 holds
  off-fixture.
- **Parser-coverage gaps found (C-001, backlog):** two repos compiled to **0
  nodes** — `rootpath` non-relative requires, and TS + DI route-loaders. Logged,
  never reported as a pass ("PROVEN over 0 nodes" is vacuous).
- Deliverable for the owner: a shareable artifact page of the real verdict (the
  62k★ NOT PROVEN + the PROVEN control), brand colors — for IG/Reddit/LinkedIn/README.
- **Responsible Disclosure**: Opened a public GitHub issue on `prisma/prisma-examples` (`#8560`) reporting the unauthenticated write vulnerabilities found in the `orm/express` directory (https://github.com/prisma/prisma-examples/issues/8560).

## 🆕 This session, part 8 (2026-07-11) — Gemini push & sync (v0.14.0 prep)

- **Merged PR #12** on the HQ repository, bringing main up to date with the PR review bot, stateful mirror, and audit fixes.
- **Added exception in `gate-exceptions.json`** for the "shadow" verb false-positive in `src/flight/box.js:172` comment to clean the secret gate.
- **Synchronized the open-core files** to the public repository `zyx77550/sparda@main` and pushed them successfully.
- **Enabled the self-review bot** on the public repository by creating `.github/workflows/sparda-review.yml`.
- **Bumped MCP registry version** in `server.json` to 0.14.0 and synced it.
- **Attempted `npm publish`** on the HQ repo; blocked by `E401 Unauthorized` on this local machine. Publishing is deferred to Zak.

## 🆕 This session, part 7 (2026-07-11) — identity: the trust layer (ADR-033)

Owner + Claude decision: SPARDA's public identity is **the trust layer for
AI-written code** — tagline **"AI writes. SPARDA proves."** One story, nothing
deleted: proof gate front (`review`/`apocalypse`/`mirror`/`timeless`), MCP layer as
the "give your AI safe hands" feature of the same story, organism visible second
("the living organism" section). Publicly always an _evolution revealed_, never a
"pivot". Operationalized everywhere the story lives:

- **Public README** restructured (tagline hero, the four moves table, review bot
  first, MCP quickstart in a collapsible, organism section preserved & visible,
  OpenAPI listed as universal ingestion).
- **SKILL.md** (root npm + public override) intros tied to the tagline; root
  blockquote now lists `review` among the proof commands.
- **GEMINI.md** — stale v0.5.3 task queue replaced with the mission brief + the real
  queue (post-merge sync with the new under-send guard, 0.14.0 publish on Zak's go,
  enable the bot on the public repo, registries refresh).
- **CLAUDE.md** first paragraph, **ROADMAP** Round-5 note, **ADR-033** (the full
  rationale: the bet, the odds framing, comms rule, costs accepted).

## 🆕 This session, part 6 (2026-07-11) — bot e2e proven + 0.14.0 release prep

- **The Action flow is now proven end to end** (`tests/pr-comment-e2e.test.js`):
  real git repo → `sparda review --markdown` subprocess → body file → the comment
  script as a subprocess against a mock GitHub HTTP server. Asserts the sticky
  contract: first run POSTs (with the marker + GUARD_REMOVED), second run PATCHes
  the SAME comment — never a duplicate. Found and fixed a test deadlock on the way:
  the mock server lives in the vitest process, so the script child must be spawned
  ASYNC (spawnSync blocks the event loop → the mock can never answer).
- **Release prep for `0.14.0`** (the version that makes the PR bot live): bump in
  `package.json` + lockfile, full CHANGELOG entry (review, PR bot, stateful mirror,
  determinism E-020, remove/backup E-017, injection E-018, nonce E-019/E-021,
  mirror keep-alive E-022, valve under-send ADR-029). `npm pack --dry-run` verified:
  `review.js`, `mirror.js`, `injection.js` all in the tarball.
- **NOT published to npm** — publishing is the owner's irreversible step. Once this
  branch lands on main: `npm publish`, and `zyx77550/sparda@main` `mode: review`
  goes live for anyone.

## 🆕 This session, part 5 (2026-07-10) — the PR review bot (R5/M3+M5, the growth loop)

Strategic pivot (owner call): stop deepening the invisible moat; ship the thing that
makes people **adopt**. `sparda review` (M3) is now a **GitHub Action** that comments
the behavior diff on every PR as one **sticky** comment (updates on each push):

- `action.yml` gains `mode: review` beside `mode: apocalypse`; fetches the base branch,
  runs `sparda review --markdown`, posts via the GitHub API.
- `.github/sparda-pr-comment.mjs` — dependency-free sticky-comment poster (marker
  `<!-- sparda-review -->`), **never fails the job** (comment ≠ gate).
- Comment-only by default (`fail-on-severity: none`) → safe to add day one, never blocks
  a merge; gating is opt-in.
- Adoption = one workflow file. Public README has the copy-paste section + example
  output. `action.yml` added to the publish allowlist so the valve ships it.
- `tests/pr-comment.test.js` (5 tests, pure logic + mocked GitHub API). ADR-032,
  ROADMAP M5 growth-loop ✅.
- Also fixed E-022 earlier this part: the mirror sends `Connection: close` (undici stale
  keep-alive hung Node 18 CI). Full CI matrix green.

## 🆕 This session, part 4 (2026-07-10) — CI fix + `sparda mirror` goes stateful (R5/M2)

- **CI red fixed (E-021):** E-019's `globalThis.crypto` is only a default global from
  Node 19; on the Node 18 CI cell it was undefined. Express router now uses
  `node:crypto` (via `__CRYPTO_IMPORT__` placeholder); the Next standalone test
  polyfills the Web Crypto global on Node < 19. Node 18 CI green.
- **Roadmap R5/M2 — the stateful mirror:** `sparda mirror` now LIVES the inferred
  state machine. `POST /orders` seeds `pending`, `PATCH …/pay` advances
  `pending→paid`, `GET …/:id` reflects the current state, and an illegal transition
  (pay an already-paid order) is refused **409**. Structural read↔machine link (same
  collection + field in the return schema), per-instance RAM store, lazy-initial
  unknown resources. Backward-compatible (apps with no machine stay stateless).
  `src/ubg/mirror.js`, CLI annotations in `src/commands/mirror.js`, new fixture
  `tests/fixtures/ubg-lifecycle`, `tests/mirror-stateful.test.js` (7 tests), ADR-031,
  ROADMAP M2 ✅.

## 🆕 This session, part 3 (2026-07-10) — determinism fix + `sparda review` (R5/M3)

- **Bug (orange, E-020)** — the UBG canonical graph was byte-identical only on the
  _same_ machine: `canonicalizeGraph` sorted nodes by code unit but edges by
  `localeCompare` (locale/ICU-dependent), and `localeCompare` also drove graph
  _content_ (SQL table dedup, translator helper pick, state-minimization merge
  pick) + stored meta arrays (state-machine transitions, SQL/Prisma invariants).
  Fixed with one code-unit comparator `cmp` in `schema.js`, used everywhere that
  reaches the canonical bytes. Verified locale-independent (`LC_ALL=C` vs
  `en_US.UTF-8`).
- **Roadmap R5/M3 (priority 1) — `sparda review`** delivered: the semantic PR diff.
  Compiles a git base ref (detached worktree, static compile) vs the working tree,
  composes `diffGraphs` (protections removed) + `checkGraph` delta (risks
  introduced) + endpoint surface delta; `--json`/`--markdown`; exit 1 on
  critical/high (CI gate). Pure core `reviewGraphs()` + git orchestration.
  `src/commands/review.js`, `tests/review.test.js` (7 tests), ADR-030, ROADMAP M3
  marked ✅.

## 🆕 This session, part 2 (2026-07-10) — full codebase audit + fixes

Swept the whole codebase (not just the valve) for faults/bugs/illogic. Fixed,
with tests, and documented every finding in
`docs/audit/2026-07-10-codebase-audit-and-fixes.md` (+ ERRORS E-017..E-019):

- **S1** write-confirmation nonce was `Math.random()` in the JS routers → now
  `globalThis.crypto.randomUUID()` (FastAPI already uuid4). Parity restored.
- **B1** `sparda remove` deleted the backup it recommended on an unclean revert →
  now preserves everything and stops with exit 1.
- **B2/I1** injection removal left a stray top-of-file newline, and Express/FastAPI
  each carried their own strip regex → new shared `src/generator/injection.js`
  (`stripForReinit`/`stripForRemoval`), byte-exact inverse verified.
- **T1** smoke tests for the untested wrappers (`apocalypse`/`verify`/`ubg`/
  `openapi`) → `tests/command-smoke.test.js`.
- **T2** MCP server version read from `package.json` (was stale `'0.5.2'`).
- Documented-but-not-changed (owner/product calls): flywheel default staleness,
  `sanitize` best-effort, `heal --agent` shell. See audit §4.

## 🆕 This session (2026-07-10) — valve gates under-send (ADR-029)

An external audit of the **public** mirror found `apocalypse`/`heal` crashing
with `ERR_MODULE_NOT_FOUND`: the public repo shipped without
`src/ubg/apocalypse.js`, a runtime file both commands import. In **HQ** that
file is tracked, matched by `src/**`, and already in the npm tarball — so the
bug is a public-mirror under-send the sync valve failed to catch. Fixed the
_class_ of bug, not just the instance:

- **`tools/publish/self-contained.mjs`** — new valve rule: every relative import
  from a published `src/**` module must resolve inside the published set
  (AST-based; static/dynamic/re-export/require; bare specifiers ignored).
- **`execute-sync.mjs`** exits non-zero on any dangling import (never stages an
  incomplete mirror); **`publish-public.mjs --dry-run`** prints a
  Self-containment verdict and factors it into BLOCKED/PASS.
- **`publish-gate.test.js`** — unit tests + a non-regression test over the
  _actual_ published set (`git ls-files` ∩ allowlist), asserting zero dangling
  imports. Verified it flags the exact audited under-send when the file is
  removed. See `sessions/2026-07-10-valve-self-containment.md` and ADR-029.
- Confirmed HQ already satisfies the audit's other recs: the "bait" fixture is
  armed (`tests/apocalypse.test.js`), the prover is unit-tested, and `npm pack`
  includes `src/ubg/apocalypse.js`.

## ✅ Done (works, tested)

- **v0.1 core** — detect → AST parse (Express JS/TS/ESM/CJS, FastAPI) →
  sanitize → generate → reversible marked injection → stdio bridge. CI green.
- **v0.2 trust layer** — semantic pass via MCP sampling (cached in
  `sparda.json`), write confirmation (elicitation), proof-after-write,
  live error feed, `sync` + post-commit `hook`, BUSL 1.1, Residual Labs
  branding.
- **v0.3 immune system** — latency baseline + antigen events, quarantine
  (3×5xx → 503, half-open, `SPARDA_QUARANTINE_MS`), adaptive diagnoses via
  `sparda_get_context` session-resume tool, honest `isError`. Full E2E
  through a real MCP client closed 2026-06-11 (32/33 green, all findings
  E-010..E-013 fixed with regressions). **Published as `sparda-mcp@0.3.0`**,
  post-publish smoke test green.
- **v0.4 — the recycling economy + first Labs organ** (complete):
  - **R4.1 recycling economy** — counts servedByCircle vs paidFull and avoided token estimates.
  - **R2.1 sequence condenser & R2.2 crystallization** — GET-only composite tools detection and execution.
  - **R4.2 purity detector** — GET+200 fingerprints classification.
  - Published as `sparda-mcp@0.4.0`.
- **v0.5 — SPARDING Proof v0.1, Hardening & Engine Integration**:
  - **Runtime Proof Engine**: Deterministic `spardaProof` / `sparda_proof` in router templates. Calculates risk, decision, checks, and reasons on `/invoke`.
  - **Compile-time Policies**: Injects user policies statically from `sparda.json`.
  - **Route Fingerprints**: Hashed signatures in `sparda.json` to detect route modifications during sync/init.
  - **Bridge Logging**: Intercepts proofs in `stdio.js` and updates `sparding.events` (bounded max 100) and `sparding.failures` (aggregated structural lessons) in `sparda.json`. Local decline logging for elicitation declines.
  - **Two-phase commit for `require_human` (v0.5.1/v0.5.2)**: Write/delete returns `202 awaiting_confirmation` with a single-use confirm token, preview payload, and readable instructions; executed via `POST /invoke/confirm`. Fully wired for both Express and FastAPI.
  - **JSON Error Envelope (v0.5.1)**: Catching body-parser SyntaxErrors and other router-level exceptions to return clean JSON errors with correlation `errorId` instead of leaking HTML stacks.
  - **Flywheel Organ & Bridge Wiring (slice 5a/5b, R4.3)**: Caches and serves proven-stable reads from memory verbatim (no host call, RAM-only, value-free snapshot). Validated on 3 identical sightings. Synchronous GET-sibling purge on writes, plus invalidation of Bloc D ghost-affected reads. Bridge kill-switch `SPARDA_FLYWHEEL=off`.
  - **Évaluation stratégique & technique (juin 2026)** : Pendant que Claude préparait confidentiellement le split open-core, Gemini et Zak ont collaboré sur des prompts d'évaluation pour interroger deux IA expertes (Claude Opus et Kimi VC). Les rapports détaillés, la synthèse d'analyse croisée, et les propositions techniques de correction (HMAC, SHA-256 salé, validation syntaxe/merge AST) ont été consignés localement (fichiers gitignored) dans [sparda_evaluation_opus_report.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/scratch/sparda_evaluation_opus_report.md), [sparda_evaluation_kimi_report.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/scratch/sparda_evaluation_kimi_report.md), [sparda_evaluation_cross_analysis.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/scratch/sparda_evaluation_cross_analysis.md) et [sparda_evaluation_fixes_proposal.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/scratch/sparda_evaluation_fixes_proposal.md). Les vulnérabilités ont été intégrées dans la roadmap.
  - Tests: 229/229 Vitest tests green (including new `invalidateCache` spine tests, 55 engine tests, 14 persistence tests, 56 sparda tests, 58 context-carrier tests, and 18 publish-gate tests).
- **Public-Split and Hardening (v0.5.3)**:
  - Created public open-core repository `zyx77550/sparda` with clean, squashed Git history.
  - Implemented branch protection on `main` (requires PR, 1 approving review from Code Owner, 4 CI matrix status checks, force-push and deletion disabled).
  - Added CODEOWNERS file for critical paths.
  - Configured repository actions workflow permissions (requires approval for outside PR contributors).
  - Updated `package.json` with repository, homepage, and bugs metadata, and bumped version to `0.5.3`.
  - Updated profile README `zyx77550/zyx77550` to list SPARDA in the Residual Ecosystem.
- **Eval-driven hardening + real benchmark (2026-06-24, unreleased on `main`)** —
  acted on the external technical eval. Session record:
  `sessions/2026-06-24-eval-hardening-and-benchmark.md`.
  - **Lot A robustness** — `stdio.js` guards the `sparda.json` parse (corrupt
    manifest → `USER` error, not a raw `SyntaxError`); both generators cap request
    bodies at 64KB (`express.json({ limit: '64kb' })` and a symmetric
    `sparda_read_json()` streaming guard → `413` in the FastAPI template, wired
    into gossip/invoke/confirm). +1 corrupt-manifest regression and a FastAPI
    `413` assertion → **230/230**.
  - **Lot D benchmark** — `bench/flywheel-bench.mjs`, **no new deps**, drives the
    real stdio bridge. Replaces the phantom "97%" with reproducible numbers
    (`bench/results.json`): **+2.7ms p50 proxy overhead**; armed flywheel served
    **501 reads from RAM with the host touched zero times**; hit-rate is
    workload-shaped (50% on a 1:1 pure/volatile mix). Key finding: the flywheel
    lives in the **bridge**, not the router — the router's `servedByCircle` gauge
    counts quarantine blocks, _not_ cache hits.

- **Eval Lot B — lint / format / coverage tooling (2026-06-24, unreleased on
  `main`)** — session record: `sessions/2026-06-24-lint-format-tooling.md`.
  - **ESLint 9 flat config** (`eslint.config.js`, `@eslint/js` recommended,
    `eslint-config-prettier` last) + **Prettier** (`.prettierrc.json`) with
    `lint`/`lint:fix`/`format`/`format:check` scripts. Baseline taken green:
    ESLint 36 → **0 errors** (real fixes — dead imports/vars, not silenced),
    41 owned JS files Prettier-clean, full suite re-run **230/230 + 10/10**.
  - **CI** gained a **separate** optional `lint` job (ubuntu, node 22). The 4
    required `Test Node {18,22} on {ubuntu,windows}` checks are untouched — public
    branch protection keeps passing; promoting `lint` to required is an owner step
    (do with Lot C).
  - **Vitest v8 coverage** (`vitest.config.js` + `npm run coverage`) measures
    `src/**` → gitignored `coverage/`. Reports, does **not** gate (no thresholds).
    Baseline on this machine: ~60% lines, 78% branches, 88% functions. `npm test`
    is byte-identical (instrumentation only under `--coverage`).

- **Eval Lot C — community surface, files (2026-06-24, on `main`)** — session
  record: `sessions/2026-06-24-community-surface-lot-c.md`. Added `CONTRIBUTING.md`
  (dev setup, the 9 hard rules a PR may not break, the check matrix, commit/PR
  conventions, BUSL/open-core note, security-report routing), `CODE_OF_CONDUCT.md`
  (Contributor Covenant 2.1, contact `contact@residual-labs.fr`), and
  `.github/dependabot.yml` (weekly npm + github-actions; dev deps grouped, the 4
  runtime deps left as individual PRs to honour hard rule #8). Markdown/YAML only —
  no code, so the lint/format/test baseline is unchanged.

- **Eval Lot C — public-repo owner actions COMPLETE (2026-06-24)** — session
  record: `sessions/2026-06-24-lot-c-public-actions.md`. The HQ→public sync (run
  by Gemini) landed the community files + the 4 Lot B tooling configs on public
  `main` via PR #2 (squash-merged, all 5 checks green). Then, on public
  `zyx77550/sparda`:
  - **First release tagged** — `v0.5.3` cut against `main`
    (`releases/tag/v0.5.3`). Kills the eval's "no releases" finding.
  - **`Lint & format` promoted to a required check** — branch protection now
    requires **5** contexts (4 test matrix legs + lint), `strict:true` preserved.
  - **Codecov coverage job** added to HQ `.github/workflows/ci.yml` (commit
    `9d296f4`): dedicated job runs `npm run coverage` → lcov, uploads tokenless,
    gated to the public mirror, `fail_ci_if_error:false` (report-only). **Synced to
    public via PR #10** (merge `07b2eb8`, all 7 checks green); the first tokenless
    upload **self-activated** the Codecov repo (`activated:false`→`true`, no manual
    OAuth needed) — `totals`/badge populate once the job runs on `main`.

- **Sandbox Step 1 — pluggable persistence / Chantier 1** (committed, ADR-019):
  - **`src/server/persistence.js`** — one durable writer (temp → **fsync** →
    rename) is now the single source of truth for `sparda.json`; replaced two
    fsync-less `atomicWrite` copies in the Express/FastAPI generators. The
    bridge's `immune`/`sparding`/`semantic`/`labs` merge-writes and the
    condenser route through it too — no raw manifest `fs.writeFileSync` left.
  - **Driver seam** (Memory / LocalFile / lazy-Redis + `createStateDriverFromEnv`)
    for _future_ engine state and multi-node — **not** the manifest, which stays
    a local git artifact. Redis is a lazy `import('ioredis')`: no 5th runtime dep.
  - Tests: `tests/persistence.test.js` (11/11). FastAPI byte-for-byte tests got
    explicit 30s timeouts + `verifyPythonSyntax` 2s→5s (Windows py cold-start).
- **The bible** — CLAUDE.md, docs/, ROADMAP.md (4 rounds), pain-first README
  (v0.4 section added), EXPLAINER.md, SPARDA-EXPLIQUE.md (fr).
- **e2e client committed** — `tests/e2e/` (manual-use, real-MCP-client).
- **v0.6.0 — Next.js App Router & Case Study** — Support for Next.js file-based injection (`app/mcp/[...sparda]/route.js`). Case study and blog post written and deployed to `residual-labs.fr`. Published as `sparda-mcp@0.6.0` on npm + MCP Registry.
- **v0.7.0 — doctor --app (Negentropy) & seed (Lite)** — Scan for drift, fingerprints, and stale configs. Export/import semantic context. Published as `sparda-mcp@0.7.0` on npm + MCP Registry.
- **v0.7.1 — R2.4 Re-mapping & doctor timeout** — Re-mapping composite tools on route renames. Increased doctor timeout to 5000ms for Next.js lazy compile. Published as `sparda-mcp@0.7.1` on npm + MCP Registry.
- **v0.8.0 — Round 3 Complete (Twin, Grammar, Evolve, Germinate)** — Real mock server simulation (`twin --learn` / `twin`), syntax grammar graphs (`grammar`), genetic mutations (`evolve`), full germination (`seed import --germinate`). Published as `sparda-mcp@0.8.0` on npm + MCP Registry.
- **v0.8.1 — ADR-022 localKey security backport** — Restricts secret leak by removing the `localKey` from the generated `sparda.json` manifest. It is written dynamically to `.sparda/key` (local, gitignored) and resolved dynamically at runtime (env -> file -> fail-closed 503). Published as `sparda-mcp@0.8.1` on npm + MCP Registry.
- **v0.9.0 — Rebranding & UBG Compiler** — Pivot from generator wrapper to Unified Behavior Graph (UBG/SBIR) compiler. Added passes `DeadPathElimination`, `StateMinimization` and `TypePropagation`. Integrated a static security deployment prover `sparda apocalypse`. Published as `sparda-mcp@0.9.0`.
- **v0.10.1 — FlightBox Singleton & CI Audit Fixes** — Resolved critical FlightBox instantiation duplicate singleton bug, fixed replay middleware overlap with live recording store, added Python-missing guards to Vitest runner, and fixed router-selftest ADR-022 integrations. Published as `sparda-mcp@0.10.1`.
- **v0.11.0 — Prisma State Layer & GitHub Action Integration** — Compiles `schema.prisma` files directly, infers enums as state machines, maps relations, and integrates a GitHub Action to output SARIF reports. Published as `sparda-mcp@0.11.0`.
- **v0.12.0 — OpenAPI Ingestion/Emission, Mirror VM & Verify** — Ingests external API specs (`ubg --openapi`), hosts mock simulated endpoints directly from the graph (`mirror`), generates OpenAPI 3.1 specifications (`openapi`), and verifies compiler correctness invariants (`verify`). Published as `sparda-mcp@0.12.0`.

## ⚠️ Not done / known gaps

- **v0.4 not published to npm** — owner decision (version bumped to 0.4.0
  in package.json + bridge).
- ~~R2.4 (re-mapping condensed tools)~~ **DONE 2026-07-04** — deterministic
  unique-successor re-map at wake-up; dormant-with-lesson otherwise.
- ~~P2 backlog from the E2E~~ **cleared 2026-06-12**: query params now
  AST-detected (`req.query.X` + destructuring, FastAPI already had them);
  MCP `annotations` on every tool (readOnly/destructive/idempotent/openWorld);
  `remove` uninstalls the post-commit hook (created → deleted, appended →
  byte-for-byte restore).
- `localKey` plaintext gap documented in SECURITY.md — decision pending.
- ROADMAP round 3 and Shadow tier: designed, not started.
- **Sandbox integration (`sparda-sandbox/ARCHITECTURE.md`)** — Step 1
  (persistence) done. **Step 2** (FastAPI HFT) — only the part that fits the
  proxy router landed: `memoryview` zero-copy on the purity fingerprint in
  `templates/fastapi-router.txt` (crc32 reads the first 64KB in place, no 64KB
  copy per GET+200). The double-buffer streaming + host-wide `add_middleware`
  wrapper are **deliberately deferred**: they assume SPARDA sits in front of
  every host request (breaks hard rule #1) and import the sandbox neural engine
  (`sparda_unified`) prod doesn't have. They only become relevant once the 4
  core engine blocs (A/B/C/D) are in prod. ThreadPoolExecutor offload was
  already in prod. **Step 3** (Mycélium P2P gossip — JCS + Ed25519, needs its
  own ADR: it changes the 127.0.0.1-only posture) not started.
- **Windows rename hardening on `atomicWriteFileSync` (parked, owner's call
  2026-06-14)** — `fs.renameSync` in `src/server/persistence.js` can transiently
  throw `EPERM` on Windows when Defender/the search indexer briefly locks the
  target (seen as a ~1-in-N flake in the `.gitignore` byte-for-byte test; passes
  on retry). A bounded retry on `EPERM`/`EACCES`/`EBUSY` fixes it. **Do this
  small fix only AFTER the 4 core engine blocs are implemented and the full
  suite is solidly green.**

## 🎯 Adoption roadmap (owner-validated 2026-07-02, paid tier stays parked)

1. ~~npm 0.5.4 + registry~~ **DONE** — then superseded: **0.6.0 published on
   npm AND the MCP registry (2026-07-03, Gemini)**.
2. ~~`sparda report`~~ **DONE 2026-07-02** (shipped in 0.6.0).
3. ~~**Next.js App Router parser**~~ **DONE 2026-07-03**, shipped in 0.6.0 —
   dogfooded on the 4 real Residual Next repos (120 routes, builds green,
   zero code touched; artifacts left UNCOMMITTED on purpose — do not commit
   sparda.json + app/mcp/ into the SaaS repos or Vercel deploys them).
4. ~~**Negentropy `doctor --app`**~~ **DONE 2026-07-03 (b)** (see header) —
   unreleased on npm; next publish carries it.
5. ~~**`sparda seed export/import`**~~ **DONE 2026-07-03 (c)** — the adoption
   roadmap is COMPLETE. Owner publishes 0.7.0 (negentropy + seed), then the
   focus shifts to distribution (posts, dogfood case study) and R2.4/Round 3.

## 🎯 Next steps (in order)

> **Eval response (Lots A–D) is fully closed** and the HQ→public sync is done
> (PR #10): release `v0.5.3`, `Lint & format` required, coverage job live on
> public `main`, Codecov **self-activated**. Nothing operational is pending.

1. **E2E — largely DONE 2026-06-26 (was the biggest blind spot).** New
   `tests/e2e/phase4.mjs` (fixture-based real MCP client) ran **7/7 ALL PASS**:
   protocol (write tools hidden, `/v2/meta` skipped), annotations, live read,
   **flywheel armed** (purity: prospects=pure, health=unknown), **crystallization**
   (composite `circuit_get_api_prospects_then_get_api_users_by_id` at ×3 + ran live),
   stdout discipline. `remove` byte-for-byte clean-diff re-proven (`git diff` empty).
   Step-by-step + one-command guide: `docs/E2E-RUNBOOK.md`.
   - **Still optional (manual, low risk):** §5 write opt-in via a real client's
     _native elicitation_ accept/decline — covered today by 10/10 router self-test
     (confirm-token two-phase) + the archived phase3 debrief, not re-driven through
     Claude Desktop. The old `tests/e2e/phase1-3` remain pinned to the deleted
     `sparda-demo-app` (quarantine/antibody regression) — revive only if suspected.
2. **ADOPTION before monetization (owner call 2026-06-26).** No free users yet ⇒
   the paid tier waits. Session: `sessions/2026-06-26-adoption-mcp-registry-prep.md`.
   - **Official MCP registry — metadata PREPPED 2026-06-26.** `package.json` carries
     `mcpName: io.github.zyx77550/sparda-mcp`; `server.json` (schema `2025-12-11`) is
     schema-valid at repo root, points at the **public** repo + npm `sparda-mcp`,
     command `dev`. **Publish gated on the owner** (npm + GitHub auth) AND on npm
     carrying a version with `mcpName` — 4-step runbook in the session note. Honest
     caveat: `npx sparda-mcp dev` cold does nothing (needs `sparda init` + a running
     host) — the listing converts only once `demo` (below) exists, so **hold publish
     until then**.
   - **`npx sparda-mcp demo` — DONE 2026-06-28.** Session:
     `sessions/2026-06-28-demo-standalone-mode.md`. Ships a top-level `demo-app/`
     (in the npm `files` array) and `src/commands/demo.js`; runs the **real**
     pipeline (detect → parse → sanitize → generate → inject → remove) on it in a
     throwaway temp dir, narrating all six guarantees, then proves `remove` is
     byte-for-byte clean. **Deliberately STATIC** (no host, no bridge, no port, no
     express install) — `detect`/`parse`/`generate` are pure AST+file ops, so it
     **cannot fail** on the user's machine and never touches their project. Test
     `tests/demo.test.js` (2/2) pins the contract. **Design note (honest):** this is
     a _terminal_ try-it, NOT a registry auto-launch MCP server — running a live
     server needs express, which is a devDependency (absent under `npx`) → rejected
     (hard rule #8). So the registry's `server.json` command stays `dev` (the real
     MCP server, for users who ran `init`); `demo` is what the README/registry
     _description_ points at for an instant "see it work". **Registry publish is now
     unblocked** (the listing is no longer a dead end — the description can say
     "run `npx sparda-mcp demo`"), still owner-gated on npm+GitHub auth.
   - **Next.js route-handler parsing** — highest-leverage framework add for reach
     (dominant JS framework, owner dogfoods it). A new parser path.
   - _(Parked until there are free users: **v0.5 Shadow** paid tier — HQ-private per
     ADR-016 — and the **§6 security chantiers**: harden `remove` vs Prettier reformat;
     FNV-1a → salted SHA-256 PII; validate the Gossip CRDT P2P protocol.)_
3. **Dependabot** (public): 7 open PRs incl. 2 **major** runtime-dep bumps
   (`@babel/parser`, `@babel/traverse` 7→8) — review individually per hard rule
   #8 (each runtime bump is its own decision); the dev-dep group can go together.

_(Repo split / ADR-016 — **done**, shipped as v0.5.3: public `sparda` is live
with a squashed history and branch protection; this repo stays HQ.)_

## ❓ Open questions (owner decisions)

- Shadow tier pricing/naming final call; when to start the SaaS phase 2.
  _(still pending per owner, 2026-06-12)_
- `localKey` storage hardening (needs ADR — touches carry-over).
  _(still pending per owner, 2026-06-12)_
- ~~Desktop cleanup~~ **resolved 2026-06-12**: owner killed the leftover
  PID on :3344 and deleted `Desktop/app-demo`.
