# G1 — root-cause définitif (mesuré) + spec du fix — 2026-07-18

> **Pour la prochaine session moteur (passe dédiée, à froid).** Suite directe du
> strategy-pack (`_STRATEGY-PACK-INDEX-2026-07-18.md`, branche `docs/sparda-strategy-pack`).
> Tout ci-dessous est **mesuré en direct** sur dub (clone du 2026-07-18), pas déduit.
> **⚠️ Ce doc CORRIGE le field-test du pack : le fix qu'il propose ne marcherait pas.**

---

## 1. Ce que le pack disait vs ce que la mesure montre

**Le pack (`FIELD-TEST-AND-GAP-MAP` §2)** : les ~60 `OBJECT_SCOPE_UNPROVEN` de dub seraient dus
au fait que SPARDA « n'a pas connecté que le `where` lie l'id-requête à l'identité de
l'appelant » → fix proposé = comparer la clé du `where` au principal de l'identité
(BolaRay étape 2).

**La mesure (2026-07-18, dub@HEAD, SPARDA 0.64.0)** : c'est faux sur les deux points.

1. **SPARDA reconnaît DÉJÀ les clés d'ownership dans un `where`.**
   `extract.js` → `whereOwnerScoped()` (`OWNERSHIP_KEY` = `workspace_id|user_id|project_id…`,
   `OWNERSHIP_ROOT` = `session|auth|…`) pose `meta.ownerScoped` sur l'effet. Vérifié dans le
   graphe compilé de dub : la lecture de `getCustomerOrThrow` sort bien
   `db_read customer idScoped=true ownerScoped=true` (le `projectId: workspaceId` est vu).

2. **Le vrai pattern dub n'est pas « le scope dans le where de la mutation ».**
   Lu dans le source (`app/(ee)/api/customers/[id]/route.ts`) :
   ```ts
   const customer = await getCustomerOrThrow({ workspaceId: workspace.id, id }); // read scopée + THROW
   await prisma.customer.delete({ where: { id: customer.id } }); // where = { id } SEUL
   ```
   L'ownership est prouvé par une **assertion préalable dans un helper importé**
   (`getXOrThrow` — dub en a un par ressource : getBounty/getFolder/getLink/getDomain/…OrThrow,
   ~18 helpers, `lib/api/*/get-*-or-throw.ts`), pas par le `where` de la mutation.
   Comparer les clés du `where` de la mutation ne changerait donc RIEN.

## 2. Le root-cause définitif (une phrase)

> **Les effets d'un helper IMPORTÉ ne sont pas câblés dans la chaîne control_flow de la
> route qui l'appelle — donc `reachOf(entrypoint)` ne les voit pas.**

Chaîne de preuve (reproduite avec les vraies fonctions, pas un BFS maison) :

- `reachOf('DELETE /api/customers/:id')` atteint **1 seul effet** : le `delete`
  (`ownerScoped=false`). La lecture `ownerScoped=true` existe dans le graphe mais est
  **hors reach**.
- Pourquoi : `translate.js` `attachBody()` (~l.336) ne relie une route qu'aux callees présents
  dans **`helperByName`, le call-graph LOCAL au fichier**. `getCustomerOrThrow` est importé
  (`@/lib/api/customers/get-customer-or-throw`) → absent de la map → l'edge
  `control_flow(route → helper)` n'est jamais créé → ses effets restent des îlots.
- O7 (`apocalypse.js` ~l.240) fait `ownerScopedSeen = reached.some(ownerScoped)` → false →
  **faux BOLA**. Les ~60 advisories dub sont très majoritairement cette classe (les routes
  listées sont toutes du pattern `getXOrThrow`).

C'est le **même trou** que le bare-call following v0.50 (E-042 lineage) : le suivi des appels
importés existe côté _extraction d'effets_ mais pas côté _câblage CFG de la route_.

## 3. Le fix (option A, principiel) — et pourquoi pas l'option B

**A (à faire) :** dans `translate.js`, quand `scan.calls` contient un callee absent de
`helperByName`, le résoudre via les imports du module (la machinerie `resolveRelImport` /
`parseModule` existe — c'est celle du bare-call following et du workspace resolver E-048),
créer/réutiliser le nœud logique du helper, et **câbler l'edge `control_flow` avec le
`route: epId` du chemin courant**, puis attacher son body (borné par le set `expanded`
anti-réentrance existant + une profondeur max).

**B (rejetée comme fix principal) :** reconnaître le pattern `getXOrThrow({ownershipKey})` au
site d'appel. Rejetée parce que (1) c'est une liste, pas un principe (viole la règle du
guard-taxonomy doc) ; (2) A répare AUSSI la couverture et d'autres règles ; (3) la moitié du
travail de A (résoudre l'import) est déjà nécessaire pour B.

**Soundness du gain :** poser `ownerScoped` vu par O7 ne peut JAMAIS créer de faux PROVEN —
O7 est advisory (ne gate pas), et `ownerScoped` reste MUST-analysis (posé uniquement sur preuve).
Le risque n'est pas là — il est dans l'effet de bord :

## 4. ⚠️ Le protocole anti-dérive (OBLIGATOIRE — le fix change reachOf partout)

`reachOf` alimente aussi les règles **dures** (UNGUARDED_MUTATION, aggregates, transactions,
IRREVERSIBLE). Câbler des helpers importés = plus d'effets reachable sur TOUTES les routes du
corpus. Direction sound = de **nouveaux findings peuvent apparaître** (effets nouvellement
visibles, pattern E-046 « newly-visible ») ; ce qui ne doit JAMAIS arriver = un finding qui
**disparaît** ou un verdict qui passe à PROVEN à cause du câblage.

Checklist de la passe dédiée :

1. Implémenter A (translate.js), borné (profondeur, anti-réentrance, jamais de guard fabriqué —
   un helper importé contribue ses **effets**, jamais une garde : E-042/v0.50 reste la loi).
2. `npm test` — corpus oracle : **tout verdict qui bouge doit bouger vers PLUS de findings ou
   plus de couverture, jamais vers PROVEN.** Documenter chaque drift.
3. Re-mesurer dub : BOLA 60 → cible ~5-10 (les vrais). Vérifier que les 5 UNGUARDED (faux
   positifs du guard-taxonomy doc, familles jeton/webhook) n'ont PAS bougé (c'est G2, pas G1).
4. Re-mesurer n8n + cal.com (les 2 autres géants du pack) : couverture ↑, pas de PROVEN nouveau.
5. Attention perf/précision : la route dub `DELETE /customers/:id` atteint déjà **791 effets**
   en BFS naïf toutes-edges (sur-réachabilité, peut-être aggravée par E-048/workspace) — après
   câblage, surveiller la taille de `reachOf` et le temps de compile (dub ~2s aujourd'hui).
6. Tests : fixture « helper importé porteur d'ownership » (le pattern getXOrThrow minimal) +
   mutant (débrancher le câblage → le test BOLA doit re-crier faux positif).

## 5. ✅ Phase 1 LIVRÉE (option B bornée, advisory-safe) — 2026-07-18

Plutôt que l'option A risquée (câblage CFG corpus-wide) en fin de session, la partie **sûre et
bornée** est shippée : reconnaître l'assertion d'ownership **au site d'appel**
(`getXOrThrow({ workspaceId: workspace.id })`) — visible sans résoudre le helper importé — et
poser `ep.meta.ownerAsserted`, qui **ne gate QUE l'advisory O7** (aucune règle dure touchée).

- **Mesuré dub :** `OBJECT_SCOPE_UNPROVEN` **60 → 39** (21 faux positifs tués — la famille
  `getXOrThrow`). **Règles dures BYTE-IDENTIQUES** : UNGUARDED=5, NON_ATOMIC=26, UNVALIDATED=61,
  verdict NOT_PROVEN @99.4%. **Zéro dérive corpus** (670→673 tests verts, mutation 9/9).
- **Soundness :** advisory-only (ne peut jamais créer un faux PROVEN) + garde anti-usurpation —
  une valeur venue de la requête (`req.body.workspaceId`) n'est PAS une identité (test dédié).
- **Code :** `extract.js` (`callAssertsOwnership`/`valueIsIdentity` + flag scan),
  `translate.js` (propagation à l'entrypoint), `apocalypse.js` (garde O7). Fixture
  `tests/fixtures/ubg-ownership-assert` (asserted / raw / spoof) + mutant.

## 5bis. ✅ G2 phase 1 LIVRÉE (downgrade credential-gated, advisory-safe) — 2026-07-18

Familles B–D/F du guard-taxonomy : une route publique-par-design dont le corps **vérifie un
credential et peut refuser** n'est pas "unguarded" au sens critical. Signaux advisory-only
(`credentialSignals` dans le scan, SÉPARÉS de `guardSignals` pour ne jamais fabriquer de garde) :

- **C (jeton stocké)** : lecture d'une table `*token*/*verif*/invite/otp` + un `throw`/4xx.
- **B (verify)** : appel dont le nom matche `verify|signature|hmac` + un `throw`/4xx.
- **F (callback OAuth)** : route `*callback*/webhook` qui refuse par `redirect`.

**Invariant respecté :** ne fait que **rétrograder critical → advisory** (jamais prouver, jamais
silencer). Une lecture de table-token SANS refus reste critical (test dédié `reads-token-no-gate`).

- **Mesuré dub :** `UNGUARDED_MUTATION` critical **5 → 1** (le survivant `track/application` est le
  vrai signal à examiner — exactement l'objectif du pack : « ce qui RESTE en critical est du vrai
  signal »). Règles dures inchangées (NON_ATOMIC=26, UNVALIDATED=61, BOLA-adv=39). Zéro dérive
  corpus (673→677 tests).
- **Code :** `extract.js` (`credentialSignals`, `statusIn4xx`, throw/verify/redirect capture),
  `translate.js` (propagation), `apocalypse.js` (downgrade O1 par famille). Fixture
  `ubg-credential-gate` (4 directions) + mutant.

## 5ter. ⛔ Option A TENTÉE puis ANNULÉE (2026-07-18) — la mesure a tranché

Le câblage complet des helpers importés (résoudre `scan.calls` cross-fichier via
`resolveExportedFunction`, créer le nœud, l'attacher à la chaîne de la route) a été **implémenté
et mesuré**. Il **marche** sur le plan mécanique — customers/:id passe de 1 → 27 effets atteints,
la lecture `ownerScoped` de `getCustomerOrThrow` devient réelle, BOLA 39 → 0 (via le vrai chemin,
pas l'heuristique G1). **MAIS il est UNSOUND en précision** et a été **reverté** :

- **Sur-attribution massive :** `NON_ATOMIC_AGGREGATE_WRITE` se met à tirer sur **580/580 routes
  (100%)**, `UNVALIDATED` sur 235/580 (40%). Un helper partagé (util, logger, session) qui fait
  un write non-atomique, une fois câblé, voit son effet **étalé sur TOUTES les routes** qui
  l'atteignent transitivement. `reachOf` explose (1 → 27 effets), la majorité n'étant PAS le
  comportement propre de la route mais des internes de helpers partagés.
- Les findings n'ont pas "disparu" (le flood-collapse les résume en 1) — mais **une règle qui
  tire à 100% est du bruit, pas du signal.** C'est exactement pourquoi G1 phase 1 a pris
  l'approche bornée au **site d'appel** plutôt que le câblage complet.
- **Détail technique appris (pour la reprise) :** les nœuds stockent un `loc.file` RELATIF ;
  `parseModule` exige l'absolu → il faut threader `cwd` dans `translate()` (fait, `wire.cwd`),
  sinon `wireImportedHelper` renvoie null en silence (c'était le premier bug, corrigé avant de
  voir la sur-attribution).

**La contrainte de design pour une future option A SAINE :** ne pas attribuer aux règles DURES
per-route les effets atteints uniquement via un helper partagé à fort fan-out. Pistes :
(a) ne câbler que les helpers **à faible fan-out** (appelés par ≤ k routes) ; (b) n'utiliser les
effets de helper câblé que pour les signaux **advisory** (ownership/BOLA), jamais pour
UNGUARDED/aggregate/atomicity (c-à-d généraliser proprement ce que G1 fait déjà au site d'appel) ;
(c) une notion de "profondeur sémantique" qui distingue l'effet propre de la route de l'interne
partagé. **À faire en passe dédiée, avec le protocole anti-dérive du §4 comme juge.**

## 6. Reste à faire (prochaines passes)

- **Les 39 BOLA restants ne sont PAS tous la même classe** (vérifié route par route) : familles
  jeton/embed (`/api/embed/referrals/*`, OTP) = **G2** ; scoping par relation partner-profile
  (`/api/partner-profile/programs/:programId/*`) ; quelques vrais candidats de revue. Ne PAS
  chercher à tous les tuer avec des heuristiques trop généreuses — ça masquerait de vrais BOLA.
- **Option A (câblage CFG des helpers importés)** reste le fix de fond pour la COUVERTURE
  (effets des helpers importés invisibles à `reachOf`) — à faire en passe dédiée avec le
  protocole anti-dérive du §4 (re-mesure des 7 géants, jamais un finding perdu ni un PROVEN neuf).
- dub cloné dans le scratchpad éphémère (`giants/dub`) — recloner au besoin
  (`git clone --depth 1 --filter=blob:none https://github.com/dubinc/dub`).
