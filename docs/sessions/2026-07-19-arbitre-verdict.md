# Session 2026-07-19 — L'ARBITRE : audit stratégique externe (analyse, zéro code moteur)

**Mandat :** trouver LE levier d'expansion malgré solo/zéro distribution/zéro budget,
tout étayer par des mesures faites en session. Livrable : `docs/ARBITRE-VERDICT-2026-07-19.md`.

**Mesuré :** 667 tests verts ; dub réel 580 routes prouvées en 2,5 s ; sabotage d'une
garde (`withWorkspace` → identité) attrapé `GUARD_REMOVED` [critical] en 1,8 s via
baseline ; `review --base` CASSÉ depuis un sous-dossier de monorepo (compile la base à
la racine du worktree) ; demo bundlée = SURFACE ONLY 0 % ; listing registre MCP officiel
gelé à v0.10.1 avec le pitch pré-pivot ; aucune intégration hook Claude Code/Cursor.

**Verdict :** le levier unique est `sparda gate` — le gate déterministe < 2 s de
régression comportementale (garde retirée / route droppée / blast radius) dans la boucle
d'édit de l'agent, distribué par les canaux agent-natifs qui n'exigent aucune audience
(registre MCP, plugin marketplace Claude Code, Action Marketplace, awesome-lists).
Recherche croisée : le coin « déterministe + local + < 2 s + zéro clé » est vide
(Qodo = LLM/enterprise ; GitHub/GitGuardian MCP = secrets ; Heeler = policies).
Kill list et plan 30 jours dans le doc verdict.

**Bugs produit découverts (à corriger en S1) :**
1. `review --base` monorepo : la base est compilée à la racine du worktree, pas dans le
   sous-dossier courant → « No supported framework found » depuis `apps/web` de dub.
2. Listing registre MCP périmé (0.10.1, ancienne description) — canal n°1 qui vend la
   mauvaise identité.
3. La demo bundlée produit l'anti-démo (0 % coverage).

**Aucun changement de code moteur.** Docs uniquement.
