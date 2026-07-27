# CLAUDE.md — AI session entry point

SPARDA is **the trust layer for AI-written code** — "AI writes. SPARDA proves."
(ADR-033). Under the hood it is a behavior compiler: backend (code + schema) →
deterministic UBG → proofs (`review`, `apocalypse`), an executable mock
(`mirror`), deterministic replay (`timeless`/`heal`). The MCP layer is the same
trust story at runtime: it parses an Express/FastAPI/Next app (AST), injects a
reversible `/mcp` router *inside the live process*, and bridges it to MCP
clients over stdio. Zero infra, zero budget: compute from the host process,
intelligence from the client's own LLM (MCP sampling), storage from
`sparda.json` + git.

## Start here, every session

1. Read `docs/HANDOFF.md` — current state: what is done, not done, and next.
2. Read the doc that matches your task (map in `docs/README.md`).
3. Before touching code that failed before, check `docs/ERRORS.md`.
4. Big-picture questions (tiers, rounds, monetization) → `ROADMAP.md`.

**Before ending a session that changed anything:** update `docs/HANDOFF.md`
and append a session record in `docs/sessions/` (use `TEMPLATE.md`).
This is how context survives between sessions — never skip it.

## Commands

```bash
npm test                       # vitest, full suite — must be green before any push
npm run mutation               # 77 mutants — all must die before any push (rule 11)
npx vitest run -t "quarantine" # single test by name
node src/index.js init|dev|sync|hook|remove|doctor   # the CLI, from a target app dir
```

Tests need Node >= 18 and Python >= 3.9 (FastAPI parser fixtures).

## Architecture in one breath

`init`: `detect.js` (framework/entry/port) → `parser/` (routes via AST) →
`security/sanitize.js` (docstring defense) → `generator/` (render
`templates/*.txt` → router file, inject marked block into entry, write
`sparda.json`). `dev`: `server/stdio.js` bridges MCP stdio ↔ the injected
router's HTTP endpoints (`/mcp/tools|invoke|stats|events`). Details and the
`sparda.json` schema: `docs/ARCHITECTURE.md`.

## Hard rules (violating these breaks the product — see docs/DECISIONS.md)

1. **The host never pays for SPARDA's intelligence.** Nothing heavy on the
   request path; ring buffers bounded; LLM only on surprise, never required.
2. **stdout is the MCP protocol.** Human logs go to stderr, always.
3. **Write tools are disabled by default** (write-safety); user opt-in only.
4. **`sparda remove` must leave a byte-for-byte clean diff.** Injection is
   marked, idempotent, backed up, re-parsed after every modification.
5. **Carry-over is sacred:** `localKey`, per-tool `enabled`, `semantic`,
   `immune`, and `labs` survive re-init. Never regenerate them.
6. **Templates must stay valid in all variants** (JS/TS × ESM/CJS, Python).
   Placeholders like `__ANY_TYPE__` exist for TS — keep them consistent.
7. **Every LLM output is sanitized** (`sanitizeDescription`) before it is
   stored or shown to a client. No exceptions.
8. **No new runtime dependency without an entry in `docs/DECISIONS.md`.**
   Currently 4, exact-pinned — that is a selling point.
9. **A registration is MODELLED or DECLARED — never dropped.** Every `continue`
   in a registration dispatch either registers something or emits an
   `UnknownHandler` + a high-risk blind spot. Silence is how a real endpoint
   earns a false PROVEN (ADR-079, SOUNDNESS Direction 3).
10. **An oracle may not import an extractor.** `oracle-static.js` and the
   sealing certificates check the analyser against a SECOND implementation;
   one that reuses the analyser's walk is a mirror, and confirms bugs instead
   of finding them (ADR-082).
11. **A guarantee is universal or it is false.** ANY module that grades a compiled
   graph MUST call `premiseFor` — a command, the MCP tool, a bench, the corpus
   oracle. An organ reachable from some consumers buys confidence it has not
   earned, and a rule that scans only the directory where the last such bug was
   found repeats the same mistake one level up (ADR-083 + amendment).
12. Tests green (`npm test`) **and** mutants dead (`npm run mutation`) before
   commit; new behavior ships with tests, new soundness-critical lines ship
   with a killing mutant.

## Conventions

- ESM everywhere, Node >= 18 compatible (no `??=` worries, but check vitest ^3).
- User-facing errors: `Object.assign(new Error(msg), { code: 'USER', hint })`.
- Comments explain *constraints*, not narration; match existing density.
- Commit style: `feat(scope):`, `fix(scope):`, `docs:`, `chore:`.
