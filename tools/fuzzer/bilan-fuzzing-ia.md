# Bilan — campagne de fuzzing IA (Ollama / qwen2.5-coder)

**Date :** 2026-07-28 · **Modèle :** `qwen2.5-coder:1.5b` · **Cibles :** `apocalypse.js`,
`nestjs.js`, `extract.js`

## Ce qui a été mesuré

- **2 224 mutants** générés par le modèle, vérifiés au caractère près contre la source
  (`indexOf`), physiquement écrits dans les fichiers, puis testés.
- **0 SURVIVED.** Aucune mutation injectée n'a laissé passer le test gardien correspondant.
- Les mutants dont la chaîne de recherche ne correspondait pas exactement sont comptés
  `Skipped` et **exclus du dénominateur** — ils n'ont jamais touché le disque.

C'est un stress-test sérieux, et l'absence de survivant sur cette surface est un vrai
signal. Ce n'est pas une preuve, et la suite dit pourquoi.

## Ce qui n'a PAS été mesuré (et pourquoi le chiffre a été borné)

Le premier harnais comptait **tout échec de test comme un kill**. Trois causes très
différentes tombaient dans la même case :

| cause | ce que ça mesure | comptait comme |
|---|---|---|
| assertions du test en échec | **la suite** — le vrai kill | KILLED ✅ |
| mutant syntaxiquement invalide → Babel refuse le fichier | le parseur, pas la suite | KILLED ❌ |
| run coupé par le timeout (5 s) | **rien du tout** | KILLED ❌ |

Le troisième cas est le plus dangereux : une mutation qui ferait *boucler* l'analyseur
serait tuée par le timeout et lue comme « attrapée », alors que rien n'a été observé. C'est
exactement l'inversion que SPARDA existe pour interdire — « on n'a pas pu mesurer » compté
comme « on a mesuré et rien ne cloche ».

Et le harnais ne conservait que les **survivants** dans `bilan-fuzzing-ia.json`. Avec zéro
survivant, **rien n'a été gardé** : la campagne de 2 224 mutants n'est pas auditable
a posteriori, y compris par nous.

**Conclusion honnête sur le 2 224 / 2 224 : une part inconnue de ces kills est attribuable
au parseur, pas aux tests.** Le chiffre borne le risque vers le haut ; il ne le mesure pas.

## Corrections apportées au harnais

1. **Trois issues distinctes** — `KILLED`, `PARSE_ERROR`, `TIMEOUT` — décidées en lisant
   stderr (qui était capturé puis jeté ; c'est ESLint qui l'a signalé).
2. **Timeout porté de 5 s à 15 s.** Le baseline mesuré des trois tests cibles est
   1,1–1,6 s ; 15 s laisse un ordre de grandeur de marge, donc un timeout signifie désormais
   quelque chose de pathologique — et il est rapporté comme **non mesuré**, jamais comme un
   kill.
3. **Chaque mutant est enregistré**, pas seulement les survivants, avec son fichier, son
   test, sa recherche/remplacement et les dernières lignes d'erreur.
4. **Le taux de kill est rapporté sur les mutants qui ont réellement tourné**
   (`killed / (killed + survived)`), avec les parse-errors et les timeouts affichés à part.

## Limite restante, non corrigée

Le modèle ne voit que `targetContent.slice(0, 3000)` — les ~40 premières lignes de 3
fichiers, tirées 2 224 fois. La campagne explore donc un puits étroit, pas la surface du
moteur. Élargir la fenêtre (ou tirer un extrait aléatoire dans le fichier) est le prochain
gain évident, et il faudra relancer pour obtenir un chiffre comparable.
