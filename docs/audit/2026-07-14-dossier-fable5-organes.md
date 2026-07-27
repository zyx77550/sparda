# Dossier Fable 5 — Analyse des organes et dépassement des limites

**Date :** 2026-07-14 · **Auditeur :** Claude (Fable 5), audit externe complémentaire
**Objet :** ré-examiner les limites identifiées par l'analyse précédente (Claude 4.8 —
stress-test grand corpus `2026-07-13`, items Round 7 différés, gaps « honnêtes » de
HANDOFF part 24–25) et déterminer, organe par organe : lesquelles sont **fondamentales**
(inhérentes à l'approche) et lesquelles sont **contingentes** (choix d'implémentation),
puis proposer des dépassements concrets, arbitrés, formalisés en ADR.

**Méthode :** lecture du code réel (`src/`), des ADR-001…046, d'ERRORS.md, des cinq
rapports d'audit précédents, et de la ROADMAP (Rounds 1–7). Aucune supposition n'est
faite qu'une limite est absolue sans l'avoir tracée jusqu'au code qui la porte.

---

## 1. Vue globale du système

SPARDA est organisé en une chaîne de confiance dont chaque étage consomme la sortie
déterministe du précédent :

```
                    ┌─────────────────────────────────────────────────┐
                    │              O-8 Chaîne produit                 │
                    │   (valve open-core, CI, publish gate, tests)    │
                    └─────────────────────────────────────────────────┘
  code source ──► O-1 Ingestion ──► O-3 Noyau IR (UBG) ──► O-4 Prouveur ──► verdict
  (+ schéma)      (routes/guards)   │  (passes, schéma,     (apocalypse,     (PROVEN /
                  O-2 Effets ───────┘   déterminisme)        polarity,        NOT PROVEN /
                  (extract, deepScan)                        review)          SURFACE ONLY /
                                          │                                   NO PROOF)
                                          ▼
                            O-5 Exécution dérivée                O-6 Immunité collective
                            (mirror, timeless, heal,             (fingerprint, immunize,
                             speculate)                           genome signé)

                            O-7 Couche runtime MCP
                            (templates injectés, bridge stdio,
                             engine, flywheel, quarantaine)
```

**Constat global de l'audit :** la colonne vertébrale (O-3, O-4 en surface, O-8) est
saine — déterminisme byte-identique prouvé, zéro crash sur ~3 700 routes réelles,
verdicts honnêtes (NO PROOF / SURFACE ONLY plutôt que faux verts). Les limites
identifiées se concentrent sur **trois frontières** : la *portée* de l'ingestion (O-1),
la *profondeur* de la résolution d'effets (O-2), et la *force* des obligations (O-4).
Sur les huit organes, **une seule limite est réellement fondamentale au sens strict**
(la vérité d'exécution du génome, O-6) ; une seconde est fondamentale *pour l'analyse
purement statique* mais contournable par un changement de posture (routage 100 %
runtime, O-1). Tout le reste est contingent.

Un fait important que l'analyse précédente n'a pas exploité : **le dépassement de la
limite « montage dynamique » existe déjà à moitié dans le repo.** `src/probe/`
(shim Express CJS/ESM + sonde FastAPI + `reconcile.js`) capture les routes *observées
à l'enregistrement* sans `listen()`, avec un contrat de fusion propre (statique = le
plancher, dynamique = `gaps[]`). Cet organe est branché sur le chemin MCP `init`, pas
sur l'ingestion UBG. Le relier est un assemblage, pas une construction (voir §O-1 et
ADR-P3).

---

## 2. Organe O-1 — Ingestion (détection + extraction de routes)

### 2.1 Description

- **Rôle :** transformer un repo arbitraire en surface d'entrée (entrypoints, guards,
  chaînes) de l'UBG. C'est la portée du produit : ce que O-1 ne voit pas n'existe pour
  aucun organe aval.
- **Fonctionnement :** `detect.js` (framework/entrée/port, avec fallback tree-scan
  ADR-045) → extracteurs par convention : `ubg/express.js` (suivi de mounts statiques +
  inline-require ADR-034/C-001a), `ubg/nestjs.js` (table de décorateurs + résolution DI
  statique par types de constructeur, ADR-039/043), `ubg/nextjs.js` (app-router,
  `verbHandlers` 0.24.0), `ubg/medusa.js` (routage par système de fichiers, ADR-040),
  `ubg/fastapi.js` (+ `fastapi_extract.py`), `ubg/openapi.js` (toute-langue via spec).

### 2.2 Limites identifiées

| Limite | Source | Nature |
|---|---|---|
| Montage dynamique/registre Express (directus 0 routes, parse-server) | stress-test §gaps | **contingente** (voir analyse) |
| GraphQL invisible (twenty : PROVEN sur la surface REST mince) | stress-test §gaps | **contingente** |
| Frameworks non supportés (Flask, Remix, Hono, Koa, Fastify) | stress-test §gaps | **contingente** (coût linéaire aujourd'hui) |
| DI par string-token (`@Inject('TOKEN')`) | HANDOFF part 21 | **mixte** |
| Pas d'override `--entry`/`--framework` pour monorepos ambigus | HANDOFF part 23 | **contingente triviale** |

**Analyse fondamentale vs contingente.** Le théorème de Rice garantit qu'aucune
analyse statique ne peut énumérer les routes d'un programme qui les construit par
calcul arbitraire à l'exécution (plugins chargés depuis la DB, chemins concaténés
depuis la config). *Dans le cas général*, la limite est donc fondamentale — **pour une
analyse qui s'interdit toute exécution.** Mais les cas réels rencontrés (directus,
parse-server) ne sont pas le cas général : ce sont des boucles sur des tables de
contrôleurs **constantes à l'analyse** (`for (const c of controllers) app.use(c.path,
c.router)`), c'est-à-dire exactement le fragment qu'une évaluation partielle bornée
résout. La limite observée est contingente ; seule sa queue de distribution (routage
piloté par données externes) est fondamentale — et pour cette queue, le repo possède
déjà la réponse : la sonde.

### 2.3 Dépassement des limites

**(a) Évaluateur partiel borné du code de montage** *(Round 7 #2, précisé ici).*
Ne pas construire un interpréteur JS — construire une **interprétation abstraite sur
un domaine minuscule** : les seules valeurs suivies sont {littéraux string, tableaux/
objets de littéraux, imports résolus, concaténations de ces valeurs}. Toute autre
valeur = ⊤ (inconnu) → la route est déclarée `unresolved` et **comptée** (le rapport
dit « N mounts non résolus », jamais silencieux). Dérouler : boucles `for…of` sur des
tableaux constants, `Object.entries()` de registres constants, `Array.prototype.map`
sur littéraux. Borne dure : profondeur d'inlining ≤ 3, ≤ 512 itérations dépliées par
mount. C'est ~300 lignes sur l'AST Babel déjà en place, pas un moteur symbolique.

**(b) Relier la sonde runtime existante à l'ingestion UBG (opt-in, provenance).**
`src/probe/` sait déjà : shimmer `express()` sans `listen()`, capturer les
enregistrements, tuer au timeout, et `reconcile.js` impose déjà le bon contrat
(statique = plancher, dynamique = `gaps`). Le brancher derrière un flag explicite
(`sparda ubg --probe`) avec une règle de vérité stricte : une route de provenance
`observed` **peut produire des findings** (elle élargit la surface d'accusation) mais
**ne peut jamais contribuer à PROVEN** (on ne prouve pas sur une observation partielle
d'un run). Le verdict gagne un champ `surface: static|static+observed`. Cela résout
directus/parse-server sans compromettre l'honnêteté — le déterminisme du verdict
statique reste intact, la partie observée est étiquetée comme telle.

**(c) GraphQL n'est pas un gap, c'est la surface la mieux alignée.** Un schéma SDL
déclare `type Mutation` — l'intention d'écriture est **dans le langage**, là où REST
la fait deviner par le verbe HTTP. Extraction statique : champs de `Query`/`Mutation`
→ entrypoints ; résolveurs (map de résolveurs classique, ou décorateurs
`@Resolver/@Mutation` NestJS — le suivi DI **existe déjà** pour ce dernier cas) →
mêmes chaînes d'effets que O-2. Le coût marginal est faible précisément parce que
twenty est du Nest : `nestjs.js` sait déjà suivre `@Resolver` comme il suit
`@Controller` ; il ne lui manque que la table de routes (champ GraphQL au lieu de
chemin HTTP).

**(d) DSL d'adaptateurs pour la breadth** *(Round 7 #5, confirmé).* Hono, Koa,
Fastify partagent la forme `app.<verbe>(chemin, …handlers)` — c'est une *variante de
paramétrage* d'`express.js`, pas un nouvel extracteur. Extraire d'`express.js` le
noyau (suivi de mounts, résolution de handlers) et le paramétrer par un descripteur
déclaratif : `{ factoryModule, verbMethods, mountMethod, guardHeuristics }`. Flask
est la même opération côté Python (`@app.route` vs `@router.get`).

### 2.4 Arbitrage

| Dépassement | Faisabilité | Coût | Risque | Condition |
|---|---|---|---|---|
| (a) évaluateur partiel | haute (AST déjà là) | 1–2 sessions | FP si domaine mal borné → borner et compter les `unresolved` | fixtures directus-like d'abord |
| (b) sonde → UBG | **très haute** (code existant) | ~1 session | exécution de code utilisateur → opt-in explicite + jamais PROVEN | règle de provenance dans le verdict |
| (c) GraphQL | haute | 1–2 sessions | none structurel — surface additive | commencer par le chemin Nest `@Resolver` |
| (d) DSL adaptateurs | haute | refactor 1 session + ~0,5/framework ensuite | régression Express → la suite de 529 tests est le filet | après (a), qui touche le même fichier |

→ **ADR-P3** (a+b), le point (c) et (d) relèvent du kilométrage sous **ADR-P2**.

---

## 3. Organe O-2 — Résolution d'effets (le lecteur de comportement)

### 3.1 Description

- **Rôle :** pour chaque handler atteint, résoudre les effets réels (db_read/db_write/
  http_call/fs_write), les tables touchées, les transactions — la matière première des
  cinq obligations.
- **Fonctionnement :** `ubg/extract.js` (1 052 lignes) scanne les corps par motifs
  (Prisma, SQL brut, supabase/knex, Kysely, Mongoose, Drizzle, TypeORM, Sequelize) ;
  la profondeur interprocédurale est **réimplémentée par framework** : `followDI`
  récursif borné côté Nest (ADR-043), `deepScan`/`followMembers` côté Express CommonJS
  (ADR-044), *rien* côté Next.js (formbricks : 119 routes / 7 effets), et un scan
  superficiel côté Python (open-webui : 456 routes / 64 effets).

### 3.2 Limites identifiées

- **Profondeur asymétrique entre frameworks** (Next sans deepScan, Python plat) —
  **contingente**, et c'est une dette de *duplication* : trois moteurs de suivi
  différents pour un seul problème (résoudre `x.m()` à travers les modules).
- **Reconnaissance d'ORM par motifs de noms** (`findAll`, `bulkCreate`…) — contingente,
  et fragile par construction : E-029 (le premier essai de sémantique de gardes a
  montré exactement comment les heuristiques nominales se retournent).
- **Repository pattern non matché directement** (choix anti-double-comptage) — correct
  aujourd'hui, mais symptôme du même problème : sans notion de *provenance des
  récepteurs*, on ne peut pas distinguer « ce `save()` est un repo TypeORM » de « ce
  `save()` est du métier ».
- **Fondamental ?** Non pour l'essentiel. La résolution statique complète des appels
  en langage dynamique est indécidable en général, mais les apps serveur réelles sont
  massivement *import-rootées* : le récepteur d'un effet remonte presque toujours à un
  import identifiable (`@prisma/client`, `drizzle-orm`, `sequelize`…). La limite
  actuelle vient du fait qu'`extract.js` regarde la *forme* de l'appel, pas la
  *racine* du récepteur.

### 3.3 Dépassement des limites

**(a) Un seul moteur interprocédural, paramétré par framework.** Factoriser
`followDI` + `deepScan`/`followMembers` en un module `ubg/resolve.js` : entrée =
(fichier, symbole, règles de résolution de modules du framework — tsconfig paths,
barrels CJS, `Depends()` FastAPI) ; sortie = l'ensemble borné (profondeur 6, garde de
cycle — les invariants déjà éprouvés) des corps atteignables. Nest, Express, Next et
Medusa deviennent des *configurations* de ce moteur. Next gagne la profondeur
gratuitement ; le bug-perf de twenty (memoization 0.24.1) profite à tous au lieu d'un
seul chemin.

**(b) Résolution par racine d'import plutôt que par motif de nom.** Un appel est un
effet DB si et seulement si son récepteur se **résout** (via le moteur (a)) à un
export d'un module ORM connu — la liste des ORM devient une table de *modules* (
`drizzle-orm`, `typeorm`, `sequelize`, `mongoose`…) + un petit mapping verbe→(read|
write), au lieu d'une forêt de motifs syntaxiques. Bénéfices : le repository pattern
se résout naturellement (le repo est typé/importé → suivi, pas de double comptage),
les faux positifs nominaux (E-029-style) chutent, et ajouter un ORM = 5 lignes de
table. Les motifs actuels restent en *fallback* étiqueté `asserted` (même distinction
verified/asserted que les guards ADR-046 — cohérence systémique).

**(c) Python : porter le contrat, pas le code.** `fastapi_extract.py` reçoit le même
contrat que (a) via `ast` stdlib (zéro dépendance, règle #8 sauve) : suivre les
imports intra-projet et les `Depends(...)` à profondeur bornée, mêmes bornes, même
étiquetage. Le PROVEN « partiellement creux » d'open-webui devient soit un vrai
NOT PROVEN documenté, soit un PROVEN qui a vu les 400+ effets réels.

### 3.4 Arbitrage

Refactor le plus rentable du système : il convertit quatre gaps listés (Next depth,
Python depth, ORM breadth, repository pattern) en un seul chantier, et il est le
**prérequis structurel** du dataflow (O-4) — le taint a besoin d'un call-graph
unifié pour propager. Risque principal : régression sur les chemins Nest/Express
durement gagnés (immich, express-boilerplate) → le refactor doit être *à résultats
byte-identiques* sur le corpus fixture avant d'ajouter quoi que ce soit (la
détermination du système rend cette vérification triviale : diff des graphes
canoniques avant/après). → **ADR-P2.**

---

## 4. Organe O-3 — Le noyau IR (UBG : schéma, passes, déterminisme)

### 4.1 Description

- **Rôle :** l'IR unique dont tout dérive. Nœuds {entrypoint, guard, effect, state},
  arêtes {control_flow, mutation, gate, compensation}, huit passes ordonnées
  (`pipeline.js`) validées à chaque frontière, sérialisation canonique
  locale-indépendante (E-020/E-024, comparateur `cmp` unique).
- **État :** c'est l'organe le plus sain du système. Byte-identité inter-machines
  prouvée sur du code réel, validation par passe avec nom du coupable, 45 lignes de
  runner. Rien à réparer.

### 4.2 Limites identifiées

Aucune limite n'a été *déclarée* sur cet organe — mais il porte une **limite
implicite structurante** que l'analyse précédente n'a pas nommée : **l'IR ne
représente pas le flux de valeurs.** Les arêtes disent « ce chemin de contrôle mène à
cet effet », jamais « cette valeur d'entrée atteint cette colonne ». Conséquences en
cascade : O2 est un booléen (`inputValidated`), O1 teste l'*existence* d'un guard sur
le chemin (pas sa *dominance*), et le `behaviorHash` (O-6) fingerprinte une forme qui
ignore si la validation est réelle. Le Round 7 #1 (« dataflow inter-procédural »)
est listé comme un pass à écrire ; l'analyse ici est qu'il est d'abord **une décision
d'IR**.

**Nature :** contingente — c'est une extension de schéma, pas une refonte. Mais c'est
la décision la plus lourde de conséquences du dossier, car elle traverse
fingerprint/polarity/speculate/genome.

### 4.3 Dépassement

Étendre le schéma d'une arête `dataflow` (`{ from, to, meta: { param, sanitizedBy:
[guardIds] } }`) émise par le moteur unifié de O-2, plutôt qu'un calcul éphémère
interne au prouveur. Justification systémique : (1) le prouveur reste fidèle à son
contrat fondateur (« ce fichier ne parse jamais de source » — apocalypse.js:2) ;
(2) `fingerprint` peut choisir d'inclure les arêtes dataflow dans le hash → deux
routes de même forme mais dont l'une valide et l'autre pas cessent d'être
« immunitairement identiques » — correction silencieuse d'une imprécision du génome ;
(3) `speculate` reste exact (le hash capture plus, donc l'équivalence hash⇒verdict
se renforce). Versionner le hash (`bh2_`) pour ne pas corrompre les capsules
existantes. → **ADR-P1** (avec O-4).

---

## 5. Organe O-4 — Le prouveur (apocalypse, polarity, review)

### 5.1 Description

- **Rôle :** décharger cinq obligations (O1 guard, O2 validation, O3 atomicité,
  O4 réversibilité, O5 racine d'agrégat) sur la reachability structurelle du graphe ;
  produire findings-contre-exemples, vecteur ternaire de polarité (ADR-036), verdict
  quadri-état honnête (PROVEN / NOT PROVEN / SURFACE ONLY / NO PROOF, ADR-034/042) ;
  mode diff pour `review` (D1–D4).
- **Contrat d'honnêteté déjà en place et remarquablement bien tenu :** « proven =
  aucune obligation déclarée violée sous reachability structurelle » — le prouveur
  prouve l'absence de *classes* de bugs, pas de bugs.

### 5.2 Limites identifiées

| Limite | Où dans le code | Nature |
|---|---|---|
| O1 : *existence* d'un guard sur le chemin, pas dominance (un guard après l'effet, ou sur une branche sœur, satisfait O1) | `checkGraph`, `guards.length` | **contingente** |
| O2 : `ep.meta.inputValidated` est un booléen par entrypoint — pas « quelle valeur atteint quelle table » | `checkGraph` O2 | **contingente** (bloquée par l'IR, §4) |
| Sémantique des gardes : premier cran nominal (ADR-046 : downgrade des pass-through visibles ; provenance verified/asserted) | ADR-046, E-029 | **contingente**, chemin déjà tracé (Round 7 #3 : dominance du chemin de refus) |
| Le prouveur ne prouvera jamais l'absence de bugs arbitraires | contrat | **fondamentale** — et correctement assumée ; le dépassement consiste à élargir les classes, jamais à surpromettre |

### 5.3 Dépassement

**(a) Dominance, pas existence (Round 7 #3, cran 2).** Sur le CFG par route (déjà
présent : chaînes `control_flow` ordonnées), exiger que le nœud guard **domine** le
nœud effet (tout chemin entrypoint→effet passe par le guard). Le calcul est trivial
sur des chaînes quasi linéaires (l'immense majorité) et bien défini quand le montage
en branches arrive. Combiné à ADR-046 (le guard doit *pouvoir* refuser), l'obligation
O1 devient : « un chemin de refus vérifié domine l'accès à l'effet » — la définition
correcte, atteignable en une session.

**(b) O2 en taint réel** — consommateur direct des arêtes `dataflow` de §4.3 :
source = paramètres d'entrypoint (`req.body`/`req.query`/body Pydantic absent),
sink = arête `mutation` vers une table contrainte, sanitizer = nœud de validation
dominant. Le finding passe de « cet endpoint n'est pas marqué validé » à « `req.body.
email` atteint `users.email` (NOT NULL, UNIQUE) sans validation dominante — chemin :
… » : contre-exemple complet, classe CodeQL, zéro configuration.

**(c) Ce qu'il ne faut PAS faire :** ajouter des obligations nominales de plus en
attendant le dataflow. E-029 est la leçon : chaque heuristique nominale ajoutée au
prouveur affaiblit la marque « preuve ». La discipline actuelle (peu d'obligations,
toutes structurelles) est la bonne ; qu'elle tienne jusqu'à ADR-P1.

### 5.4 Arbitrage

(a) est indépendant de l'IR et livrable immédiatement — c'est le meilleur ratio du
dossier. (b) dépend d'ADR-P1+P2 ; multi-session, mais c'est l'écart entre « linter
sémantique honnête » et « prouveur » aux yeux d'un lecteur exigeant. → **ADR-P1.**

---

## 6. Organe O-5 — Exécution dérivée (mirror, timeless/heal, speculate)

### 6.1 Description

- **Rôle :** exécuter le graphe. `mirror` sert un mock stateful qui *vit* les machines
  à états inférées (ADR-031 : transition illégale → 409) ; `timeless` rejoue
  déterministe ; `heal` gate les réparations ; `speculate` règle les formes déjà
  prouvées par lookup de capsule (ADR-038, hit exact ⇒ même verdict que le prouveur).

### 6.2 Limites identifiées

- **La validation différentielle n'existe pas** (Round 7 #4, différé) : rien ne
  mesure aujourd'hui *empiriquement* si le graphe ment. C'est la seule boucle de
  rétroaction qui manque au système — tous les autres organes se vérifient entre eux
  par construction, aucun ne se vérifie contre la réalité d'exécution.
  **Contingente**, et c'est un assemblage : `flight/box.js` enregistre déjà le trafic,
  `mirror` exécute déjà le graphe — il manque le comparateur.
- Lien read↔machine du mirror structurel uniquement — contingente, mineure, assumée
  (ADR-031 : « jamais deviné » est le bon choix).

### 6.3 Dépassement

**Le mirror comme oracle de test du compilateur, en deux crans :**

1. **Différentiel sur trafic enregistré** — rejouer une capture FlightBox contre
   l'app réelle ET le mirror ; toute divergence (statut, forme de la réponse,
   transition d'état) = « un endroit où le graphe ment », classé automatiquement vers
   l'organe fautif (route absente → O-1 ; effet absent → O-2 ; machine fausse →
   passe state-machines). Méthode SQLite appliquée au compilateur de comportement.
2. **Génératif sans trafic** — le graphe contient les schémas d'entrée : générer les
   requêtes depuis les types (valides + mutations aux bornes), même comparaison. Pas
   de dépendance à un enregistrement préalable, donc exécutable sur tout le corpus
   fixture en CI nocturne (alimente O-8 directement).

### 6.4 Arbitrage

Coût modéré (le comparateur + la classification des divergences), aucun risque
produit (outil interne d'abord), gain de crédibilité maximal : « notre compilateur
est fuzzé sémantiquement chaque nuit contre l'exécution réelle » est une phrase
qu'aucun concurrent de la catégorie ne peut écrire. Condition : cran 1 sur demo-app +
2 fixtures avant toute généralisation. → **ADR-P4.**

---

## 7. Organe O-6 — Immunité collective (fingerprint, capsule, génome signé)

### 7.1 Description

- **Rôle :** rendre les verdicts portables et composables. `behaviorHash` sans
  coordonnées (ADR-035) ; capsule 1 octet / 5 trits (ADR-037) ; anticorps signés
  Ed25519 auto-vérifiables, JSONL committé, git = réplication (ADR-041) ;
  `mergeGenome` corrobore et **fait remonter les conflits** au lieu de les cacher.

### 7.2 Limites identifiées

- **« Un anticorps prouve *qui a signé* un verdict re-dérivable, pas qu'un prover non
  modifié a tourné »** (ADR-041, limite auto-déclarée). Analyse : **réellement
  fondamentale** dans le modèle zéro-infra. Prouver l'exécution fidèle d'un
  logiciel sur une machine adverse exige une attestation matérielle (TEE) ou une
  preuve cryptographique d'exécution (zk-VM) — les deux violeraient ADR-001
  (zéro infra, 4 dépendances) pour un gain marginal, car le système possède une
  propriété que presque aucun système de confiance distribué n'a : **le verdict est
  une fonction déterministe re-dérivable de la source publique.** La bonne réponse
  n'est donc pas de prouver l'exécution, mais d'exploiter la re-dérivabilité.
- **Brick 3 (politique : réputation, seuils, révocation) designée, non shippée** —
  contingente, et c'est elle qui borne réellement la limite fondamentale ci-dessus.

### 7.3 Dépassement

**Politique de confiance « re-derive, don't trust » (Brick 3 concrétisée) :**

1. **Quorum d'indépendance** : un anticorps n'entre en « mémoire active » (consommé
   par `speculate`/`recall` sans avertissement) qu'à partir de *k* issuers de clés
   indépendantes corroborant le même `behaviorHash→pol` (k=2 pour commencer ;
   `mergeGenome` compte déjà la corroboration — il manque le seuil).
2. **Re-dérivation par échantillonnage** : pour tout anticorps dont le repo source
   est public et le SHA connu, un job (le banc O-8) reclone et re-dérive p % des
   claims ; une divergence brûle *la clé émettrice entière*, pas le seul anticorps
   (c'est l'incitation qui rend la fraude non rentable : une clé se construit
   lentement par corroborations et meurt d'un seul mensonge).
3. **Révocation = fichier de révocation signé dans le même JSONL** (kind: revoke,
   ciblant un id ou une clé), fusionné par les mêmes règles. L'historique git du
   génome sert de transparency log append-only — pas de blockchain, conformément à
   l'exclusion déjà actée (ROADMAP Round 7, « on ne fait PAS »).

À inclure dans l'enveloppe dès maintenant (avant qu'il y ait un parc à migrer) :
`proverVersion` + `hashVersion` dans le contenu signé — sinon le passage à `bh2_`
(§4.3) rendra les corroborations inter-versions indistinguables des conflits.

### 7.4 Arbitrage

Faisabilité haute (tout est extension de `genome.js` + un job de re-dérivation qui
réutilise le prover tel quel). Le point dur est décisionnel, pas technique : les
constantes (k, p, politique de brûlage) sont des choix de gouvernance → ADR
obligatoire. → **ADR-P6.**

---

## 8. Organe O-7 — Couche runtime MCP (templates, bridge, engine)

### 8.1 Description

- **Rôle :** l'histoire de confiance au runtime — routeur `/mcp` réversible injecté,
  bridge stdio, write-safety deux phases, quarantaine, flywheel, anticorps runtime.
  Organe mûr (v0.1→v0.8), E2E réel prouvé, benchmark honnête (+2,7 ms p50).

### 8.2 Limites identifiées et analyse

Toutes contingentes, toutes déjà tracées dans HANDOFF/ROADMAP §6 — aucune n'est un
mur : `localKey` en clair (décision pendante, le design env→fichier→fail-closed
d'ADR-022 est déjà le bon squelette), gossip CRDT non validé (ne pas shipper avant
validation — c'est le seul item qui change la posture 127.0.0.1-only, il mérite son
ADR de toute façon), EPERM Windows sur rename (retry borné, parké volontairement),
`sanitize` best-effort (assumé, documenté).

### 8.3 Dépassement / arbitrage

Rien de nouveau à proposer ici qui batte les priorités O-1…O-6 : cet organe est
*au-dessus* de son niveau de risque actuel. Seul rappel d'arbitrage : si le Round 7
consomme toutes les sessions, la validation gossip doit rester **bloquante pour tout
déploiement multi-instances**, pas pour le reste. Pas d'ADR nouveau.

---

## 9. Organe O-8 — Chaîne de confiance produit (valve, tests, CI)

### 9.1 Description

- **Rôle :** garantir que ce qui est publié est ce qui est prouvé : valve
  open-core anti-under-send AST (ADR-029), 529 tests + self-test, déterminisme
  verrouillé par test, gates lint/format/coverage.

### 9.2 Limites identifiées

- **Pas de banc de torture permanent** (Round 7 #6) : les stress-tests sont des
  événements manuels (parts 20, 24) — la régression de couverture entre deux
  commits est invisible (le bug Next.js à -90 % de routes a vécu jusqu'à ce qu'un
  humain relance un stress-test). **Contingente.**
- Limite implicite : **pas de vérité terrain** — sans labels FP/FN par repo, un banc
  ne mesure que la stabilité, pas la justesse.

### 9.3 Dépassement

Banc nocturne à coût quasi nul, en exploitant le déterminisme :
- corpus de repos réels **épinglés par SHA** (clones sparse/shallow, cache) ;
- pour chacun, un **fichier de verdict d'or committé** (`corpus/<repo>@<sha>.json` :
  routes, effets, findings, verdict) — établi une fois, revu à la main ;
- le job nocturne re-dérive et **diffe** : tout écart = soit régression (rouge), soit
  amélioration à re-consacrer explicitement (le commit qui met à jour le golden file
  EST la revue). Le déterminisme byte-identique rend le diff lisible — c'est
  l'avantage structurel que les outils à sortie fluctuante n'ont pas.
- Commencer à 15 repos (ceux du stress-test part 24, déjà qualifiés à la main —
  la vérité terrain existe déjà dans le rapport), croître vers 500 ensuite.
- Le fuzzing des parsers (entrées malformées) s'ajoute au même job.

### 9.4 Arbitrage

Le seul coût réel est le CI-minutes ; GitHub Actions nightly sur repo privé suffit.
Condition de mise en œuvre : commencer par les 15 déjà étalonnés — le passage à 500
sans golden files serait du théâtre de métrique. → **ADR-P5.**

---

## 10. Synthèse — matrice et recommandations prioritaires

### 10.1 Matrice fondamentale / contingente

| Limite (analyse précédente) | Verdict de ce dossier | Dépassement |
|---|---|---|
| Montage dynamique Express (directus, parse-server) | contingente (queue fondamentale pour le *pur* statique) | ADR-P3 : évaluateur partiel + sonde existante reliée, provenance |
| GraphQL invisible | contingente — surface la mieux alignée sur les obligations | via ADR-P2 (chemin Nest `@Resolver` d'abord) |
| Profondeur Python / Next.js | contingente (dette de duplication) | ADR-P2 : moteur interprocédural unique |
| ORM par motifs de noms / repository pattern | contingente | ADR-P2 : résolution par racine d'import, fallback `asserted` |
| O2 superficielle, O1 = existence pas dominance | contingente | ADR-P1 : arêtes dataflow dans l'IR + dominance |
| « Le prouveur ne prouve pas l'absence de bugs » | **fondamentale** — correctement assumée | élargir les classes, jamais la promesse |
| Anticorps ≠ preuve d'exécution fidèle du prover | **fondamentale** (zéro-infra) | ADR-P6 : borner par quorum + re-dérivation + brûlage de clé |
| Pas de rétroaction empirique (graphe vs réalité) | contingente | ADR-P4 : validation différentielle |
| Pas de mesure continue FP/FN | contingente | ADR-P5 : banc nocturne + verdicts d'or |
| Frameworks non supportés (Flask/Remix/Hono/Koa/Fastify) | contingente | ADR-P2 (DSL d'adaptateurs) |

### 10.2 Ordre recommandé (dépendances explicites)

1. **Dominance des gardes** (§5.3a) — sans dépendance, une session, transforme O1.
   *(cran 2 de l'ADR-046 existant, pas de nouvel ADR requis)*
2. **ADR-P2 — moteur interprocédural unifié + résolution par racine d'import.**
   Prérequis technique d'ADR-P1 ; résout 4 gaps d'un coup ; refactor à
   byte-identité vérifiable.
3. **ADR-P1 — arêtes dataflow dans l'IR + O2 en taint** *(le « génie » du Round 7 #1,
   ancré dans l'IR et non dans un pass éphémère)*. Versionner le hash (`bh2_`).
4. **ADR-P3 — ingestion des montages dynamiques** (évaluateur partiel + sonde
   reliée). Indépendant de P1/P2, peut se paralléliser.
5. **ADR-P5 — banc de torture** dès que P2 commence (il protège le refactor).
6. **ADR-P4 — validation différentielle**, puis **ADR-P6 — politique du génome**
   (mais inclure `proverVersion`/`hashVersion` dans l'enveloppe **immédiatement**,
   avant tout parc installé).

### 10.3 Ce que ce dossier déconseille

- Toute nouvelle obligation nominale au prouveur avant ADR-P1 (leçon E-029).
- Le passage à 500 repos de banc sans verdicts d'or (métrique sans vérité terrain).
- Réécriture Rust, daemon résident, blockchain — exclusions déjà actées, confirmées
  par cette analyse (le goulot mesuré est le parse, la règle #1 est identitaire, git
  signé est un transparency log suffisant).

---

## 11. ADR proposés

> Statut : **proposés** par l'audit externe. À promouvoir individuellement dans
> `docs/DECISIONS.md` (numérotation ADR-047+) après décision de l'owner. Chaque ADR
> est évalué contre le cadre : **C**ohérence systémique, **P**érennité,
> **R**obustesse, **D**éployabilité, **A**uditabilité.

### ADR-P1 — Le flux de valeurs entre dans l'IR (dataflow + dominance)

- **Contexte.** Les cinq obligations sont déchargées sur la reachability structurelle.
  O2 est un booléen par entrypoint ; O1 teste l'existence d'un guard, pas sa
  dominance ; le `behaviorHash` ignore la réalité de la validation.
- **Problème.** Round 7 #1 exige de prouver « `req.body` atteint un `db_write` sans
  validation ». Où vit ce calcul : pass éphémère dans le prouveur, ou extension de
  l'IR ?
- **Options.** (1) Taint éphémère dans apocalypse.js — viole le contrat fondateur du
  prouveur (« ne parse jamais de source », ne lit que le graphe) et n'irrigue ni
  fingerprint ni speculate. (2) Arête `dataflow` dans le schéma UBG, émise par le
  moteur de résolution (ADR-P2), consommée par le prouveur ; O1 passe en dominance
  sur le CFG existant. (3) IR séparé dédié au taint — deux sources de vérité, exclu.
- **Décision proposée.** Option 2. Nouveau kind d'arête `dataflow`
  (`meta: { param, sanitizedBy }`), hash versionné `bh2_`, `hashVersion` dans capsule
  et génome.
- **Conséquences.** O2 produit des contre-exemples complets (classe CodeQL, zéro
  config) ; deux formes identiques dont une seule valide cessent de partager un hash ;
  migration de hash à orchestrer (cf. ADR-P6) ; coût multi-session assumé.
- **Cadre.** **C** : une seule vérité, tout l'aval en profite. **P** : l'IR est le bon
  endroit pour une capacité décennale. **R** : validateGraph borne chaque pass ;
  byte-identité testable. **D** : aucun changement d'usage CLI. **A** : chaque finding
  porte son chemin de valeur — auditabilité maximale.

### ADR-P2 — Un moteur interprocédural unique, résolution par racine d'import

- **Contexte.** Trois implémentations du suivi inter-modules (Nest `followDI`,
  Express `deepScan`, rien pour Next/Python) ; effets reconnus par motifs de noms.
- **Problème.** Chaque framework paie la profondeur séparément ; chaque ORM ajoute
  des motifs fragiles (E-029) ; le repository pattern est contourné, pas résolu.
- **Options.** (1) Continuer par framework — coût linéaire, divergence garantie.
  (2) `ubg/resolve.js` unique (profondeur 6, cycle-guard, memoization), frameworks =
  configurations ; effets = appels dont le récepteur remonte à un module ORM connu ;
  motifs actuels en fallback `asserted`. (3) Adopter un framework d'analyse externe —
  viole la règle #8 (4 dépendances).
- **Décision proposée.** Option 2, en deux temps : extraction à résultats
  byte-identiques sur tout le corpus fixture (le diff des graphes canoniques est le
  test), puis branchement Next/Python/GraphQL et table de modules ORM.
- **Conséquences.** Next/Python gagnent la profondeur ; ORM = 5 lignes/entrée ;
  provenance verified/asserted unifiée avec ADR-046 ; prérequis d'ADR-P1 ; risque de
  régression borné par la byte-identité exigée avant extension.
- **Cadre.** **C** : supprime trois divergences futures. **P** : le coût marginal
  d'un framework devient sous-linéaire. **R** : mêmes bornes éprouvées partout.
  **D** : transparent pour l'utilisateur. **A** : chaque effet porte sa racine
  d'import résolue comme evidence.

### ADR-P3 — Montages dynamiques : évaluateur partiel borné + sonde à provenance

- **Contexte.** directus/parse-server compilent à 0 routes (NO PROOF honnête). Le
  repo contient déjà une sonde runtime (`src/probe/`, shim sans `listen`,
  `reconcile.js` statique-plancher) non reliée à l'UBG.
- **Problème.** Le routage construit par programme est invisible au statique pur ;
  le cas général est indécidable mais les cas réels sont des boucles sur tables
  constantes.
- **Options.** (1) Statu quo (NO PROOF) — honnête mais infirme sur toute une classe
  d'apps. (2) Évaluateur partiel borné (domaine : littéraux/registres constants,
  bornes dures, `unresolved` compté). (3) Sonde runtime opt-in reliée à l'ingestion,
  provenance `observed`, jamais contributrice de PROVEN. (4) Exécution symbolique
  générale — hors de proportion.
- **Décision proposée.** 2 **et** 3 : le statique d'abord (déterministe, dans le
  verdict), la sonde en filet opt-in étiqueté. Le verdict expose
  `surface: static|static+observed`.
- **Conséquences.** directus/parse-server deviennent analysables ; la frontière
  preuve/observation est explicite dans chaque artefact ; exécution de code
  utilisateur strictement opt-in (flag), timeout borné, jamais dans `review`/CI par
  défaut.
- **Cadre.** **C** : réutilise un organe existant au lieu d'en créer un. **P** :
  l'évaluateur partiel couvre la forme stable du problème. **R** : bornes dures +
  comptage des non-résolus. **D** : opt-in, zéro changement par défaut. **A** :
  provenance visible dans verdict, dossier et capsule.

### ADR-P4 — Validation différentielle : le mirror comme oracle

- **Contexte.** Aucune boucle empirique ne vérifie le graphe contre l'exécution
  réelle. FlightBox enregistre déjà ; mirror exécute déjà le graphe.
- **Problème.** « Le graphe ment-il ? » n'a pas de détecteur automatique.
- **Options.** (1) Rejeu différentiel de trafic enregistré (app vs mirror, divergence
  classée vers l'organe fautif). (2) Génération depuis les schémas du graphe (pas de
  trafic requis, exécutable en CI). (3) Fuzzing aveugle — signal pauvre, exclu.
- **Décision proposée.** 1 puis 2, outil interne d'abord (`sparda diffcheck` ou
  équivalent), branché au banc ADR-P5.
- **Conséquences.** Chaque divergence est un bug de compilateur trouvé avant un
  utilisateur ; mesure continue de la fidélité du mirror ; coût borné (comparateur +
  classifieur de divergences).
- **Cadre.** **C** : assemble trois briques shippées. **P** : c'est la méthode SQLite
  — elle vieillit bien. **R** : la seule vraie mesure de robustesse sémantique.
  **D** : interne, aucun impact utilisateur. **A** : les rapports de divergence sont
  des artefacts committables.

### ADR-P5 — Banc de torture permanent avec verdicts d'or

- **Contexte.** Les stress-tests sont manuels ; le bug Next -90 % de routes a vécu
  jusqu'au stress-test suivant. Le déterminisme rend les diffs de verdict lisibles.
- **Problème.** Pas de mesure FP/FN continue ; pas de vérité terrain formalisée.
- **Options.** (1) 500 repos sans labels — métrique sans vérité, théâtre. (2) Corpus
  épinglé par SHA + fichier de verdict d'or par repo, diffé chaque nuit ; départ à 15
  (déjà étalonnés dans le rapport part 24), croissance ensuite ; fuzzing des parsers
  dans le même job.
- **Décision proposée.** Option 2. Tout écart au golden = rouge ou re-consécration
  explicite par commit (le commit de mise à jour EST la revue).
- **Conséquences.** Les régressions de couverture deviennent visibles au commit ;
  protège le refactor ADR-P2 ; coût = CI-minutes nocturnes uniquement.
- **Cadre.** **C** : consomme le déterminisme comme feature. **P** : le corpus est un
  actif qui s'apprécie. **R** : c'est l'organe de robustesse lui-même. **D** : un
  workflow nightly. **A** : les golden files sont l'historique auditable de ce que
  SPARDA affirmait, commit par commit.

### ADR-P6 — Politique de confiance du génome : re-dériver, pas croire

- **Contexte.** ADR-041 déclare honnêtement sa limite : la signature prouve
  l'émetteur, pas l'exécution fidèle du prover. Limite fondamentale en zéro-infra —
  mais le verdict est re-dérivable depuis la source publique, propriété rare.
- **Problème.** Brick 3 (politique) est designée, non shippée ; sans elle, la limite
  fondamentale est non bornée.
- **Options.** (1) Attestation TEE / zk-VM — viole ADR-001 et la règle #8. (2)
  Réputation sociale hors-bande — non auditable. (3) Quorum k-of-n de clés
  indépendantes + re-dérivation par échantillonnage (le banc ADR-P5 recompile p % des
  claims publics) + brûlage de la clé entière sur divergence + révocations signées
  dans le même JSONL, git = transparency log.
- **Décision proposée.** Option 3. **Immédiatement** (avant tout parc) : ajouter
  `proverVersion` + `hashVersion` au contenu signé de l'enveloppe.
- **Conséquences.** La fraude devient non rentable (une clé se construit lentement,
  meurt d'un mensonge) ; la limite fondamentale demeure mais bornée et documentée ;
  constantes (k, p) = décisions de gouvernance à acter par l'owner.
- **Cadre.** **C** : réutilise mergeGenome/corroboration/conflits déjà shippés.
  **P** : le versionnage d'enveloppe évite une migration impossible plus tard.
  **R** : dégradation gracieuse déjà en place (les lignes invalides tombent).
  **D** : zéro infra, inchangé. **A** : chaque décision de confiance est re-calculable
  depuis le JSONL + git log.

---

## 12. Conclusion

L'analyse précédente était juste dans ses constats mais laissait deux idées sur la
table : (1) **la plupart des « murs » sont des dettes de duplication** — un seul
moteur de résolution (ADR-P2) fait tomber quatre gaps listés séparément ; (2) **le
repo contient déjà des organes qui répondent aux limites d'autres organes** — la
sonde runtime répond au montage dynamique, FlightBox + mirror répondent à l'absence
de rétroaction empirique, la re-dérivabilité déterministe répond à la limite du
génome. Le système n'a pas besoin de nouvelles inventions pour son Round 7 : il a
besoin de **relier ce qu'il possède**, dans l'ordre de dépendances du §10.2, sans
jamais relâcher le contrat d'honnêteté qui est aujourd'hui son actif le plus
différenciant.

Deux limites sont réellement fondamentales et doivent le rester dans le discours
public : le prouveur prouve des classes déclarées (jamais « pas de bugs »), et le
génome prouve la signature d'un verdict re-dérivable (jamais l'exécution fidèle
d'un prover distant). Les assumer explicitement — comme le produit le fait déjà —
vaut plus que n'importe quelle promesse au-dessus.
