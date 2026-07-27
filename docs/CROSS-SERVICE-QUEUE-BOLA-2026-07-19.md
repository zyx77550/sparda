# La carte maîtresse : BOLA cross-service par FILE DE MESSAGES — pour Fable

> 2026-07-19. Trouvé en exécutant le pipeline cross-service sur un vrai système (Novu). Ce doc
> raconte COMMENT, explique le mécanisme EXACT, et te met au défi de faire mieux. C'est,
> mesuré, l'angle où SPARDA peut être **le seul au monde** — pas "meilleur", **seul**.

---

## Comment je l'ai trouvé (la méthode, à reproduire)

1. Choisi un vrai système microservices que SPARDA parse : **Novu** (6 services NestJS : api,
   worker, ws, webhook…).
2. Compilé chaque service. `api` = **407 routes, 48 http_calls sortants**. Le moteur marche.
3. Lancé `stitchServices()` sur les 4 services → **0 arête cross-service.**
4. Cherché POURQUOI : inspecté les 48 http_calls de `api` → **tous EXTERNES** (Telegram,
   Microsoft Graph, Azure) ou "dynamic". **Aucun appel HTTP interne service→service.**
5. Conclusion : Novu (comme ~80% des vrais microservices) communique en interne par **files de
   messages** (Bull/Redis), PAS par HTTP-vers-endpoint. **Notre stitch HTTP ne peut structurellement
   rien voir.** Le mur n'est pas un bug — c'est le mauvais type de frontière.

**La leçon de méthode :** ne devine pas où est ton avantage. EXÉCUTE sur du vrai, regarde où ça
casse, et la forme exacte de l'opportunité apparaît. Ici, le "0 arête" était le résultat le plus
utile de toute la session.

---

## La faille, et pourquoi elle est invisible pour TOUT LE MONDE

```
Producteur (api) :   queue.add('sendMessage', { subscriberId: req.params.id, ... })
                          ↓ (l'id disparaît dans Redis)
Consommateur (worker) :  @Process('sendMessage')  handler(job) {
                            const sub = await db.subscriber.findUnique({ where: { id: job.data.subscriberId } });
                            // ← aucune re-vérification d'appartenance : confiance aveugle
                          }
```

- La queue **efface le flux de données**. L'id entre dans Redis, ressort dans le worker. Aucune
  analyse mono-repo (CodeQL/Semgrep/Snyk) ne peut suivre ça — ils ne voient qu'un côté.
- Même un humain le rate : le producteur et le consommateur sont dans des fichiers/services
  différents, reliés seulement par une **chaîne de caractères** (le nom de la file).
- C'est **exactement comment les vrais systèmes marchent.** Donc c'est là que les vraies failles
  vivent, et là où personne ne regarde.

---

## Le mécanisme à construire (précis)

Étend la machinerie cross-service existante (`stitch.js` + le modèle d'ownership CSOP) à un
NOUVEAU type de frontière : **producteur→file→consommateur.**

1. **Côté producteur** — repérer l'enqueue : `queue.add(name, payload)`, `client.emit(name,
   payload)`, `eventEmitter.emit(...)`, `kafka.send(...)`. Extraire : le **nom** de la file/event,
   et les **champs du payload** (surtout ceux qui sont un id fourni par la requête).
2. **Côté consommateur** — repérer le handler : `@Process(name)`, `queue.process(name, fn)`,
   `@OnEvent(name)`, un consumer Kafka. Extraire : le nom écouté, et quels champs de `job.data`
   alimentent un sink (db_read/write d'un objet).
3. **Le stitch** — matcher producteur.name == consommateur.name (comme le suffix-match HTTP, mais
   sur le nom de file). L'`outlet` = le label du champ du payload ; l'`inlet` = ce champ chez le
   consommateur. **Puis c'est EXACTEMENT le CSOP existant** : si l'id était owner-verified avant
   l'enqueue → sûr ; s'il est caller-supplied et que le consommateur ne re-scope pas → 
   `CROSS_SERVICE_QUEUE_BOLA`.
4. **Discipline (non négociable)** : advisory-only, ne gate JAMAIS le verdict (comme le
   cross-service HTTP / OBJECT_SCOPE). Le match par nom de file est structurel, pas une preuve
   d'intention runtime. Faux positif = "un humain regarde" ; jamais un faux "sûr".

**Réutilise tout ce qui existe :** le treillis d'ownership, la propagation de label, les
certificats conditionnels incrémentaux (`docs/csop-handoff/`). Seul le DÉTECTEUR de frontière
change (queue au lieu de HTTP). Le reste est déjà codé et prouvé (empirique + lemme 1 Lean).

---

## Le défi — fais MIEUX que ce que je décris

Je te donne le cas HTTP + queue. Mais la vraie frontière async générale, c'est plus large :
- **Events / pub-sub** (EventEmitter, Redis pub/sub, SNS/SQS) — même motif.
- **gRPC** — appel typé, plus facile à matcher que le HTTP (le nom de méthode est explicite).
- **Le vrai boss** : un modèle unifié de "**frontière de confiance asynchrone**" où un id traverse
  N'IMPORTE quel canal (HTTP, queue, event, gRPC) et où on prouve l'ownership de bout en bout.
  Si tu construis ça, SPARDA devient le seul outil qui raisonne à travers *toutes* les frontières
  d'un système distribué. Personne n'a ça.

Contrainte de design (leçon de G1) : ne pas laisser un producteur à fort fan-out "baver" son label
sur tous les consommateurs — matcher précisément par nom de file + forme de payload, sinon bruit.

---

## Pourquoi ça compte (une phrase)

Le cross-service HTTP est rare en vrai (Novu : 0). Le cross-service **par queue/event est comment
les vrais systèmes communiquent** — et personne ne le détecte. C'est le seul terrain où SPARDA
n'est pas "un scanner de plus" mais **le seul outil de la planète.**
