# 🗺️ MASTER MAP — état complet + changement de direction (pour Fable)

> 2026-07-19. Synthèse d'une longue session Zak + Claude. **Lis CECI en premier** : c'est la
> carte de tout ce qu'on a mesuré, décidé, et de ce qui reste. Ton travail moteur (G1/G2/proof
> objects) reste juste et central — ce doc ne l'annule pas, il lui donne un CAP plus grand.
>
> **Règle d'or de toute la session (non négociable) :** jamais "révolutionnaire", "seul au
> monde", "le roi". On vend *"le seul compilateur de comportement déterministe qu'un agent peut
> interroger — précis là où il couvre, honnête sur le reste."* Ça survit à la due diligence.

---

## 1. LE CHANGEMENT DE DIRECTION (le pourquoi)

**Avant :** SPARDA = un outil de sécurité (BOLA/apocalypse). Problème mesuré : marché bondé
(CodeQL, Semgrep, Snyk, + recherche 2025 active sur la BOLA microservices — MScan, BolaZ). En
outil de sécu, on est "un scanner de plus" face à des acteurs installés avec des users. On ne
gagne pas là.

**Après (thèse n°1) :** SPARDA = **le compilateur de COMPORTEMENT pour agents IA** — le modèle
déterministe de ce que le code FAIT, qu'un agent interroge au lieu de deviner. Détail complet :
`docs/THESIS-BEHAVIOR-COMPILER-FOR-AGENTS.md` (branche `docs/thesis-behavior-compiler`).

**Pourquoi ce cap (cartographie croisée, sources dans le doc thèse) :**
- Douleur confirmée, chiffrée : *"RAG récupère le code, il ne le COMPREND pas."* 96% des devs ne
  font pas confiance au code IA ; les agents brûlent 80% de leurs tokens à chercher ; ils
  hallucinent sur ce que le code fait.
- Tous les grands (Cursor, Sourcegraph, GitHub, Anthropic) attaquent ça par **recherche
  sémantique + graphes de STRUCTURE + meilleurs modèles.** Aucun ne compile un modèle de
  **COMPORTEMENT** (effets, état, autorisation). **C'est le vide, confirmé sur 2 recherches.**
- La sécurité (apocalypse) devient **une requête** sur le modèle, plus le produit entier.

---

## 2. LA CARTE DES ORGANES DANS LE NOUVEAU CAP (rien n'est perdu)

| Organe | Rôle |
|---|---|
| UBG/SBIR | le produit : le modèle déterministe de comportement |
| apocalypse | une requête ("ma modif casse un invariant ?") ; la sécu = feature |
| sparda_prove (MCP) | l'interface : l'agent interroge le modèle en direct |
| mirror | exécuter le comportement sans le code (bac à sable agent) |
| timeless | vérité terrain : rejouer une exécution réelle |
| cross-service stitch | le modèle couvre tout le système distribué |
| blindspot ledger | dit à l'agent ce qu'il NE peut PAS garantir → pas d'hallucination |
| certificats incrémentaux | le modèle se met à jour à chaque changement, rapide |
| **immunité collective** | **le seul MOAT non-copiable** (voir §5) |

---

## 3. CE QU'ON A MESURÉ (les faits, pour ne pas se raconter d'histoires)

- **Tests : 684/684 vert** sur 0.65.0. 4 deps exact-pin. Santé OK.
- **Couverture parser : ~4 styles seulement.** dub 580 routes ✅, n8n 494 ✅, immich 268 ✅, medusa
  477 ✅ — MAIS Ghost 0, realworld 1, sequelize 1, beaucoup d'apps → 0-1 route. **C'est le mur n°1.**
- **Faux positifs sur du vrai (mesurés) :** dub = 5 UNGUARDED + 39 BOLA, tous faux (auth/callback/
  helpers). immich = 5 UNGUARDED, tous auth/oauth/état. **2 classes identifiées** (voir §4).
- **Test carte de comportement (dub) :** scoping précis par route = **carte parfaite** là où la
  couverture est bonne (`DELETE /folders/:id → withWorkspace, delete folder + update project`),
  mais **0 effet** sur les routes qui délèguent à un helper importé. → **La valeur = la couverture.**
- **Cross-service HTTP (novu, 6 services) :** stitch = 0 arête. Les vrais systèmes communiquent par
  **queues**, pas HTTP. → nouvelle piste (voir §4, doc queue-bola).
- **Chasse à la faille :** 4 passes soignées (immich, documenso…) → tout bien gardé. Pas de pépite.
  La faille se trouve par **grind sur des apps moins auditées**, pas sur les géants durcis.

---

## 4. LA LISTE DE TRAVAIL POUR FABLE (regroupée, par priorité)

**Le prérequis qui débloque TOUT (sécu + comportement-agents) : la couverture.**

1. **Les 2 classes de faux positifs** — `docs/TWO-FALSE-POSITIVE-CLASSES-2026-07-19.md`
   (branche `docs/false-positive-classes`) :
   - Classe 1 : routes publiques par design (auth/oauth/webhook/health) → re-labelliser, pas critical.
   - Classe 2 : **gardes par état** (`if (await getAdmin()) throw` — cas immich vérifié) → reconnaître
     comme garde. Test de référence fourni.
2. **Les helpers importés** (le trou que ta phase-2 G1 a trouvé dur — l'over-attribution). C'est LE
   plafond de la carte de comportement ET des faux BOLA. Contrainte de design déjà notée : ne pas
   laisser un helper à fort fan-out baver ses effets.
3. **Élargir le parser** au-delà des 4 styles (le mur qui empêche de scanner les apps où sont les
   vraies failles).
4. **Nouvelle piste différenciante : BOLA par file de messages** —
   `docs/CROSS-SERVICE-QUEUE-BOLA-2026-07-19.md` (branche `docs/cross-service-queue-bola`). Trouvé en
   exécutant sur novu. Mécanisme : stitch producteur→queue→consommateur, réutilise le CSOP. (Note :
   la recherche montre que la BOLA cross-service HTTP est déjà couverte par la recherche ; l'angle
   queue est moins couvert mais À CONFIRMER — ne pas revendiquer "seuls au monde".)
5. **Exposer le modèle de comportement aux agents** (le nouveau cap) : une surface MCP qui répond
   "que fait cette route/fonction ?" (effets, tables, gardes, appels) — réutilise le scoping précis
   par route qu'on a testé + le pattern `sparda_prove`.

**Déjà livré cette session (pour info) :** `sparda_prove` (PR mergée), les certificats incrémentaux
CSOP validés empiriquement + lemme 1 prouvé en Lean (`docs/csop-handoff/`).

---

## 5. LA VÉRITÉ SUR LE MOAT (à ne jamais oublier)

- **La complexité NE protège PAS.** Une équipe financée réimplémente n'importe quel algo. "Trop
  complexe pour être copié" est un mythe en logiciel.
- **Le seul moat non-copiable = la DONNÉE / effet de réseau = l'immunité collective.** Anthropic
  peut copier l'algo ; pas 5M de backends dont SPARDA a accumulé le comportement.
- **État aujourd'hui : mécanisme ~50-60% (fingerprint + anticorps livrés, backplane public non),
  DONNÉE réelle ~0% (0 user).** Un moat de données vide n'est pas un moat — c'est un plan.
- **Conséquence :** le moat est DERRIÈRE l'adoption, pas avant. Séquence : produit qui marche →
  adoption → donnée → moat. **Tout ramène à l'adoption.**

---

## 6. RÉSULTATS ATTENDUS (projection honnête, SI la couverture est réparée)

- SPARDA = acteur respecté et différencié dans l'espace agent-code : **~60-70%**.
- "Le roi" / leader de catégorie : **~10-15%**.
- Acquisition (Anthropic/Cursor/GitHub/Snyk) sur ~2 ans **avec visibilité + démo prouvée** :
  **~15-25%** ; **~0 sans visibilité.**
- **La variable qui décide de tout, partout : exécution + visibilité. Jamais l'idée.**

---

## 7. TOUS LES ARTEFACTS DE LA SESSION (branches, pour tout retrouver)

- `docs/thesis-behavior-compiler` — LE cap (compilateur de comportement pour agents) + projection.
- `docs/secret-roadmap` — la roadmap secrète (Niveau 4 : certificats composables code-privés).
- `docs/false-positive-classes` — les 2 classes de faux positifs (cas immich).
- `docs/cross-service-queue-bola` — la piste BOLA par queue (trouvée sur novu).
- `docs/csop-handoff` — l'algo CSOP validé + certificats incrémentaux + lemme Lean 1.
- `docs/kimi-csop-spec`, `docs/sparda-strategy-pack`, `docs/urgent-adoption-playbook` — specs/plans.
- `feat/sparda-prove-mcp` — l'outil de preuve live (mergé).

> **En une phrase, la direction :** SPARDA cesse d'être "un scanner de sécu de plus" pour devenir
> "le compilateur de comportement que les agents interrogent". Le chantier n°1 (la couverture) sert
> les DEUX. Le seul moat non-copiable (l'immunité collective) est derrière l'adoption. Il ne manque
> pas une idée — il manque l'exécution propre et les premiers vrais users.
