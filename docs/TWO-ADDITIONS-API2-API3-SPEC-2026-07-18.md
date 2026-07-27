# Les deux ajouts : API3 (mass assignment) + API2 (auth cassée) — spec pour Fable

> **Date :** 2026-07-18 · **Pour Fable.** Validé par Zak. Les "deux choses à ajouter" sont les
> deux classes OWASP API que SPARDA ne cherche pas encore et qui découlent des primitives déjà
> présentes (cf. `FIELD-TEST-AND-GAP-MAP-2026-07-18.md`).
>
> **Discipline non négociable (comme partout) :** ces deux règles sont **absence-based** et
> donc sujettes aux faux positifs → elles sont **ADVISORY** (comme `OBJECT_SCOPE_UNPROVEN`) :
> elles ne GATENT jamais le verdict (`safe`), elles pointent un humain. Elles ne peuvent JAMAIS
> créer un faux PROVEN — au pire un faux "à vérifier". Même posture que BOLA (ADR-058).

---

## Faisabilité (mesurée dans le code, 2026-07-18)

Le graphe expose déjà ce qu'il faut :
- `ep.meta.inputValidated` (bool) — l'entrypoint valide-t-il son input (Zod/schema) ? (`apocalypse.js:146`)
- les nœuds `state` portent `meta.columns[].name` et `meta.invariants` (`apocalypse.js:456`).
- chaque write est `{ effect, stateId }` reliant une route à la table mutée.

→ **API3 est implémentable MAINTENANT** avec ces primitives.
→ **API2 dépend de G2** (reconnaître les gardes-jeton d'abord) — spec ci-dessous, mais ne pas
   commencer avant que G2 émette des gardes typées `token-principal`.

---

## AJOUT 1 — API3 : Mass Assignment / BOPLA (implémentable tout de suite)

**Le bug réel.** Une route écrit une table depuis un body **non filtré**, et cette table
contient une colonne **privilégiée** (celle qui donne un droit ou une appartenance). Un
attaquant ajoute `{"role":"admin"}` ou `{"workspaceId":"autre"}` au body → escalade. C'est
l'OWASP API3, une des failles les plus fréquentes et les plus discrètes.

**La règle (saine).** Émettre l'advisory `MASS_ASSIGNMENT_UNPROVEN` quand :
1. la route a un write vers une table `T`, ET
2. `T.meta.columns` contient au moins une **colonne privilégiée** (liste ci-dessous), ET
3. `ep.meta.inputValidated === false` (le body entre sans schéma qui filtre les clés).

```
severity: 'info'            // advisory, ne gate jamais (comme OBJECT_SCOPE_UNPROVEN)
rule: 'MASS_ASSIGNMENT_UNPROVEN'
message: `${ep.label} writes ${T} which has privileged column(s) ${cols} from unvalidated
          input — a request body could set a field it should not (mass assignment / BOPLA)`
```

**Colonnes privilégiées (heuristique, à raffiner en constante partagée) :**
`role|roles|isadmin|admin|issuperuser|superuser|permission|permissions|scope|scopes|plan|tier|
credits|balance|ownerid|userid|workspaceid|teamid|orgid|emailverified|verified|status|enabled|
isactive|banned`
— regroupe deux familles : **privilège** (role/admin/plan/credits) et **appartenance**
(ownerId/workspaceId — écrire ça = se réassigner la propriété).

**Anti-faux-positif (important).** La règle ne fire QUE si `inputValidated === false`. Une route
qui valide par un schéma Zod qui *pick* explicitement ses champs est déjà safe → pas d'advisory.
Raffinement v2 (quand le graphe portera les champs du schéma) : fire même si validé MAIS si le
schéma inclut une colonne privilégiée. v1 = `inputValidated===false` suffit et est sain.

**Où :** un nouveau bloc `findings.push` dans `checkGraph` (`src/ubg/apocalypse.js`), même boucle
que O2 (`UNVALIDATED_CONSTRAINED_WRITE`, l.138-152) — il a déjà `writes` + les colonnes de table.

**Mesure :** re-run dub/n8n → compter les `MASS_ASSIGNMENT_UNPROVEN`, en vérifier 5 à la main
(vrai champ sensible atteignable vs faux positif). Cible : précision > 70% sur l'échantillon.

**Tests :** fixture `ubg-mass-assignment` (une route qui `update` une table avec colonne `role`
depuis `req.body` sans schéma → advisory ; la même avec un Zod qui pick `{name}` → pas d'advisory)
+ un mutant dans `tests/mutation/run.mjs` (retirer la règle → l'advisory disparaît).

---

## AJOUT 2 — API2 : Broken Authentication (dépend de G2)

**Le bug réel.** Une garde-jeton existe mais est **cassée** : jeton sans expiration, ou rejouable
(pas d'usage unique), ou vérifié sans invalidation. Un lien de reset qui n'expire jamais = un
compte compromis à vie. C'est OWASP API2.

**Pré-requis :** G2 (`GUARD-TAXONOMY-CLOSE-THE-CLASS`) doit d'abord émettre des gardes typées
`token-principal` / `stored-token` (familles B/C). **Sans ça, il n'y a rien dont vérifier
l'expiry** — ne pas commencer avant.

**La règle (saine), une fois G2 là.** Émettre `WEAK_TOKEN_AUTH` (advisory) quand une garde de
type `stored-token` (famille C : lookup DB d'un `*token*`) est sur le chemin MAIS le lookup
**n'inclut pas** de contrainte d'expiration (`expires`/`expiresAt`/`ttl` dans le `where`) OU la
route ne **supprime/invalide pas** le jeton après usage (pas de `delete`/`update used=true` sur
la table jeton).

```
severity: 'info'            // advisory
rule: 'WEAK_TOKEN_AUTH'
message: `${ep.label} authenticates via a stored token but the lookup has no expiry check
          (replayable) ` | `... and never invalidates the token after use (reusable)`
```

**Signal structurel (réutilise ce que G2 aura construit) :**
- expiry : le `where` du lookup de la table-jeton contient une clé `expires|expiresAt|validUntil`.
- usage-unique : un effet `delete`/`update` sur la même table-jeton existe sur le chemin après la vérif.

**Référence concrète (déjà vue dans dub, à retourner comme le POSITIF).**
`reset-password` FAIT les deux correctement : `findFirst({ token, expires: { gt: now } })` +
`$transaction([deleteMany token, update user])`. C'est le modèle de ce qui doit passer ; la règle
fire sur ceux qui NE le font pas. → écrire la fixture à partir de ce vrai exemple (version saine
= pas d'advisory ; version sans `expires` = advisory ; version sans delete = advisory).

**Où :** bloc `findings.push` dans `checkGraph`, conditionné à la présence d'une garde typée
`stored-token` (donc après G2).

**Mesure :** re-run corpus → `WEAK_TOKEN_AUTH` ne fire PAS sur `reset-password` (le bon élève),
fire sur une fixture volontairement cassée.

---

## Ordre d'exécution recommandé

1. **API3 maintenant** (indépendant, primitives prêtes, gros signal fréquent).
2. **G2** (la taxonomy des gardes) — prérequis structurel de beaucoup de choses.
3. **API2 après G2** (sinon rien à vérifier).

**Rappel du garde-fou commun :** les deux sont ADVISORY, jamais gating. Ils ne touchent pas
`verdictOf`/`safe`. Un faux positif ici coûte "un humain regarde une route safe" — jamais "un
vrai trou passe en vert". C'est le seul sens d'erreur acceptable pour un produit qui vend la
preuve.

> Docs liés : `FIELD-TEST-AND-GAP-MAP-2026-07-18.md` (le terrain qui a révélé ces deux classes),
> `GUARD-TAXONOMY-CLOSE-THE-CLASS-2026-07-18.md` (G2, prérequis d'API2).
