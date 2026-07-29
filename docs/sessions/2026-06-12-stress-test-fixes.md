# 2026-06-12 — Stress Test Fixes

**Scope:** Fix the 5 parser/extractor bugs identified in the SPARDA v0.4.0 stress test report.
**Commits:** `<to_be_committed>` · **Branch:** `main` · **Tests:** 54/54 green unit tests

## Done
- **Express `/mcp-*` Prefix check**:
  - Tightened the route blocking check in [express.js](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/src/parser/express.js) to allow routes like `/mcp-analytics` while maintaining the `/mcp` or `/mcp/*` loop blocks.
- **FastAPI `/mcp-*` Prefix check**:
  - Tightened the loop check in [fastapi_extract.py](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/src/parser/fastapi_extract.py) identically to Express (Bug #1).
- **FastAPI `async def` Support**:
  - Added support for `ast.AsyncFunctionDef` alongside `ast.FunctionDef` in [fastapi_extract.py](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/src/parser/fastapi_extract.py) (Bug #2).
- **FastAPI Modular Package & Symbol Imports**:
  - Improved `ImportFrom` parsing in [fastapi_extract.py](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/src/parser/fastapi_extract.py) to resolve imported module files (e.g., `from routers import users`) and support attribute arguments like `users.router` in `include_router()` (Bug #3).
- **FastAPI Cross-File Pydantic preloading**:
  - Implemented `preload_models()` in [fastapi_extract.py](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/src/parser/fastapi_extract.py) (Bug #4) to walk all reachable imports and pre-register Pydantic body schemas prior to routes parsing.
- **FastAPI `Depends()` Exclusions**:
  - Added default value checking in [fastapi_extract.py](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/src/parser/fastapi_extract.py) to skip any argument using `Depends(...)` from being exposed in the query parameters schema (Bug #5).
- **Tests Added**:
  - Added dedicated unit tests in [sparda.test.js](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/tests/sparda.test.js) checking the Express prefix check, `async def` routes, `Depends` skipping, modular package imports, and cross-file Pydantic model resolution.

## Not done / deferred
- None. All 5 bugs were successfully fixed and validated.

## Decisions made
- **Global Pre-load BFS strategy for Pydantic Models**: Rather than tracking multi-hop imports or aliases during route traversal, we recursively pre-scan all reachable project modules for Pydantic models. This keeps routes extraction fast and decoupled from complex import-renaming paths.
- **Attribute Router resolution**: We support standard modular router patterns like `from routers import users` coupled with `app.include_router(users.router)` by checking `ast.Attribute` nodes and matching their base names (`users`) against the imports map.

## Bugs hit
- Recorded under **E-015** in [ERRORS.md](file:///c:/Users/zakwi/Developer/residual-labs-forge/SPARDA/sparda/docs/ERRORS.md).

## Notes for the next session
- The FastAPI parser is now robust against production APIs using dependency injection and modular router packages. Ready to publish/test on staging environments.
