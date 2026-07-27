# SPARDA v0.5.0 — Audit complet

## 1. Bugs trouvés

### BUG CRITIQUE #1 — Crash sur `args: null`

**Sévérité :** Critique  
**Comment trouvé :** Test de type confusion systématique — j’ai envoyé toutes les valeurs non-standard possibles pour `args` : `null`, `""`, `{}`, `[]`, `true`, une string.

**Payload :**

```json
{"tool": "get_users_by_id", "args": null}
```

**Résultat :** Le serveur retourne une page HTML 500 avec stack trace complète exposée :

```
TypeError: Cannot read properties of null (reading 'id')
at spardaProof (sparda-router.js:270:13)
```

**Pourquoi c’est grave :** Deux problèmes en un. D’abord, la stack trace interne est exposée à l’appelant — c’est une fuite d’information sur l’architecture interne. Ensuite, le comportement est non géré : le router ne valide pas que `args` est bien un objet avant d’y accéder. Un LLM mal configuré ou un client hostile peut déclencher ça facilement.

**Le serveur survit** grâce au gestionnaire d’erreurs par défaut d’Express, mais le résultat est une réponse HTML au lieu de JSON — cassant pour tout client qui parse la réponse.

-----

### BUG #2 — JSON malformé et body non-objet → HTML 500 avec stack trace

**Sévérité :** Moyenne  
**Comment trouvé :** Même approche — tester les inputs invalides sur le content-type `application/json`.

**Payloads testés :**

```
"hello"          → body valide JSON mais pas un objet
{bad json}       → JSON syntaxiquement invalide
```

**Résultat :** Express retourne une page HTML avec la stack trace du parser `body-parser` :

```
SyntaxError: Unexpected token '"', ""hello"" is not valid JSON
at JSON.parse (<anonymous>)
at createStrictSyntaxError (body-parser/lib/types/json.js:109:10)
```

**Pourquoi c’est grave :** Même problème que le bug #1 — stack trace exposée, réponse HTML au lieu de JSON. Tout client qui s’attend à du JSON plante silencieusement.

-----

### BUG #3 — `require_human` n’est pas bloquant

**Sévérité :** Conceptuelle / Sécurité  
**Comment trouvé :** En activant manuellement les write tools et en les invoquant, j’ai observé que malgré `decision: require_human` dans le proof, l’appel upstream est **quand même exécuté**.

**Comportement observé :**

```json
{
  "upstreamStatus": 200,
  "data": {"id": "zakaria", "credits": 600, "delta": 100},
  "spardingProof": {
    "decision": "require_human",
    "risk": "medium"
  }
}
```

**Pourquoi c’est grave :** La policy `writes: require_human` dans `sparda.json` est documentée comme requérant une confirmation humaine. En réalité elle exécute l’appel et retourne juste un flag dans le proof. Si le LLM ignore le champ `decision` — ce qui peut arriver selon le system prompt — l’opération d’écriture passe sans aucune validation. C’est une fausse promesse de sécurité.

-----

### BUG #4 — `sparda.json` ignoré au re-init

**Sévérité :** UX / Workflow  
**Comment trouvé :** En activant `"enabled": true` sur les write tools dans `sparda.json` puis en relançant `npx sparda-mcp init --yes`.

**Comportement :** SPARDA régénère le router depuis l’AST du code source et remet tous les write tools à `false`, écrasant les modifications manuelles du `sparda.json`.

**Pourquoi c’est grave :** Le workflow pour activer les writes n’est pas documenté clairement. La seule façon découverte est de patcher directement le fichier `sparda-router.js` généré — un fichier marqué “DO NOT EDIT”. Contradiction directe avec les instructions.

-----

### BUG #5 — GET sur `/mcp/invoke` → HTML non-JSON

**Sévérité :** Faible  
**Comment trouvé :** Verb smuggling — tester le endpoint `/invoke` avec GET au lieu de POST.

**Résultat :**

```html
<pre>Cannot GET /mcp/invoke</pre>
```

**Pourquoi c’est grave :** Inconsistance — tous les autres endpoints retournent du JSON même en cas d’erreur, celui-ci retourne du HTML Express brut. Mineur mais cassant pour les clients stricts.

-----

### BUG #6 — Immune system bypass via alternance 500/200

**Sévérité :** Moyenne  
**Comment trouvé :** Test du comportement du compteur `consecutive5xx` en alternant les résultats.

**Comportement :** Un outil qui répond 500/200/500/200/500 n’est jamais quarantainé car le compteur `consecutive5xx` se remet à zéro à chaque réponse < 400. Un service instable qui oscille peut hammerer indéfiniment.

**Résultat du test :**

```
500 call 1: status=500   → consecutive5xx=1
200 call   : status=200  → consecutive5xx=0  ← reset
500 call 2: status=500   → consecutive5xx=1
500 call 3: status=500   → consecutive5xx=2
→ jamais quarantainé
```

-----

## 2. Inventions sous-exploitées

### Le `sparding-proof` — exploité à ~12%

**Ce que c’est :** Un objet de justification structurée retourné au LLM à chaque invocation, expliquant pourquoi un appel a été autorisé, bloqué, ou flaggé.

**Ce qui est sous-exploité :**

Les champs `reversibleHint` et `hasBodyForWrite` sont calculés à chaque appel mais **ne déclenchent aucune action**. Ils existent dans la réponse et c’est tout. Aucun mécanisme ne dit au LLM quoi faire de ces informations. Aucun système n’utilise `reversibleHint: false` pour suggérer un GET préalable. Aucune logique n’utilise l’historique des proofs pour apprendre les patterns d’usage.

Le proof est généré et retourné. Il n’est ni exploité côté serveur, ni guidé côté LLM.

**Pourquoi c’est un problème :** L’invention existe à 100% conceptuellement mais son potentiel réel — faire dialoguer le LLM avec la décision de sécurité — n’est pas du tout activé. Un utilisateur qui installe SPARDA aujourd’hui bénéficie de la sécurité passive (allow/block) mais pas de la couche intelligente.

**Comment y remédier sans donner l’astuce :** Réfléchis à ce que le LLM pourrait faire différemment s’il comprenait le proof, pas juste s’il le recevait.

-----

### La purity classification — exploitée à ~15%

**Ce que c’est :** Un système qui observe les réponses des tools en runtime pour les classifier automatiquement (`pure`, `volatile`, `erasing`, `unknown`) sans aucune configuration manuelle.

**Ce qui est sous-exploité :**

La classification est calculée et stockée dans `SPARDA_PURITY`. Elle est accessible via `/mcp/stats`. C’est tout.

Aucune décision n’est prise à partir de la classification. Un tool `pure` est traité exactement comme un tool `volatile`. La purity n’influence pas le proof, ne change pas le comportement du router, n’est pas exposée dans les tool definitions que voit le LLM. C’est une observation sans conséquence.

De plus, la classification `pure` requiert 3 répétitions identiques — ce qui ne se produit presque jamais en usage réel car la plupart des APIs ont des timestamps, des IDs ou de l’aléatoire dans leurs réponses.

**Pourquoi c’est un problème :** La feature existe dans les stats mais est invisible pour l’utilisateur final et sans effet sur le comportement. Quelqu’un qui installe SPARDA ne sait pas que ce système existe.

**Comment y remédier sans donner l’astuce :** La classification devrait changer quelque chose. Demande-toi ce qu’un LLM ferait différemment s’il savait qu’un tool est `pure` vs `volatile`.

-----

## 3. Avances de marché sous-structurées

### AST → MCP sans config

**Ce que c’est :** SPARDA analyse le code source Express directement pour inférer les tools MCP, sans OpenAPI, sans annotations, sans configuration manuelle.

**Ce qui manque pour en faire une vraie avance :**

La détection des schemas de body est marquée `"schema not statically detected"` sur tous les POSTs. C’est le point le plus visible pour un dev qui teste l’outil — son write tool n’a pas de schema, le LLM ne sait pas quoi envoyer. L’avance technique de l’AST parsing est là, mais elle s’arrête aux path params.

Le support est limité à Express CJS. Fastify, NestJS, Hono, Express ESM ne sont pas supportés. L’avance existe sur un seul framework.

**Pourquoi c’est un problème :** Un dev sur Fastify ou NestJS — qui représentent une part croissante du marché Node.js — ne peut pas utiliser SPARDA aujourd’hui. L’avance est réelle mais son périmètre est trop étroit pour créer un standard.

**Comment y remédier :** L’AST parsing pour les bodies est la priorité #1 technique. Le multi-framework est la priorité #1 adoption.

-----

### Immune system avec latency baseline

**Ce que c’est :** Un système qui apprend la latence moyenne d’un tool et alerte quand un appel est anormalement lent — combiné à la quarantaine sur 5xx consécutifs.

**Ce qui manque pour en faire une vraie avance :**

L’alerte de latence anomalie crée un event dans le log mais **ne fait rien d’autre**. Pas de quarantaine préventive. Pas d’escalade. Pas de signal dans le proof. Le LLM qui appelle un tool en train de devenir lent ne le sait pas.

La quarantaine se lève automatiquement après 60 secondes sans vérification que le service est réellement rétabli. Un service qui redémarre mais reste cassé sera re-quarantainé après 3 nouveaux échecs — mais ces 3 échecs coûtent des appels réels.

**Comment y remédier :** Réfléchis à ce qui devrait se passer quand la latency anomaly est détectée, et à comment vérifier qu’un service est vraiment rétabli avant de lever la quarantaine.

-----

## Résumé

|Item                                 |Type     |Sévérité                    |
|-------------------------------------|---------|----------------------------|
|`args: null` crash + stack trace     |Bug      |Critique                    |
|JSON invalide → HTML 500             |Bug      |Moyenne                     |
|`require_human` non bloquant         |Bug      |Sécurité                    |
|`sparda.json` ignoré au re-init      |Bug      |UX                          |
|GET `/invoke` → HTML                 |Bug      |Faible                      |
|Immune bypass 500/200                |Bug      |Moyenne                     |
|`sparding-proof` sous-exploité       |Invention|12% activé                  |
|Purity classification sans effet     |Invention|15% activé                  |
|AST parsing limité aux path params   |Avance   |Périmètre étroit            |
|Immune system sans action sur latency|Avance   |Observation sans conséquence|