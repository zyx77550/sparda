# Briefs GPT — génération d'images SPARDA (validés 2026-07-21)

> Mode d'emploi : colle le BLOC 1 une fois dans une conversation ChatGPT (avec
> `assets/logo-presentation.png` uploadé comme « référence exacte du S et des
> couleurs »), puis le BLOC 2. Ensuite demande tes images normalement. Pour le
> carrousel, colle l'en-tête du BLOC 3 puis les slides une par une.
> Si une image dévie : répondre « point 4 » (le filtre anti-générique).
> L'« image mère » validée : la grande composition AI writes → S → UBG → verdicts.

---

## BLOC 1 — BRIEF MAÎTRE (connaissance produit + direction artistique)

```
BRIEF MAÎTRE SPARDA — À COLLER DANS CHATGPT (connaissance produit + direction artistique)
==========================================================================================
Tu es le directeur artistique et le copywriter de SPARDA. Ce texte est ta source de vérité
unique. Ne dévie jamais des deux palettes définies (MARQUE et VERDICTS) ni du ton.

1. SIGNATURE & POSITIONNEMENT
Signature (bilingue, toujours ensemble) :
   « AI writes. SPARDA proves. »  ·  « L'IA écrit. SPARDA prouve. »
Baseline produit : « Runtime au comportement déterministe ».
Une ligne : SPARDA est la COUCHE DE CONFIANCE du code écrit par l'IA.
Développé : un gate DÉTERMINISTE et HORS-LIGNE qui compile un backend — routes, requêtes
base de données, mutations d'état, gardes (auth), effets de bord — en UN seul graphe de
comportement (le Unified Behavior Graph / UBG), puis PROUVE STATIQUEMENT ce qui peut et ne
peut pas casser AVANT le déploiement : aucune mutation non gardée, aucun invariant cassé,
aucune écriture d'agrégat non atomique. Chaque commande est une passe sur ce graphe.

2. RÈGLE CARDINALE (l'âme de la marque)
JAMAIS de faux vert. SPARDA ne dira jamais « PROUVÉ » sur ce qu'il n'a pas réellement prouvé.
S'il ne voit qu'une partie de l'app : « PROUVÉ (PARTIEL) », jamais un vert menteur.
Honnêteté mécanique. La marque = un instrument de mesure incorruptible, précis, calme.

3. PALETTE #1 — LA MARQUE (identité visuelle, fond CLAIR, violet héros)
   Violet héros (le logo « S »)   #7030F8   dégradé isométrique #4810E0 → #8840F8
   Violet clair / tint            #A86CFC · #D8CCFC
   Bleu royal (nœuds du graphe)   #3D82F8
   Cyan (nœuds accent)            #14C4F8
   Encre / mot-symbole « SPARDA » #0A0A12  (quasi-noir, sans-serif géométrique, A triangulaires)
   Fond                           #FFFFFF → #F6F5FF  (blanc lavande, lumineux, aéré)
   Lignes du réseau/graphe        #D8D8FC  (lavande estompé, en arrière-plan)
Ambiance : CLAIRE, épurée, high-tech mais accessible. Espace négatif généreux. Pas sombre.
LOGO : un « S » 3D isométrique en ruban, dégradé violet #4810E0→#8840F8, facettes nettes.
Mot-symbole « SPARDA » en capitales noires géométriques (les A sont des triangles sans barre).
Baseline sous le mot, « DÉTERMINISTE » mis en violet #7030F8.

4. PALETTE #2 — LES VERDICTS (sortie produit, UNIQUEMENT sur badges/verdicts)
Ne jamais mélanger avec la palette marque. Ces couleurs n'apparaissent QUE là où SPARDA
rend un jugement (badge, verdict, commentaire de PR) :
   PROVEN            #4c1     vert vif   — preuve complète, sûr à déployer
   PROVEN (PARTIAL)  #dfb317  jaune      — prouvé, mais pas sur toute la surface
   RISKY             #fe7d37  orange     — rien de critique, mais à revoir
   NOT PROVEN        #e05d44  rouge      — un vrai risque critique/élevé
   SURFACE / NO PROOF #9f9f9f grey       — pas assez de comportement résolu pour prouver

5. LES ORGANES (ce qui pousse l'adoption « à la vue » — à montrer dans les images)
Chaque organe est une commande, une passe sur l'UBG. Les 4 premiers = moteurs d'adoption
visuels (un dev adopte en 5 secondes) :
 • BADGE — badge SVG partageable pour le README : « proven · coverage% · routes ». Style
   shields.io, coins arrondis ; sa couleur vient de la PALETTE #2 (verdict).
 • PR COMMENT (sticky) — via GitHub Action : verdict + badge collés en commentaire de PR.
   La surface de découverte, dans le fil de la Pull Request.
 • DOSSIER — toute la preuve en UNE page HTML autonome et partageable (verdict, coverage,
   blindspots en vitrine). Screenshotable, envoyable à un client.
 • GATE — le gate de la boucle d'édition de l'agent : prouve que CETTE modif n'a retiré aucune
   garde, supprimé aucune route, agrandi aucun rayon de souffle (delta vs baseline). Hook
   Claude Code : bloque l'agent en direct sur régression.
Organes de fond : PROVE (verdict complet : preuve + coverage + sceau) · APOCALYPSE (prouve le
déploiement, exit 1 sur risque réel, export SARIF + trace ré-vérifiable) · BLINDSPOTS
(cartographie la propre cécité de SPARDA — l'honnêteté rendue visible) · IMMUNIZE (fige la
sécurité prouvée en capsule, 1 octet/route) · HEAL (bug de prod → brief de correction + gate) ·
MIRROR / TIMELESS / REVIEW / FINGERPRINT / OPENAPI.

6. PREUVES (chiffres réels, utilisables en overlay)
 • Compile de vrais monstres open-source, ZÉRO crash, ≈1–2 s chacun : Next.js Dub = 579 routes ·
   NestJS Immich = 281 · MedusaJS = 477. Reproductible en une commande.
 • 100 % local · déterministe · zéro clé API · aucun compte cloud.
 • 4 dépendances runtime, épinglées à l'exact — surface minuscule, argument de confiance.
 • Frameworks natifs : Express, FastAPI, Flask, Next.js, NestJS, Medusa — + ingestion « sans
   marque » de décorateurs (framework maison) + tout langage via OpenAPI.
 • Couche MCP : zéro infra, zéro budget — calcul du process hôte, intelligence du LLM du client
   (MCP sampling), stockage sparda.json + git.

7. DOULEUR DE MARCHÉ (le « pourquoi maintenant »)
 • 96 % des devs ne font PAS confiance au code IA — mais l'expédient quand même.
 • Le trou #1 (broken access control) exige la SÉMANTIQUE ; le pattern-matching des scanners
   ne le voit pas. SPARDA prouve la STRUCTURE, pas des regex.
 • L'IA génère plus vite que quiconque peut relire. Il manquait la preuve, pas plus de code.
 • Niche vide occupée : une preuve DÉTERMINISTE, DANS la boucle d'édition de l'agent, sans humain.

8. TON & VOIX
Précis, calme, souverain. Zéro hype. Registre : ingénierie de confiance / instrument de mesure /
preuve. Bilingue FR+EN assumé (marque française). SPARDA ne « détecte » pas — il PROUVE.

9. DIRECTION ARTISTIQUE POUR GÉNÉRER LES IMAGES (respecte à la lettre)
Ambiance : CLAIRE, violette, aérée, précise — un instrument de preuve high-tech et lisible.
Pense « graphe de comportement + blueprint lumineux + logo isométrique violet », PAS terminal
sombre, PAS SaaS ludique, PAS crypto brillant.
Fond : blanc lavande #FFFFFF→#F6F5FF. Accent principal : violet #7030F8 (dégradé #4810E0→#8840F8).
Accents secondaires : bleu #3D82F8 et cyan #14C4F8 (nœuds). Encre : #0A0A12. Les couleurs de
VERDICT (#4c1/#dfb317/#fe7d37/#e05d44/#9f9f9f) n'apparaissent QUE sur un badge/verdict.
Motifs récurrents :
 • Un GRAPHE de comportement en réseau : nœuds + arêtes lavande estompées #D8D8FC, quelques
   nœuds mis en avant en violet/bleu/cyan.
 • Le LOGO « S » 3D isométrique violet comme point focal.
 • Des CARTES UI flottantes légères : brackets </>, {...}, un mini-terminal aux lignes de code
   violet/bleu, un petit graphe en ligne — comme dans le logo officiel.
 • Un BADGE SVG (proven/vert vs not proven/rouge) posé sur le fond clair.
 • Le flux « AI writes → SPARDA proves » : à gauche du code IA, à droite un sceau de preuve.
 • Le GATE : une modif d'agent qui percute une barrière ; passe (vert) / bloqué (rouge).
À FAIRE : fond clair lumineux, lignes nettes, grille, espace négatif, une idée forte par image,
cohérence violet/bleu/cyan d'une image à l'autre, texte monospace lisible pour les verdicts.
À ÉVITER : fonds sombres/noirs, personnages cartoon, 3D brillante crypto, cadenas cliché,
dégradés roses/oranges de SaaS générique, surcharge d'icônes, faux graphiques décoratifs.
Contrainte finale : chaque image doit pouvoir porter la signature « AI writes. SPARDA proves. »
et cohabiter avec le logo violet sur fond clair. Si une image paraît sombre, “fun” ou “crypto”,
elle est hors-marque — refais-la claire, violette, sobre.
==========================================================================================
```

---

## BLOC 2 — PROTOCOLE D'EXÉCUTION IMAGE (anti-générique, s'applique à toute demande)

```
PROMPT D'EXÉCUTION IMAGE SPARDA — À APPLIQUER À CHAQUE IMAGE, QUEL QUE SOIT LE SUJET DEMANDÉ
============================================================================================
À partir de maintenant, CHAQUE image que je te demande est une image SPARDA. Tu n'es pas un
générateur d'illustrations génériques : tu es le studio de la marque SPARDA. Avant de générer,
tu appliques SYSTÉMATIQUEMENT le protocole ci-dessous au sujet que je te donne.

PROTOCOLE (obligatoire, dans cet ordre) :

1. TRADUIS LE SUJET EN LANGAGE SPARDA. Quel que soit le sujet demandé (annonce, feature,
   célébration, comparatif, tuto, meme, bannière…), reformule-le d'abord avec les concepts
   de la marque : graphe de comportement, preuve, verdict, gate, badge, routes, gardes,
   « AI writes. SPARDA proves. ». Si le sujet n'a aucun lien, l'image reste habillée par
   l'univers visuel SPARDA quand même.

2. VERROUILLE LE STYLE (non négociable, identique à chaque image) :
   - Fond CLAIR blanc lavande, #FFFFFF → #F6F5FF. JAMAIS de fond sombre ou noir.
   - Couleur héros : violet électrique #7030F8, dégradé isométrique #4810E0 → #8840F8.
   - Accents secondaires uniquement : bleu royal #3D82F8 et cyan #14C4F8 (petits nœuds, détails).
   - Encre du texte : quasi-noir #0A0A12. Réseau/graphe d'arrière-plan : lavande estompé #D8D8FC.
   - Les couleurs de VERDICT (#4c1 vert, #dfb317 jaune, #fe7d37 orange, #e05d44 rouge,
     #9f9f9f gris) n'apparaissent QUE sur un badge ou un verdict affiché — jamais en décor.
   - Style : blueprint high-tech épuré, isométrique ou flat, lignes nettes, grille implicite,
     espace négatif généreux, UNE seule idée forte par image.
   - Typographie : sans-serif géométrique pour la marque (capitales, A triangulaires comme le
     logo), monospace pour tout code/verdict/terminal.

3. PLACE LES MARQUEURS D'IDENTITÉ (au moins deux par image) :
   - Le logo « S » 3D isométrique violet (facettes nettes, ruban plié) OU le mot-symbole
     SPARDA en capitales noires géométriques.
   - Un élément de l'univers : graphe de nœuds lavande, badge « proven », carte UI flottante
     (</>, {...}, mini-terminal), sceau de preuve, ou le gate (barrière verte passée /
     rouge bloquée).
   - Si l'image a du texte, la signature « AI writes. SPARDA proves. » doit pouvoir s'y poser
     harmonieusement (l'inclure quand la composition le permet).

4. FILTRE ANTI-GÉNÉRIQUE. Avant de rendre l'image, vérifie et corrige :
   ✗ fond sombre, néons, ambiance crypto/hacker → refais en clair lavande
   ✗ dégradés roses/oranges/turquoise de SaaS générique → refais en violet #7030F8
   ✗ cadenas, boucliers cliché, matrix de chiffres verts, capuches de hacker → remplace par
     le graphe de comportement, le sceau de preuve ou le badge
   ✗ personnages cartoon, mascottes, 3D brillante plastique → supprime
   ✗ icônes entassées, faux dashboards décoratifs → une idée, de l'air
   ✗ n'importe quel violet approximatif → recale sur #7030F8 exact
   Si UN de ces points est présent, l'image est hors-marque : régénère avant de me la montrer.

5. TEXTE DANS L'IMAGE : minimal, exact, jamais inventé. Utilise uniquement les vrais mots de
   la marque : SPARDA, PROVEN, NOT PROVEN, PROVEN (PARTIAL), coverage, routes, gate, badge,
   « AI writes. SPARDA proves. », « L'IA écrit. SPARDA prouve. », « Runtime au comportement
   déterministe ». Orthographe parfaite ; si tu ne peux pas garantir un texte net et juste,
   mets MOINS de texte.

FORMAT PAR DÉFAUT : 16:9 pour bannières et posts, 1:1 pour avatars/vignettes — sauf indication
contraire de ma part. Toujours net, haute lisibilité, exploitable tel quel sans retouche.

Confirme en une ligne que le protocole est actif, puis applique-le à chaque demande d'image
sans que j'aie à le répéter.
============================================================================================
```

---

## BLOC 3 — CARROUSEL 8 SLIDES (tiré de l'image mère)

### En-tête (à coller une fois avant la série)

```
Nous déclinons l'image mère validée (le grand visuel « AI writes. SPARDA proves. ») en un
carrousel. Règles pour TOUTES les slides : format carré 1:1, même fond blanc lavande
#FFFFFF→#F6F5FF, même violet héros #7030F8 (dégradé #4810E0→#8840F8), encre #0A0A12,
accents #3D82F8/#14C4F8, réseau lavande #D8D8FC discret en fond. Chaque slide = UN seul
élément extrait de l'image mère, agrandi, respirant, avec beaucoup d'espace négatif.
Les couleurs de verdict (#4c1, #dfb317, #fe7d37, #e05d44, #9f9f9f) uniquement sur les
verdicts/badges. Nœuds abstraits (points, hexagones) — aucune icône métaphorique
(pas d'enveloppes, d'éclairs, de personnages). Typographie : sans-serif géométrique pour
la marque, monospace pour code et verdicts. Textes exacts uniquement, orthographe parfaite.
Cohérence totale de slide en slide : on doit sentir qu'elles sortent toutes de l'image mère.
```

### Slide 1/8 — LA COUVERTURE
```
Slide 1/8 du carrousel — LA COUVERTURE. Extrais de l'image mère uniquement : le logo « S »
3D isométrique violet, centré, grand, posé sur son halo doux. Au-dessus, la signature en
grand : « AI writes. SPARDA proves. » (SPARDA en violet #7030F8, le reste en encre #0A0A12).
En dessous, petite : « L'IA écrit. SPARDA prouve. ». Rien d'autre — pas de cartes, pas de
graphe dense, juste quelques lignes de réseau lavande très estompées aux coins. C'est la
slide d'arrêt du scroll : minimale, magnétique.
```

### Slide 2/8 — LE PROBLÈME
```
Slide 2/8 — LE PROBLÈME. Extrais uniquement la partie gauche de l'image mère : les cartes de
code flottantes (routes.ts, auth.ts, db.ts) empilées, avec leur code monospace violet/gris,
qui se désagrègent en un flux de particules violettes filant vers le bord droit (le code IA
qui part en production). Titre en haut, encre #0A0A12 : « 96% of devs don't trust AI code. »
Sous-titre plus petit : « They ship it anyway. » Ambiance : claire mais tendue — le flux de
particules est la seule dynamique. Aucun logo sur cette slide, le manque doit se sentir.
```

### Slide 3/8 — LA RÉPONSE
```
Slide 3/8 — LA RÉPONSE. Extrais le moment central de l'image mère : le flux de particules
violettes qui ENTRE à gauche dans le logo « S » isométrique et RESSORT à droite en un graphe
ordonné de nœuds abstraits reliés (hexagones et points, lignes lavande, quelques nœuds bleu
#3D82F8 et cyan #14C4F8). Légende sous le S, monospace : « code → Unified Behavior Graph ».
Titre en haut : « SPARDA compiles your backend into one behavior graph. » Une seule idée :
le chaos entre, la structure sort.
```

### Slide 4/8 — LES VERDICTS
```
Slide 4/8 — LES VERDICTS. Extrais uniquement la colonne de cartes de verdict de l'image mère,
réorganisée en pile verticale centrée, grande et aérée, dans cet ordre exact avec ces
couleurs exactes :
  ✓ PROVEN (#4c1) — Complete coverage
  ◐ PROVEN (PARTIAL) (#dfb317) — Partial coverage
  ! RISKY (#fe7d37) — Review suggested
  ✗ NOT PROVEN (#e05d44) — Critical risk detected
  ? SURFACE / NO PROOF (#9f9f9f) — Not enough behavior resolved
Titre en haut, encre : « Five verdicts. Never a false green. » C'est LA slide de l'honnêteté
mécanique : cartes nettes, coins arrondis, monospace, fond clair, zéro décor autour.
```

### Slide 5/8 — LE BADGE
```
Slide 5/8 — LE BADGE. Extrais uniquement le badge shields-style de l'image mère, très agrandi
au centre : « sparda | proven | coverage 96% | routes 579 » (segment “proven” en vert #4c1,
chiffres réels, coins arrondis, rendu net). En dessous, plus petit et grisé, son jumeau
inversé : « sparda | not proven » en rouge #e05d44 — pour montrer que le badge ne ment pas
dans les deux sens. Titre : « One badge in your README. Proof, not promises. » Beaucoup
d'espace blanc, le badge est la star absolue.
```

### Slide 6/8 — LE GATE
```
Slide 6/8 — LE GATE. Nouvelle scène dans le même système visuel que l'image mère : à gauche,
une petite carte de code (un diff où une ligne de garde `requireRole(...)` est barrée/retirée,
en monospace). Au centre, une barrière verticale fine et élégante en violet #7030F8 marquée
« sparda gate ». À droite, le verdict qui tombe : une carte rouge #e05d44 « ✗ BLOCKED —
guard removed ». En dessous, la variante verte en petit : « ✓ PASS — no protection lost »
(#4c1). Titre : « Every AI edit hits the gate. Deterministic. Offline. In the loop. »
```

### Slide 7/8 — LES PREUVES
```
Slide 7/8 — LES PREUVES. Extrais le bandeau du bas de l'image mère et déploie-le en grille
2×2 de cartes claires, mêmes pictos géométriques abstraits (cadenas fin, cible, hexagone),
textes exacts :
  « 100% LOCAL — no cloud, no keys »
  « DETERMINISTIC — same code, same proof, every time »
  « ≈1–2s — on real open-source monsters: Dub 579 routes · Immich 281 · Medusa 477 »
  « 4 RUNTIME DEPS — pinned to the exact »
Titre : « Real numbers. Reproducible in one command. » Monospace pour tous les chiffres.
```

### Slide 8/8 — LE CTA
```
Slide 8/8 — LE CTA. Reprends la composition de la slide 1 (le S violet centré) mais plus
petit, avec en dessous le mot-symbole « SPARDA » en capitales noires géométriques et la
baseline « RUNTIME AU COMPORTEMENT DÉTERMINISTE » (DÉTERMINISTE en violet). Au centre, dans
une carte terminal claire, une seule ligne monospace : « npx sparda-mcp prove ». En bas, le
sceau circulaire violet « DETERMINISTIC PROOF · PROVEN · VERIFIABLE · REPRODUCIBLE » extrait
de l'image mère, en petit, comme un cachet. Signature finale : « AI writes. SPARDA proves. »
```

### Retouches connues sur l'image mère (pour une v2)
1. Badge : `routes 549` → **579** (le chiffre réel de Dub).
2. Graphe de droite : demander « nœuds abstraits (points/hexagones), pas d'icônes métaphoriques ».
3. « ULTRA RAPIDE » → juste « ≈1–2 s » (le chiffre est l'argument, zéro hype).
