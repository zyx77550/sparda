# Passation CSOP → pour Fable (à lire quand tu reprends)

> **De :** session Claude (Zak) · **Statut algo :** terminé et validé · **Statut intégration :** à faire.
> **Ordre imposé par Zak — ne pas inverser :**
>
> ## ⚠️ 1) D'ABORD finis ce que tu fais (G1 phase 2). 2) SEULEMENT APRÈS, applique l'algo CSOP.
>
> Ce n'est pas un caprice d'ordre : **G1 phase 2 est le prérequis mesuré qui rend CSOP bon.**
> Voir la mesure ci-dessous. Ne branche pas CSOP avant que G1 phase 2 soit vert.

---

## Ce qu'il y a dans ce dossier

- `algorithm/` — l'algorithme **Cross-Service Object-Ownership Proof (CSOP)**, fini et validé.
  TypeScript, zéro dépendance runtime, déterministe, pur. C'est la version MAX (7 itérations).
  - `csop.ts` (l'algo), `types.ts` (le schéma d'entrée), `csop.test.ts` (20 tests).
  - **État vérifié :** `npm test` = 20/20 vert. Plus une batterie adverse indépendante
    (auth-seul → non sûr ; check-après-sink → non sûr ; callee public flaggé malgré vérif amont ;
    callee interne + vérif → sûr ; exposure absent → défaut prudent ; déterminisme) = 6/6.
  - **Propriété clé (la seule non négociable) :** il ne dit JAMAIS « sûr » à tort. Même discipline
    que le reste de SPARDA — pas de faux PROVEN.
- `adapter/sparda-to-csop.mjs` — l'adaptateur prototype **UBG (SPARDA) → DBG (CSOP)**. Il extrait
  des graphes SPARDA : entrypoints, effects `http_call` (appels sortants), effects `db_read`/
  `db_write` (sinks), guards ; infère l'exposure (public/interne) ; construit le format CSOP.
  C'est un prototype de référence pour l'intégration, pas du code de prod.

## Ce que CSOP apporte

Détecte le **BOLA cross-service** : service A (authentifié) transmet un id fourni par
l'utilisateur à service B qui le supprime/lit sans prouver l'appartenance. **Aucun outil mono-repo
(CodeQL/Semgrep/Snyk) ne voit ça.** SPARDA produit déjà l'artefact qu'il faut (un graphe par repo)
— CSOP le prouve à travers la frontière.

## La mesure qui impose l'ordre (G1 avant CSOP)

Batterie de 6 topologies Express réelles, compilées par SPARDA → adaptateur → CSOP :

| Cas | Attendu | Résultat |
|---|---|---|
| cross-service vulnérable | faille | ✅ |
| cross-service sûr (scope `where`) | rien | ✅ |
| mono-service vulnérable | faille locale | ✅ |
| mono-service sûr | rien | ✅ |
| chaîne 3 services | faille | ✅ |
| **protégé par helper `getXOrThrow`** | rien | ❌ **faux positif** |

**5/6 = 83%.** Le seul raté est le cas `getXOrThrow` : le backend EST sûr (le helper vérifie
`workspaceId` avant le delete), mais SPARDA ne voit pas la vérif faite dans le **helper importé**
→ le sink lit `ownerScoped: false` → CSOP flague à tort. **C'est exactement G1 phase 2**
(`docs/G1-ROOT-CAUSE-AND-FIX-SPEC-2026-07-18.md` §3 / §6, option A : câbler les effets des helpers
importés dans `reachOf`). Vérifié en direct : le graphe de ce backend ne contient QUE le `delete`
non scopé — l'adaptateur ne peut rien y faire, la donnée manque à la source.

**Conséquence :**
- Tant que G1 phase 2 n'est pas fait → CSOP produit ce faux positif (et les ~39 faux BOLA
  restants sur dub viennent du même trou).
- **Dès que G1 phase 2 est vert → CSOP passe 5/6 → 6/6 sur cette batterie, ET dub tombe de ~39 à
  ~15 faux positifs.** Un seul fix, deux gains. D'où l'ordre.

## Plan d'intégration (APRÈS G1 phase 2)

1. Finir G1 phase 2 (ton travail en cours) — le prérequis. Suite complète verte + un fixture
   type `getXOrThrow`.
2. Porter l'algo `algorithm/csop.ts` en module SPARDA (`src/ubg/csop.js` ou étendre `stitch.js`,
   qui fait déjà le liage cross-repo mais s'arrête au match structurel — CSOP est le niveau
   au-dessus : la preuve d'appartenance propagée à travers la frontière).
3. Reprendre la logique de `adapter/sparda-to-csop.mjs` pour alimenter CSOP depuis le vrai UBG
   (au lieu du prototype externe). Points durs identifiés : l'exposure (public/interne — vient du
   déploiement, pas du code ; défaut prudent = public), le mapping précis des params transmis.
4. Advisory-only (comme `OBJECT_SCOPE_UNPROVEN` / la posture de `stitch.js`) : ne gate JAMAIS le
   verdict. Un faux positif coûte « un humain regarde » ; jamais un faux « sûr ».
5. Re-mesurer sur la batterie (à recréer, elle était éphémère) + viser une vraie cible :
   un système microservices open-source réel.

## Spécification complète de l'algo (si tu réécris)

`docs/KIMI-SPEC-CROSS-SERVICE-BOLA-PROOF.md` (branche `docs/kimi-csop-spec`) contient la spec
clean-room complète : schéma d'entrée, treillis d'appartenance, propagation cross-service,
invariants de solidité, exemples chiffrés. `algorithm/csop.ts` en est l'implémentation validée.

> Rappel de l'ordre : **G1 phase 2 d'abord. CSOP ensuite.** L'algo est prêt et t'attend ;
> il ne donnera son plein résultat qu'une fois le moteur capable de voir les helpers importés.
