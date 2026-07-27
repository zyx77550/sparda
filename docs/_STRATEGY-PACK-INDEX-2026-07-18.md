# 📍 Point d'entrée — pack de specs stratégiques (2026-07-18)

> Pour Fable. Zak dit "regarde ce que je t'ai laissé" → commence ICI. Ce sont des **specs**
> (pas du code), écrites après un audit terrain sur de vrais géants (dub, n8n), chaque
> affirmation sourcée `file:line` ou mesurée en direct. Tout est ADVISORY-safe : rien ici ne
> peut créer un faux PROVEN — c'est la règle de tri de tout le pack.

## L'ordre de lecture et d'exécution

1. **`FIELD-TEST-AND-GAP-MAP-2026-07-18.md`** — LIS-LE EN PREMIER. Le test terrain sur dub + n8n
   qui a révélé que la majorité des findings critical/advisory sont des **faux positifs** dus à
   3 trous de résolution (G1 ownership, G2 gardes, G3 ORM). Contient la carte OWASP (ce que
   SPARDA ne cherche pas) et la procédure de triage "à la place de l'auteur".

2. **`GUARD-TAXONOMY-CLOSE-THE-CLASS-2026-07-18.md`** — le principe qui ferme G2 définitivement
   (identité vérifiée + portée couvrante), pas une liste de vendeurs. Prérequis d'API2.

3. **`TWO-ADDITIONS-API2-API3-SPEC-2026-07-18.md`** — les deux ajouts validés par Zak :
   API3 mass assignment (codable tout de suite), API2 broken auth (après G2). Advisory-only.

4. **`CORROBORATION-AND-PROOF-OBJECTS-2026-07-18.md`** — deux idées saines tirées d'un MLD
   "godmode" (le reste jeté) : corroboration (accord entre voies, pas vote) + objet-preuve
   re-vérifiable. Renforce la confiance des verdicts.

## Ordre d'implémentation recommandé (par levier)

| Prio | Chantier | Doc | Débloque |
|---|---|---|---|
| 1 | **G1 — enforcement d'ownership** (BolaRay étape 2) | field-test §3 | ~60 faux BOLA dub → ~5 |
| 2 | **G2 — gardes résolues jusqu'au refus** (HOF/décorateurs/jeton/webhook) | guard-taxonomy | 429 unverified n8n → <50 ; 5 UNGUARDED dub → 0 |
| 3 | **API3 — mass assignment** (indépendant, primitives prêtes) | two-additions §1 | nouvelle classe OWASP, signal fréquent |
| 4 | **G3 — cibles ORM TypeORM** | field-test §3 | couverture n8n 65% → 90%+ |
| 5 | **API2 — broken auth** (après G2) | two-additions §2 | expiry/usage-unique des jetons |
| 6 | corroboration + objet-preuve (renfort confiance) | corroboration | verdicts re-vérifiables |

**Prérequis de tout bruit public (cap #1 : une vraie faille démontrée sur un géant) : G1 + G2.**
Tant que le taux de faux positifs est élevé, une démo se fait démolir. Après, ce qui reste en
critical est du vrai signal.

## Déjà livré (contexte)

- `sparda_prove` (outil MCP de preuve live) — mergé dans 0.64, PR #17.
- Décision : zéro paywall, gratuit d'abord (`URGENT-ADOPTION-PLAYBOOK.md`, déjà dans main).
- Idées long terme (cross-repo stitch livré, sparda_prove) — `RESEARCH-AND-10X-IDEAS-2026-07-17.md`.
