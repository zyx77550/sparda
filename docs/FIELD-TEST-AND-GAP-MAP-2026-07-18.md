# Test terrain sur deux géants + carte des trous — pour que Fable bosse sur TOUT

> **Date :** 2026-07-18 · **Pour Fable / session moteur.** Méthode demandée par Zak : tester
> en long et en large sur de vraies apps géantes, **lire le code comme si on l'avait écrit**
> pour classer chaque finding (vrai bug vs faux positif ET pourquoi), et croiser avec les
> classes de bugs que la plupart des apps rencontrent (OWASP API Top 10) pour trouver ce que
> SPARDA **ne cherche même pas**. Tout ci-dessous est mesuré en direct (SPARDA lancé sur les
> repos) ou lu dans le vrai source, jamais deviné.

---

## 1. Ce que le test a donné (mesuré 2026-07-18)

Deux géants, deux frameworks/patterns d'auth volontairement différents :

| App | Framework | Routes | Couverture | Verdict | Findings | Blindspots |
|---|---|---|---|---|---|---|
| **dub** | Next.js (auth par HOF `withWorkspace`) | 580 | 99% | NOT_PROVEN | 5 UNGUARDED + 26 NON_ATOMIC + 61 UNVALIDATED + 60 BOLA-advisory | — |
| **n8n** | NestJS (auth par décorateurs `@GlobalScope`/`@ProjectScope`) | 494 | 65% | NOT_PROVEN | 19 UNGUARDED + 2 IRREVERSIBLE | 579 (dont **429 unverified-guard**, 110 blind-mutation, 40 opaque-target) |

**Verdict des deux : NOT_PROVEN — mais pour des raisons majoritairement FAUSSES.** Vérification
manuelle du vrai source ci-dessous.

---

## 2. Classement des findings — vrais bugs vs faux positifs (lu dans le source)

### dub — les 5 "UNGUARDED_MUTATION critical" → **faux positifs** (cf. doc guard-taxonomy)
Routes publiques par design protégées par un mécanisme non-modélisé : jeton de reset stocké
(`reset-password`), jeton d'unsubscribe signé (`notification-preferences`), tracking rate-limité
(`track/application`), signatures de webhook (`paypal/callback`, `platforms/callback`).
→ traité par `docs/GUARD-TAXONOMY-CLOSE-THE-CLASS-2026-07-18.md`.

### dub — les ~60 "OBJECT_SCOPE_UNPROVEN" (BOLA) → **majoritairement faux positifs** ⭐ le plus gros
Exemple vérifié ligne à ligne : `DELETE /api/customers/:id`
(`app/(ee)/api/customers/[id]/route.ts:152`) :
```ts
export const DELETE = withWorkspace(async ({ workspace, params }) => {
  await prisma.customer.delete({
    where: { workspaceId: workspace.id, id: params.id }   // ← scope PROUVÉ
  });
});
```
La suppression est scopée au workspace de l'appelant (`workspaceId: workspace.id`). C'est
correctement protégé. SPARDA a bien vu la garde (sinon UNGUARDED, pas BOLA) mais **n'a pas
connecté que le `where` lie l'id de la requête À l'identité de l'appelant** — donc il crie BOLA.
C'est **exactement l'étape 2 de BolaRay** que le HANDOFF marque comme "open work" : suivre la
liaison clé-de-groupe à travers le `where`/le wrapper d'auth.

### n8n — 429 "unverified-guard" → **même classe, autre forme**
n8n garde ses routes par décorateurs de scope (`@GlobalScope('workflow:delete')`,
`@ProjectScope`). SPARDA les voit **par leur nom** mais ne prouve pas qu'ils **refusent**
vraiment (le deny vit dans un handler de décorateur/middleware global qu'il ne résout pas). D'où
429 gardes "de confiance mais non prouvées". Ce ne sont pas des trous — c'est SPARDA qui n'a pas
suivi la machinerie du décorateur jusqu'au refus réel.

### n8n — 110 "blind-mutation" → **trou de résolution ORM**
n8n mute via des repositories TypeORM (`this.workflowRepository.delete(...)`). La cible de la
mutation n'est pas toujours résolue → la mutation est "aveugle". Coverage 65% (vs 99% sur dub)
vient en grande partie de là.

**Bilan honnête du terrain :** sur ces deux géants, la **grande majorité** des signaux critical/
advisory sont des **faux positifs** dus à 3 trous de résolution, PAS à de vrais bugs. C'est la
raison n°1 pour laquelle on ne peut pas encore faire de bruit (cap #1). Fermer ces 3 trous
transforme le bruit en signal.

---

## 3. Les 3 trous de résolution à combler (par ordre de levier)

| # | Trou | Ce qu'il tue | Où dans le code | Preuve |
|---|---|---|---|---|
| **G1** | **Enforcement d'ownership (BolaRay étape 2).** Prouver qu'un `where` lie l'id-requête à la clé d'identité de l'appelant (`workspaceId: workspace.id`, `userId: session.user.id`) | ~60 faux BOLA sur dub · une partie des 429 unverified-guard n8n | `src/ubg/apocalypse.js` (OBJECT_SCOPE_UNPROVEN + `inferOwnershipModel`) — connecter le principal de l'identité à la clé du `where` | `DELETE /api/customers/:id` lu ligne à ligne |
| **G2** | **Résolution des gardes jusqu'au refus réel** : HOF-wrappers (`withWorkspace`), décorateurs de scope (`@GlobalScope`/`@ProjectScope`), + les familles jeton/webhook/cron du doc taxonomy | 429 unverified-guard n8n · 5 UNGUARDED dub | `src/ubg/extract.js` (`isGuardLike`, bare-call following v0.50) + `src/ubg/nestjs.js` (décorateurs) | `@GlobalScope` vu mais non prouvé denier |
| **G3** | **Résolution de cible ORM manquante** : repositories TypeORM (`repo.delete/update`) + patterns d'accès n8n | 110 blind-mutation n8n · fait monter la couverture 65→90%+ | `src/ubg/extract.js` (résolution d'effets/tables) | 110 blind-mutation mesurés |

> G1 est le plus fort levier : c'est un vrai différenciateur (personne ne prouve l'ownership
> cross-`where`) ET la première source de faux positifs. G2 fait tomber le bruit n8n. G3 monte
> la couverture, donc réduit les PARTIAL.

---

## 4. Ce que SPARDA ne cherche même PAS — carte OWASP API Top 10 (2023)

"Consulter les bugs que la plupart des apps rencontrent" = le référentiel OWASP API. État réel :

| Classe OWASP API | SPARDA aujourd'hui | Action |
|---|---|---|
| **API1 BOLA** (objet d'autrui) | ⚠️ partiel (advisory, étape 2 manquante) | **G1** ci-dessus |
| **API2 Broken Authentication** (auth cassée sur les routes d'auth : jeton sans expiry, reset rejouable) | ❌ non modélisé | **Candidat "chose à ajouter" #1** — vérifier que les jetons de capacité ont expiry + usage unique |
| **API3 BOPLA / Mass Assignment** (écrire un champ qu'on ne devrait pas : `role`, `isAdmin` via body) | ⚠️ partiel (UNVALIDATED_CONSTRAINED_WRITE ≈ contraintes DB, pas mass-assignment) | **Candidat "chose à ajouter" #2** — flaguer un `update` qui écrit un champ sensible (`role`, `plan`, `ownerId`) depuis un body non filtré |
| **API4 Unrestricted Resource Consumption** (pas de rate-limit) | ❌ non | futur — détecter l'absence de `ratelimit` sur une route coûteuse |
| **API5 Broken Function Level Auth** (route admin atteignable par non-admin) | ⚠️ partiel (garde vue, rôle non modélisé) | lié à G2 — modéliser le NIVEAU de la garde (admin vs user) |
| **API6 Sensitive Business Flows** | ❌ non | futur |
| **API7 SSRF** (l'app fetch une URL fournie par l'utilisateur) | ❌ non | futur — un effet `http` dont l'URL vient du body |
| **API8 Security Misconfiguration** (CORS `*`, headers) | ❌ non | futur |
| **API9 Improper Inventory** (routes fantômes/dépréciées) | ⚠️ SPARDA voit TOUTES les routes → atout latent | valoriser : "voici les routes que tu as oubliées" |
| **API10 Unsafe Consumption** | ❌ non | futur |

**Les deux "choses à ajouter" que Zak veut sont naturellement API2 et API3** (Broken Auth =
expiry/usage-unique des jetons ; Mass Assignment = écriture d'un champ sensible depuis le body).
Elles sont proches des obligations existantes et découlent des mêmes primitives (identité +
portée + champs écrits). À confirmer avec Zak avant de coder.

---

## 5. Comment "agir comme si on avait construit dub/n8n" (le mental model de vérification)

Pour classer un finding sans se tromper, se mettre à la place de l'auteur et poser 3 questions
dans l'ordre — c'est la procédure que j'ai appliquée ci-dessus, à coder comme checklist de triage :

1. **Cette porte est-elle censée être publique ?** (callback, webhook, reset, tracking, signup)
   → si oui, chercher la protection ALTERNATIVE (jeton, signature, rate-limit) avant de crier.
2. **S'il y a une garde, d'où vient l'identité, et le `where` la ré-utilise-t-il ?**
   → `withWorkspace`/`@ProjectScope` → l'identité est `workspace.id`/`project.id` → est-elle
   dans le `where` de la mutation ? Si oui → scopé, pas de BOLA.
3. **Que mute exactement la route, et cette table a-t-elle un propriétaire ?**
   → table possédée (user/workspace) sans scope = vrai trou ; journal append-only = non-sujet.

C'est la même logique que la taxonomy (identité vérifiée + portée couvrante). Ce doc en donne
la **preuve terrain** sur deux frameworks.

---

## 6. La liste de travail pour Fable (ce qu'il trouve en "regardant ce que je lui laisse")

Dans l'ordre de levier, chaque item est mesurable (re-run dub/n8n, compter les faux positifs) :

1. **G1 — enforcement d'ownership (BolaRay étape 2).** Cible : faux BOLA sur dub 60 → ~5.
2. **G2 — gardes résolues jusqu'au refus** (HOF + décorateurs + familles jeton/webhook/cron de
   `GUARD-TAXONOMY-CLOSE-THE-CLASS`). Cible : unverified-guard n8n 429 → <50 ; UNGUARDED dub 5 → 0.
3. **G3 — cibles ORM TypeORM/repository.** Cible : couverture n8n 65% → 90%+.
4. **API2 (Broken Auth)** — jetons de capacité : exiger expiry + usage-unique. *(à ajouter, valider)*
5. **API3 (Mass Assignment)** — flaguer l'écriture d'un champ sensible depuis un body non filtré.
   *(à ajouter, valider)*
6. **API9 (atout latent)** — "routes que tu as oubliées" : SPARDA voit tout, personne d'autre non.

**Prérequis de tout bruit public (cap #1) : G1+G2 faits.** Tant que le taux de faux positifs
critical/advisory est élevé, une démo sur un géant se fait démolir. Après G1+G2, ce qui reste
en critical est du vrai signal — et là on relance dub/n8n/cal.com pour chercher LE vrai bug.

> Docs liés : `GUARD-TAXONOMY-CLOSE-THE-CLASS-2026-07-18.md` (le principe pour G2),
> `CORROBORATION-AND-PROOF-OBJECTS-2026-07-18.md` (renforcer la confiance des verdicts),
> `RESEARCH-AND-10X-IDEAS-2026-07-17.md` (sparda_prove, cross-repo, les paris long terme).
