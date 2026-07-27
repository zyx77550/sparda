# L'ARBITRE-2 — le playbook exécutable (2026-07-19, tout mesuré ou sourcé)

> Suite d'`ARBITRE-VERDICT-2026-07-19.md`. Différence : cette session n'opine pas — elle a
> **construit le wedge** (`sparda gate`, commité avec cette analyse) et l'a **mesuré** sur du
> vrai code. Chaque chiffre ci-dessous vient d'un run de cette session ou d'une source datée.

---

## 1. LE WEDGE, PROUVÉ EN CODE (pas en slides)

Construit : `src/commands/gate.js` (+ câblage `src/index.js`, 4 tests `tests/gate.test.js`,
démo reproductible `bench/guard-removal-replay.mjs`). Réutilise `diffGraphs`/`checkGraph`
d'apocalypse — ~110 lignes. **Delta-only par design** : l'état pré-existant ne bloque jamais
un edit (la leçon des 2 classes de FP appliquée structurellement).

Mesures sur **dub réel** (clone frais, 580 routes) :

| Scénario | Résultat | Latence |
|---|---|---|
| 1er run (auto-arm, zéro config) | `✓ GATE ARMED (first run)` | 6,4 s wall (compile + write baseline) |
| Edit bénin (logique métier) | **silence total, exit 0** | 2,3 s wall / 2,0 s interne |
| Wrapper d'auth → identité (l'edit d'agent type) | `[critical] GUARD_REMOVED — POST /api/links … (app/api/links/route.ts:56)` sur **stderr, exit 2** (contrat PostToolUse bloquant) | 2,2 s wall / **1,88 s interne** |
| Nouvelle route qui écrit en base sans garde | `[critical] UNGUARDED_MUTATION` + `[medium] UNVALIDATED_CONSTRAINED_WRITE`, file:line | 2,1 s |
| App petite/médiane (fixture Express) | clean | **55 ms interne / 0,4 s wall** |
| `bench/guard-removal-replay.mjs` (la démo 60 s) | régression injectée → attrapée | **1 465 ms** in-process |

Suite complète : **687 verts / 3 skip (76 fichiers)**, ESLint/Prettier clean, valve ADR-029
passée (elle a attrapé le module non tracké — witness qu'elle marche).

**Verdict : ça claque.** L'output que l'agent lit est exactement la phrase qu'on veut virale :
un mot-règle, la route, le file:line, « deterministic », et l'issue de secours
(`--arm` si intentionnel). Deux réserves honnêtes : (a) sur un monstre de 580 routes, ~2,2 s
à CHAQUE edit est lourd pour un hook PostToolUse systématique → la recette par défaut doit
matcher `Edit|Write` et/ou se brancher sur `Stop`/pre-commit pour les gros repos (sur l'app
médiane c'est 0,4 s, non-sujet) ; (b) le gate hérite des limites de couverture du compilateur
(un guard dans un helper importé non résolu = invisible) — dit tel quel, jamais masqué.

Recette hook (à packager en plugin — aujourd'hui copiable telle quelle) :

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "npx -y sparda-mcp gate --hook" }
        ]
      }
    ]
  }
}
```
(Monorepo : ajouter `--dir apps/web`. Premier run = auto-arm, rien à configurer.)

---

## 2. LE PLAYBOOK A→I

### B. Positionnement
- **La copy (EN, testée contre le sceptique HN) :**
  *« Your AI agent just replaced an auth wrapper with an identity function. Valid TypeScript,
  tests green, route wide open. `sparda gate` caught it in 1.5 s — deterministically, offline,
  no API key. Reproduce it yourself in one command. »*
- **Le nom :** `sparda gate` (le produit), « the edit-loop gate » (la catégorie). Jamais
  « révolutionnaire / seul au monde » — la formule autorisée : *« the only deterministic,
  sub-2-second, zero-config, zero-key gate that lives inside the agent's edit loop »* (chaque
  adjectif est vérifiable ; la recherche croisée du 2026-07-19 confirme le créneau vide :
  Qodo = review LLM enterprise 70 M$ levés, GitHub/GitGuardian MCP = secrets, Heeler =
  policies, CodeQL = CI/minutes/setup).
- **La démo 60 s scriptée :** `node bench/guard-removal-replay.mjs` — clone dub, injecte le
  sabotage, montre la détection, restaure. Le sceptique la rejoue chez lui : c'est ça qui
  survit à HN, pas l'argument. Responsible disclosure by design (régression INJECTÉE, jamais
  un vrai finding tiers).
- Ce qui survit au sceptique : (1) repro 1 commande ; (2) limites imprimées dans l'output
  (delta-only, coverage %, blindspots) ; (3) silence mesuré sur edit bénin — pas un linter
  qui crie.

### C. Distribution classée (ROI décroissant, effort mesuré)
1. **Registre MCP officiel** — le listing actuel est **v0.10.1 avec le pitch pré-pivot**
  (vérifié via l'API du registre le 2026-07-19) : le seul canal actif diffuse la mauvaise
  identité. Effort ~1 h (server.json + publish). ROI immédiat : c'est du trafic existant
  mal converti.
2. **Plugin Claude Code (hooks) + listes awesome-claude-code** — le canal natif du wedge.
  Effort ~1 j (packaging plugin + 2-3 PR de listing). C'est LE canal où « installer un gate »
  est un geste d'une commande.
3. **GitHub Action Marketplace** — `action.yml` prêt (3 modes), jamais publié. Effort ~1 h
  (tag + release UI). Chaque PR commentée fait la pub à toute l'équipe (mécanique
  Codecov/Snyk, ADR-032).
4. **Registres tiers** (glama — `glama.json` déjà là, smithery, mcp.so) + awesome-mcp-servers.
  Effort ~2 h cumulé.
5. **Cursor hooks** — même mécanique, deuxième client. Après le plugin Claude Code.

### D. Séquence 30 jours → §3 ci-dessous.

### E. Métriques & critères de kill
- **Métrique nord : repos actifs externes** = repos GitHub publics tiers contenant
  `.sparda/ubg.baseline.json` ou le badge (GitHub code search, gratuit, hebdo).
- Proxies d'entonnoir : uniques GitHub/14 j (baseline mesurée : 41) ; installs du plugin ;
  part de la version `latest` dans les dl npm (baseline : 12,5 % — un usage humain la fait
  monter) ; stars (baseline : 3).
- **Seuil de morsure (J+30 après le lancement réel, pas avant) :** ≥ 10 repos actifs externes
  OU uniques ×5 soutenus. **Sinon → pivot**, sans état d'âme, vers : (a) le gate comme
  infra de PLATEFORME (agents-as-a-service qui déploient du code généré — le gate devient
  une feature de leur pipeline, un seul deal remplace 1 000 installs), et/ou (b) la surface
  « behavior model for agents » (MCP : « que fait cette route ? » — la thèse n°1, qui
  partage le même chantier couverture).

### F. La réponse concurrente (quand ils voient le wedge)
- **Qodo (120 M$ total)** : ajoute « deterministic checks » à son agent enterprise. Mais son
  GTM est top-down enterprise et son cœur est LLM — refaire un compilateur sonore, c'est
  refaire les 49 classes d'erreurs (E-001→E-049) et l'oracle corpus : 12-18 mois de grind,
  pas un sprint. Défense : vitesse + rester le standard neutre local.
- **GitHub** : a CodeQL (CI-time, minutes, setup) et pourrait gater Copilot — org lente,
  et leur intérêt valide la catégorie. Défense : être déjà LE gate multi-client
  (Claude Code + Cursor + Action) quand ils bougent.
- **Anthropic** : le vrai risque — un « verify » natif dans Claude Code. C'est AUSSI le
  scénario d'acquisition (§G). Défense : la fenêtre est la vitesse d'ancrage (baselines
  committées = switching cost ; SBIR public = candidat standard) + la neutralité
  cross-client qu'un feature interne n'aura pas.
- Honnête : le moat est mince 6-12 mois. La seule défense est l'exécution immédiate + amorcer
  le genome (la donnée) dès que ça mord.

### G. La thèse Anthropic, opérationnelle
- **Le chemin de l'attention (dans l'ordre) :** (1) le plugin vit dans LEUR écosystème
  (hooks Claude Code) — l'usage est visible de chez eux ; (2) les listes/marketplace
  communautaires ; (3) SEULEMENT après usage démontré : la contribution technique publique
  (SBIR + le replay) vers les mainteneurs MCP/Claude Code — une démo, pas une RFC à froid
  (le M6 « cheval de Troie » de ROADMAP.md reste gelé : sans usage c'est un signal de
  faiblesse).
- **Le seuil buy-not-build** (cohérent avec `THESIS…md` §6 : acquisition ~15-25 % AVEC
  visibilité, ~0 sans) : ~1 000 repos actifs, le plugin dans les listings de tête, SBIR
  consommé par ≥ 1 outil tiers. Ce qui manque aujourd'hui : tout le côté usage — rien
  d'autre.
- La démo qui déclenche la conversation : le replay + « works in Claude Code today, no
  config » + la courbe de repos actifs.

### H. Monétisation (plus tard, sans tuer l'adoption)
- Verrou de Zak maintenu : **zéro paywall tant que l'adoption n'est pas là** (playbook
  2026-07-17). Le gate reste gratuit POUR TOUJOURS — c'est le moteur de distribution.
- Le modèle qui tient ensuite, dans l'ordre de crédibilité : (1) **fleet/genome hébergé**
  (dashboard multi-repos, postures agrégées, politique d'équipe) — exactement le seul cas
  que la BUSL réserve déjà (service hébergé) ; (2) **couche équipe** : politiques par
  outil/personne + journal signé append-only (déjà ROADMAP §3 « Shadow stable ») ;
  (3) support/SLA. La BUSL empêche un hyperscaler de revendre le cœur ; la conversion
  Apache à +4 ans garde la confiance OSS.

### I. Red-team → §5 ci-dessous.

---

## 3. LA SÉQUENCE 30 JOURS (livrables vérifiables)

**S1 — packager + réparer les canaux (J1-J7)**
- J1 : merger `sparda gate` (fait dans cette session, branche
  `claude/sparda-compiler-analysis-3qvx9b`) ; publier 0.66.0.
- J2 : **plugin Claude Code** (hook + recette monorepo) installable en 1 commande ;
  README section « the edit-loop gate » avec le replay en tête.
- J3 : registre MCP → version courante + pitch gate/trust-layer ; glama ; smithery.
  *Vérifiable : l'API du registre renvoie la nouvelle description.*
- J4 : GitHub Action publiée au Marketplace (tag + release).
- J5 : fixer `review --base` monorepo (bug mesuré ARBITRE-1, toujours présent) ; remplacer
  la demo bundlée (mesurée SURFACE ONLY 0 % — l'anti-démo) par le replay.
- J6-7 : **Classe 2 des FP (gardes par état)** — obligatoire avant tout regard public
  (`TWO-FALSE-POSITIVE-CLASSES…md` : le faux CRITICAL est fatal en première impression).

**S2 — dogfood + présence (J8-J14)**
- Gate actif sur 3 vrais repos Residual Labs (tuer la ligne « dogfooding : 0 » de la due
  diligence) ; baselines committées. *Vérifiable : les `.sparda/` dans les repos.*
- 5-10 PR : awesome-claude-code, awesome-mcp-servers, listes hooks. *Vérifiable : PR mergées.*
- 3 mini case studies chiffrées (routes/coverage/latence, sabotage-replay par repo).

**S3 — le lancement (J15-J21)**
- **Show HN — le titre :** *« Show HN: My AI agent removed an auth check. A deterministic
  2-second gate caught it »*. **L'asset :** le replay 1-commande + un GIF de 20 s du hook
  qui bloque l'edit dans Claude Code. Le post dit les limites (delta-only, couverture,
  JS/TS/Python) AVANT qu'un commentateur les trouve.
- Même asset décliné : r/ClaudeAI, X, lobste.rs.

**S4 — mesurer, décider (J22-J30)**
- Tableau hebdo des métriques §E. Si morsure → seeder `sparda-genome` v0 (fingerprints +
  verdicts des géants OSS, git-backplane, coût 0) et 2ᵉ client (Cursor hooks).
- Si pas de morsure au seuil §E → exécuter le pivot §E, documenté, sans 6 mois d'espoir.

---

## 4. LES 3 CLÉS QUI DÉCIDENT DE TOUT

1. **Le gate dans la boucle d'édit** — construit et mesuré (1,5-2 s sur un monstre, 55 ms
  sur l'app médiane, silence sur edit bénin). Sans lui, SPARDA reste un compilateur que
  personne ne rencontre.
2. **Les canaux agent-natifs réparés** — registre (aujourd'hui périmé v0.10.1), plugin,
  Action. C'est là que « zéro audience » cesse d'être une condamnation : l'agent installe,
  pas l'humain.
3. **La discipline zéro-bruit** — delta-only + Classe 1 (livrée) + Classe 2 (à livrer avant
  lancement). Un seul faux CRITICAL en première impression et tout le reste est invalidé
  (`TWO-FALSE-POSITIVE-CLASSES…md`).

## 5. RED-TEAM (les 3 morts possibles + contres)

1. **Personne n'installe de hook** (friction psychologique : « un binaire qui tourne à chaque
  edit »). *Contre :* silence-quand-clean mesuré, latence médiane 0,4 s, ET le funnel
  parallèle plus doux (Action CI + badge) — on mesure les DEUX entonnoirs, le hook n'est
  pas un pari unique.
2. **L'humiliation FP au premier contact** (Classe 2 non livrée ; un state-guard immich lu
  CRITICAL). *Contre structurel :* le gate est delta-only — les FP pré-existants ne parlent
  JAMAIS dans la boucle d'édit (mesuré : silence sur edit bénin) ; Classe 2 avant lancement ;
  medium/info ne bloquent jamais (codé).
3. **Un géant ship la même UX à J+60 de la visibilité.** *Contre :* vitesse d'ancrage
  (baselines = switching cost, SBIR publié = candidat standard), neutralité cross-client,
  et si ça arrive : la catégorie est validée et le chemin acqui-hire (§G) devient réel.
  Honnête : ce scénario peut quand même perdre — c'est le prix d'un marché réel.

## 6. VERDICT FINAL

Le wedge n'est plus une hypothèse : il est codé, testé (687 verts), et mesuré sur un
codebase de production — 1,5 s pour attraper la dé-protection qu'un agent LLM produit
réellement, silence sur le reste. Le créneau est vide et financé. Mais rien de tout ça ne
compte tant que les trois canaux (registre, plugin, Action) diffusent l'ancienne identité ou
rien : **la condition unique de l'expansion est d'exécuter S1-S2 sans retomber une seule
journée dans le moteur.** Probabilités honnêtes, cohérentes avec la projection de
`THESIS…md` : percée fulgurante type PLG breakout **~10-20 %** ; adoption réelle et position
différenciée-respectée **~50-60 %** si le plan est exécuté tel quel ; **~0 %** si le gate
reste non packagé. Le moteur a cessé d'être le risque ; le risque, c'est l'agenda.

*Session Fable 5 du 2026-07-19 (ARBITRE-2). Prototype + mesures + ce playbook commités
ensemble. Sources externes : TechCrunch 2026-03-30 (Qodo 70 M$) ; Sonar State of Code 2026
(96 %/48 %) ; The New Stack 2026 (43 %) ; API registry.modelcontextprotocol.io (2026-07-19).*
