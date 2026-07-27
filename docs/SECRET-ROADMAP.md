# 🔒 ROADMAP SECRÈTE — SPARDA (interne, ne pas publier)

> Statut au 2026-07-19. Ce doc trace la carte maîtresse long terme (au-delà de l'adoption
> immédiate). Chaque brique dit : ce que ça apporte, ce qu'il faut pour y arriver, l'état.

---

## Carte maîtresse en une image

```
NIVEAU 1 (produit, maintenant)   → le deploy gate CI + une vraie faille démontrée
NIVEAU 2 (moteur, en cours)      → G1/G2, proof objects, couverture réelle sans faux positifs
NIVEAU 3 (théorème/moat)         → preuve incrémentale cross-service (fait, empirique+Lean partiel)
NIVEAU 4 (carte maîtresse)       → certificats d'autorisation composables & code-privés  ← CE DOC
```

---

## 🎯 NIVEAU 4 — Certificats d'autorisation composables et code-privés (le grand pari)

### Ce que c'est, en une phrase
Chaque service publie un **certificat** (son résumé d'autorisation à la frontière — la fonction
"entrées → verdict/sorties", qui ne révèle **rien** du code). N'importe qui compose ces
certificats pour **prouver qu'un système distribué entier ne fuit pas d'objet (BOLA)**, sans
qu'aucun service ne partage sa source, et de façon **incrémentale** (un service republie
seulement quand son comportement de frontière change).

### Ce que ça apporte (la valeur produit, unique)
1. **Prouver un système de 200 services / 50 équipes que personne ne voit en entier.** Aujourd'hui
   impossible : aucune personne n'a tout le code. Là, on compose les certificats publiés.
2. **Confiance cross-entreprise sans révéler la PI.** Un fournisseur donne son certificat, pas son
   code ; l'intégrateur prouve que le système combiné reste sûr.
3. **Attestation de sécurité re-vérifiable** (pas un PDF de promesse) — un artefact signé, petit,
   que n'importe qui recontrôle.
4. **Rapide à l'échelle** (incrémental) : re-vérifier tout le système à chaque PR sans tout
   recompiler.

### Ce qui existe déjà (à ne pas revendiquer comme neuf)
- Résumés de procédure (procedure summaries) : connu depuis 1981 (Sharir-Pnueli), 1995 (IFDS/IDE).
- Analyse incrémentale interprocédurale : établie (années 90).
- Authentification cross-service par certificat X.509 : connu (mais c'est l'authN, pas la preuve
  d'autorisation d'objet).

### Le sliver potentiellement neuf (à CONFIRMER par recherche académique)
La combinaison précise **autorisation-d'objet + composable + code-privé + incrémental** appliquée
au distribué. Signal préliminaire encourageant (web search 2026-07-19 : non trouvé), **PAS
confirmé** — il faut Semantic Scholar/DBLP + lire les papiers proches (proof-carrying code,
vérification modulaire distribuée, privacy-preserving program analysis) avant toute revendication.

### Ce qu'il faut pour y arriver (étapes, dans l'ordre)
1. **Prérequis moteur (Niveau 2)** : réduire les faux positifs sur du vrai code — surtout le trou
   des helpers importés (G1 phase 2, tenté + annulé car il "bavait" ; contrainte de design notée :
   ne pas injecter les effets des helpers partagés à fort fan-out dans les règles dures par route).
   Sans ça, les certificats encodent du bruit.
2. **Durcir l'adaptateur** SPARDA UBG → format certificat (exposure public/interne inférée du
   déploiement, mapping précis des params transmis).
3. **Format de certificat signé + protocole de publication/composition** (le certificat = la
   fonction conditionnelle totale + signature Ed25519 ; SPARDA a déjà l'infra de signature via la
   collective-immunity).
4. **Recherche de littérature sérieuse** → trancher "trou réel vs déjà pris". Si trou : viser un
   papier appliqué + co-auteur académique. Si pris : le garder comme pure capacité produit.
5. **Preuve formelle du modèle** (Lean) : lemme 1 (semi-treillis) ✅ fait ; reste monotonie du
   certificat, terminaison du point-fixe (Knaster-Tarski via Mathlib), soundness de la réutilisation.
6. **Démonstration sur un vrai système multi-services** + une vraie faille cross-service trouvée.

### État aujourd'hui
- La brique technique sous-jacente (certificat conditionnel + composition incrémentale) : **codée,
  validée empiriquement (20k-10M éditions, 0 faux "sûr"), lemme 1 prouvé en Lean.** Voir
  `docs/csop-handoff/`.
- Le format publiable + code-privé + le protocole cross-org : **pas encore construit.**
- Positionnement : **carte de vision (investisseur / gros client / acquéreur), pas le prochain
  client.** Ne pas construire avant d'avoir prouvé la base sur une vraie faille (Niveau 1).

### Le piège à éviter (rappel discipline)
Ne jamais revendiquer "théorème neuf" ni "révolutionnaire" sans (a) recherche de littérature qui
confirme le trou, et (b) preuve formelle. La valeur ne dépend PAS de l'étiquette théorème — elle
dépend de la capacité produit réelle + d'une faille démontrée.
