# Thèse produit n°1 : le compilateur de comportement pour agents IA

> 2026-07-19. Repositionnement issu d'une cartographie croisée + tests sur du vrai code (dub).
> Interne. **La règle de toute cette thèse : jamais un mot qui ne survivrait pas à la due
> diligence.** Ci-dessous, le cap ET la projection honnête (où on atterrit vraiment, ce que
> diront les autres, Anthropic, les stats). Pas de vente.

---

## La thèse

> **SPARDA n'est pas un outil de sécurité. C'est le compilateur de COMPORTEMENT : le modèle
> déterministe de ce que le code FAIT, qu'un agent IA interroge au lieu de deviner.**

La douleur (confirmée, chiffrée) : *"RAG récupère le code, il ne le COMPREND pas."* Les agents
traitent le code comme du texte plat, brûlent 80% de leurs tokens à chercher, hallucinent sur ce
que le code fait. Tous les grands (Cursor, Sourcegraph, GitHub, Anthropic) attaquent ça par
**recherche sémantique + graphes de structure + meilleurs modèles.** Aucun ne compile un modèle
déterministe de **comportement** (effets, état, autorisation, flux). C'est le vide, confirmé sur
deux recherches.

## Le wedge (précis, pas "on remplace la recherche")

On ne gagne PAS sur "comprendre le code en général" (les modèles + la recherche y sont bons). On
gagne **là où deviner est interdit** : tous les effets d'une fonction, tous les invariants, le
comportement à travers tout un système distribué, la preuve qu'une modif ne casse rien —
**déterministe, jamais halluciné.**

## La carte des organes (rien n'est perdu)

| Organe | Rôle dans la thèse |
|---|---|
| **UBG/SBIR** | le produit : le modèle déterministe de comportement |
| **apocalypse** | une requête sur le modèle ("ma modif casse un invariant ?") ; la sécu = une feature |
| **sparda_prove (MCP)** | l'interface : l'agent interroge le modèle en direct |
| **mirror** | exécuter le comportement sans le code (bac à sable pour l'agent) |
| **timeless** | vérité terrain : rejouer une exécution réelle |
| **cross-service stitch** | le modèle couvre tout le système distribué (la douleur "500k lignes sur N services") |
| **blindspot ledger** | dit à l'agent ce qu'il NE peut PAS garantir → pas d'hallucination sur ces zones |
| **certificats incrémentaux** | le modèle se met à jour à chaque changement, rapide |

## Le prérequis unique (mesuré, honnête)

Test sur dub : quand SPARDA voit les effets → carte de comportement **parfaite**
(`DELETE /folders/:id → withWorkspace, delete folder + update project`). Quand la route délègue à
un **helper importé** → carte **vide** (0 effet). **La valeur = la couverture.** Le MÊME chantier
(couverture, helpers importés, faux positifs) débloque à la fois la sécu ET le comportement-pour-
agents. Une pierre, deux marchés. Pas de magie qui contourne ce travail.

---

## LA PROJECTION HONNÊTE — si la couverture est réparée et propre

### Où sera SPARDA
Un **compilateur de comportement déterministe, différencié, respecté sur son créneau.** Précis là
où il couvre, honnête sur le reste (soundy — jamais 100%, théorème de Rice). **PAS le roi.** Aucune
exécution propre ne transforme un outil de fondateur solo en leader incontesté du jour au
lendemain. Ça en fait **un acteur crédible et une cible d'acquisition plausible.**

### Ce que diront les autres
- **Le dev pragmatique :** "ça me dit ce qu'une route fait sans lire le code — utile." (utilité réelle)
- **Le chercheur PL/sécu :** "analyse d'effets soundy + résumés + jolie interface agent. Techniques
  connues. Bonne ingénierie, pas de science neuve." (l'avis honnête — tenu toute la session)
- **Le concurrent (Sourcegraph/Snyk) :** "on pourrait l'ajouter à notre graphe." Le moat n'est PAS
  imprenable — les grands POURRAIENT le construire ; ils ne l'ont pas fait. Ton avance = zéro-infra
  + déterminisme + agent-native. Une longueur d'avance, pas un fossé permanent.

### Ce que dira Anthropic
Aligné avec leur mission (agents qui codent sûr) et leur produit (Claude Code). Ils trouveraient ça
**intéressant** : soit une capacité à intégrer (un agent qui interroge des faits déterministes +
prouve ses modifs), soit un **acqui-hire** si la tech + le fondateur sont forts. **Mais** ils
peuvent aussi le **construire** eux-mêmes. Le calcul "acheter vs construire" penche vers "construire"
SAUF si (a) la tech est démontrablement dure à répliquer, (b) le fondateur est exceptionnel, (c)
c'est plus rapide d'acheter. **À l'état actuel (solo, 0 traction), ils ne viendront pas frapper
seuls.** Il faut une démo qui claque + de la visibilité pour déclencher la conversation.

### Les statistiques (honnêtes, conditionnées à "couverture réparée")
- Devenir un outil respecté et différencié dans l'espace agent-code : **~60-70%** (si l'exécution
  suit — la couverture est le vrai combat).
- Devenir "le roi / leader de catégorie" : **~10-15%** (le leadership demande distribution +
  adoption qu'un solo atteint rarement seul).
- Acquisition (acqui-hire par Anthropic/Cursor/GitHub/Snyk) sur ~2 ans : **~15-25% AVEC visibilité
  et une démo prouvée** ; **~0 sans visibilité.**
- Base rate brute "outil de fondateur solo → acquisition" : quelques % seulement. Ta différenciation
  te met **au-dessus** de la base rate, sans garantie.

### La variable qui décide de tout
Partout ci-dessus, le facteur n'est **jamais l'idée** — c'est **l'exécution + la visibilité.** La
thèse est bonne. Le résultat dépend de la réparer proprement et de la montrer aux bonnes personnes.

---

## Garde-fou

Ne jamais dire "révolutionnaire", "seul au monde", "le roi". Dire : *"le seul compilateur de
comportement déterministe que l'agent peut interroger — précis là où il couvre, honnête sur le
reste."* Vrai, différencié, et ça survit à la due diligence. C'est ça qui gagne, pas l'hyperbole.
