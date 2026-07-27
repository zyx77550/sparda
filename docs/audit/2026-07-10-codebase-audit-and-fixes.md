# Audit complet du codebase SPARDA — findings & correctifs

**Date :** 2026-07-10 · **Portée :** HQ (`zyx77550/sparda-hq`) · **Branche :** `claude/new-session-5yhx6t`
**Environnement :** Node v22 · **Suite :** 399 ✓ Vitest + 10/10 router self-test après correctifs
**Méthode :** revue ciblée des surfaces critiques (bridge stdio, sécurité, réversibilité de
l'injection, moteur/flywheel, templates de routeur, couverture de test), chaque point vérifié
dans le code (référence `fichier:ligne`), puis corrigé avec test de non-régression.

> Ce fichier est le compagnon de l'audit externe `SPARDA_AUDIT_REPORT.md` (trou de sync
> HQ→public). Il documente une seconde passe, interne, sur **tout** le code — failles,
> bugs, incohérences, axes d'amélioration — et les correctifs livrés.

---

## 0. TL;DR

| # | Finding | Sévérité | État |
|---|---|---|---|
| **S1** | Jeton de confirmation d'écriture (Express/Next) minté avec `Math.random()` | 🔴 Medium | ✅ Corrigé |
| **B1** | `sparda remove` détruit le backup qu'il vient de recommander (chemin d'échec) | 🟠 Medium | ✅ Corrigé |
| **B2** | Réversibilité : le retrait de l'injection laisse une ligne vide si le bloc est en tête de fichier | 🟠 Low | ✅ Corrigé |
| **I1** | Deux regex divergentes pour retirer le même bloc marqué (Express ⇄ FastAPI) | 🔵 Maint. | ✅ Corrigé (module partagé) |
| **T1** | Wrappers de commandes (`apocalypse`/`verify`/`ubg`/`openapi`) sans smoke test | 🟡 Medium | ✅ Corrigé |
| **T2** | Version du serveur MCP codée en dur et périmée (`0.5.2`) | 🟡 Trivial | ✅ Corrigé |
| **D1** | Flywheel : lectures potentiellement périmées (≤30 s) servies par défaut | 🔵 Design | ⚠ Documenté (voir §4) |
| **D2** | `sanitizeDescription` : défense regex best-effort présentée comme absolue | 🔵 Design | ⚠ Documenté (voir §4) |
| **D3** | `heal --agent` : `spawnSync(..., { shell: true })` sur une valeur de flag | 🔵 Design | ⚠ Documenté (voir §4) |

---

## 1. Correctifs de sécurité

### S1 — Jeton de confirmation d'écriture non-cryptographique

**Preuve.** `templates/express-router.txt` (`spardaNonce`) et `templates/nextjs-router.txt` :
```js
return 'cfm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
```
`cfm_...` est le **nonce à usage unique qui garde les écritures** (commit en deux phases :
`/invoke` renvoie `202 awaiting_confirmation` + jeton ; `/invoke/confirm` rejoue le jeton pour
exécuter). `Math.random()` n'est pas cryptographique — l'état de xorshift128+ (V8) est
reconstructible à partir de quelques sorties, rendant les jetons suivants prédictibles.

**Parité rompue.** `templates/fastapi-router.txt:61` utilisait déjà `uuid.uuid4()` (correct).
Les templates JS étaient donc *moins* sûrs que le template Python pour la même garde.

**Atténuations présentes** (pourquoi Medium et pas High) : `/mcp/invoke/confirm` exige
`x-sparda-key`, le jeton a un TTL court, et — sur les clients sans elicitation — le Signal 2
(dialogue OS, `server/confirmation.js`) est une garde *séparée* que l'IA ne peut pas atteindre.
C'est donc de la défense en profondeur ; mais pour un produit qui **vend** la preuve de
sécurité, un nonce de garde non-crypto est un vrai défaut.

**Correctif.** `return 'cfm_' + globalThis.crypto.randomUUID();` dans les deux templates JS.
- Web Crypto est un global stable en Node ≥ 18 (l'`engines` du paquet) et dans tous les
  runtimes Next.js → cryptographiquement sûr, sans nouvelle dépendance ni nouveau placeholder.
- `randomUUID()` aligne les trois templates (Express/Next/FastAPI) sur une même garantie.
- **Non touché volontairement** : `errorId = 'err_' + ... Math.random()` reste inchangé — c'est
  un identifiant de corrélation de logs, non-sécuritaire ; `Math.random()` y est acceptable.

**Vérification.** Le router self-test exerce le chemin `require_human → 202 → /invoke/confirm`
(mint + rejeu du jeton) : 10/10 vert, donc `globalThis.crypto.randomUUID()` fonctionne bien
dans le routeur généré.

---

## 2. Correctifs de correction (bugs)

### B1 — `sparda remove` détruit le backup qu'il recommande

**Preuve.** `src/commands/remove.js` (avant correctif) : en cas d'échec de `removeInjection`
(le fichier dépouillé ne parse plus → `{ ok: false }`), on affichait
`✗ Could not safely remove from <file> — restore from .sparda/backup/`, **puis** on exécutait
inconditionnellement `fs.rmSync('.sparda', { recursive: true, force: true })` — supprimant le
`.sparda/backup/` que l'on venait de désigner comme filet de sécurité. Perte de données dans
le seul chemin où le filet compte.

**Correctif.** Si un fichier n'a pas pu être reverti proprement, on **s'arrête avant tout
nettoyage destructif** : `sparda.json`, fichiers générés et `.sparda/backup/` sont préservés,
un message clair indique quoi restaurer, et `process.exitCode = 1`. Rien n'est supprimé tant
que l'arbre n'est pas prouvé propre.

```js
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  // … message …
  process.exitCode = 1;
  return { removed: false, failed: failed.map((r) => r.file) };
}
```

**Vérification.** Suite `remove`/`nextjs` (byte-identical trees) verte ; nouveau contrat de
retour (`{ removed }`) cohérent sur succès comme sur échec.

### B2 — Ligne vide résiduelle quand le bloc d'injection est en tête de fichier

**Preuve.** `removeInjection` (Express **et** FastAPI) utilisait une regex qui consomme le
newline **de tête** du bloc (`\n?MARK_START…MARK_END`) et le remplace par `''`. Or l'injection
insère le bloc **comme des lignes entières avant une ligne existante** : par rapport à
l'original, elle ajoute le bloc + **un newline de queue** ; le newline de tête appartenait déjà
au fichier. Le retrait « par la tête » est byte-parfait pour un bloc au milieu, mais laisse un
`\n` orphelin quand le bloc est tout en haut (`insertAt === 0`) → `git diff` non propre
(viole la règle dure #4).

**Correctif.** Le retrait consomme désormais le bloc **+ son newline de queue** uniquement
(`MARK_START…MARK_END\r?\n?` → `''`), le newline de tête restant le séparateur d'origine. C'est
l'inverse exact d'un `splice` de lignes.

**Vérification.** Probe de round-trip `inject → remove` :
```
mid-file byte-identical:    true
top-of-file byte-identical: true   ← corrige l'edge case
CRLF byte-identical:        true
```

### I1 — Deux regex divergentes pour le même bloc marqué

**Preuve.** `generator/express.js` et `generator/fastapi.js` définissaient chacun `MARK_START`,
`MARK_END`, `escapeRx`, et **deux** regex de strip (idempotence à l'init + retrait) avec des
sémantiques de newline subtilement différentes — source de divergence future exactement du
type de B2.

**Correctif (nouveau module).** `src/generator/injection.js` — **une** définition du contrat de
bloc marqué, partagée :
```js
export function makeInjectionMarkers(commentPrefix) {
  // MARK_START / MARK_END dérivés du préfixe de commentaire ('//' pour JS, '#' pour Python)
  // stripForReinit(src)  → retire le bloc + les newlines autour, laisse un seul '\n' (ré-init)
  // stripForRemoval(src) → inverse byte-parfait d'un splice de lignes (bloc + newline de queue)
}
```
`express.js` consomme `makeInjectionMarkers('//')`, `fastapi.js` `makeInjectionMarkers('#')`.
Les deux strips locaux et les deux `escapeRx` dupliqués sont supprimés. L'injection et son
inverse ne peuvent plus dériver (règle dure #4 tenue par construction).

> **Effet de bord vertueux :** ce nouveau fichier runtime a immédiatement fait échouer le test
> d'auto-cohérence de la valve (PR #12) tant qu'il n'était pas suivi par git — la preuve que
> le garde-fou anti-sous-envoi fonctionne. Résolu en stageant `injection.js`.

---

## 3. Correctifs process / tests

### T1 — Wrappers de commandes sans smoke test

**Preuve.** Aucun test n'exerçait les *entrées CLI* `runApocalypse` / `runVerify` / `runUbg` /
`runOpenapi` : leurs codes de sortie, la forme du JSON et la sortie console pouvaient régresser
avec une suite verte (les passes sous-jacentes étant testées au niveau module). C'est la reco
#5 de l'audit externe, appliquée en HQ.

**Correctif.** `tests/command-smoke.test.js` — pilote chaque wrapper sur une fixture réelle et
assère le contrat qu'un utilisateur CI attend :

| Wrapper | Fixture | Assertion |
|---|---|---|
| `runApocalypse` | `demo-app` | `verdict.safe`, **exit 0**, « PROVEN » |
| `runApocalypse` | `ubg-semantics` | non-safe, ≥1 critical, **exit 1**, « NOT PROVEN », `UNGUARDED_MUTATION` |
| `runApocalypse --json` | `ubg-semantics` | enveloppe `{verdict, findings[], obligations>0}` parseable |
| `runVerify` | `demo-app` | `ok`, exit 0, « PROVEN » |
| `runUbg` | `demo-app` | « UBG compiled », graphe écrit avec `nodes[]` |
| `runOpenapi --json` | `demo-app` | doc OpenAPI `3.1`, `paths` non vide |

Le harnais isole `process.exitCode` (un wrapper qui met `exitCode = 1` pour le gate CI ne doit
pas faire échouer vitest) et capture `console.log`. Les verdicts des fixtures ont été mesurés
empiriquement avant d'écrire les assertions (demo-app PROVEN/0 ; ubg-express & ubg-semantics
NOT-PROVEN/1 ; verify vert partout).

**Restants (non livrés, volontairement)** : `runInit` / `runDev` / `runMirror` / `runTimeless`
et l'axe *apocalypse* de `runHeal` demandent un serveur hôte vivant ou un harnais d'intégration
(port, process). À couvrir dans un chantier d'intégration dédié plutôt que par des tests
à moitié faits. Le condensateur, l'immune et le flywheel restent couverts par leurs tests
existants.

### T2 — Version du serveur MCP codée en dur

**Preuve.** `src/server/stdio.js` annonçait `version: '0.5.2'` alors que le paquet est en
`0.13.3` (figé depuis de nombreuses releases).

**Correctif.** Lecture de la version depuis `package.json` au chargement du module
(`new URL('../../package.json', import.meta.url)`), avec repli `'0.0.0'`. Impossible de dériver
à l'avenir.

---

## 4. Findings de design — documentés, non « corrigés » (par choix)

### D1 — Le flywheel sert des lectures potentiellement périmées par défaut

`src/server/engine.js` (`FLYWHEEL = { MIN_HITS: 3, TTL_MS: 30_000 }`) + `stdio.js` : sur une
écriture, seul le cache GET de **même path** est invalidé de façon synchrone ; les couplages
cross-path (ghost) ne sont purgés qu'en idle, **après apprentissage**. Un `GET /balance` peut
donc être servi jusqu'à **30 s périmé** après un `POST /orders` corrélé mais non encore appris.

C'est un compromis **documenté** (ADR-020) avec kill-switch `SPARDA_FLYWHEEL=off`. Mais il
existe une tension de fond : un produit dont l'argument central est « prouver la correction »
sert par défaut (flywheel **ON**) des lectures éventuellement périmées. **Recommandation** (non
tranchée ici car c'est une décision produit) : soit passer le flywheel en **opt-in**, soit
documenter explicitement la fenêtre de staleness dans le `hint` de `sparda_get_context`. Laissé
en l'état pour ne pas changer un comportement produit sans décision du propriétaire.

### D2 — `sanitizeDescription` est une défense best-effort

`src/security/sanitize.js` applique `.slice(0, 300)` **avant** le test des motifs dangereux
(une charge après le 300ᵉ caractère échappe au filtre), et les motifs regex sont contournables
par fragmentation / unicode / homoglyphes. C'est inhérent à une défense par liste de motifs.
**Non corrigé** : durcir sans casser la couverture existante mérite son propre chantier
(normalisation Unicode, test *avant* slice). **Documenté** pour que la règle dure #7 soit lue
comme « best-effort, défense en profondeur » et non comme une garantie absolue.

### D3 — `heal --agent` exécute la valeur du flag via un shell

`src/commands/heal.js` : `spawnSync(opts.agent, { input: brief, shell: true, … })`. Acceptable
dans le modèle de menace (l'utilisateur fournit sa propre commande d'agent sur sa propre
machine, comme `xargs` ou `git -c`), mais `shell: true` sur une valeur de flag mérite d'être
**explicité dans l'aide/doc**. Non modifié (le retirer casserait l'usage `--agent "claude -p"`).

---

## 5. Ce qui a été vérifié et qui tient (revue négative)

- `localKey` = `crypto.randomUUID()` (`generator/manifest.js:31`) — 122 bits, correct.
- Confirmation à **deux signaux** (`server/confirmation.js`) : Signal 2 (dialogue OS) non
  atteignable par l'IA, fail-closed en headless, argv sans interpolation shell → solide.
- Aucun `process.exit` dans le code bibliothèque (hors shim de sonde, légitime) ; aucun
  `eval`/`new Function` ; pas d'injection shell exploitable.
- `pickPathArgs` ↔ `pathParams` cohérents ; `/mcp/tools` expose bien `pathParams` au bridge.
- Le bridge garde le parse de `sparda.json` (E-000x), plafonne les corps à 64 Ko, et route
  toutes les sorties humaines vers stderr (règle dure #2).
- Valve d'auto-cohérence HQ→public (PR #12) — a d'ailleurs attrapé `injection.js` non suivi.

---

## 6. Fichiers touchés

**Nouveaux**
- `src/generator/injection.js` — contrat de bloc marqué partagé (I1/B2).
- `tests/command-smoke.test.js` — smoke tests des wrappers (T1).
- `docs/audit/2026-07-10-codebase-audit-and-fixes.md` — ce fichier.

**Modifiés**
- `templates/express-router.txt`, `templates/nextjs-router.txt` — nonce crypto (S1).
- `src/commands/remove.js` — préservation du backup en cas d'échec (B1).
- `src/generator/express.js`, `src/generator/fastapi.js` — usage du module partagé (I1/B2).
- `src/server/stdio.js` — version lue depuis `package.json` (T2).

**Non modifié volontairement** : `errorId` (non-sécuritaire), flywheel (décision produit),
`sanitize` (chantier dédié), `heal --agent` (usage légitime). Voir §4.

---

## 7. Vérification finale

```
npm test                 → 399 passed | 3 skipped (22 files)
node tests/router-selftest.cjs → 10/10 passed
eslint (fichiers touchés)      → 0 erreur
prettier --check               → clean
round-trip inject→remove       → byte-identical (mid-file, top-of-file, CRLF)
```
Aucune nouvelle dépendance runtime (règle dure #8 tenue — toujours 4).
