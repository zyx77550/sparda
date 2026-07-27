# SPARDA expliqué — le document du fondateur

> Fichier personnel, en français, pour (re)comprendre tout le projet en 10
> minutes : la douleur, la solution, le moteur, le business, le vocabulaire.
> Version publique détaillée (anglais) : [`EXPLAINER.md`](EXPLAINER.md).

---

## 1. La douleur qu'on règle (à raconter en premier, toujours)

Les IA savent **écrire du code**, mais elles ne savent pas **se servir des
applications**. Claude voit les *fichiers* d'un projet, pas le *produit qui
tourne* : il peut modifier la fonction `createOrder`, mais il ne peut pas
créer une commande, vérifier un vrai client, ou voir pourquoi la prod plante.

Pour donner ce pouvoir à une IA aujourd'hui, un développeur doit : écrire une
spec OpenAPI, coder un serveur MCP, l'héberger, le sécuriser, le maintenir
synchronisé à chaque changement de route… **des jours de travail par projet**,
et la peur permanente que l'IA fasse un `DELETE` au mauvais endroit.

**SPARDA remplace tout ça par une commande.** Trois minutes, et l'app devient
pilotable par l'IA — sans risque d'écriture, sans compte, sans serveur à
héberger, et réversible au byte près.

## 2. Comment ça marche (l'image simple)

Pense à une **prise électrique** qu'on installe *à l'intérieur* de la maison,
pas un câble tiré depuis la rue :

1. **`init`** — SPARDA lit le code de l'app (analyse AST, pas d'exécution),
   trouve toutes les routes, et injecte un petit bloc marqué dans l'app :
   le **router** (`/mcp`). C'est la prise. Tout est réversible (`remove`).
2. **`dev`** — le **bridge** se lance et fait le traducteur entre l'IA
   (protocole MCP) et la prise. L'IA voit chaque route comme un **outil**
   qu'elle peut appeler.
3. L'appel passe **dans le vrai process de l'app** : vraies données, vraie
   auth, vraie base. Pas une simulation.

Trois protections par défaut : les **écritures sont verrouillées** (tu les
actives une par une), une **clé locale** protège la prise, et les docstrings
suspectes sont **purgées** avant d'atteindre l'IA (anti-manipulation).

## 3. Notre position imbattable (le « pourquoi nous »)

Tous les concurrents convertissent une *spec* depuis l'**extérieur**. Nous, on
vit **à l'intérieur du process**. Conséquences que personne ne peut copier :

| Ressource | D'où elle vient | Coût |
|---|---|---|
| Calcul | cycles libres du process hôte | 0 |
| Intelligence | le LLM du client, via MCP *sampling* | 0 |
| Stockage | `sparda.json` + git | 0 |
| Persistance | commits git | 0 |

**Zéro infra, zéro budget — par construction.** Et la règle d'or qui protège
tout : *l'hôte ne paie jamais pour l'intelligence de SPARDA ; on ne dépense
de l'énergie que sur la surprise.*

## 4. Le moteur : les 4 rounds (la vision en une ligne chacun)

- **R1 — 🧬 L'immunité** *(construit, v0.3)* : l'app apprend son « soi »
  (latences, statuts), met en **quarantaine** les routes cassées, fait
  diagnostiquer les pannes nouvelles par le LLM du client et garde le
  diagnostic en **anticorps** — la même panne plus tard coûte zéro token.
- **R2 — ⚡ Le condensateur** *(à venir)* : observer les enchaînements
  d'appels répétés et les **cristalliser en nouveaux outils** que personne
  n'a écrits. Créer ce qui n'existe pas à partir de ce qui existe.
- **R3 — 🔮 L'organisme prédictif** *(horizon)* : prédire au lieu de réagir —
  détecter le code mort, reconstruire un **jumeau** de l'app pour tester sans
  risque, faire évoluer les workflows pendant que l'app « dort ».
- **R4 — 🥑 Le Noyau** *(transverse)* : ne jamais refaire un calcul déjà fait.
  Classer les routes **pures** (recyclables à l'infini) vs **effaçantes**,
  compter ce qu'on économise (le **compteur**, brique n°1), distiller tout
  l'appris en une **graine** qui fait tout regermer.

Le fil rouge : plus l'app vit avec SPARDA, plus elle devient intelligente —
et **copier le code ne copie pas la mémoire**. C'est notre fossé.

## 5. Le business : trois étages

- **🆓 Gratuit** = la puissance individuelle (init, bridge, sémantique,
  immunité de base). *Le produit gratuit EST le marketing.*
- **💰 Shadow stable** = la confiance en équipe : essai à blanc des écritures,
  boîte noire signée (audit), mesh multi-apps, politiques d'accès, support.
- **🧪 Shadow Labs** = les organes vivants (R2-R4) en bêta, **cases à cocher**,
  opt-in, jauge de consommation visible, auto-désactivation en cas de pépin.

Pipeline : une idée naît dans Labs → mûrit → descend dans Shadow stable → sa
version simple finit parfois gratuite. Licence BUSL 1.1 : code visible, usage
libre, interdiction d'en faire un service concurrent.

## 6. La promesse v1 (ce qu'on peut jurer à 100%)

Trois minutes, une commande, ton app devient pilotable par ton IA — écritures
verrouillées par défaut, app qui se défend seule, rien ne quitte ta machine,
et si tu enlèves SPARDA, il ne reste **pas un byte**. Chaque mot est couvert
par un test en CI. Ce qu'on ne jure PAS : voir `SECURITY.md` (limites
honnêtes) — et ne jamais promettre un % d'économie tant que le compteur ne
le mesure pas.

## 7. Le vocabulaire (pour ne jamais être perdu)

| Mot | Ça veut dire |
|---|---|
| **MCP** | le protocole standard qui connecte les IA aux outils (créé par Anthropic) |
| **Outil (tool)** | une route de ton app, vue par l'IA comme une action appelable |
| **Router** | le bloc injecté dans l'app — la « prise » (`/mcp`) |
| **Bridge** | le traducteur entre l'IA et le router (`sparda dev`) |
| **Sampling** | le serveur demande au LLM *du client* de réfléchir — gratuit pour nous |
| **Elicitation** | demander confirmation à l'humain dans l'UI de son IA |
| **`sparda.json`** | la mémoire de l'organisme : outils, réglages, anticorps |
| **Anticorps** | un diagnostic de panne mémorisé — la récidive coûte zéro token |
| **Quarantaine** | route cassée temporairement bloquée (503 + délai de retry) |
| **`sparda_get_context`** | l'outil que l'IA appelle en premier pour tout savoir de l'app |
| **Carry-over** | tout ce qui survit aux régénérations (clé, réglages, mémoire) |

## 8. Où on en est, et la suite

**Fait** : v0.1 (cœur) + v0.2 (couche de confiance) + v0.3 (immunité) —
25 tests verts, CI verte sur Linux et Windows, la bible documentaire complète.
**Pas fait** : jamais branché à un vrai Claude Desktop (LE verrou), pas encore
publié sur npm, rounds 2-4 conçus mais pas codés.
**L'ordre** : E2E réel → publier → 10 utilisateurs. *Ces trois actions valent
plus que tous les rounds réunis.* État vivant : [`HANDOFF.md`](HANDOFF.md).
