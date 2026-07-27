# SPARDA — Brand Kit (source de vérité marketing)

> Tout ce qu'il faut pour produire des visuels, vidéos et textes SPARDA cohérents
> sans jamais repartir de zéro. Validé le 2026-07-21 (image mère GPT + vidéo de
> lancement). Les couleurs sont **eyedropées du logo officiel**
> (`assets/logo-presentation.png`), pas inventées.

## Les deux palettes (ne JAMAIS les mélanger)

### Palette #1 — LA MARQUE (identité, fond clair, violet héros)

| Rôle | Hex |
|------|-----|
| Violet héros (le « S ») | `#7030F8` — dégradé isométrique `#4810E0` → `#8840F8` |
| Violet clair / tint | `#A86CFC` · `#D8CCFC` |
| Bleu royal (nœuds) | `#3D82F8` |
| Cyan (nœuds accent) | `#14C4F8` |
| Encre / mot-symbole | `#0A0A12` |
| Fond | `#FFFFFF` → `#F6F5FF` (blanc lavande) |
| Lignes réseau/graphe | `#D8D8FC` |

Ambiance : **claire**, épurée, high-tech accessible. Jamais de fond sombre pour
la marque. Typo : sans-serif géométrique (Space Grotesk ~ le mot-symbole a des
A triangulaires), monospace (JetBrains Mono) pour code/verdicts.

### Palette #2 — LES VERDICTS (sortie produit, uniquement sur badge/verdict)

| Verdict | Hex | Sens |
|---------|-----|------|
| PROVEN | `#44CC11` | preuve complète, sûr à déployer |
| PROVEN (PARTIAL) | `#DFB317` | prouvé, mais pas sur toute la surface |
| RISKY | `#FE7D37` | rien de critique, à revoir |
| NOT PROVEN | `#E05D44` | un vrai risque critique/élevé |
| SURFACE / NO PROOF | `#9F9F9F` | pas assez de comportement résolu |

(Source engine : `src/ubg/apocalypse.js` `BADGE_COLOR`.)

## Signatures

- « **AI writes. SPARDA proves.** » · « **L'IA écrit. SPARDA prouve.** » (toujours bilingue)
- Baseline : « Runtime au comportement déterministe » / « Deterministic behavior runtime »
- Règle cardinale à l'écran : **jamais de faux vert** — un verdict vert n'apparaît
  que sur quelque chose de réellement prouvé.

## Chiffres réels utilisables (overlay, badges)

- Dub **579 routes** · Immich **281** · Medusa **477** — compilés en ≈1–2 s, zéro crash, reproductible.
- 100 % local · déterministe · zéro clé API · **4 deps runtime épinglées**.
- Frameworks natifs : Express, FastAPI, Flask, Next.js, NestJS, Medusa (+ décorateurs sans-marque, + OpenAPI).
- 96 % des devs ne font pas confiance au code IA (l'angle douleur).

## Assets

- `assets/logo-presentation.png` — bannière officielle (source des couleurs).
- `marketing/launch-video/public/s-logo.png` — le S isométrique détouré (transparent).
- `marketing/launch-video/public/wordmark.png` — le mot-symbole SPARDA détouré.
- `marketing/launch-video/public/*.wav` — sound design synthétisé (frappe, riser,
  impact, ding, whoosh, pops) — réutilisable dans toute vidéo.

## Vidéo de lancement (jamais repartir de zéro)

`marketing/launch-video/` — la vidéo EST du code (Remotion). FR + EN, 36 s,
1080×1920 (TikTok/Reels/LinkedIn). `npm install && npm run render:fr` /
`render:en`. Textes dans `src/copy.ts`, timeline dans `src/Video.tsx` (`T`),
couleurs dans `src/theme.ts`. Une nouvelle vidéo = éditer copy/scènes + re-render.
Rendus de référence : `marketing/renders/`.

## Briefs GPT prêts à coller

`marketing/GPT-IMAGE-BRIEFS.md` — les 3 blocs validés : (1) brief maître
connaissance+DA, (2) protocole d'exécution anti-générique, (3) les 8 prompts du
carrousel. À coller dans ChatGPT avec `assets/logo-presentation.png` en référence.
