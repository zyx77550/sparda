# SPARDA v0.4.0 — Stress Test Report

**Date:** 2026-06-12 | **Tests:** 24 | **Pass:** 17 | **Fail:** 7

-----

## Résultats par section

### ✅ Express Parser (9/10)

|ID     |Test                                                 |Résultat                                               |
|-------|-----------------------------------------------------|-------------------------------------------------------|
|T01    |Paths dynamiques (variable, template literal, concat)|✅ 1 route littérale extraite, dynamiques skippées      |
|T02    |Router imbriqué 3 niveaux (depth limit)              |✅ Niveau 1 extrait, niveau 2 non atteint               |
|T03    |`require()` dans `if`/`try` conditionnel             |✅ Route directe extraite, require conditionnel skipé   |
|T04    |`app.use()` sans prefix (middleware anonyme)         |✅ Middleware ignoré, seule la route directe extraite   |
|T05    |JSDoc multi-lignes (description extraction)          |✅ Présent dans source — extrait via `@babel/traverse`  |
|T06    |Route déclarée 2× (dedupe)                           |✅ 4 déclarations → 2 routes uniques                    |
|**T07**|**Path `/mcp-analytics` ne doit PAS être bloqué**    |**❌ BUG #1**                                           |
|T08    |ESM (`import`/`export`) vs CJS                       |✅ ESM détecté, routes extraites                        |
|T09    |`express()` dans une factory function                |✅ 0 appVars top-level → 0 routes (comportement attendu)|
|T10    |TypeScript + types + port `?? 4000`                  |✅ Syntaxe TS reconnue, port 4000 extrait               |

### ❌ FastAPI Extractor (2/7)

|ID        |Test                                               |Résultat                       |
|----------|---------------------------------------------------|-------------------------------|
|**T11**   |APIRouter + prefix cumulatif                       |**❌ BUG #2 + #3**              |
|**T12**   |Pydantic `BaseModel` cross-file                    |**❌ BUG #2 + #4**              |
|T13       |`Optional[str]` / `Union[str, None]` / `str | None`|✅ 3 syntaxes → `required=false`|
|**T14/15**|`Depends()` ignoré + defaults                      |**❌ BUG #5**                   |
|**T16**   |`async def` routes                                 |**❌ BUG #2 CRITICAL**          |
|**T17**   |`/mcp-status` ne doit PAS être bloqué              |**❌ BUG #1**                   |
|**T18**   |Import relatif `from app.routers import users`     |**❌ BUG #3**                   |

### ✅ Detect (4/4)

|ID    |Test                                    |Résultat        |
|------|----------------------------------------|----------------|
|T19   |Conflit `express` + `next` → erreur USER|✅               |
|T20   |Port depuis `.env` (`APP_PORT=8080`)    |✅ `8080` extrait|
|T21   |Port fallback `process.env.PORT ?? 4477`|✅ `4477` extrait|
|T22/25|Pas de framework → erreur USER          |✅               |

### ✅ Security (2/2)

|ID |Test                                                          |Résultat                            |
|---|--------------------------------------------------------------|------------------------------------|
|T23|Injection prompt dans JSDoc (“ignore previous instructions”)  |✅ Purgé, fallback sur `METHOD /path`|
|T24|5 cas de détection (“act as”, “system prompt”, “from now on”…)|✅ 5/5 corrects                      |

### ✅ Edge Cases (1/1)

|ID |Test                                                        |Résultat|
|---|------------------------------------------------------------|--------|
|T26|Injection idempotente (bloc déjà présent → strip + réinject)|✅       |

-----

## Bugs identifiés

### 🔴 BUG #2 — CRITICAL: `async def` non géré (FastAPI)

**Fichier:** `src/parser/fastapi_extract.py`, ligne ~210  
**Impact:** Toutes les routes `async def` ignorées silencieusement. FastAPI étant async-first, cela signifie que la majorité des projets FastAPI réels retournent **0 routes**.

**Root cause:**

```python
# Actuel — seulement FunctionDef:
elif isinstance(node, ast.FunctionDef):

# Manque:
elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
```

**Fix:**

```python
elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
    for dec in node.decorator_list:
        ...  # même logique
```

-----

### 🟠 BUG #3 — HIGH: Imports multi-noms depuis package non résolus

**Fichier:** `src/parser/fastapi_extract.py`, `resolve_import()`  
**Impact:** `from routers import users, products` → `resolve_import('routers')` → `None`. Le pattern standard de tout projet FastAPI modulaire est cassé.

**Root cause:** `resolve_import` cherche `routers.py` ou `routers/__init__.py` mais ne résout pas les **symboles individuels** `users` et `products` depuis le package.

**Fix:** Après avoir résolu le package `routers/`, chercher `routers/users.py` et `routers/products.py` en fonction des noms importés :

```python
# Dans ImportFrom handler:
for name_node in node.names:
    local_name = name_node.asname or name_node.name
    # D'abord essayer comme fichier direct
    resolved = self.resolve_import(abs_file, f"{node.module}.{name_node.name}")
    if not resolved:
        # Fallback: résoudre le package et chercher le sous-module
        resolved = self.resolve_import(abs_file, node.module)
    if resolved:
        import_map[local_name] = resolved
```

-----

### 🟠 BUG #4 — HIGH: Pydantic cross-file — modèles non disponibles au moment du parsing

**Fichier:** `src/parser/fastapi_extract.py`  
**Impact:** Si un modèle Pydantic est défini dans `schemas.py` et utilisé dans `main.py`, il n’est pas dans `self.models` lors du parsing de `main.py` (il sera parsé après, dans le 2nd pass sur les routers montés).

**Root cause:** L’ordre de parsing est entry → mounts, mais `extract_pydantic_models` n’est appelé que dans `parse_file`. Si les modèles sont importés (pas montés), ils ne sont jamais pré-scannés.

**Fix:** Ajouter un **pre-pass** qui scanne tous les fichiers importés pour les modèles Pydantic avant le parsing des routes :

```python
def preload_models(self):
    """Pre-scan all reachable files for Pydantic models before route extraction."""
    for abs_path in self._collect_all_imports(self.entry_file):
        if abs_path not in self.models:
            try:
                src = open(abs_path).read()
                tree = ast.parse(src)
                self.extract_pydantic_models(tree, abs_path)
            except: pass
```

-----

### 🟡 BUG #1 — MEDIUM: `/mcp-*` faux positifs (Express + FastAPI)

**Fichiers:** `src/parser/express.js` ligne ~103, `src/parser/fastapi_extract.py` ligne ~196  
**Impact:** Routes légitimes comme `/mcp-analytics`, `/mcp-status`, `/mcp2` bloquées à tort.

**Root cause:** `path.startsWith('/mcp')` est trop large.

**Fix (1 caractère):**

```python
# Actuel:
if full_path.startswith('/mcp'):

# Fix:
if full_path == '/mcp' or full_path.startswith('/mcp/'):
```

```javascript
// Actuel:
if (fullPath.startsWith('/mcp')) {

// Fix:
if (fullPath === '/mcp' || fullPath.startsWith('/mcp/')) {
```

-----

### 🟡 BUG #5 — MEDIUM: `Depends()` exposés comme query params

**Fichier:** `src/parser/fastapi_extract.py`  
**Impact:** `db=Depends(get_db)` et `current_user=Depends(get_current_user)` apparaissent comme params query dans le tool schema — Claude va tenter de les passer et obtenir des erreurs.

**Root cause:** L’extractor ne détecte pas les `ast.Call` dans les valeurs par défaut.

**Fix:**

```python
def _is_depends(self, default_node):
    """True si la valeur par défaut est Depends(...)"""
    return (
        isinstance(default_node, ast.Call) and
        ((isinstance(default_node.func, ast.Name) and default_node.func.id == 'Depends') or
         (isinstance(default_node.func, ast.Attribute) and default_node.func.attr == 'Depends'))
    )

# Dans la boucle d'args, avant d'ajouter le param:
defaults_start_idx = len(node.args.args) - len(node.args.defaults)
for idx, arg in enumerate(node.args.args):
    has_default = idx >= defaults_start_idx
    if has_default:
        default_val = node.args.defaults[idx - defaults_start_idx]
        if self._is_depends(default_val):
            continue  # Skip Depends() params
```

-----

## Priorités de fix

|Priorité|Bug                                |Effort                   |Impact                                          |
|--------|-----------------------------------|-------------------------|------------------------------------------------|
|P0      |**BUG #2** — `async def` non géré  |1 ligne                  |CRITICAL — tous projets FastAPI async = 0 routes|
|P1      |**BUG #3** — imports multi-noms    |~20 lignes               |HIGH — pattern modulaire standard cassé         |
|P1      |**BUG #4** — Pydantic cross-file   |~30 lignes (pre-pass)    |HIGH — body schemas non inférés                 |
|P2      |**BUG #1** — `/mcp-*` faux positifs|1 char (`/mcp` → `/mcp/`)|MEDIUM — routes légitimes bloquées              |
|P2      |**BUG #5** — `Depends()` exposés   |~15 lignes               |MEDIUM — faux params dans tool schema           |