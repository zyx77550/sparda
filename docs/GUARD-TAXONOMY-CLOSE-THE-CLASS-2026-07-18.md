# Fermer la classe des faux "UNGUARDED_MUTATION" — définitivement, par principe

> **Date :** 2026-07-18 · **Pour Fable / session moteur.** Déclencheur : audit manuel de dub
> (2026-07-18). Les 5 findings "critical UNGUARDED_MUTATION" sont des **faux positifs** —
> des routes publiques par design protégées par un mécanisme que SPARDA ne modélise pas comme
> garde. Vérifiés à la main : `reset-password` (jeton de reset stocké + expiry), `notification-
> preferences` (jeton d'unsubscribe signé), `track/application` (tracking public rate-limité),
> `paypal/callback` + `platforms/callback` (webhooks signés).
>
> **Condition de Zak :** ne PAS patcher ces 5 cas un par un. Fermer **toute la classe** —
> y compris les pièges qu'on n'a pas encore vus. C'est faisable, mais seulement par un
> **principe**, pas par une liste de vendeurs SaaS. Ce doc donne les deux : la liste (ce qu'il
> faut reconnaître) ET le principe (ce qui la rend complète et saine).

---

## Le principe qui ferme la classe (une seule phrase)

> **Une mutation est prouvée sûre si et seulement si il existe, sur le chemin, une IDENTITÉ
> VÉRIFIÉE dont la portée COUVRE STRUCTURELLEMENT la cible de la mutation.**

Tout le reste en découle. Une "garde" n'est pas un nom (`auth`, `requireX`) ni une famille de
vendeur — c'est **une identité vérifiée + une portée qui contient ce qui est modifié.** Ça
subsume la session, les jetons, les webhooks, les crons, l'OAuth, et tout mécanisme futur :
un nouveau piège produit soit une identité vérifiée qui scope la mutation (→ reconnu par le
principe, sans code neuf), soit non (→ reste correctement un finding). Plus de chat-et-souris.

---

## Couche 1 — RECONNAISSANCE : les familles d'identité vérifiée (la liste)

SPARDA ne reconnaît aujourd'hui QUE la famille A (session/middleware). Les autres produisent
toutes une identité vérifiée que le marcheur doit apprendre à voir. Signal commun : **une valeur
extraite d'un secret, validée par un crypto-verify OU un lookup DB avec expiry, qui gate le
chemin (un `return 4xx` si absente).**

| Famille | Mécanisme | Comment le reconnaître (signal structurel) |
|---|---|---|
| **A. Session / middleware** *(déjà fait)* | `getSession`, `withSession`, guard NestJS | identité = `session.user.id` |
| **B. Jeton de capacité signé** | JWT/HMAC : `verifyX(token)` → renvoie un principal (email/id) | appel `verify*`/`jwt.verify` dont le retour gate un `return 4xx`, puis alimente un `where` |
| **C. Jeton à usage unique stocké** | reset-password, invite, email-verify : `prisma.xToken.findFirst({token, expires})` | lookup DB d'une table `*token*`/`*verification*` avec `expires`, gate le chemin |
| **D. Signature de webhook** | Stripe `constructEvent`, GitHub `X-Hub-Signature`, Svix, Shopify HMAC, PayPal | appel de vérif de signature sur un header + secret d'env ; l'appelant est un service externe de confiance |
| **E. Secret de cron / interne** | `if (header.authorization !== env.CRON_SECRET) return 401`, signature Vercel Cron | comparaison d'un header à un secret d'env qui gate le chemin |
| **F. Handshake OAuth** | callback : validation du `state` (CSRF) + échange `code`↔provider | route `*/callback` qui lit `state`+`code` et appelle le provider |
| **G. API key** | clé en header/query vérifiée en DB | lookup d'une table `*apikey*`/`*token*` par la valeur d'un header |
| **H. URL signée** | download/upload pré-signé, expiry dans la query | vérif HMAC de l'URL + `expires` |

**Chaque famille produit une "identité vérifiée" typée** : `session-user`, `token-principal`,
`webhook-external`, `cron-system`, `oauth-provider`. Cette étiquette est ce que la couche 2 va
confronter à la cible de la mutation.

---

## Couche 2 — SOUNDNESS : la portée doit couvrir la mutation (l'anti-faux-PROVEN)

Reconnaître une identité ne suffit PAS. Le piège inverse — et le péché capital — serait de
traiter "il y a un jeton quelque part" comme un blanc-seing et de produire un **faux PROVEN**.
La règle qui l'empêche, en réutilisant l'inférence d'ownership BolaRay **déjà présente**
(`inferOwnershipModel`, `apocalypse.js`) :

Pour chaque route qui mute une table :

1. **Identité vérifiée sur le chemin ?** (familles A–H)
   - Non → aller à l'étape 3.
2. **La portée de l'identité couvre-t-elle la cible ?**
   - La valeur dérivée de l'identité (`session.userId`, l'email du jeton, l'id du principal) est
     l'**even la même** que la clé d'ownership utilisée dans le `where`/`update` ?
     - **Oui → PROUVÉ (verified).** Ex : reset-password (email du jeton → `where user.email`). C'est
       le cas des 5 faux positifs de dub : la portée du jeton scope la mutation.
     - **Non → BOLA advisory** (`OBJECT_SCOPE_UNPROVEN`, déjà existant). Identité vérifiée, mais
       elle mute un objet désigné par un id de la requête qu'elle ne possède peut-être pas. Reste
       un finding — **jamais promu en PROVEN.**
   - Webhook/cron (`webhook-external`/`cron-system`) → autorisé à muter une table **non
     possédée par un user** (event log, sync). S'il mute une table *user-owned* sans autre
     scope → reste finding.
3. **Pas d'identité vérifiée : la table est-elle POSSÉDÉE ?** (le modèle d'ownership décide le défaut)
   - Table avec modèle d'ownership (`direct-owner`/`group-scoped`/`transitive`) → **vrai
     UNGUARDED_MUTATION (critical).** Muter une ressource possédée sans identité = le vrai trou.
   - Table **sans** modèle (append-only : `event`, `log`, `click`, `waitlist`, tracking) →
     **INFO/low**, pas critical. Muter un journal public n'est pas une faille (c'est
     `track/application`). Publique-par-design devient plausible ET typée, pas devinée.

**Invariant (le garde-fou, non négociable) :** l'ajout des familles B–H ne peut faire que
**deux choses** — soit prouver (identité + portée couvrante), soit rétrograder un critical en
advisory/info. Il ne peut JAMAIS transformer un vrai finding en silence. Une identité reconnue
mais dont la portée n'est pas structurellement prouvée **reste un finding**. C'est le même
principe que llm-resolve : reconnu ≠ admis ; il faut la confirmation structurelle. La soundness
ne bouge que dans le sens qui resserre.

---

## Pourquoi ça ferme la classe "définitivement"

Un mécanisme de protection futur, aussi exotique soit-il (passkey, mTLS, capability macaroon,
signature de queue…), tombe forcément dans un des deux cas :
- il produit une **identité vérifiée dont la portée couvre la mutation** → prouvé par le principe,
  sans code spécifique à ce mécanisme ;
- il ne le fait pas → **reste un finding**, correctement.

On n'énumère donc pas les pièges à l'infini : on reconnaît des *familles de crédential* (liste
finie, extensible proprement) et on tranche par un *principe de portée* (invariant, non
extensible car complet). Les nouveaux mécanismes n'ajoutent qu'un **détecteur de famille**
(couche 1), jamais une nouvelle règle de décision (couche 2).

---

## Où ça se branche dans le code

- **Couche 1 (reconnaissance)** : étendre `isGuardLike`/le scan de garde (`src/ubg/extract.js`,
  `GUARD_NAME` l.136 + `guardSignals.deniesWithStatus`) pour émettre des **nœuds guard typés**
  quand un `verify*`/lookup-token/signature-check gate un `return 4xx`. Le bare-call following
  (v0.50) suit déjà les helpers — ici il faut classer un helper qui *renvoie un principal ET
  gate* comme garde, pas seulement un helper deny-only.
- **Couche 2 (soundness)** : dans `verdictOf`/le calcul des obligations (`src/ubg/apocalypse.js`),
  confronter le principal de l'identité à la clé d'ownership de `inferOwnershipModel` déjà
  calculée. Réutilise `OBJECT_SCOPE_UNPROVEN` pour le cas "identité sans portée".
- **Défaut sans identité** : la sévérité d'`UNGUARDED_MUTATION` devient fonction du modèle
  d'ownership de la table (possédée → critical ; append-only → info).
- **Blindspots** : une identité reconnue mais non-scopée structurellement va dans le ledger
  (catégorie existante `unverified-guard` ou nouvelle `unscoped-credential`), jamais en PROVEN.
- **Tests** : mutants (`tests/mutation/run.mjs`) pour chaque famille B–H (retirer la
  reconnaissance → le test doit voir réapparaître le finding) + un test end-to-end par famille
  sur une fixture minimale (le pattern reset-password/webhook/cron).

---

## Ce que ça débloque (mesurable)

- Re-run corpus après : le nombre de "critical UNGUARDED_MUTATION" sur dub doit tomber de 5 → ~0
  (tous rétrogradés en prouvés ou en advisories scopés). Métrique : faux positifs critical sur
  dub/immich, aujourd'hui élevé, cible ≈ 0.
- **C'est le prérequis du cap #1** (une vraie faille démontrée sur un géant). Tant que le taux de
  faux positifs critical est élevé, on ne peut pas faire de bruit sans se faire démolir. Une fois
  la classe fermée, ce qui RESTE en critical est du vrai signal — et LÀ on cherche le vrai bug.
