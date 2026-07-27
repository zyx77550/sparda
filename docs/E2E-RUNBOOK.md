# SPARDA — E2E Runbook (manual, real MCP client)

**But :** prouver à la main ce que les 230 tests unitaires ne peuvent pas prouver —
le **vrai protocole MCP de bout en bout** avec un client réel (Claude Desktop), la
**jauge de recyclage / flywheel**, la **cristallisation de circuits**, et la promesse
n°1 : **`remove` = diff git byte-for-byte propre**. Pas tourné end-to-end depuis le
2026-06-11 — c'est le plus gros angle mort.

> Tout est sur l'app `tests/fixtures/express-demo` (existe, minuscule, contient déjà
> le piège d'injection + la route dynamique à ignorer + des outils write + un sous-router).
> Déroule dans l'ordre. Chaque étape a un **Attendu** en gras = le gate à vérifier.
> Commandes en **PowerShell**. Coche au fur et à mesure.

Raccourcis (colle-les une fois dans ton terminal) :

```powershell
$sparda = "C:\Users\zakwi\Developer\residual-labs-forge\SPARDA\sparda"
$work   = "C:\Users\zakwi\sparda-e2e\demo"
```

---

## 0 — Setup (une fois, ~3 min)

```powershell
# copie propre de la fixture dans un dossier scratch (on ne salit pas le repo)
New-Item -ItemType Directory -Force -Path (Split-Path $work) | Out-Null
Copy-Item -Recurse -Force "$sparda\tests\fixtures\express-demo" $work
cd $work
npm install                      # installe express (la fixture n'a pas de node_modules)
git init -q; git add -A; git commit -q -m "baseline app (avant SPARDA)"
```

- [ ] **Attendu :** `npm install` OK, `git log` montre 1 commit « baseline ». Ce commit
  est la **référence** pour prouver le diff propre au §6.

---

## 1 — `init` : injection réversible (~2 min)

```powershell
node "$sparda\src\index.js" init --yes
git status
```

- [ ] **Attendu :** `sparda.json` créé, le router généré `src/sparda-router.js`, et dans
  `src/app.js` un **bloc marqué** `// >>> sparda-injection …` … `// <<< sparda-injection`.
- [ ] **Attendu :** `git status` ne liste **que** des ajouts/edits attendus (router,
  sparda.json, bloc dans app.js, éventuel `.gitignore`). Rien d'autre.
- [ ] **Route dynamique ignorée :** ouvre `sparda.json` → `GET /v2/meta` (construit via
  `` `/v${VERSION}/meta` ``) **ne doit PAS** apparaître comme outil. Le parser saute ce
  qu'il ne peut pas prouver — il ne devine pas.
- [ ] **Defense docstring :** la description de `delete_api_prospects_by_id` ne doit
  **pas** contenir l'injection brute « Ignore previous instructions… » (sanitizée).

---

## 2 — App + client réel connectés (~3 min)

**Terminal 1 — lance l'app hôte** (le bridge s'y attache, il ne la lance pas) :

```powershell
cd $work
node src/app.js          # → "demo-crm on :3456" — laisse tourner
```

**Branche Claude Desktop sur le bridge.** Édite
`%APPDATA%\Claude\claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "sparda-demo": {
      "command": "node",
      "args": ["C:\\Users\\zakwi\\Developer\\residual-labs-forge\\SPARDA\\sparda\\src\\index.js", "dev"],
      "cwd": "C:\\Users\\zakwi\\sparda-e2e\\demo"
    }
  }
}
```

Puis **redémarre Claude Desktop**.
> Si les outils n'apparaissent pas (vieille version qui ignore `cwd`), remplace par :
> `"command": "cmd", "args": ["/c", "cd /d C:\\Users\\zakwi\\sparda-e2e\\demo && node C:\\Users\\zakwi\\Developer\\residual-labs-forge\\SPARDA\\sparda\\src\\index.js dev"]`

- [ ] **Attendu — `tools/list` :** tu vois `get_health`, `get_api_prospects`,
  `get_api_users_by_id` + les méta `sparda_info`, `sparda_get_context`,
  `sparda_list_disabled_tools`, `sparda_confirm`.
- [ ] **Attendu — write-safety :** `post_api_users` et `delete_api_prospects_by_id`
  sont **ABSENTS** de la liste (désactivés par défaut, règle dure n°3).
- [ ] **Annotations :** `get_api_prospects` → `readOnlyHint:true`, `idempotentHint:true`.
  (Le DELETE, une fois activé au §5, sortira `destructiveHint:true`.)

**Smoke read :**
- [ ] Appelle `get_api_prospects` → **Attendu :** données live (`count:3`, les 3 prospects),
  `isError:false`. → **Le wire MCP marche de bout en bout.**
- [ ] Appelle `sparda_info` → **Attendu :** `tools_enabled`, `tools_disabled_write_safety:2`,
  `labs_sequence_recording:"off …"`.

---

## 3 — Jauge de recyclage / flywheel (unique à l'E2E, ~3 min)

Le flywheel sert un read depuis la RAM dès qu'il a renvoyé **la même réponse ≥3× pour
les mêmes args**. `get_api_prospects` renvoie un payload **constant** → s'arme.
(`get_health` renvoie `uptime` qui bouge → **ne s'arme jamais** : c'est volontaire, bon
test de la classification de pureté.)

1. Appelle `sparda_get_context` → note `recycling.flywheel.servedFromMemory` (≈ 0).
2. Appelle **`get_api_prospects` 4 fois de suite** (mêmes args = aucun).
3. Rappelle `sparda_get_context`.

- [ ] **Attendu :** `recycling.flywheel.armed` **≥ 1** et `servedFromMemory` **≥ 1**
  (le ou les appels après le 3e sont servis depuis la RAM — l'hôte n'est jamais touché).
- [ ] **Attendu :** `runtime.purity` classe `get_api_prospects` = **pure** et
  `get_health` = **volatile**.
- [ ] **Attendu :** `behavior.stability` pour `get_api_prospects` liste des champs
  **stable** (`count`, `prospects.*`).
> Sanity : relance avec l'app stoppée — un `get_api_prospects` servi par le flywheel
> répond quand même (RAM). `SPARDA_FLYWHEEL=off` coupe le service (les organes continuent
> d'apprendre).

---

## 4 — Cristallisation d'un circuit (Labs, unique à l'E2E, ~4 min)

Un circuit = la sortie d'un outil A re-nourrit l'argument d'un outil B, **observé ≥3×**.
Off par défaut — active-le :

```powershell
# dans sparda.json, ajoute (ou édite) :  "labs": { "recordSequences": true }
```
Redémarre **Claude Desktop** (le recorder est côté bridge — il relit le manifest au
démarrage ; pas besoin de re-`init`).

Pilote la chaîne **3 fois** (prospects → users avec un id **numérique**) :
- [ ] Appelle `get_api_prospects` (sort `id: 1,2,3`).
- [ ] Appelle `get_api_users_by_id` avec **`{ "id": 2 }`** ⚠️ un **nombre**, pas `"2"`.
  (Un id string à 1 caractère est rejeté par le matcher ; un nombre sous la clé `id`
  est toujours retenu — c'est la seule subtilité.)
- [ ] Répète ce duo **3 fois** au total.
- [ ] Re-liste les outils.

- [ ] **Attendu :** un outil composite apparaît, nommé d'après la chaîne, décrit
  `[Labs circuit ×3]`, annotations GET-only (`readOnlyHint:true`).
- [ ] **Attendu :** `sparda_info` → `circuits_observed ≥ 1` ;
  `sparda_get_context.labs.circuits` contient la chaîne `…prospects>…users…`.

---

## 5 — Write opt-in + confirmation à deux temps (~3 min)

- [ ] Appelle `sparda_list_disabled_tools` → **Attendu :** liste `post_api_users` +
  `delete_api_prospects_by_id` **avec la procédure exacte pour les activer** (c'est le
  produit qui te la donne — suis-la, n'invente rien).
- [ ] Active `post_api_users` : dans `sparda.json` mets `tools.post_api_users.enabled = true`,
  puis **re-run `node "$sparda\src\index.js" init --yes`** (régénère le router ; la
  règle de carry-over n°5 garde le flag). Redémarre l'app + Claude Desktop.
- [ ] Appelle `post_api_users` `{ "name": "Test" }` → **Attendu :** pas d'exécution
  directe — réponse **gated** qui renvoie un **token de confirmation** (ou une
  élicitation native si le client la supporte).
- [ ] Appelle `sparda_confirm` `{ "token": "<le token>" }` → **Attendu :** la création
  s'exécute (`201 { created:true }`). **Le gate humain marche avec un vrai client.**

---

## 6 — `remove` = diff propre (promesse n°1, OBLIGATOIRE, ~3 min)

Arrête Claude Desktop (libère le bridge) et l'app (Terminal 1). Puis :

```powershell
cd $work
node "$sparda\src\index.js" remove --yes
git status
git diff
```

- [ ] **Attendu :** message « SPARDA removed. `git diff` should be clean. »
- [ ] **🔴 GATE :** `git status` **propre** et `git diff` **vide** — retour byte-for-byte
  au commit baseline du §0. (Note : supprime d'abord `sparda.json`/router non suivis si
  `git status` les montre en *untracked* — le diff des fichiers **suivis** doit être nul.)
- [ ] **Attendu :** le bloc `// >>> sparda-injection … <<< sparda-injection` a disparu de
  `src/app.js`, `.sparda/`, `sparda.json` et `src/sparda-router.js` sont partis.
  *(Vérifié ici automatiquement : `git status` vide + `git diff src/app.js` vide.)*
- [ ] **Hook :** si tu as testé `node "$sparda\src\index.js" hook`, vérifie que
  `.git/hooks/post-commit` est **désinstallé** après `remove`.

---

## 7 — `doctor` (~1 min)

```powershell
node "$sparda\src\index.js" init --yes   # re-init rapide juste pour diagnostiquer
node "$sparda\src\index.js" doctor; "exit=$LASTEXITCODE"
node "$sparda\src\index.js" remove --yes # nettoie derrière
```

- [ ] **Attendu :** `doctor` rapporte healthy, **exit 0**. (exit 1 = setup cassé.)

---

## Déjà couvert ailleurs — NE refais à la main que si tu suspectes une régression

Prouvé par les 230 tests Vitest verts + les debriefs archivés
(`docs/sessions/debrief_phase{1,2,3}.md`) : quarantaine 3-strikes + cooldown + recovery
+ re-arm, mémoire immunitaire / antibody cache, cache du semantic pass (sampling),
discipline stdout, params imbriqués/encodés, variantes CJS/TS, gros payloads, concurrence,
input invalide, sanitisation docstring. Inutile de les rejouer au clavier.

## Raccourci automatisé : `tests/e2e/phase4.mjs` (déjà écrit + vert ✅)
Les §2→§4 (protocole + jauge flywheel + cristallisation) sont **automatisés** par un vrai
client MCP scripté. Une seule commande, depuis le repo :

```powershell
# prépare une fois l'app cible (copie + express + init + labs.recordSequences)
Copy-Item -Recurse -Force "$sparda\tests\fixtures\express-demo" $work
cd $work; npm install; node "$sparda\src\index.js" init --yes
# active l'enregistrement de séquences dans sparda.json : "labs": { "recordSequences": true }
# puis, depuis le repo SPARDA :
$env:SPARDA_E2E_APP = $work
node tests/e2e/phase4.mjs        # → verdict JSON, exit 0 si tout passe
```

Dernier run ici : **7/7 ALL PASS** (protocole, annotations, read live, flywheel armé,
circuit cristallisé ×3 + exécuté, discipline stdout). Le `remove` propre (§6) est validé à
part (`git diff` vide). Reste **manuel** : §5 write+confirm via élicitation native d'un vrai
client (déjà prouvé par les 10/10 du router self-test + le debrief phase3).

## Note sur les anciens scripts (`tests/e2e/phase1-3`)
Toujours **épinglés à l'ancienne `sparda-demo-app`** (routes `products`/`flaky`, supprimée) —
ils **échoueront** tels quels sur la fixture. `phase4` les remplace pour les organes
post-0.3.0 ; recréer l'app d'origine seulement si tu veux rejouer la quarantaine/antibody
au clavier (sinon déjà couvert par les tests unitaires).
