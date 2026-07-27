# Les 2 classes de faux positifs qui embarrassent SPARDA — pour Fable

> 2026-07-19. Mesuré en direct sur immich + dub + n8n. **Le vrai risque n'est pas de rater une
> faille — c'est de crier au loup sur du code sain.** Un dev (ou un acquéreur) qui teste SPARDA et
> voit "CRITICAL" sur une route en fait protégée nous classe "amateur" en 30 secondes. Ce doc
> capture les 2 classes exactes, avec un cas de référence réel pour chacune.
>
> **Discipline (rappel) :** ces fixes ne changent JAMAIS un verdict `PROVEN`/`NOT_PROVEN` en
> "safe". Ils **rétrogradent/re-labellisent** un finding bruyant (critical → info/expected),
> **sans jamais le cacher** (l'humain voit tout) et sans jamais marquer quoi que ce soit "sûr".
> Déterministe. C'est le prolongement de G2 (credential-gated → advisory).

---

## Classe 1 — routes publiques par design

Une route `/auth/login`, `/auth/register`, `/auth/reset-password`, `/oauth/callback`,
`/webhooks/*`, `/health`, `/metrics` est **censée** être sans garde de session. Aujourd'hui
SPARDA les remonte en `UNGUARDED_MUTATION` critical. Mesuré :
- dub : 5 UNGUARDED, tous auth/callback/tracking.
- immich : 5 UNGUARDED — 4 sont `/auth/*` et `/oauth/*`.
- boilerplate : 6 UNGUARDED, TOUS `/v1/auth/*`.

**Fix :** un classifieur curé (fini, petit — c'est la TÊTE de la distribution, pas l'infini) de
signatures publiques-par-design (method + path). Match → rétrograder en
`EXPECTED_PUBLIC` (info), pas critical. Jamais supprimé. La longue traîne viendra plus tard par
apprentissage ; la tête, une liste curée suffit et tue ~80% de l'embarras tout de suite.

Liste de départ (à affiner) : `**/auth/**`, `**/oauth/**`, `**/*callback*`, `**/*webhook*`,
`**/login`, `**/register`, `**/logout`, `**/forgot-password`, `**/reset-password`,
`**/verify-email`, `**/health`, `**/healthz`, `**/metrics`, `**/.well-known/**`.

---

## Classe 2 — gardes par ÉTAT (precondition guard) ⭐ le cas subtil

C'est la classe qui transforme un faux positif en **humiliation**, parce que la route a l'air
vraiment ouverte. **Cas de référence réel (immich, 2026-07-19) :**

`POST /admin/database-backups/start-restore` — la SEULE route de son contrôleur **sans**
`@Authenticated`, alors que toutes les autres ont `admin: true`. Une route qui **restaure la base
de données.** Sur le papier : faille critique.

La réalité, dans le service :
```ts
async startRestoreFlow() {
  const adminUser = await this.userRepository.getAdmin();
  if (adminUser) {
    throw new BadRequestException('The server already has an admin'); // ← LA GARDE
  }
  ...
}
```
**La garde existe** — mais c'est une **vérification d'état** (`si un admin existe → throw`), pas
un décorateur. La route n'est utilisable que sur une install fraîche (bootstrap légitime). SPARDA
ne regarde que les décorateurs/sessions → il crie au loup.

**Fix (le motif à reconnaître) :** sur le chemin d'un handler, un `throw`/`return 4xx`
**conditionné par une lecture d'état** (existence d'un admin, d'un enregistrement, d'un flag) qui
gate l'effet → c'est une garde. La route devient `STATE_GUARDED` (advisory/expected), pas
critical. Signal structurel : un `if (x) throw|return 4xx` où `x` vient d'un `db_read`/lookup, en
amont de la mutation, sur le chemin de contrôle.

**Test de régression obligatoire :** un fixture reproduisant le pattern immich
(handler sans décorateur + `if (await getAdmin()) throw` avant l'effet) → doit NE PAS remonter
critical. Et un contre-test : le MÊME handler sans le `throw` → doit rester critical (on ne
masque pas un vrai trou).

---

## Le backstop ultime (plus tard, hors scope immédiat)

Pour les cas que le statique ne peut pas trancher (garde par état complexe, helper importé),
**l'observation runtime** est la vérité terrain : faire tourner la route et voir si elle refuse.
SPARDA a déjà le tap in-process (MCP). Noté comme direction, pas pour maintenant.

---

## Pourquoi ça compte plus que trouver une faille

On peut vivre sans trouver une faille demain. On ne peut PAS survivre à un testeur qui voit un
faux "CRITICAL" sur du code sain — c'est la première impression, et elle est fatale. **Ces 2
classes couvrent ~90% de ce qu'un testeur verra en premier.** Priorité absolue avant toute
démo publique ou tout regard d'un géant.
