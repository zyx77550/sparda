# 🔴 URGENT — ADOPTION PLAYBOOK (lire AVANT tout travail moteur)

> **Date :** 2026-07-17 · **Statut :** ACTIF — prime sur NEXT-WAVES-PLAYBOOK tant que la Phase 1 n'est pas livrée.
> **Pour qui :** toute session (Fable 5 ou autre) qui travaille sur SPARDA.
> **Mandat de Zak :** transformer SPARDA en outil que le marché adopte, en appliquant les playbooks des géants. Cette semaine.

> **💰 Décision monétisation (2026-07-17, Zak) : ZÉRO paywall, ZÉRO tier payant, ZÉRO friction
> de paiement tant que l'adoption n'est pas là. On ne fait pas payer pour l'instant — on veut
> des utilisateurs, rien ne bat le gratuit pour ça.** Ce n'est pas un changement de plan : la
> licence BUSL (`LICENSE:8`) autorise déjà explicitement l'usage production gratuit pour tout le
> monde, et `ROADMAP.md:174` dit déjà "SaaS phase 2... jamais en même temps" que le cœur — cette
> décision confirme et **verrouille** ce qui était déjà prévu, elle ne l'invente pas.
> **Implication concrète pour toute session (y compris le travail de résolution LLM-assistée des
> blindspots, `docs/AUDIT-1000-SPARDA-2026-07-17.md` §Part A) : aucune nouvelle capacité moteur
> ne doit être posée derrière un compte, une clé API, un login, ou un tier "pro". Tout ce qui
> existe dans le CLI reste 100% gratuit et sans friction.** La seule chose qui peut rester payante
> plus tard (phase 2, jamais avant que l'adoption tourne) : un service hébergé/managé tiers — et
> uniquement ça, car c'est le seul cas que la licence BUSL exclut déjà de l'usage gratuit.

---

## 0. Pourquoi ce dossier existe (les faits, mesurés le 2026-07-16/17)

| Signal | Valeur | Lecture |
|---|---|---|
| npm downloads `sparda-mcp` | 3 618/mois affichés — **mais non fiable, voir 0bis** | Métrique vanité, à ne PAS utiliser pour piloter |
| GitHub vues repo public `sparda` | **41 visiteurs uniques / 14 jours** (70 vues) | Le vrai goulot : quasi personne ne découvre le produit |
| GitHub stars (repo public) | **3** | Sur ~41 vrais visiteurs, pas sur 3618 dl — moins alarmant mais toujours faible |
| Dogfooding sur les produits Residual Labs | **0 app** | Contradiction fatale en due diligence |
| Coverage sur apps réelles | twenty 8% · formbricks 8% · open-webui 0% | "PROVEN" peut vouloir dire "prouvé sur 8%" |
| Claim Medusa 476 routes | **Non reproductible** sur le clone local (bug `detect.js` : deps only, pas devDeps/self) | Un sceptique conclut "vaporware" en 2 min |

### 0bis. Diagnostic bots vs humains sur npm (2026-07-17)

Deux signaux croisés, indépendants :
1. **Répartition par version anormale.** `npx sparda-mcp` prend toujours `latest` sauf pin — un
   usage humain masse sur la dernière version. Réalité : `0.32.0` (latest) = **12.5%** du volume
   hebdo (142/1138) ; le reste se disperse sur de vieilles versions au hasard (`0.14.0` = 189,
   la PLUS grosse). Signature classique de scanners de sécurité / miroirs de registre qui aspirent
   systématiquement chaque version publiée — pas des devs qui essaient l'outil.
2. **Clones GitHub (3093/13j) >> vues de page (70/14j, 41 uniques).** `git clone` ne passe pas par
   la page README — l'écart massif confirme que la majorité des clones sont automatisés (CI,
   miroirs), pas précédés d'une découverte humaine.

**Conclusion : le vrai volume d'essayeurs humains est de l'ordre de quelques centaines/mois, pas
3618. N'utilise JAMAIS le chiffre npm brut comme preuve de traction dans le README ou un pitch —
utilise `docs/URGENT-ADOPTION-PLAYBOOK.md §4` (GitHub views/uniques) à la place.**

### 0ter. Sur le nom `sparda` vs `sparda-mcp`

`sparda` (sans suffixe) est **disponible sur npm en ce moment** (vérifié 2026-07-17, 404 propre).
**Décision : NE PAS renommer le package `sparda-mcp`** — trop d'équité déjà construite (registres
MCP, awesome-lists, tous les `npx sparda-mcp` déjà documentés/partagés) ; le rename résout zéro
problème de perception. Le "on nous prend pour un petit outil MCP de plus" vient du CONTEXTE de
découverte (listé au milieu de 200 serveurs MCP identiques), pas du nom — la solution est le
badge/case-study/README (§3), pas un rename. Action à faible coût acceptée : réserver `sparda`
sur npm en meta-package défensif (empêche un typosquat), sans migrer quoi que ce soit.

**Diagnostic en une phrase : le moteur dépasse la traction d'un facteur 10-100 (le facteur exact
est inconnu tant que le vrai volume npm n'est pas mesurable — voir 0bis).
Chaque heure investie dans le moteur avant d'avoir réparé le funnel a un ROI proche de zéro.**

---

## 1. La thèse (comment les géants font adopter un dev-tool)

L'adoption n'est pas une feature, c'est une **boucle**. Les quatre facteurs se multiplient —
si un facteur vaut 0, le produit vaut 0 :

```
Adoption = Time-to-wow × Artefact partageable × Distribution native × Confiance
```

| Géant | Le move | Traduction SPARDA |
|---|---|---|
| **Stripe** | Premier appel API réussi en < 60 s, zéro config | `npx sparda-mcp ubg` doit produire un résultat impressionnant sur N'IMPORTE quel repo, sans config, sans crash, sans "0 routes" |
| **Codecov / Lighthouse** | Le résultat est un **score + badge** que l'utilisateur affiche fièrement | Badge "Behavior coverage 87% — proven by SPARDA" dans le README des users = boucle virale. C'est LE mécanisme qui convertit un download en star |
| **Vercel** | La distribution vit là où le dev travaille déjà (git push) | GitHub Action Marketplace (le `action.yml` existe déjà !) + registres MCP officiels (`server.json`, `glama.json` existent déjà) |
| **Docker → OCI, Microsoft → LSP** | Ouvrir le **format** pour posséder le standard | SBIR spec publiée, versionnée, consommable par d'autres outils. Celui qui définit le format du behavior-graph pour agents gagne sans se battre |
| **ESLint** | La confiance par l'honnêteté : dire ce qu'on ne voit pas | Le blindspot ledger est un signal coûteux qu'aucun concurrent marketing ne peut imiter. Le mettre en VITRINE du rapport, pas en annexe |

**Honnêteté d'abord : personne ne peut "garantir" l'adoption.** Ce playbook maximise la
probabilité en réparant chaque facteur de la boucle, dans l'ordre du levier.

---

## 2. KILL LIST — interdit tant que la Phase 1 n'est pas livrée

- ❌ Nouveaux organes / nouvelles vagues moteur (Wave 2b, Wave 3 : REPORTÉES)
- ❌ Nouveaux frameworks (la largeur est la guerre des concurrents, pas la nôtre — COMPETITION.md)
- ❌ Dossiers d'analyse, ADR non liés à l'adoption, redesigns d'outils internes
- ❌ Superlatifs README non reproductibles ("mathematical", chiffres héroïques sans script de repro)
- ❌ `mirror` et features démo sans demande utilisateur

---

## 3. PLAN 7 JOURS (exécutable, dans l'ordre — chaque jour a un livrable vérifiable)

### J1-J2 — Réparer le time-to-wow (le "0 routes" est un tueur d'adoption)
1. ✅ **LIVRÉ (v0.51, E-043)** — `detect.js` : détection Medusa STRUCTURELLE (`src/api/**/route.ts`
   exportant des verbes), sans dep, avant le bloc express. `packages/medusa` : 1 → 477 routes.
   Test de régression `ubg-medusa-nodep`. + tripwire honnêteté (E-044) : `PROVEN (PARTIAL)` sous
   60 % de couverture, fin de "PROVEN sur 8 %".
2. ✅ **LIVRÉ (v0.52)** — `ubg`/`prove` ne sortent plus jamais "0 routes" en silence.
   `suggestAppDirs` (detect.js) scanne apps/·packages/·services/… → diagnostic actionnable
   (`cd apps/web && sparda prove   # looks like Next.js`). Câblé dans prove, ubg et l'erreur
   no-framework (qui liste maintenant Express/Next/Nest/Medusa/FastAPI). Test de régression.
3. ✅ **LIVRÉ (v0.55)** — `bench/repro.mjs` clone Dub/Immich/Medusa et reproduit les chiffres du
   README (579/281/477 routes, 0 crash, ≤2.05s), avec un plancher par repo = gate de régression.
   Évidence commitée : `bench/route-proof.json` + `bench/README.md` (claim → commande). Le
   README héroïque non reproductible ("proved 3700+ routes", v0.26) est corrigé en chiffre
   honnête et scriptable — et "compiler une route" ≠ "la prouver sûre" (la plupart NOT_PROVEN).

### J3-J4 — L'artefact partageable (le mécanisme viral)
4. ✅ **LIVRÉ (v0.53)** — `sparda badge` : SVG auto-contenu (zéro fetch externe) + bloc markdown
   prêt à coller + alternative shields.io + `--json` pour la CI. Le mot ET la couleur viennent
   de `verdictState` (source unique partagée avec `prove`) → le badge ne peut JAMAIS sur-vendre :
   un repo résolu à 23 % affiche un `partial · 23%` jaune, jamais un faux vert. Test de régression.
5. ✅ **LIVRÉ (v0.56)** — `sparda dossier` réorienté public : verdict via `verdictState` (montre
   `PROVEN (PARTIAL)` + "UNPROVEN, not safe", ne peut plus sur-vendre), score coverage en header,
   matrice de sécurité, risques, et "où la preuve s'arrête" (blindspots en vitrine = confiance).
   Une page auto-contenue, screenshotable. Test de régression PARTIAL.
6. Le badge/rapport doit sortir à la FIN de `ubg` et `apocalypse` par défaut (opt-out, pas opt-in).

### J5 — Distribution native
7. ⏳ **EN COURS (v0.54)** — `action.yml` a maintenant 3 modes : apocalypse (gate + SARIF),
   review (diff de comportement), et **prove** (commentaire sticky = verdict + badge inline +
   coverage + top findings). Le corps vient de `prove --markdown`, posté par le sticky-comment
   existant. Reste à PUBLIER l'action au Marketplace (tag + release, action manuelle GitHub UI).
8. **Registres MCP** : vérifier/soumettre `server.json` au registre officiel MCP + glama +
   3 listes awesome-mcp (PR simples).

### J6 — Dogfooding = les 3 premières case studies
9. Lancer `ubg` + `apocalypse` sur **Reach, Audit, Publish** (Next.js/Supabase = le plus gros
   marché). Corriger ce qui casse (c'est le vrai test du time-to-wow). Committer les
   `.sparda/ubg.json` + badges dans ces repos.
10. En tirer 3 mini case studies chiffrées (routes, coverage, blindspots trouvés) pour le README.

### J7 — Le lancement
11. ⏳ **README RÉÉCRIT (v0.56)** — pitch "AI writes. SPARDA proves." + trust-layer (fini le
    "LLVM"), bandeau de badges, bloc **60-second proof** (`apocalypse`/`prove`/`badge`) en tête,
    prouveur = produit / MCP = runtime optionnel, claims reproductibles uniquement (le "3700
    proved" mort). Reste : le GIF du rapport + le lancement lui-même (Show HN/PH — action Zak).
12. Préparer (pas forcément tirer) : Show HN + Product Hunt + thread — l'angle est la démo
    `attack`/apocalypse sur un repo connu, reproductible par le lecteur en 1 commande.

---

## 4. Métrique nord + tripwires

- **Métrique nord : repos actifs** = nombre de repos avec `.sparda/ubg.json` committé/mis à jour
  sur 7 jours glissants. PAS les downloads npm (vanity, pollués par les bots — voir §0bis).
- **Métrique de distribution : GitHub views/uniques** (`gh api repos/zyx77550/sparda/traffic/views`,
  gratuit, déjà disponible, cohérent avec la philosophie zéro-infra). Baseline 2026-07-17 : 41
  uniques/14j. Objectif J7 : x5 minimum via Show HN/PH.
- Métriques de boucle : vues README → clones réels (proxy imparfait) → % qui génèrent un badge →
  % de badges publiés → stars.
- **Tripwire honnêteté :** aucun chiffre ne va dans le README sans script de repro dans `bench/`.
- **Tripwire focus :** si une session passe > 30 min sur du moteur non listé ici avant la fin
  de la Phase 1 → stop, revenir au playbook.

## 5. Après la Phase 1 (teaser, ne pas commencer avant)

- **`sparda attack`** : le prouveur adversarial (minimax sur l'UBG — chemin le moins cher pour
  violer une garde, output "top 5 attack paths"). C'est la killer demo du lancement V2.
- Wave 2b/3 (profondeur Python, taint dataflow) — reprennent APRÈS que la boucle d'adoption tourne.

> Rédigé par la session Fable 5 du 2026-07-17 (audit repreneur, données vérifiées sur machine).
> Contexte complet de l'audit : demander à Zak ou voir la session correspondante.
