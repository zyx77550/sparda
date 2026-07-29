# Brief Architecture & UX : SPARDA VS Code Extension

**Destinataire :** Claude (Architecte Système & Sécurité)
**Sujet :** Pousser l'Expérience Utilisateur (UX) de l'extension VS Code au niveau "Premium" absolu.

## 1. La Vision
La version `0.70.1` de l'extension est fonctionnelle, asynchrone et propre. Mais l'onboarding et l'UX face aux erreurs (notamment l'absence du CLI) sont encore trop "bruts". 

L'objectif n'est **pas** d'ajouter des mascottes ou des gadgets (cela irait à l'encontre de l'identité froide, clinique et "Elite" de Sparda). L'objectif est de créer une UX sans friction, qui guide l'utilisateur intelligemment en exploitant à 100% l'API native de VS Code.

## 2. Le Problème Immédiat (Auto-Installation)
Actuellement, si `sparda-mcp` n'est pas installé, `runCli()` échoue et affiche un message d'erreur statique. 

**Ce que nous voulons :**
- Capter l'erreur liée à l'absence du CLI.
- Afficher un *Toast* (`vscode.window.showErrorMessage`) avec un bouton d'action **"Install sparda-mcp"**.
- Si l'utilisateur clique, l'extension ouvre un terminal VS Code intégré et exécute automatiquement `npm i -D sparda-mcp` (ou l'équivalent global si préféré). 

## 3. Pistes d'Amélioration UX (À concevoir et implémenter)
Nous te laissons carte blanche pour concevoir la meilleure expérience possible autour de ces axes :

- **Utilisation des Codicons :** Intégrer les icônes natives de VS Code (`$(shield)`, `$(zap)`, `$(check-all)`) dans les notifications et la barre de statut pour un rendu professionnel.
- **Onboarding (Walkthrough) :** Est-ce qu'on ajoute un fichier d'onboarding natif VS Code (`contributes.walkthroughs` dans `package.json`) pour expliquer en 3 étapes comment armer la Gate et lire les diagnostics ?
- **Barre de statut interactive :** Actuellement la barre change de couleur (Warning/Error). Peut-on la rendre cliquable pour ouvrir directement le panel des "Problèmes" ou déclencher une action spécifique ?
- **Quick Fixes (Code Actions) :** Est-il possible de lier les diagnostics (les erreurs BOLA/IDOR) à des "Quick Fixes" VS Code qui suggèrent à l'humain d'invoquer l'IA pour corriger le tir ?

## Mission
Claude, analyse ces besoins. Mets à jour `extension.cjs` (et `package.json` si besoin) pour implémenter en priorité le **bouton d'auto-installation du CLI**, puis propose/implémente les autres améliorations UX qui te semblent pertinentes pour rendre l'extension incontournable et "sans friction".
