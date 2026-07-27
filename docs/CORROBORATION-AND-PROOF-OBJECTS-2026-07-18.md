# Ce qu'on garde de "l'Oracle hétérogène" — deux idées, reformulées saines

> **Date :** 2026-07-18 · **Auteur :** session Claude, tri au scalpel d'un MLD "godmode"
> soumis par Zak. **Pour Fable / toute session moteur.**
>
> **Verdict sur le document source :** 80% est soit déjà construit (blindspot ledger =
> `src/ubg/blindspots.js` ; fuzzing-du-vérificateur = `tests/mutation/run.mjs` ; tiers de
> confiance = `verifiedVia`), soit toxique pour le cœur (vote pondéré → faux PROVEN ;
> 5-7 moteurs externes → viole la règle 8 + Loi 1 ; traduction inter-logiques → SPARDA a
> une seule logique). **Ne PAS implémenter l'architecture du document.** Deux instincts
> valent l'or ; ils sont reformulés ci-dessous en versions qui RENFORCENT la soundness au
> lieu de la trahir.

---

## Idée 1 — Corroboration (la version SAINE du "parlement de preuves")

**Le piège du document.** Il propose un vote : N moteurs votent, poids = `trust × confidence`,
`consensus > 0.75 → CERTIFIED`. C'est un faux PROVEN par construction : une majorité
d'heuristiques n'est pas une preuve. Ça retourne l'invariant n°1.

**La reformulation saine.** Ne pas voter — **exiger l'accord, traiter le désaccord comme un
blindspot.** SPARDA résout déjà une garde par plusieurs voies indépendantes :
- structurelle (marche AST → un `deny` prouvé) → `meta.verified = true`
- guidée-LLM, vérifiée après coup (`src/ubg/llm-resolve.js`) → `verifiedVia: 'llm-guided'`
- (à venir possible) rejeu de vol runtime (`timeless`/flight) → une garde OBSERVÉE en train de refuser

Aujourd'hui ces voies ne font que s'ajouter. La corroboration les fait **se contrôler** :

| Voies concordantes | Verdict de la garde |
|---|---|
| ≥2 voies indépendantes prouvent le même `deny` | `verified` **corroboré** (le plus fort) |
| 1 seule voie prouve | `verified` (inchangé, actuel) |
| Deux voies se **contredisent** (l'une prouve deny, l'autre prouve reachable sans garde) | **PAS verified → blindspot `contradiction`**, jamais tranché par vote |

**Ce que ça change, mesurable.** Un nouveau champ `corroboratedBy: ['structural','llm-guided']`
sur les nœuds guard. Un nouveau type de blindspot `contradiction` dans `blindspots.js`. Le
verdict ne monte JAMAIS grâce à la corroboration (un `verified` reste `verified`) — mais une
**contradiction fait DESCENDRE** un PROVEN vers PARTIAL/blindspot. C'est la seule direction
saine : la corroboration ne peut que resserrer, jamais gonfler. Métrique : nombre de
contradictions détectées sur le corpus (aujourd'hui = 0 car non mesuré ; toute valeur > 0 est
un faux PROVEN qu'on attrapait pas). Fichier : `src/ubg/apocalypse.js` (verdictOf), extension
de `src/ubg/blindspots.js`.

**Invariant respecté :** ne fait que SOFTEN (comme E-047). Aucune dépendance nouvelle. Aucun
moteur externe. Le "parlement" devient un jury à l'unanimité-ou-abstention, jamais à la majorité.

---

## Idée 2 — L'objet-preuve vérifiable (la version SAINE du `CERTIFICATE`)

**Le bon instinct du document.** Un `proof_object` avec `certainty_chain` : la preuve comme
objet manipulable et re-vérifiable, pas juste un mot vert. C'est le seul endroit où le document
touche un vrai manque de SPARDA.

**L'état actuel, mesuré.** `apocalypse` émet un VERDICT (`PROVEN`) + des findings avec evidence,
mais un `PROVEN` ne porte pas la **trace de décharge** : *pourquoi* chaque obligation est
satisfaite. Un sceptique doit re-lancer SPARDA pour le croire ; il ne peut pas re-vérifier la
preuve isolément.

**La reformulation saine — un "proof object" déterministe, pas un certificat probabiliste.**
Pour chaque obligation déchargée, émettre (opt-in, `--proof`) l'objet minimal qui la rend
**re-checkable par un tiers sans re-compiler** :

```json
{
  "obligation": "UNGUARDED_MUTATION",
  "route": "DELETE /orders/:id",
  "discharged_by": {
    "guard": "auth",
    "provenance": "verified",
    "corroboratedBy": ["structural"],
    "deny_path": ["entrypoint:DELETE /orders/:id", "guard:auth", "deny:401"]
  },
  "graph_hash": "bh1_…",
  "sparda_version": "0.64.0"
}
```

**Pourquoi c'est fort ET sain :** c'est déterministe (même graphe → même objet, testable comme
une loi `verify`), c'est traçable (le `deny_path` est un chemin réel dans l'UBG, pas une
opinion), et ça transforme "fais-moi confiance, c'est PROVEN" en "voici le chemin exact,
re-vérifie-le". C'est le costly signal ultime pour un acheteur enterprise : la preuve s'audite
sans nous. Aucune traduction inter-logiques (une seule logique SBIR), aucun moteur externe.
Fichier : nouvel émetteur à côté de `toSarif` dans `src/commands/apocalypse.js`, alimenté par
les obligations déjà calculées par `checkGraph`.

**Métrique :** % d'obligations PROVEN qui portent un `deny_path` non vide et re-checkable. Cible :
100% des PROVEN complets. Un PROVEN sans proof object re-vérifiable devient un signal d'alarme
interne (comme un `verified` sans provenance).

---

## Ce qu'on jette explicitement (pour qu'aucune session ne le reprenne)

- ❌ **Vote pondéré / `consensus_strength → CERTIFIED`** — faux PROVEN par construction. Violé n°1.
- ❌ **Z3/KLEE/angr/Infer/Frama-C embarqués** — viole règle 8 (4 deps) + Loi 1 (zéro infra).
- ❌ **Cloud spot $100-500/mois** — l'anti-thèse du produit.
- ❌ **CERTIFICATE_TRANSLATION inter-logiques** — SPARDA a une seule logique ; rien à traduire ;
  claim de nouveauté factuellement faux (Dedukti, PCC existent).
- ❌ **Framing "godmode / 🜏 / jamais construit"** — échoue à la barre d'honnêteté de
  `DECISIONS.md:432`. Le produit vend l'honnêteté ; ce ton la sabote.

> Règle de tri appliquée : on ne garde une idée que si elle RENFORCE la soundness (softening
> only), n'ajoute AUCUNE dépendance, et n'introduit AUCUNE infra. Les deux idées retenues
> passent les trois ; tout le reste échoue à au moins une.
