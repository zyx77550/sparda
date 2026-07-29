# 2026-07-28: Publication de l'Extension VS Code et Robustesse Windows

## 1. Fuzzing & Mutation
- **IA Fuzzing (Ollama)** : Le fuzzer a été restructuré pour capturer `stderr`. Cela permet de faire la distinction exacte entre les erreurs de parsing (crash syntaxique) et les vrais "kills" logiques.
- **Bilan** : 2 224 mutations injectées, mesurées, et tuées avec succès.

## 2. Fusion et Nettoyage de l'Extension VS Code
- **Merge** : Les dossiers `integrations/vscode/` et `extensions/vscode/` ont été fusionnés en une seule base de code source fonctionnelle et testée.
- **Architecture** : L'extension est confirmée comme un wrapper non-bloquant (`spawn`) qui lit le `stdout` JSON du CLI Sparda et déverse le `stderr` pour les logs. Zéro dépendance interne, aucune dérive possible par rapport au CLI.

## 3. La Gardienne de Release (Release Gate)
- **Incident Windows** : La `release-gate.mjs` bloquait sur l'exécution de `npx vitest` sous Windows (`spawnSync ENOENT`).
- **Fix 1 (Intermédiaire)** : Ajout de `shell: true` pour Windows.
- **Fix 2 (Architectural par Claude)** : Retrait pur et simple de `npx` dans la Gate et dans les tests de mutation. La Gate utilise désormais directement l'exécutable Node natif (`process.execPath`) pointant vers `node_modules/vitest/vitest.mjs`.
- **Corpus** : Résolution de la dérive du fichier snapshot `corpus.snapshot.json` suite à la PR 35 (ADR-089 sur les Middlewares NestJS).

## 4. Robustesse de la Suite de Tests sur Windows
- **Dépendance Python** : Le test FastAPI (`registration-invariant-fleet.test.js`) crashait faute de Python sur la machine Windows de l'utilisateur. Ajout d'une détection automatique et d'un `skipIf(!hasPython)`.
- **Race Condition** : Le test `premise-convention.test.js` échouait à cause de fichiers temporaires (`sparda.json`, `.syntax-check.py`) créés par les autres tests en parallèle. Modification de la fonction `walkDisk` pour ignorer ces artefacts.

## 5. Publications Officielles
- **NPM** : Le paquet `sparda-mcp` v0.70.1 a été publié avec succès.
- **VS Code Marketplace** : L'extension `zyx77550.sparda` v0.70.1 a été packagée et publiée en utilisant le PAT de l'éditeur (Publisher: Residual Labs).

## 6. UX et Brief Claude
- **Problème Identifié** : Si `sparda-mcp` n'est pas installé, l'extension échoue avec une simple erreur texte. L'IA de VS Code, en tentant de l'installer dans un dossier temporaire, s'est heurtée à un faux fichier `package.json` contenant du code React.
- **Solution Documentée** : Rédaction du fichier `docs/UX-VSCODE-BRIEF.md` à destination de Claude. Ce brief demande la création d'un popup natif interceptant l'absence du CLI, et proposant un bouton d'action "Install sparda-mcp" qui ouvre un terminal et lance l'installation automatiquement, tout en conservant l'identité froide et chirurgicale de Sparda (via les Codicons de VS Code).

## 7. Cartographie du Projet (Pour Mémoire)
**A. Le Moteur (CLI / Serveur MCP)**
- **Nom du paquet NPM** : `sparda-mcp`
- **Chemin du code source** : Le point d'entrée est dans `src/index.js` (déclaré dans le `package.json` sous `"bin": { "sparda": "src/index.js" }`).
- **Fonctionnement** : C'est le cœur de Sparda. Il analyse le code, détecte les vulnérabilités (BOLA, unguarded mutations, etc.) et agit comme serveur MCP (Model Context Protocol) pour fournir ces preuves directement aux agents IA comme Claude.
- **Commandes principales** :
  - `sparda prove` : Vérifie le code local par rapport à la "baseline" (la Gate).
  - `sparda apocalypse` : Liste absolument toutes les failles trouvées.
  - `sparda gate --arm` : Fixe le comportement actuel comme la nouvelle référence stricte.

**B. L'Interface (Extension VS Code)**
- **Nom du paquet Marketplace** : `zyx77550.sparda`
- **Chemin du code source** : `extensions/vscode/src/extension.cjs` (et `lib.cjs` pour le parsing).
- **Fonctionnement** : L'extension est un "client stupide" et volontairement léger. Elle n'embarque **pas** le moteur d'analyse. Elle se contente de spawner le CLI local (`sparda-mcp`) en arrière-plan à chaque sauvegarde via `child_process.spawn`.
- **Flux de données** : Elle parse la sortie JSON (`stdout`) du CLI et la convertit instantanément en `vscode.Diagnostic` (les lignes rouges/warnings dans l'éditeur), tout en déversant le texte de log (`stderr`) dans le panel "Output" de VS Code.
- **L'avantage sécurité** : En forçant l'éditeur à utiliser le même CLI que le terminal ou le serveur d'intégration continue, on s'assure que le verdict affiché au développeur ne peut **jamais** différer du verdict final du pipeline. Zéro dérive.
