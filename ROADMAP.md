# SPARDA — Vision & Roadmap

> **Créer des choses qui n'existent pas à partir de choses qui existent.**
> Chaque brique existe quelque part dans le monde. L'assemblage n'existe nulle part.

Ce document fige la vision complète du projet (sessions de conception de juin 2026)
pour qu'aucune idée ne dépende d'une conversation. Il est la source de vérité :
toute feature développée doit se rattacher à un point de ce document.

---

## 0. La position structurelle (pourquoi nous et personne d'autre)

SPARDA vit **à l'intérieur du process** de l'application hôte. Tous nos avantages
découlent de cette seule position, et aucun concurrent extérieur ne peut les copier :

| Ressource | D'où elle vient | Coût |
|---|---|---|
| Calcul | cycles libres du process hôte | 0 |
| Intelligence | LLM du client via MCP sampling | 0 |
| Stockage | `sparda.json` + git | 0 |
| Persistance | commits git (hook `sparda sync`) | 0 |

**Zéro infra, zéro budget — par construction, pas par contrainte.**

## 1. La règle de survie (loi-maîtresse, non négociable)

> **L'hôte ne paie jamais pour l'intelligence de SPARDA.
> On ne dépense de l'énergie que sur la surprise.** (principe d'énergie libre, Friston)

Déclinaisons concrètes — toute PR doit les respecter :
- L'observation est un *tap passif* : compteurs, ring buffers bornés, jamais de travail
  lourd sur le chemin d'une requête réelle. Le lourd tourne en idle/async.
- Le LLM n'est **jamais** sur le chemin critique. Tout l'étage déterministe fonctionne
  sans sampling (dégradation gracieuse). Le LLM n'est convoqué que sur anomalie.
- La vérité, c'est toujours l'appel réel. Une prédiction/un cache ne remplace jamais
  une réponse ; pour une écriture, le proof-after-write reste la source de vérité.
- Rien d'auto-actif sans seuil + confirmation. Une capacité émergente est une
  *suggestion* tant qu'elle n'a pas été observée N fois.
- Une feature qui échoue se **désactive toute seule et le dit** — jamais elle ne
  dégrade l'app hôte (auto-quarantaine appliquée à nos propres organes).

---

## 2. Les trois organes (rounds de conception)

### Round 1 — 🧬 Le système immunitaire *(étage béton — EN COURS, v0.3)*

L'app apprend ce qui est « soi », détecte ce qui dévie, se défend, et se souvient.

1. **Le soi (inné, zéro LLM)** — le router apprend la signature normale de chaque
   route : latence typique, distribution des statuts. ✅ *(stats v0.2 + baseline v0.3)*
2. **Détection d'antigène** — déviation locale détectée en quelques lignes de maths :
   rafale de 5xx, latence ×10 vs baseline. ✅ *(v0.3)*
3. **Quarantaine (inflammation)** — un write/tool qui enchaîne 3 erreurs 5xx est mis
   en quarantaine (503 + raison + retryInMs), ré-essayé après cooldown (half-open).
   L'IA ne peut plus marteler une route cassée. ✅ *(v0.3)*
4. **Immunité adaptative** — sur anomalie, le bridge réveille le LLM du client via
   sampling avec le contexte : « diagnostique ». L'intelligence coûteuse n'est
   convoquée que quand le corps a de la fièvre. ✅ *(v0.3)*
5. **Mémoire immunitaire (anticorps)** — le diagnostic est caché dans `sparda.json`
   avec la signature de l'anomalie. Même signature plus tard → diagnostic instantané,
   zéro token. L'app accumule des anticorps au fil de sa vie. ✅ *(v0.3)*
6. **`sparda_get_context`** — l'outil que l'IA appelle en premier : tout le contexte
   vivant du projet (outils, workflows, télémétrie, quarantaine, anticorps) en un
   appel. Chaque session IA reprend là où la précédente s'est arrêtée. ✅ *(v0.3)*

> Pitch : *« Ton API ne se contente pas d'être pilotable par l'IA — elle se défend,
> se diagnostique et se souvient. »* Copier le code ne copie pas les anticorps.

### Round 2 — ⚡ Le condensateur d'outils *(Labs)*

Créer des outils que personne n'a écrits, condensés depuis l'usage réel.

1. **Canaliser le courant** — enregistrer les séquences d'appels par session et
   détecter (par correspondance de valeurs) quand une sortie de l'outil A alimente
   l'entrée de l'outil B. Un *circuit*, pas des appels isolés. Déterministe. ✅ *(v0.4)*
2. **L'observation fige l'état** — un circuit reproduit N fois se cristallise en
   outil composite ; le sampling le nomme et le décrit ; `tools/list_changed`
   annonce sa naissance en pleine session. ✅ *(v0.4 — GET-only, repli déterministe)*
3. **Mémoire de l'eau** — tout est absorbé dans `sparda.json`, versionné par git.
   Cloner le code ne clone pas la mémoire. ✅ *(v0.4 — circuits + composites)*
4. **Rien ne disparaît, x devient y** — au changement de code, diff de manifest et
   re-mapping des outils condensés au lieu de les tuer. Les échecs deviennent des
   anticorps (même organe que le round 1).

### Round 3 — 🔮 L'organisme prédictif *(Labs / horizon)*

L'app quitte le présent (réagir) pour habiter le futur (prédire).

1. **Néguentropie (démon de Maxwell)** — détecter le pourrissement : routes mortes
   (zéro courant), dérive de schéma, config zombie ; proposer la réparation.
   Déterministe, constructible tôt.
2. **Le jumeau (principe holographique)** — reconstruire un mock vivant de l'app
   depuis sa frontière (manifest + I/O observées) ; tester sans toucher la prod.
3. **La grammaire (Rosette)** — inférer quelles séquences d'appels ont un sens ;
   traduire l'app vers d'autres protocoles ; horizon : deux apps SPARDA qui
   s'auto-négocient.
4. **L'évolution nocturne (Darwin/Baldwin)** — muter les circuits, les éprouver
   contre le jumeau, garder ce qui réussit, l'inscrire dans `sparda.json` (hérédité).
5. **Énergie libre (Friston)** — le modèle prédictif unifie tout : la surprise EST
   l'antigène (R1), le circuit sans surprise EST le condensable (R2), l'erreur de
   prédiction EST l'entropie à rembourser (R3.1). Voir §1 : cette loi s'applique
   d'abord à nous-mêmes.

### Round 4 — 🥑 Le Noyau : le cercle parfait de l'information *(Labs / transverse)*

Le seul cercle fermé que la physique autorise est celui de l'information
(Landauer : le calcul ne coûte que lorsqu'on *efface* ; la graine biologique :
le cycle ADN → organisme → ADN est fermé, l'énergie ne fait que le traverser).
Traduction : on ne recycle pas de l'énergie, on recycle du calcul.

1. **Le compteur** *(brique n°1, à coder en premier)* — trois entiers dans le
   router : appels servis par le cercle / appels payés plein tarif / tokens
   évités. La jauge affiche le taux de recyclage réel de l'app — pas une
   promesse, une mesure. Fourchettes attendues en croisière : 40-60% du
   calcul hôte sur app read-heavy, 25-40% en mixte, 10-15% en transactionnel ;
   50-80% de tokens sur les flux répétés. Jour 1 = 0% : le cercle se remplit
   avec l'usage (l'économie croît avec la fidélité — feature commerciale).
2. **Classification thermodynamique des routes** — détecter par observation
   les routes *pures* (mêmes entrées → même réponse : leur résultat préexiste,
   recyclable à l'infini) vs *effaçantes* (writes : irréversibles, paient la
   dîme). Personne au monde ne classe les endpoints ainsi. Converge avec la
   write-safety : on gardait déjà les writes parce qu'ils effacent.
   ✅ *(v0.4 — détecteur livré, ADR-017 ; le volant R4.3 le consommera)*
3. **Volant d'inertie** — cache adressé par contenu des réponses *prouvées
   pures*, servi comme préchauffage/prédiction. La vérité reste l'appel réel
   (règle §1) ; revalidation en idle.
4. **Le moissonneur de ralenti** — ordonnanceur `whenIdle()` : tout le travail
   interne (condensation, prédiction, rêve, évolution) ne tourne que quand la
   boucle d'événements est silencieuse. Saturation perçue : zéro.
5. **La graine** — distiller tout l'appris (schémas, grammaire, workflows,
   anticorps, classes de pureté) en un génome compact dont tout regerme
   (le jumeau du R3, les préchargements) sans re-payer un apprentissage.
   Cycle fermé : app → usage → graine → app suivante.

> Le R4 est l'économie des trois autres rounds : l'immunité, le condensateur
> et le prédictif ne sont que trois façons de recycler le même échappement.

---

## 3. Le modèle : trois étages, un pipeline

- **🆓 Gratuit (l'adoption)** — init, bridge, sémantique sampling, immunité de base.
  *Gratuit = puissance individuelle. Le produit gratuit EST le marketing.*
- **💰 Shadow stable (la confiance)** — mode shadow des writes (dry-run/rollback :
  « essaie avant d'autoriser »), boîte noire signée (journal append-only inviolable
  de chaque action IA — argument compliance), mesh local multi-apps, politiques
  d'accès par outil/par personne, support.
  *Payant = confiance et contrôle en équipe.*
- **🧪 Shadow Labs (la frontière)** — les organes vivants (rounds 2-3) en bêta,
  **à cocher, opt-in, défaut OFF**. Chaque case porte son badge (🟢 stable /
  🟡 bêta / 🔴 expérimental) et sa **jauge de coût visible** (RAM/CPU temps réel
  via `/mcp/stats`). Une feature Labs qui échoue se désactive seule et le dit.

**Pipeline de maturité** : une idée naît dans Labs → se durcit avec l'usage réel
(plusieurs passes de parachèvement) → descend dans Shadow stable → sa version
simple finit parfois gratuite. Le produit a un métabolisme.

**Rétention organique** : la mémoire (`sparda.json` — anticorps, outils condensés,
modèle prédictif) se construit pendant que Shadow tourne. Annuler Shadow, c'est
endormir un organisme qu'on a mis des mois à éduquer.

## 4. Monétisation & protection

- **Licence** : BUSL 1.1 sur le cœur ✅ — usage libre y compris en prod, interdiction
  d'en faire un service concurrent. Conversion Apache 2.0 à +4 ans.
- **Sémantique** : sampling d'abord (zéro clé, zéro coût) ✅ ; **BYOK multimodal**
  en secours (CI, headless) — l'utilisateur met sa clé (Groq, Mistral, OpenAI,
  Claude, Ollama local…), nous ne payons rien.
- **Crédits sur nos clés** : seulement quand le SaaS existe (une clé embarquée dans
  du code distribué se vole ; chaque appel coûterait — contraire au zéro-budget v1).
- **SaaS (phase 2)** : login + Stripe + webhooks sur free tiers (Supabase/Vercel).
  C'est un mini-produit en soi : après le cœur, jamais en même temps.
- **Micro-agents déterministes** : des centaines de règles AST/patterns à zéro token,
  réveillées par un seul cerveau LLM — fusionne avec l'immunité et la néguentropie
  (même organe d'observation).

## 5. Ordre de construction

1. ✅ v0.1 — cœur : parser AST, génération, injection réversible, bridge stdio
2. ✅ v0.2 — trust layer : sampling sémantique, confirmation d'écriture,
   proof-after-write, flux d'erreurs live, sync/hook, BUSL 1.1
3. 🔨 v0.3 — **étage béton** : système immunitaire complet (baseline, antigènes,
   quarantaine, anticorps via sampling) + `sparda_get_context`
4. ✅ v0.4 — le compteur de recyclage (R4.1) + moissonneur idle (R4.4) +
   condensateur d'outils (Labs) : courant, circuits, cristallisation,
   `tools/list_changed`
5. ⬜ v0.5 — Shadow stable : mode shadow des writes, boîte noire signée, politiques
6. ⬜ v0.6 — détecteur de pureté + volant d'inertie (R4.2-4.3), néguentropie,
   cœur prédictif (mesure d'erreur de prédiction)
7. ⬜ phase 2 — SaaS (licences, crédits, BYOK UI), mesh local, jumeau, graine
   complète (R4.5), évolution

---

## 6. Focus post-évaluation (Claude Opus, juin 2026)

L'évaluation stratégique a mis en évidence trois chantiers techniques prioritaires à intégrer au planning :

- **Robustesse AST & Nettoyage** : Blinder la désinstallation (`sparda remove`) contre les reformatages de code par les linters/Prettier. Gérer les décors complexes et mixins en TypeScript.
- **Sécurisation PII (RGPD)** : Remplacer FNV-1a par un hash SHA-256 avec salt dynamique en RAM pour les champs sensibles (emails, téléphones) pour éliminer le risque de rainbow tables.
- **Synchronisation multi-instances (k8s)** : Valider et optimiser le protocole Gossip CRDT P2P (introduit en v0.5.3) pour une convergence sémantique sans infrastructure. Conserver le pilote Redis (seam v0.5.2) uniquement comme option Enterprise (opt-in) pour les parcs massifs.

---

## 7. Round 5 — Dépasser l'état de l'art *(le compilateur est livré : v0.13.1)*

> Le pivot compilateur est fait : `ubg` compile, `apocalypse` prouve, `timeless`
> rejoue, `heal` répare avec preuve, `mirror` sert, `openapi` émet, `verify`
> prouve ses lois. Les rounds 1–4 (immunité, Labs) restent la couche runtime
> MCP. Ce round-ci répond à une seule question : **comment dépasser des géants
> à une personne.**

> **Identité actée (ADR-033, 2026-07-11) :** SPARDA se présente désormais comme
> **la couche de confiance du code écrit par IA** — tagline *« AI writes. SPARDA
> proves. »* Le prouveur en vitrine, le MCP comme feature de la même histoire,
> l'organisme visible en second. Évolution révélée, jamais « pivot » en public.

**La règle de dépassement.** On ne battra jamais CodeQL sur le nombre de règles,
ni Antithesis sur le replay concurrent, ni WireMock sur les mocks. On ne joue
pas leur jeu — on gagne sur trois axes qu'ils ne peuvent structurellement pas
occuper :

1. **Verification, pas detection.** Eux cherchent des patterns (faux positifs) ;
   nous *prouvons* — sans que le dev écrive une seule ligne de spec (elle est
   extraite du code + du schéma). "Zéro effort + preuve" = une case vide.
2. **Composable, pas isolé.** Tout sort du même IR déterministe : le replayer
   parle au prouveur, le prouveur au mock. Chaque brique multiplie les autres.
3. **Agent-native, pas human-native.** `npx`, zéro clé, un graphe que l'IA lit
   et dont elle vérifie la preuve. On est la couche de confiance des agents.

### Les moves (par ratio impact / effort)

- **M3 — `sparda review` : le diff SÉMANTIQUE de PR *(priorité 1)*.** ✅ *(v0.13.x —
  livré).* Personne ne fait le diff de *comportement* d'un PR (tous font le diff
  textuel). "Ce PR change ces 3 endpoints, agrandit le blast radius sur l'agrégat
  Billing, retire un guard sur `/pay`." Livré : `sparda review [--base <ref>]
  [--json] [--markdown]` compile la ref de base (worktree git détaché, compile
  statique, zéro `npm install`) et le working tree, puis compose les passes du
  prouveur (`diffGraphs` pour les protections retirées + delta `checkGraph` pour
  les risques *introduits*, dédupliqués), plus le delta de surface (endpoints
  ajoutés/retirés). Exit 1 sur critical/high → gate CI. Zéro config, zéro
  baseline à mémoriser (la baseline EST git). Voir ADR-030.
- **M1 — Taint interprocédural au service de la preuve.** Pas 1000 règles ; UNE :
  suivre une donnée user non validée à travers N fonctions jusqu'à une écriture
  contrainte. Transforme l'obligation O2 (superficielle) en preuve profonde —
  nous rapproche de CodeQL sur *notre* terrain (prouver), pas le leur (détecter).
- **M2 — Mirror stateful.** ✅ *(v0.13.x — livré).* Les machines à états inférées
  (pass `StateMachineInference`) pilotent le mirror : `POST /orders` sème `pending`,
  `PATCH /orders/:id/pay` avance `pending→paid`, `GET /orders/:id` reflète l'état
  courant, et une transition ILLÉGALE (payer une commande déjà payée) est refusée
  **409**. Store RAM par instance, ids auto-mintés, ressources inconnues lues à
  l'état initial. Le lien read↔machine est structurel (même collection + le champ
  dans le schéma de retour), jamais deviné. WireMock fait ça à la main (dérive) ;
  le nôtre est dérivé du code+schéma, synchro par construction — la *fraîcheur
  garantie*. Voir ADR-031.
- **M4 — Preuve cross-service.** Avec plusieurs graphes (microservices) : prouver
  qu'un changement dans le service A ne casse pas le contrat que B attend. Le
  Saint Graal que personne ne fait bien ; notre IR unique le permet nativement.
- **M5 — Le premier utilisateur externe *(le plus important, non-technique)*.**
  Tout le reste est secondaire tant que le founder est le seul usager. Voie :
  dogfood sur Reach / Audit / Publish (de vrais backends) → publier le corpus
  run → un design partner qui met `apocalypse` en CI. Le premier "SPARDA a
  bloqué un vrai bug chez quelqu'un d'autre" vaut plus que 10 features.
  - **La boucle de croissance — livrée ✅ (v0.13.x).** `sparda review` est
    maintenant une **GitHub Action** (`mode: review`) qui commente le diff
    comportemental sur chaque PR, en **un seul commentaire sticky** qui se met à
    jour à chaque push. Adoption = déposer 1 fichier workflow (`mode: review`,
    `permissions: pull-requests: write`). Commentaire-seul par défaut (ne bloque
    jamais un merge ; gating opt-in via `fail-on-severity`). Chaque PR fait la pub
    de SPARDA à toute l'équipe — comme Codecov/Snyk/Vercel, mais un diff que
    personne d'autre ne produit. Voir ADR-032. Prochain cran M5 : un design
    partner qui l'active sur un vrai repo.
- **M6 — Infiltration Stratégique (Le Cheval de Troie MCP).** Une fois que le cœur est irréprochable et éprouvé sur des repos publics massifs (ex: Prisma, 67k stars), la distribution ne se fera pas par du marketing traditionnel (inefficace pour la Deep Tech). La stratégie : cibler directement les architectes d'Anthropic qui gèrent le protocole MCP.
  - **L'exécution :** Soumettre une RFC (Request for Comments) chirurgicale sur le dépôt GitHub officiel d'Anthropic (`modelcontextprotocol/specification`).
  - **Le message :** *"Nous avons résolu la sécurité des serveurs MCP hors-ligne via un compilateur AST déterministe (capsule 1 octet, O(1)). Faut-il standardiser les vecteurs de polarité dans la v2 ?"*
  - Ce mouvement oblige l'élite technique à lire notre code source. Une validation de leur part créera un effet de levier massif (adoption de la norme SPARDA).

**Ordre : M3 → M1 → M2 → M4, avec M5 en parallèle permanent et M6 comme frappe finale.** Le secret pour
dépasser des géants à une personne : ne pas être meilleur sur dix choses, être
**le seul au monde sur une seule** — la boucle fermée prouvée — et la rendre si
évidente que l'assemblage devienne l'identité du produit avant qu'un géant y pense.

---

## 8. Round 6 — L'immunité collective : le génome mondial *(ADR-035, horizon)*

> Le vrai « personne ne l'a, et ça 10000× ». SPARDA détient **les deux bouts d'une
> boucle** : le génotype (le graphe déterministe, byte-adressable, de ce que le code
> *est*) et le phénotype (ce qu'il *fait* et comment il *échoue*, appris au runtime —
> anticorps, circuits, grammar). On les relie par une **adresse de contenu** : un bug
> diagnostiqué **une seule fois sur Terre**, hérité par toute app partageant la même
> forme comportementale. C'est le système immunitaire de tout le logiciel — un effet
> de réseau qu'aucun fork et aucun géant ne rattrape (ils ont *un* bout, pas les deux).
> Thèse + design complets : `docs/COLLECTIVE-IMMUNITY.md`.

- **Brique 1 — le fingerprint comportemental *(LIVRÉ, v0.15.0)*.** `sparda fingerprint` :
  un `behaviorHash` portable, sans coordonnées, par route. Même forme dans deux repos
  différents → même hash (prouvé : une route fixture ≡ une vraie route Prisma). C'est
  l'adresse sous laquelle un diagnostic partagé se classe.
- **Le milieu — l'algèbre ternaire + la capsule 1-octet *(LIVRÉ, v0.15.0)*.** La réponse à
  « deux bouts c'est pas suffisant » (inspiré de BitNet). `sparda polarity` : chaque route
  = un vecteur {−,·,+} sur les 5 obligations, construit dans le prouveur (un −1 EST un
  finding). Verdict = signe, review = soustraction, posture = somme de colonnes.
  `sparda immunize` : 5 trits = 1 octet, donc la sûreté entière d'une app tient en
  quelques octets (Prisma = 5 octets), figée dans `.sparda/immunity.json`, consultée par
  simple lookup (zéro recompile/LLM/réseau). **La capsule est l'atome du génome** : les
  capsules se composent par addition (app → flotte → monde).
- **Brique 2 — l'enveloppe d'anticorps *(design)*.** Re-keyer les anticorps par
  `behaviorHash`, signés, structure + leçon uniquement (c'est déjà le contrat de `seed`),
  et seulement des fixes prouvés par `heal --check`.
- **Brique 3 — le backplane *(design, zéro infra)*.** Le génome = un repo git public
  d'anticorps signés, content-addressed ; pull-on-compile (offline-first), push opt-in.
- **Le chef d'orchestre *(design)*.** Cohérence à l'installation par divulgation
  progressive : un seul état, le prochain meilleur move — jamais tout d'un coup.

**Pourquoi c'est le 10000× et pas un slogan :** c'est la seule vérification qui tourne à
la *vitesse des agents* (preuve sur graphe + lookup d'adresse = millisecondes, gratuit,
jamais faux deux fois pareil). Quand des millions d'agents écrivent du code, le goulot
est la vérification — et on détient la seule qui scale à leur rythme, avec un corpus qui
est le moat. Le verdict sur un PR n'est que le premier symptôme visible de l'organisme.

---

*Un seul organe d'observation, construit une fois — trois rounds qui s'y branchent.*
*Puis un compilateur, une fois — sept commandes qui s'y branchent.*
*Puis une adresse comportementale, une fois — le génome mondial qui s'y branche.*
*SPARDA by [Residual Labs](https://residual-labs.fr).*

---

## Round 7 — de « très probablement vrai » à « démontré » (le durcissement)

Le grand stress-test (`docs/audit/2026-07-13`) l'a montré : la colonne vertébrale tient, ce
qui reste c'est **la profondeur de preuve** et **la portée**. Round 7 comble les deux. Les
trois premiers sont le vrai génie ; les trois derniers, du kilométrage discipliné.

1. **Dataflow inter-procédural sur l'UBG *(génie)*.** Prouver que `req.body` *atteint* un
   `db_write` *sans passer* par une validation — par le flux réel des valeurs, plus par les
   noms. Transforme chaque heuristique (workflow/décorateur/ORM) en preuve. Classe CodeQL.
2. **Évaluateur partiel du montage *(génie)*.** Exécuter symboliquement *juste* le code de
   routage (dérouler les boucles `for (c of controllers) app.use(...)`, résoudre les registres)
   pour voir les routes des apps « framework-isées » (directus, parse-server) sans rien exécuter.
3. **Sémantique des gardes *(atteignable)*.** Prouver qu'un chemin de refus (401/throw)
   **domine** l'accès à l'effet — analyse de dominateurs sur le CFG de la garde. Fini le
   décorateur au nom flatteur mais vide. *(Round 7 commence ici.)*
4. **Validation différentielle *(assemblage)*.** Rejouer le trafic réel contre `mirror` ET
   l'app, comparer : chaque divergence = un endroit où le graphe ment. Fuzzing sémantique du
   compilateur (méthode SQLite).
5. **DSL d'adaptateurs *(kilométrage).*** Un extracteur = 40 lignes déclaratives, pas 300 :
   Drizzle, TypeORM, Sequelize, Hono, Koa, Flask, GraphQL. La breadth cesse d'être linéaire.
6. **Banc de torture permanent *(discipline).*** 500 repos en CI nocturne, taux FP/FN mesuré
   à chaque commit, fuzzing des parsers. Ce qui sépare un bon outil d'un outil de confiance.

**On ne fait PAS :** réécriture Rust (goulot mesuré ailleurs), daemon résident (règle #1),
blockchain (signatures + git suffisent). Le génie se remplace un mur à la fois, mesuré et prouvé.

---

## Round 8 — Le squelette stratégique : de la technique au moat *(la boussole, 2026-07-22)*

> Ce round ne rajoute pas de feature — il **ordonne** tout ce qui précède. Il est la source de vérité
> de la *direction*. Le plan d'exécution opératoire vit dans `docs/ATTACK-PLAN-FABLE.md` (Fable code,
> Zak distribue, Gemini nourrit le génome). Ce round dit **pourquoi**, et corrige trois erreurs de
> cadrage qu'on faisait.

### 8.0 — Les deux 100 %, à ne jamais confondre

- **100 % de soundness** (jamais un faux `PROVEN` — `SURFACE` plutôt que mentir) : réel, détenu, et
  **language-agnostic donc infini** (il vit dans l'IR/prouveur, pas dans le parser).
- **100 % de couverture** (tout voir) : **impossible dans aucun langage** (indécidabilité). Quiconque
  le promet ment. Notre « 100 % » veut toujours dire *« je ne mens jamais »*, jamais *« je vois tout »*.

### 8.1 — La chaîne (les 3 conversations, condensées)

> **Profondeur + langages → crédibilité → users → génome → moat.**

Deux jobs distincts : la **crédibilité** (profondeur/largeur/chiffres) fait qu'on nous *croit* ; le
**moat** (génome + standard + position) est l'avance durable. La crédibilité n'est pas en concurrence
avec le moat — elle en est le **péage**. Donc la profondeur de Fable n'est pas de la dispersion :
c'est l'**admission de carburant** du moat.

### 8.2 — Le levier structurel : investir au niveau du UBG

Profondeur et largeur ne s'échangent qu'à **l'extracteur**. Passé l'IR, elles sont **orthogonales**.
Corollaire, la loi d'or de l'ingénierie ici : **toute brique de profondeur écrite contre le UBG
multiplie sur TOUS les langages présents et futurs ; tout langage ajouté hérite de TOUTE la
profondeur, gratuitement.** On ne code jamais deux fois la même chose. (Largeur : OpenAPI = 0 dép,
∞ mais surface, sound ; sous-process = 0 dép ; tree-sitter = 1 dép + ADR ; **jamais** un parser natif
par langage.)

### 8.3 — La boussole : la boucle de mesure (pas le pifomètre)

On ne règle pas la profondeur à l'aveugle. Le mineur de génome (`bench/cve-replay.mjs --mine`, ADR-062)
donne un **recall mesuré** sur du vrai code : `mine → recall → construis la brique du miss dominant →
re-mine → mesure le gain`. C'est le R7.6 transformé en **cadran**. La crédibilité devient un **chiffre**
(« on re-dérive X % des vrais fixes d'auth, offline, déterministe »), jamais une promesse.

### 8.4 — Les quatre insights plus tranchants *(raisonnement d'expert — les upgrades de ce round)*

1. **Counter-positioning sur le REFUS.** La chose la plus rare et la moins copiable qu'on fait, c'est
   dire *« je ne certifie PAS ça — SURFACE »*. À l'ère des agents, le signal de confiance rare n'est
   pas « ça a l'air ok » (tous les outils le disent) — c'est un **STOP déterministe et honnête**. Tout
   concurrent est incité à afficher « pass » (vert = user content) ; nous sommes les seuls
   *architecturalement engagés à retenir le vert*. Un incumbent **ne peut pas copier « refuser de
   certifier »** sans casser son propre modèle (Helmer : counter-positioning). **Le produit, c'est le
   refus honnête**, pas la preuve. On vend le `SURFACE`, pas le `PROVEN`.

2. **La preuve est une ATTESTATION — possède le format.** Le UBG est un détail d'implémentation. Ce
   que l'écosystème adoptera, c'est une **attestation portable et re-vérifiable** : « cet edit a changé
   ces comportements ; voici la preuve re-checkable ». C'est **SLSA/in-toto, mais pour le
   COMPORTEMENT** — l'attestation qu'un agent attache à chaque edit/PR comme la provenance SLSA
   s'attache à un build. Se brancher sur un mouvement déjà financé (supply-chain, Sigstore) est bien
   plus fort et adoptable que « publier une spec de graphe ». **Objectif standard : posséder le format
   d'attestation comportementale des edits d'agent.** (Élève M6/SBIR.)

3. **Le mineur MINTE le benchmark de la catégorie.** Le corpus miné de vraies régressions de garde
   n'est pas que le seed du génome : c'est **le yardstick de la catégorie** (comme SWE-bench, OWASP
   Benchmark, MLPerf). Qui définit le test définit la catégorie. Publier « le benchmark des
   garde-fous d'agents » + notre recall dessus + inviter les autres = **posséder la mesure**. Moat
   subtil, énorme. (Élève R7.6 de « discipline interne » à « actif de catégorie ».)

4. **Le réseau se remplit à la vitesse des MACHINES, pas des humains.** Chaque *vérification* (pas
   chaque user) est un anticorps. À l'ère des agents, le **volume d'edits explose** — donc le génome
   se remplit à la vitesse des edits, pas au nombre d'humains. Un seul gros usage (CI, un design
   partner qui gate tout, Gemini qui mine) contribue de façon disproportionnée. **L'effet de réseau
   comportemental se sature bien plus vite qu'un réseau d'utilisateurs humains** — c'est ce qui rend
   la course gagnable vite. (Élève R6.)

### 8.5 — Le vrai reframe : SPARDA est un REGISTRE, pas un linter

Le plafond de l'ambition, atteignable **à zéro infra** : **la mémoire mondiale de ce que fait le code
et de comment il casse** — un index content-addressed `behaviorHash → diagnostic connu`, qui grossit
à chaque compile, chaque edit vérifié, chaque commit miné. Ce n'est pas un outil, c'est une
**institution** (comme le CVE). Un registre = un moat de 30 ans, construit avec git + adressage par
contenu. Les commandes ne sont que la **pompe** qui remplit le registre.

### 8.6 — Le calcul des « 5 ans » (rigoureux) : deux horloges qui composent

Un retardataire doit gravir **deux courbes depuis zéro, séquentiellement** : (a) la profondeur
d'extraction (ingénierie) et (b) l'accumulation du génome (données). Nous, on **compose les deux en
parallèle**, et l'horloge génome a un **cliquet** : une fois `behaviorHash → diagnostic` établi, c'est
permanent et gratuit à servir. Notre avance n'est pas linéaire — c'est **l'intégrale de deux courbes
qui composent**. Zéro-infra n'est pas une contrainte : c'est la **vitesse** qui nous fait gagner la
course avant qu'un géant regarde.

### 8.7 — La position, poussée au bout : la conscience de l'agent

La position la plus profonde n'est pas « un check sur la PR » — c'est **l'agent qui appelle SPARDA
pour vérifier son PROPRE edit avant de le proposer**. Si les frameworks d'agents adoptent
« vérifie-ton-edit » comme étape native et que SPARDA est le vérificateur, on devient **la conscience
de l'agent**. (Élève le hook PostToolUse de « garde-fou CI » à « organe de l'agent ».)

### 8.8 — Invariants non négociables (une tâche qui en viole un est fausse)

Jamais un faux `PROVEN` (toute profondeur est **sous-approximante**) · offline & déterministe (LLM
seulement sur surprise, mémoïsé) · 4 deps exact-pinned (tree-sitter = ADR ; jamais un parser par
langage) · l'hôte ne paie jamais · **tout atterrit dans le UBG**.

### 8.9 — Répartition (verrouillée)

- **Fable** — le code : la boucle de mesure (compas), les briques de profondeur mesurées, le DSL, le
  génome (envelope + backplane), le standard d'attestation. Détail : `docs/ATTACK-PLAN-FABLE.md`.
- **Zak** — la distribution : premier user, saturation plugin/Action, le chiffre de recall transformé
  en artefact public, le benchmark rendu public.
- **Gemini** — nourrit le génome (`docs/gemini/GENOME-MINING-TASK.md`) + ops/registres.

> **La phrase du round :** on ne sera pas la pépite parce qu'on prouve mieux — mais parce qu'on
> devient **le registre mondial du comportement du code et de ses failles**, en vendant le **refus
> honnête** que nul incumbent ne peut copier, en possédant **le format d'attestation** et **le
> benchmark** de la catégorie, avec un réseau qui se remplit à la **vitesse des machines** — le tout à
> **zéro infra**, donc plus vite que n'importe quel géant. La technique est le ticket ; la course au
> registre, sur un seul coin, est le moat.

---

## Round 9 — La phase d'adoption : le wedge dans la boucle *(2026-07-25)*

Prolonge Round 8. Décision stratégique (avec Zak) : à cause de Rice, tous les outils-observateurs
se battent sur les **mêmes 8 axes** (moins de faux positifs, plus de bugs, vitesse, DX, langages,
explications, règles custom, intégrations) — et le plafond théorique y est **le même pour tous**.
Vouloir être « meilleur sur les mêmes axes » que Snyk/Semgrep/CodeQL = jouer leur jeu sur leur
terrain = **perdre** (ils ont 100× nos moyens). On ne gagne **pas** sur la courbe de Rice.

**La règle de la phase :** les 8 axes = **billets d'entrée** (ne pas se faire disqualifier — DX,
faux positifs, explications), jamais la condition de victoire. Le moat = une **catégorie** qu'ils ne
peuvent pas suivre : le verdict **PROUVÉ** + l'honnêteté verrouillée (jamais un faux PROUVÉ) +
**agir au lieu d'observer** (generate-and-check, enforcement). Le wedge concret : **« l'IA écrit →
SPARDA prouve, dans la boucle d'édition »** (`gate`), là où les SAST (CI, après coup, faux positifs)
ne peuvent pas être.

**Livré (9.x) :**
- **9.1 — `gate` irréprochable dans la boucle Claude Code.** Explications par régression
  (`↳ fix:` — quoi restaurer + `--arm`), sur stderr et en `--json` ; l'agent s'auto-répare dans le
  tour. Installateur **1 commande** (`gate --install-claude` → hook PostToolUse, idempotent,
  retirable proprement). Doc multi-boucles (`integrations/agent-loops.md`) : `gate --hook` = contrat
  universel (Cursor/Copilot), `apocalypse` à la frontière de merge ailleurs.
- **9.2 — Trouvable : l'extension VS Code** (`integrations/vscode/`) — le verdict dans l'éditeur
  (Prove / Apocalypse→Problems / Gate). Wrapper fin du CLI, 0 dép runtime, 100% local.
- **9.3 — Une seule identité indexée.** L'ancien pitch « MCP server » tué à la source (chaînes
  livrées + README public → « the trust layer for AI-written code »). Leçon : l'identité vit dans
  ~5 canaux ; un snapshot publié (registre) ne change que si on **re-pousse sur ce canal**.

**Reste de la phase :** ops déléguées (publish Marketplace, About/topics du repo public,
re-publish registre MCP — briefs Gemini/session publique). Le nom npm reste `sparda-mcp` (npm
bloque `sparda`).
