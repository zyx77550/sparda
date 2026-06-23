# SPARDA 0.5.3 — Réponses d'Évaluation Complète

**Inspecté par** : Claude (agent d'inspection), via lecture directe du dépôt local + API GitHub.
**Dépôt** : `https://github.com/zyx77550/sparda` — branche `main` + branche `claude/sparda-functionality-benchmarks-b6jh32`.
**Date d'inspection** : 2026-06-23.
**Version inspectée** : 0.5.3 (`package.json`).

> Convention : « Non trouvé dans le dépôt » = absence vérifiée. Les chemins de fichiers sont cités tels quels.

---

## SECTION A — IDENTITÉ DU PROJET

| # | Question | Réponse |
|---|----------|---------|
| A1 | Nom exact + version | **SPARDA**, package npm **`sparda-mcp`**, version **0.5.3** (`package.json`). |
| A2 | URL du dépôt | `https://github.com/zyx77550/sparda` (public). |
| A3 | Licence | **Business Source License 1.1 (BUSL-1.1)** — `LICENSE`, Licensor « Residual Labs ». Libre d'usage (y compris production) ; interdit de revendre ou d'offrir SPARDA comme service commercial concurrent ; chaque version passe en Apache-2.0 4 ans après sa sortie. *Note : GitHub détecte la licence comme « Other / NOASSERTION ».* |
| A4 | Date de création / 1er commit | Dépôt créé le **2026-06-15** (GitHub). Premier commit : **2026-06-16** — `Initial public release — SPARDA open core (BUSL-1.1)`. |
| A5 | Auteur / mainteneur | **Residual Labs** (residual-labs.fr) ; unique committer GitHub **`zyx77550`** (`CODEOWNERS` le désigne propriétaire de `.github/`, `package.json`, `templates/`, `src/server/`). |
| A6 | Publié sur un registre ? | Conçu pour npm sous le nom **`sparda-mcp`** (`bin: sparda`, champ `files`, `.npmignore`). Usage annoncé `npx sparda-mcp …`. *La présence effective sur le registre npm n'est pas vérifiable depuis le dépôt seul.* |
| A7 | Open core ? | **Oui.** Le cœur (CLI, parsers, générateurs, bridge, moteur, immunité) est open source sous BUSL-1.1. Réservé à un futur tier payant : **politiques d'accès fines par personne** et **journal d'audit signé/inviolable** (README §« Beyond the open core », `docs/SECURITY.md`). |
| A8 | Site / landing / wiki | Site éditeur **residual-labs.fr** (lien README). Wiki GitHub activé (`has_wiki: true`) mais aucun contenu repéré. Pas de landing dédiée trouvée. |

---

## SECTION B — STACK TECHNIQUE

| # | Question | Réponse |
|---|----------|---------|
| B1 | Langage principal | **JavaScript** (ESM, `"type": "module"`). Python en stdlib pour l'extraction FastAPI (`src/parser/fastapi_extract.py`, `src/probe/fastapi-probe.py`). |
| B2 | Runtime | **Node.js** (CLI + bridge). **Python ≥ 3.9** requis sur le PATH pour la cible FastAPI. |
| B3 | Version min. runtime | **Node ≥ 18** (`engines` dans `package.json`, `docs/TESTING.md`). |
| B4 | Frameworks **fonctionnels** aujourd'hui | **Express 4/5** (JS/TS, ESM & CJS) et **FastAPI** (Python). Couverts par parsers, générateurs, templates et tests runtime. |
| B5 | Frameworks **annoncés non implémentés** | **NestJS, Fastify, Next.js (API routes)** — annoncés « en expansion active » (README, commit `f1b87ef`). Django/Flask/Go évoqués dans le sondage issue #1. Aucun code correspondant présent. |
| B6 | Système de modules | **ESM et CJS** côté cible (templates rendus pour JS/TS × ESM/CJS) ; le projet lui-même est **ESM**. |
| B7 | Gestionnaire de dépendances | **npm** (`package-lock.json`, `npm ci` en CI). |
| B8 | Fichier de dépendances | **`package.json`** + **`package-lock.json`** présents. Pas de `requirements.txt`/`pyproject.toml` (Python reste stdlib ; `fastapi`/`uvicorn` installés seulement en CI pour le test runtime). |
| B9 | Dépendances principales | **4 runtime, exact-pinnées** : `@babel/parser` 7.26.5 + `@babel/traverse` 7.26.5 (AST Express), `@clack/prompts` 0.9.1 (prompts CLI), `@modelcontextprotocol/sdk` 1.29.0 (protocole MCP). C'est tout — hard rule « 4 deps ». |
| B10 | Dépendances de dev | `express` (^4.21.0) et `vitest` (^3.2.6). Aucun linter/formatter déclaré. |
| B11 | Fichier lock | **Oui** — `package-lock.json` (~118 Ko). |
| B12 | TypeScript ? | **Non** pour le code source (pur JS). SPARDA *cible* des apps TS (templates avec placeholders de type `__ANY_TYPE__`…), mais **aucun `tsconfig.json`** dans le dépôt. |
| B13 | Bundler ? | **Non** (webpack/rollup/esbuild/tsup absents). Distribution = sources telles quelles. |
| B14 | Transpilation / compilation ? | **Non.** Exécution directe Node ; les templates `.txt` sont rendus par substitution de placeholders, pas compilés. |

---

## SECTION C — ARCHITECTURE & CONCEPTION

| # | Question | Réponse |
|---|----------|---------|
| C1 | Architecture globale | Deux pipelines (`docs/ARCHITECTURE.md`). **(1) `init` statique, déterministe** : `detect.js` → `parser/` (AST) → `security/sanitize.js` → `generator/` → injection d'un routeur marqué `/mcp` dans l'app hôte + écriture `sparda.json`. **(2) `dev` runtime** : un *bridge* stdio (`src/server/stdio.js`) parle MCP au client (Claude) et proxie en HTTP+`localKey` vers le routeur injecté **dans le process de l'app hôte**. Plus `sync`/`hook` (sentinelle git post-commit). |
| C2 | Pattern architectural | Pas de MVC/hexagonal classique. Pattern propre : **pipeline + injection in-process + organes runtime observateurs** (décision fondatrice ADR-001 : « zéro infra, on vit dans le process hôte »). |
| C3 | Séparation logique/infra | **Oui, nette** : parsing/génération (`parser/`, `generator/`), sécurité (`security/`), runtime/moteur (`server/`), CLI (`commands/`, `index.js`), templates (`templates/`). `sparda.json` = état/mémoire unique. |
| C4 | Mécanisme **Hebbien** | **Implémenté** — `createMyelinTracker()` dans `src/server/engine.js`. Règle hebbienne « fire together → wire together » : chaque succession d'outils `A-->B` renforce une arête (`reinforce`, `strength += 1`, sature à `MAX_LAYERS=10`). Value-free (noms d'outils seulement), borné (`MAX_AXONS=200`), runtime-only. |
| C5 | Mécanisme **sommeil (sleep)** | **Implémenté** — `createIdleHarvester()` dans `src/server/idle.js`. Le travail interne (condensation, persistance, organes) ne s'exécute **que lorsque la boucle d'événements est calme** (mesure `monitorEventLoopDelay`, un job par tick, garde anti-famine `maxWaitMs`, file bornée `maxQueue=200`, `flush()` synchrone à l'arrêt). « L'organisme digère sans jamais bloquer une requête » (hard rule #1). |
| C6 | Mécanisme **autocatalyse** | **Implémenté** — la **cristallisation** (`src/server/crystallize.js`, ADR-015). Un circuit observé (chaîne d'outils dont la sortie alimente l'entrée suivante) **s'auto-transforme** à partir de 3 observations en un **outil composite** MCP, annoncé en cours de session via `tools/list_changed`. Réservé aux GET activés ; les écritures ne sont jamais absorbées. |
| C7 | Mécanisme **myélinisation** | **Implémenté** — même organe que C4 (`createMyelinTracker`). La « myélinisation » est le franchissement du seuil `THRESHOLD=3` : une arête traversée ≥3 fois devient `myelinated` (habitude entrenchée), exposée dans `snapshot().myelin`. Complète le condenser : myéline = simple succession (pas de flux de données requis). |
| C8 | **Response recycling / flywheel** | `createFlywheel()` dans `engine.js` (ADR-020, « Bloc B »). `preCall(tool, args)` sert une réponse en cache et **saute l'appel hôte** si 3 conditions tiennent : c'est une **lecture**, l'outil est **prouvé pur** (empreinte FNV-1a identique ≥3 fois pour la même signature d'args canonique), et l'entrée est **dans le TTL** (30 s). Cache **RAM-only**, jamais persisté, invalidé sur écriture observée (via dépendances « ghost »). Kill-switch `SPARDA_FLYWHEEL=off`. |
| C9 | **Cristallisation de circuits** | Voir C6. Le *condenser* (`condenser.js`, Labs OFF par défaut) détecte les circuits (lien valeur sortie→arg) ; `crystallize.js` les promeut en outils composites GET-only, ré-alimentant chaque étape via `fromKey`, s'arrêtant honnêtement à la première erreur. |
| C10 | **Classification de pureté** | ADR-017, dans les templates de routeur. Chaque route est classée par observation du trafic réel : `pure` (même argsig → même empreinte ≥3×, recyclable), `volatile` (a changé), `erasing` (non-GET, écriture — « Landauer »), `unknown`. Exposée dans `GET /mcp/stats.purity`. Borné à 20 argsigs/outil, runtime-only. |
| C11 | **Quarantaine + half-open** | ADR-009, dans les routeurs. **3 erreurs 5xx consécutives** → l'outil renvoie `503` (`reason`, `retryInMs`) sans toucher l'hôte. Après cooldown (`SPARDA_QUARANTINE_MS`, défaut 60 s), **un seul probe** passe (half-open) ; un nouveau 5xx re-quarantaine (compteur repart à 2). Zéro LLM sur ce chemin. |
| C12 | **Jauge de recyclage** (`GET /mcp/stats`) | ADR-013 : compteur `recycle: {servedByCircle, paidFull, ratePct}`. `paidFull` s'incrémente juste avant le fetch hôte ; `servedByCircle` quand SPARDA répond de sa propre mémoire. Côté bridge, `recycling.flywheel` et `recycling.intelligence` (appels de sampling évités). **« A measure, never a promise » — lit 0 % au jour 1.** |
| C13 | Système de plugins/extensions | Pas de système de plugins formel. **Seam de drivers d'état** (Memory/LocalFile/Redis, `persistence.js`, ADR-019) réservé au multi-nœud, opt-in (`SPARDA_DRIVER`), Redis en import paresseux. **Labs** = organes opt-in (`labs.recordSequences`). |
| C14 | Configuration | **Trois niveaux** : `sparda.json` (état + flags `labs`/`sparding.policies`), **variables d'environnement** (`SPARDA_QUARANTINE_MS`, `SPARDA_FLYWHEEL`, `SPARDA_RECORD_SEQUENCES`, `SPARDA_DRIVER`, `SPARDA_EVENT_POLL_MS`, `SPARDA_CONFIRM_TTL_MS`, `SPARDA_FLYWHEEL_TTL_MS`…), et **arguments CLI** (`init`/`dev`/`sync`/`hook`/`remove`/`doctor`). |
| C15 | Hot-reload / watch | Pas de watch-mode applicatif. La **sentinelle** (`sync.js` + hook git `post-commit`, `hook.js`) re-parse et régénère le routeur **à chaque commit** quand les routes changent (carry-over préservé). |

---

## SECTION D — QUALITÉ DU CODE

| # | Question | Réponse |
|---|----------|---------|
| D1 | Style guide défini | **Aucun outil de style configuré** (pas d'Airbnb/Standard/Prettier/ESLint). Le code suit néanmoins un style interne très cohérent (commentaires explicatifs denses, conventions stables). |
| D2 | Config linter présente | **Non** — pas de `.eslintrc`, `.prettierrc`, `biome.json`, `.editorconfig`. |
| D3 | Linter strict/permissif | N/A (pas de linter). |
| D4 | Typage TS strict | **Non** (projet en JS, pas de TS ni de `noImplicitAny`/`strictNullChecks`). |
| D5 | Types pour API publiques | Pas de `.d.ts` ni de types exportés. Les « contrats » sont documentés en prose (`docs/ARCHITECTURE.md`, schéma `sparda.json`). |
| D6 | Interfaces/types internes | Structures via objets JS + `Map` documentés en commentaires ; pas de types formels. |
| D7 | JSDoc/TSDoc | **Partiel** : blocs `/** */` présents surtout dans `context-carrier.js` (9), `reconcile.js` (8) et le `probe/`. Ailleurs, commentaires en ligne riches plutôt que JSDoc normé. |
| D8 | Magic numbers/strings | **Bien maîtrisés** : seuils regroupés en constantes nommées (`ENGINE_LIMITS`, `RHYTHM`, `MYELIN`, `NOETHER`, `GHOST`, `FLYWHEEL`, `MYELIN.THRESHOLD`…) avec justification en commentaire. |
| D9 | Gestion d'erreurs homogène | **Oui** : erreurs utilisateur typées `code: 'USER'` + `hint` (`index.js`), `try/catch` systématique sur les chemins risqués, repli manuel sur échec d'injection, jobs idle qui survivent à une exception. |
| D10 | Logs structurés / verbosité | Discipline forte : **tout log humain → stderr** (ADR-005, `console.log` rebindé) car **stdout = flux MCP**. Pas de logger structuré (JSON) ; messages préfixés `[sparda]`. |
| D11 | Warnings / TODOs non résolus | **0** occurrence de `TODO/FIXME/XXX/HACK` dans `src/` et `templates/`. |
| D12 | Complexité cyclomatique | Non mesurée automatiquement. Fonctions courtes et ciblées (organes ~30-60 lignes) ; le plus gros fichier est `stdio.js` (745 l.) qui orchestre, mais découpé en helpers. |
| D13 | Code mort / imports inutilisés | Aucun détecté à la lecture ; choix explicites d'omission documentés (ex. CategoryMapper retiré, commenté dans `engine.js`). |
| D14 | Nommage explicite | **Oui, fort** : noms métier/biologiques cohérents (`createMyelinTracker`, `GravitationalLens`, `flywheel`, `antibodies`, `quarantine`). |
| D15 | Duplication (DRY) | Faible. Un template par framework (ADR-006) évite la dérive ; la persistance centralisée (ADR-019) a supprimé deux `atomicWrite` dupliqués. Duplication assumée Express/FastAPI (deux langages hôtes), tenue en parité par les tests. |

---

## SECTION E — TESTS & FIABILITÉ

| # | Question | Réponse |
|---|----------|---------|
| E1 | Framework de test | **Vitest** (^3, épinglé pour rester Node-18-compatible, ADR-011). Plus un self-test routeur en CJS (`tests/router-selftest.cjs`) et un harnais e2e maison (`tests/e2e/*.mjs`). |
| E2 | Nb de suites / fichiers | **7 fichiers `*.test.js`** : `sparda` (1955 l.), `context-carrier` (670), `engine` (569), `gossip` (349), `probe` (220), `persistence` (183), `confirmation` (154). + **4 fichiers e2e** (`harness`, `phase1`, `phase2`, `phase3_write`). **57 blocs `describe`**. |
| E3 | Nb de cas de test | **~207 cas individuels** (206 `it()` + 1 `test()`). |
| E4 | Couverture globale | **Non mesurée/publiée** (pas de config coverage ni de rapport dans le dépôt). |
| E5 | Couvre extraction de routes ? | **Oui** — section 1 (Express, 5 fixtures ESM/CJS/TS×2/hostile) + section 5 (FastAPI). |
| E6 | Couvre restauration byte-for-byte ? | **Oui** — section 4 (inject → ré-inject idempotent → remove, restauration **octet pour octet**, JS/TS/Python, y compris CRLF Windows). |
| E7 | Couvre quarantaine / half-open ? | **Oui** — section 6 (runtime routeur réel). |
| E8 | Couvre anomalies de latence ? | **Oui** — section 6 (antigène de latence, marge 1000 ms vs plancher). |
| E9 | Couvre classification de pureté ? | **Oui** — section 6 (pure/volatile/erasing/unknown). |
| E10 | Couvre cristallisation de circuits ? | **Oui** — sections 7f/7g + 8 (naissance d'un composite via `tools/list_changed` puis exécution). |
| E11 | Couvre session JSON-RPC MCP e2e ? | **Oui** — section 8 (session complète contre un bridge spawné + hôte mock : tools/list+call, prompts, confirm d'écriture, proof-after-write, notifications, `sparda_get_context`). |
| E12 | Tests de perf / benchmark | **Non.** Aucun benchmark de performance dans le dépôt (voir Section J). |
| E13 | Tests de charge / stress | **Non.** |
| E14 | CI/CD | **Oui** — GitHub Actions, `.github/workflows/ci.yml`. |
| E15 | Exécutés sur PR/push ? | **Oui** — déclenché sur `push` et `pull_request` vers `main`. Matrice **{ubuntu, windows} × Node {18, 22}** + Python 3.10 (installe `fastapi`/`uvicorn` pour le test runtime). |
| E16 | Tests de régression | **Oui, par culture** : `docs/ERRORS.md` (base de connaissances append-only) demande qu'« chaque entrée soit épinglée par un test ». Ex. E-003 (Node 18/vitest) gardé par ADR-011. |
| E17 | Fixtures réalistes | **Oui** — `tests/fixtures/` : `express-demo`, `express-hostile`, `express-js-cjs`, `express-ts-cjs`, `express-ts-esm`, `fastapi-basic`, `fastapi-package`. |

---

## SECTION F — SÉCURITÉ

| # | Question | Réponse |
|---|----------|---------|
| F1 | Audit de sécurité récent | Pas de rapport Snyk/`npm audit` versionné. **Pas de Dependabot configuré** (aucun `.github/dependabot.yml`). Posture défensive = surface minimale (4 deps pinnées). |
| F2 | CVE dans les deps | Non évalué dans le dépôt ; surface réduite à 4 deps exact-pinnées (Babel, clack, MCP SDK). |
| F3 | Validation des entrées | **Oui** — params/args validés au parse et à l'invoke ; bornes partout (timeouts 30 s, troncature sortie 8 Ko, ring buffers). |
| F4 | Protection injections | **Oui** : (a) **prompt-injection** via deny-list regex `security/sanitize.js` (docstrings + sorties LLM, cap 300 car., `<>{}` retirés), appliquée à `init` *et* `sync` ; (b) **AST self-reference** : chemins `/mcp*` bloqués au parse *et* à l'invoke ; (c) FastAPI extrait via `ast` stdlib (pas d'exécution de code). |
| F5 | Secrets/tokens | **Pas de secret hardcodé.** Pas de clé API embarquée (ADR-003 : on utilise le modèle du client via MCP sampling). **Gap connu et documenté** : le `localKey` est en clair dans `sparda.json` (que l'utilisateur peut committer) — auth faible loopback, pas un secret (`docs/SECURITY.md`). |
| F6 | Rate limiting | Pas de rate-limit classique. Substitut : **quarantaine** (coupe-circuit sur 5xx) + timeouts + bornes mémoire. |
| F7 | Permissions / ACL | **Écritures OFF par défaut** + opt-in par outil + confirmation par écriture (ADR-004). **ACL fines par personne = non implémentées**, annoncées pour le tier payant. |
| F8 | Données sensibles / RGPD | **Persistance value-free par conception** : `sparda.json` ne stocke que de la structure (noms d'outils/champs, empreintes, compteurs), **jamais les payloads** (ADR-014). Le flywheel garde des valeurs **en RAM uniquement**, jamais sérialisées. Réduit fortement l'exposition PII. Pas de mention RGPD explicite. |
| F9 | Sandboxing / isolation | Le routeur hôte est isolé des opérations FS sur les fichiers SPARDA (ADR-018, SPARDING Proof). `uncaughtExceptionMonitor` en observe-only (ne modifie jamais le comportement de crash). Pas de sandbox process dédiée (par design : on vit dans le process hôte). |
| F10 | MCP sécurisé | `x-sparda-key` (UUID) requis sur **chaque** endpoint du routeur (401 sinon), interface loopback `127.0.0.1`. Confirmation d'écriture par élicitation MCP. Pas de chiffrement TLS (communication locale stdio/loopback). |

---

## SECTION G — DOCUMENTATION

| # | Question | Réponse |
|---|----------|---------|
| G1 | README présent / qualité | **Oui, excellente** (`README.md`, ~167 l.) : accroche claire, quickstart, « promesse » testée en CI, bannières. Style honnête (section « ce qu'on ne promet pas »). |
| G2 | Description du projet | **Oui.** |
| G3 | Installation rapide | **Oui** — `npx sparda-mcp init` / `dev` / `remove`. |
| G4 | Exemple d'utilisation minimal | **Oui** — bloc de config `claude_desktop_config.json` pré-rempli. |
| G5 | API reference | **Partielle** : endpoints routeur (`/mcp/tools|invoke|stats|events`) et schéma `sparda.json` documentés dans `docs/ARCHITECTURE.md`. Pas de référence API auto-générée. |
| G6 | Architecture / diagramme | **Oui** — `docs/ARCHITECTURE.md` (diagrammes ASCII des deux pipelines + file map). |
| G7 | Contribution guidelines | **Non** dans le README ; pas de `CONTRIBUTING.md`. |
| G8 | Licence mentionnée | **Oui** (section License + fichier `LICENSE`). |
| G9 | Dossier docs/ | **Oui** — `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`, `ERRORS.md`, `DECISIONS.md` (log ADR). |
| G10 | Doc API auto-générée | **Non** (pas de Swagger/TypeDoc). |
| G11 | CHANGELOG.md | **Non trouvé.** Le versionnage transparaît via commits `chore(release)` et ADR. |
| G12 | CONTRIBUTING.md | **Non trouvé.** |
| G13 | CODE_OF_CONDUCT.md | **Non trouvé.** |
| G14 | Docstrings publiques | Partielles (cf. D7) ; SKILL.md documente la « surface » outils pour les clients IA. |
| G15 | Exemples de code dans la doc | **Oui** (README, ARCHITECTURE, schéma `sparda.json` en JSONC). |
| G16 | Guide de déploiement | Partiel : « zéro infra » par design ; pas de guide de déploiement séparé. |
| G17 | Guide de troubleshooting | **Oui, de fait** — `docs/ERRORS.md` (base Symptôme/Cause/Fix/Règle) + commande `doctor`. |

---

## SECTION H — PACKAGING & DISTRIBUTION

| # | Question | Réponse |
|---|----------|---------|
| H1 | Installable via gestionnaire | **Oui** — pensé pour `npx sparda-mcp` / `npm i sparda-mcp` (`bin`, `files`). |
| H2 | Publié sur registre public | Visé sur npm (cf. A6) ; non confirmable depuis le dépôt seul. |
| H3 | Script build/release | Pas de build (pas de transpilation). Releases via commits `chore(release)`. Pas de workflow de release automatisé. |
| H4 | Semver respecté | **Oui** — 0.5.3, progression 0.2→0.3→0.4→0.5 lisible dans les ADR. |
| H5 | Tags Git par release | **Non** — `git tag` ne renvoie aucun tag dans le clone inspecté. |
| H6 | GitHub Releases + notes | **Aucune release GitHub** repérée. |
| H7 | Package = fichiers nécessaires | **Oui** — `files: [src, templates, README, LICENSE]` (exclut `templates/*.bak`), `.npmignore` présent. |
| H8 | Docker image / Dockerfile | **Non** (cohérent avec « zéro infra »). |
| H9 | docker-compose.yml | **Non.** |
| H10 | Script de démarrage rapide | Scripts npm : `test`, `test:router`, `test:all`. Démarrage applicatif = `npx sparda-mcp dev`. Pas de `npm start`. |

---

## SECTION I — COMMUNAUTÉ & ADOPTION

| # | Question | Réponse |
|---|----------|---------|
| I1 | Étoiles GitHub | **2** (`stargazers_count`). |
| I2 | Forks | **0**. |
| I3 | Issues ouvertes/fermées | **1 ouverte** (#1 — sondage « quel framework ensuite ? »), 0 fermée. |
| I4 | PR ouvertes/fermées/mergées | **0** (aucune PR). |
| I5 | Contributeurs | **1** (`zyx77550` ; les commits portent les emails `zakwissal77@gmail.com`). |
| I6 | Fréquence des commits | **5 commits**, tous sur **2026-06-16** (release initiale + docs/métadonnées). Dernier push 2026-06-16. Projet **très récent** (~1 semaine au moment de l'inspection). |
| I7 | GitHub Discussions | **Désactivées** (`has_discussions: false`). |
| I8 | Canal de communication | Aucun (Discord/Slack/Matrix) repéré. |
| I9 | Awesome-lists / articles | Aucun référencement trouvé. |
| I10 | Témoignages / cas d'usage | Aucun. |
| I11 | Utilisé en prod par des tiers | **Non démontré** dans le dépôt. |
| I12 | Sponsors / financement | Pas de `FUNDING.yml`. Modèle économique = open core + futur tier payant (Residual Labs). |

---

## SECTION J — PERFORMANCE & BENCHMARKS

| # | Question | Réponse |
|---|----------|---------|
| J1 | Benchmarks dans le repo | **Non.** Aucun fichier de benchmark. |
| J2 | Latence mesurée (p50/p95/p99) | **Non.** Le routeur calcule une *baseline* de latence par route pour l'antigène d'anomalie (immunité), mais **aucun percentile n'est mesuré, exporté ou publié**. |
| J3 | Throughput (req/s) | **Non.** |
| J4 | Consommation mémoire | **Non mesurée** (mémoire seulement *bornée* par design, pas profilée). |
| J5 | Taux de hit du cache (recycling) | **Mécanisme présent, pas de benchmark.** La jauge (`/mcp/stats.recycle`, `recycling.flywheel`) **mesure** le hit-rate en usage réel (« lit 0 % au jour 1 ») mais aucun chiffre n'est figé dans le dépôt. |
| J6 | Chiffre « 97 % de réduction de latence » | **Non trouvé — nulle part.** Recherche exhaustive (`97`, `latency`, `reduction`, `benchmark`, `p50/p95/p99`) sur code+docs+README+tests : **aucune trace**. La philosophie affichée (ADR-013) est explicitement « *a measure, never a promise* ». **Ce chiffre n'est étayé par rien de mesurable dans SPARDA.** |
| J7 | Script reproductible de mesure | **Non.** À construire. |
| J8 | Baseline avec/sans SPARDA | **Non.** |
| J9 | Harnais de benchmark en cours | **Non présent** sur `main` ni sur `claude/sparda-functionality-benchmarks-b6jh32` au moment de l'inspection (le nom de branche suggère l'intention, le code n'existe pas encore). |
| J10 | Perf monitorée en CI | **Non** — la CI ne fait que correction fonctionnelle. |

---

## SECTION K — INNOVATION & DIFFÉRENCIATION

| # | Question | Réponse |
|---|----------|---------|
| K1 | Proposition de valeur unique | **Transformer une app Express/FastAPI en cours d'exécution en serveur MCP en une commande, sans OpenAPI, sans serveur à héberger, sans clé API, réversible octet-pour-octet** — l'IA *opère* le produit vivant (vraie auth, vraies données, pools chauds), pas seulement les fichiers. |
| K2 | Problèmes résolus vs existants | Élimine le glue-code MCP par projet (spec OpenAPI, serveur MCP hébergé, synchro à chaque route). Position **in-process** (ADR-001) → observation runtime qu'aucun outil en façade ne peut faire. Sécurité d'écriture native (OFF par défaut + confirmation). |
| K3 | Concurrents directs | Écosystème MCP émergent : générateurs MCP à partir d'OpenAPI, serveurs MCP « API gateway », wrappers manuels. Aucun, à ma connaissance, ne combine injection in-process réversible + immunité + recyclage + organes d'apprentissage. (Non sourcé dans le dépôt — évaluation à confirmer.) |
| K4 | Hebbien + myélinisation unique en MCP ? | **Plausiblement oui.** L'application d'organes bio-inspirés (myéline/Hebbien, rythme, invariants de Noether, dépendances « ghost », flywheel) à une couche MCP runtime est inhabituelle. À valider par revue de littérature/écosystème. |
| K5 | Cité en publications/talks | **Non** (aucune trace). |
| K6 | Brevet / PI | Pas de brevet mentionné. Le « moat » revendiqué (ADR-002) est la **mémoire accumulée** (immunité/circuits) versionnée avec le repo de l'utilisateur, pas la licence. |
| K7 | Soumission workshop académique | **Potentiel réel** (mécanismes originaux), **mais bloqué par l'absence de benchmark/évaluation quantitative** — prérequis pour NeurIPS/ICML/workshop. |
| K8 | Roadmap publique | Partielle : frameworks à venir (NestJS/Fastify/Next.js, issue #1), tier payant (ACL fines + audit signé). Pas de `ROADMAP.md` dédié. |
| K9 | 3 prochains milestones | D'après dépôt : (1) **support nouveaux frameworks** (NestJS/Fastify/Next.js) ; (2) **tier payant** (politiques d'accès + journal d'audit signé) ; (3) implicite — **multi-nœud** (drivers d'état + gossip CRDT déjà amorcés). |
| K10 | Potentiel commercial | **Oui** : open core gratuit + capacités équipe payantes ; faible coût d'adoption (réversible) ; verrouillage doux par mémoire accumulée. |

---

## SECTION L — CONFORMITÉ & BONNES PRATIQUES

| # | Question | Réponse |
|---|----------|---------|
| L1 | Bonnes pratiques OpenSSF | **Partielles.** Pour : CI multi-OS/multi-Node, deps pinnées, CODEOWNERS, politique de sécurité. Manquent : badge OpenSSF Scorecard, `SECURITY.md` à la racine (il est dans `docs/`), signature de releases, Dependabot. |
| L2 | SECURITY.md | **Oui** — `docs/SECURITY.md` (modèle de menace + défenses + gaps honnêtes). Note : pas à l'emplacement racine standard GitHub. |
| L3 | Process de signalement de vulns | Implicite (issues/contact Residual Labs) ; **pas de politique de divulgation formelle** ni d'email sécurité dédié. |
| L4 | Deps à jour | Deps récentes et exact-pinnées ; **pas d'automatisation** de mise à jour (Dependabot absent). ADR-011 documente la contrainte vitest/Node-18. |
| L5 | .gitignore complet | **Oui** — couvre `node_modules`, `.sparda/`, `.env*`, `*.bak`, `tests/.tmp/`, `__pycache__`, etc. |
| L6 | LICENSE formaté | **Oui** — `LICENSE` BUSL-1.1 complet. `.gitattributes` force `eol=lf` (tests byte-for-byte déterministes cross-OS). |
| L7 | Statut du projet | **Implicite** (« open core », v0.5.x). Pas de badge explicite experimental/stable/deprecated. |
| L8 | Support LTS / maintenance | Promesse **Node ≥ 18** maintenue (contrainte vitest gérée par ADR-011). Pas de politique de maintenance formelle. |
| L9 | Conventional Commits | **Oui** — `docs:`, `chore(release):`, `chore(git):` observés. |
| L10 | Templates issues / PR | **Non trouvés** (`.github/ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md` absents). Seul `.github/CODEOWNERS` présent. |

---

## SYNTHÈSE EXÉCUTIVE (pour la phase 2)

**Forces.** Ingénierie d'une rare cohérence pour un projet d'une semaine : architecture in-process originale et bien documentée (ADR append-only, ARCHITECTURE/SECURITY/ERRORS), ~207 tests Vitest sur CI multi-OS/multi-Node, sécurité honnête et minimale (4 deps pinnées, écritures OFF par défaut, persistance value-free), et un corpus de mécanismes runtime inhabituels (immunité/quarantaine, recyclage flywheel, classification de pureté, organes bio-inspirés Hebbien/myéline/rythme/Noether/ghost, cristallisation auto-catalytique, convergence CRDT par gossip).

**Faiblesses bloquantes pour la « reconnaissance crédible ».**
1. **Aucun benchmark, aucune métrique quantitative.** Le chiffre « 97 % de réduction de latence » **n'existe nulle part dans le dépôt** et serait, en l'état, une affirmation non étayée — risque de crédibilité. C'est le chaînon manquant pour un papier ArXiv ou un workshop (K7).
2. **Adoption quasi nulle** (2 ★, 0 fork, 1 contributeur, 5 commits) — normal vu l'âge, mais à ne pas survendre.
3. **Lacunes de conformité** : pas de CHANGELOG/CONTRIBUTING/CODE_OF_CONDUCT, pas de tags ni de GitHub Releases, pas de Dependabot, pas de templates issue/PR, `SECURITY.md` hors emplacement racine.
4. **Pas de linter/formatter ni de TS** : qualité tenue par la discipline humaine, non outillée.

**Recommandation prioritaire #1 (et raison d'être de la branche `…-benchmarks-…`)** : construire un **harnais de benchmark reproductible** (baseline avec/sans SPARDA, hit-rate du flywheel, latence p50/p95/p99) produisant des chiffres défendables. C'est le prérequis qui débloque à la fois la communication crédible *et* une soumission académique.
