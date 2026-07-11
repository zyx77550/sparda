# Error knowledge base (append-only)

The project's own immune memory. Every non-trivial bug gets an entry:
**Symptom / Root cause / Fix / Rule**. Check here *before* debugging
anything that smells familiar. Newest last.

---

## E-001 — MCP client shows "connection closed" / garbage JSON-RPC
- **Symptom:** bridge dies instantly or client reports protocol errors.
- **Root cause:** something printed to stdout — stdout *is* the MCP stream.
  Any dependency `console.log` is enough.
- **Fix:** `console.log` rebound to stderr at bridge startup
  (`stdio.js` first line of `startStdioBridge`).
- **Rule:** never `console.log` in bridge code paths; human output → stderr.

## E-002 — Bridge crashed at startup: `localKey missing`
- **Symptom:** `sparda dev` threw immediately after v0.2 refactor.
- **Root cause:** bridge read the key from its own config instead of the
  manifest — `sparda.json` is the single source of truth.
- **Fix:** commit `b95efc1` — read `manifest.localKey`, explicit USER error
  with hint when absent.
- **Rule:** anything the router and bridge must agree on lives in
  `sparda.json` and nowhere else.

## E-003 — CI red on Node 18: vitest requires Node 20
- **Symptom:** GitHub Actions failures on the Node 18 matrix.
- **Root cause:** vitest 4.x dropped Node 18.
- **Fix:** commit `4d449f9` — pin `vitest: ^3.0.0` (see ADR-011).
- **Rule:** dependency upgrades must respect the engine promise (Node ≥ 18).

## E-004 — CI red: FastAPI parser tests can't find python
- **Symptom:** `spawnSync python` fails on runners; works locally.
- **Root cause:** runners expose `python3` (or `py` on Windows), never a
  guaranteed `python`.
- **Fix:** commit `b875f20` — `setup-python` in CI + dynamic candidate
  detection (`python3` → `python` → `py -3`) shared by detect.js and tests.
- **Rule:** never hardcode the python binary name.

## E-005 — Bridge test: live-error notification never arrives (flaky-looking, deterministic)
- **Symptom:** `expected undefined to be defined` on the
  `notifications/message` assertion in the stdio bridge test.
- **Root cause:** the mock host counts `/mcp/events` hits to decide
  baseline-vs-live-event. A *new* bridge feature (`sparda_get_context`)
  also fetches `/mcp/events`, consumed the mock's baseline slot, and the
  bridge's own baseline poll then swallowed the live event
  (`lastSeq === null → discard`).
- **Fix:** commit `364b826` — context-tool assertions moved *after* the
  polling assertions in the test.
- **Rule:** any new bridge call that touches `/mcp/events` shifts the mock
  host's poll sequence — keep polling assertions first, or make the mock
  route-aware.

## E-006 — Router-level rejections looked like successes to the AI
- **Symptom:** quarantine/disabled/bad-param responses (`{error: ...}`,
  no `upstreamStatus`) returned `isError: false` over MCP.
- **Root cause:** `isError: payload.upstreamStatus >= 400` is `false` when
  `upstreamStatus` is `undefined`.
- **Fix:** commit `364b826` — `isError` falls back to `Boolean(payload.error)`
  when `upstreamStatus` is absent.
- **Rule:** the router has two response shapes (proxied: `upstreamStatus` +
  `data`; rejected: `error` + details). Handle both, always.

## E-007 — CI red on Windows only: FastAPI injection not idempotent
- **Symptom:** `Buffer.compare(modifiedBytes1, modifiedBytes2)` = -1 on
  `windows-latest` since FastAPI support landed; green on ubuntu and locally.
- **Root cause:** two stacked issues. (1) Windows runners check out files as
  CRLF (`autocrlf=true`, no `.gitattributes`). (2) The injection regex
  captured the indent with `(\s*)` — `\s` matches `\r` and `\n`, so the
  "indent" swallowed the preceding blank line (`\n\r`) and was re-injected
  into the block; the second run (file now partially normalized) captured a
  different indent → different bytes. Invisible on LF systems because the
  pollution was *stable* there.
- **Fix:** indent capture `([ \t]*)`; injection preserves the file's own
  EOL (`join(eol)`); `.gitattributes` (`* text=auto eol=lf`) makes
  checkouts deterministic. Regression test: CRLF inject/idempotent/restore
  cycle in the FastAPI section.
- **Rule:** never use `\s` to capture indentation (`[ \t]` only), and any
  byte-for-byte promise must be tested against CRLF input too.

## E-008 — Windows: EBUSY rmdir in bridge test teardown
- **Symptom:** `EBUSY: resource busy or locked, rmdir ...sparda-stdio-*`
  in the stdio bridge test's `finally`, windows-latest only.
- **Root cause:** `child.kill('SIGKILL')` returns before Windows releases
  the child's file handles (and the bridge may be mid-write to
  `sparda.json` via `persistImmune`); the immediate `fs.rmSync` hits a
  locked directory.
- **Fix:** await the child's `close` event after kill, and
  `rmSync(..., { maxRetries: 10, retryDelay: 100 })`.
- **Rule:** on Windows, killing a process is asynchronous — always await
  `close` before deleting anything the child touched.

## E-009 — Generated FastAPI router was NEVER importable (caught by first runtime test)
- **Symptom:** `NameError: name 'true' is not defined` the moment uvicorn
  imports `sparda_router.py`. The FastAPI runtime path was broken in every
  release to date — and all checks were green.
- **Root cause:** the generator pasted `JSON.stringify(tools)` into the
  Python template as a literal. JSON's `true`/`false`/`null` are not valid
  Python (`True`/`False`/`None`). `ast.parse` and `py_compile` could not
  catch it: `true` is a syntactically valid *identifier* — it only explodes
  at import time.
- **Fix:** template does `SPARDA_TOOLS = json.loads(<double-stringified
  JSON>)` — a JSON string literal is also a valid Python string literal,
  and `json.loads` yields real Python values whatever the content. Caught
  by the new `Generated FastAPI router (runtime)` test (real uvicorn), which
  failed on its very first run.
- **Rule:** syntax checks prove nothing about importability or behavior —
  every framework MUST have a real-runtime test (live server, real HTTP).
  Never inject one language's literals into another language's source.

## E-010 — `remove` left a `.sparda/` residue in .gitignore (broke the byte-for-byte promise)
- **Symptom:** after `init` → `remove`, `git diff` showed ` M .gitignore`
  (`+.sparda/` + a blank line). All injected *code* came back byte-identical;
  only the gitignore edit survived. Found by the 2026-06-11 desktop E2E
  (Phase 1, reconfirmed Phase 3 on a multi-file app).
- **Root cause:** `init`'s `ensureGitignore` appends `\n.sparda/\n` (or creates
  the file) but `remove` never reverted it — `remove.js` even printed
  *"clean (minus a .gitignore line)"*, normalizing the violation of hard
  rule #4.
- **Fix:** `ensureGitignore` now returns what it did (`created` / `appended` /
  null); the manifest records it (`gitignore` field, carried across re-init
  like `localKey`); `remove` reverts the exact edit (deletes the file it
  created, or strips the exact appended suffix; best-effort line removal if
  the user edited around it). Pre-fix manifests have no field → no-op, as
  before. Regression: `Remove reverts .gitignore` suite.
- **Rule:** every side effect of `init` must be recorded in the manifest and
  undone by `remove` — "almost clean" is a broken promise.

## E-011 — Port mis-detected when the only hint is an env fallback
- **Symptom:** `const PORT = Number(process.env.PORT ?? 4477)` (and the `||`
  variant, CJS included) detected as port **3000** — the bridge then probes
  the wrong port out of the box. Found by the desktop E2E (Phase 1, widened
  framework-wide in Phase 2).
- **Root cause:** `detectExpressPort` matched `PORT = <digits>` and
  `.listen(<digits>)` but the `Number(...)` wrapper broke the pattern, and no
  rule read the right-hand literal of `process.env.X ?? / || <literal>`.
- **Fix:** new pattern `process\.env\.\w*PORT\w*\s*(?:\?\?|\|\|)\s*(\d{2,5})`
  tried after the `.env` lookup and before the generic `PORT =` rule.
  Regression: `Port detection` suite.
- **Rule:** port heuristics must be tested against the wrapped/env-fallback
  forms users actually write, not just bare literals.

## E-012 — `doctor` always exited 0, even with a dead host
- **Symptom:** healthy and broken apps both exited `0` — scripts/CI could not
  gate on `sparda doctor`. Found by the desktop E2E (Phase 3).
- **Root cause:** `runDoctor` printed `✗` lines but never signalled failure;
  `index.js` only exits non-zero on a *thrown* error and doctor catches its
  own failures.
- **Fix:** `runDoctor` returns `{ healthy }` (false on any critical `✗`:
  old Node, no framework, unreachable host, quarantined route, invalid
  manifest); the CLI sets `process.exitCode = 1` on it. Informational `·`
  lines never fail. Regression: `Doctor health report` suite.
- **Rule:** a diagnostic command IS an API — its exit code is the contract,
  the text is garnish.

## E-013 — Sentinel sync test flaked at 5s on a polluted Windows checkout
- **Symptom:** `Sentinel sync` timed out at vitest's 5000ms default
  (measured 5242ms) on the owner's desktop clone; green everywhere else.
- **Root cause:** someone had run `npm install` *inside*
  `tests/fixtures/express-demo/` on that machine; the test's
  `fs.cpSync(..., { recursive: true })` then copied a 67-entry
  `node_modules` on every run. The repo itself ships no fixture
  `node_modules` — this was local pollution, slow Windows I/O finished it.
- **Fix:** explicit 30s timeout on that test (copy cost is environmental),
  and: never `npm install` inside `tests/fixtures/*` — the fixtures must
  stay dependency-free (the suite resolves `express` from the repo root).
- **Rule:** any test that copies a fixture tree inherits whatever garbage
  lives in it; keep fixtures pristine and timeouts explicit on I/O-bound
  tests.

## E-014 — `stats.errors` conflated 4xx with 5xx (misleading, not broken)
- **Symptom:** an external black-box test (`sparda-mcp@0.3.0` from npm) saw a
  tool's `errors` counter climb on a plain `404 not found` — alarming a reader
  into thinking the route was failing when the AI had merely asked for a
  missing resource. Cosmetic: the immune system was never affected (quarantine
  reads `consecutive5xx`, already 5xx-gated), so no functional impact.
- **Root cause:** `spardaRecord` did `if (status >= 400) errors += 1` in both
  router templates — every 4xx (a *valid* client answer) inflated the same
  counter as real 5xx server failures.
- **Fix:** `errors` now counts 5xx only (true server failure, the number a dev
  watches for breakage); a new `clientErrors` counter holds 4xx separately.
  Applied identically to `express-router.txt` and `fastapi-router.txt` (hard
  rule #6). Regression in the Express runtime test: a 404 invoke increments
  `clientErrors`, leaves `errors` at 0. Stats are runtime-only (not persisted
  in `sparda.json`) → no carry-over concern.
- **Rule:** a 4xx is a successful conversation with an unhappy answer, not a
  failure — never fold client errors and server errors into one number a human
  reads to judge health.
- **Note:** the same report flagged a `params` vs `args` mismatch on the raw
  HTTP `/mcp/invoke` endpoint. Not reproduced through MCP: the bridge maps
  JSON-RPC `params.arguments` → `args` (`stdio.js`), so real clients are
  unaffected; the endpoint is internal and auth+localhost-gated. Left as-is
  (optional P3: accept `params` as an alias + clearer error on the HTTP layer).

## E-015 — Express + FastAPI Parser Stress Test Findings (v0.5.0)
- **Symptom:** Five parser bugs identified during stress testing:
  1. `/mcp-analytics` or `/mcp-status` blocked (Bug #1).
  2. `async def` routes ignored in FastAPI (Bug #2).
  3. Modular package imports failed to resolve router symbols (Bug #3).
  4. Pydantic cross-file models schemas missing/not inferred (Bug #4).
  5. `Depends()` exposed in query parameters (Bug #5).
- **Root cause:**
  1. Prefix check was checking `.startswith('/mcp')` instead of exact match or prefixing `/mcp/`.
  2. AST check only looked at `ast.FunctionDef` and skipped `ast.AsyncFunctionDef`.
  3. `ImportFrom` handling matched package directory `__init__.py` instead of checking the specific symbol module (e.g. `routers/users.py`) first. Additionally, `include_router` check only matched `ast.Name` and skipped attribute arguments (e.g. `users.router`).
  4. Imported Pydantic models were never parsed because non-router files were never read.
  5. Argument signature check did not inspect default values to filter out `Depends` calls.
- **Fix:**
  1. Tightened `/mcp` checks in both JS and Python routers.
  2. Matched both `ast.FunctionDef` and `ast.AsyncFunctionDef` for routes.
  3. Handled relative imports with correct level dots, resolved imported symbols as files first, and supported `ast.Attribute` router variables in `include_router`.
  4. Added `preload_models()` pre-pass walking the AST of all imported files before routes parsing.
  5. Checked default values of function arguments and skipped them if they are `Depends()` calls.
- **Rule:** FastAPI extraction must support async def routes, Depends injections, cross-file Pydantic bodies, and nested routers to parse production APIs.

## E-016 — Generated FastAPI router broke on Python < 3.12 (f-string backslash)
- **Symptom:** CI red on `ubuntu-latest` / Node 22 (and every matrix cell, hidden
  by fail-fast) after the 5b push: 5 failures in `tests/sparda.test.js` — three
  FastAPI byte-for-byte tests (`expected 1 to be +0`, i.e. `py_compile` exited
  non-zero) and two FastAPI runtime tests timing out at 60s (uvicorn never came
  up). The compiler error: `SyntaxError: f-string expression part cannot include
  a backslash`. **Green locally, red in CI** — the trap below.
- **Root cause:** the `require_human` branch of `templates/fastapi-router.txt`
  built the confirm `instruction` with a conditional *inside* the f-string
  expression part that contained escaped quotes:
  `f"...{' First call \"' + sibling_name + '\" ...' if sibling_name else ' To'}..."`.
  Python < 3.12 forbids **both** a backslash and the delimiting quote inside an
  f-string `{expression}` (PEP 701 lifted this in 3.12). The CI matrix pins
  Python 3.10, so it caught it; a dev on Python ≥ 3.12 (where the old syntax
  compiles fine) sees 125/125 green and never notices — this class of bug is
  structurally invisible to local runs on modern Python.
- **Fix:** pre-compute the segment in a local before the f-string, then
  interpolate the plain variable: `sparda_hint = f' First call "{sibling_name}"
  ...' if sibling_name else ' To'` → `...touched.{sparda_hint} confirm...`. No
  backslash, no quote reuse in any expression part. (The `\"confirm\"` later in
  the same string is in the *literal* part, which is always legal.) 125/125
  stays green on 3.12; CI Python 3.10 turns green.
- **Rule:** generated Python targets the **minimum** supported runtime (3.9), not
  the dev's local one. Never put a backslash or the delimiting quote inside an
  f-string `{expression}` — build the value in a variable first. The Python 3.10
  CI cell is the oracle for this; keep it in the matrix.

## E-017 — `sparda remove` deleted the backup it just told you to restore
- **Symptom:** on a rare unclean revert (the injection-stripped entry file no
  longer parses → `removeInjection` returns `{ok:false}`), remove printed
  "restore from .sparda/backup/" and then deleted `.sparda/` anyway — erasing
  the backup in the same run.
- **Root cause:** `commands/remove.js` ran the destructive cleanup
  (`fs.rmSync('.sparda', …)`) unconditionally, after the per-file results were
  only *logged*, never *gated on*.
- **Fix:** if any file failed to revert, STOP before any deletion — preserve
  `sparda.json`, generated files and `.sparda/backup/`, set `exitCode=1`, tell
  the operator what to restore. Nothing is removed until the tree is known-clean.
- **Rule:** never destroy a recovery artifact on the same path that recommends
  it. Gate destructive cleanup on the success of every reversible step (rule #4).

## E-018 — Injection removal left a stray blank line at the top of a file
- **Symptom:** `init → remove` produced a non-clean `git diff` (one extra blank
  line) when the marked block sat at the very top of the entry file
  (`insertAt === 0`).
- **Root cause:** injection inserts the block as whole lines *before* an existing
  line, adding the block + a *trailing* newline (the leading newline was already
  the file's). Removal consumed the *leading* newline instead — byte-perfect for
  a mid-file block, off-by-one-newline for a top-anchored one. Express and
  FastAPI each carried their own copy of this regex, free to drift.
- **Fix:** one shared contract, `src/generator/injection.js` —
  `stripForRemoval` consumes the block + its *trailing* newline (the exact byte
  inverse of a line splice); `stripForReinit` keeps a single separator. Both
  generators import it; the duplicated markers/regex/`escapeRx` are gone.
  Verified byte-identical for mid-file, top-of-file, and CRLF.
- **Rule:** an operation and its inverse must share one definition, or they drift
  (rule #4). If you splice lines, invert on lines — not on a hand-tuned regex.

## E-019 — Write-confirmation nonce minted with `Math.random()` (JS routers)
- **Symptom:** the `cfm_` single-use token that gates live-app writes was
  predictable — `Math.random()` (V8 xorshift128+) is reconstructible from a few
  outputs. FastAPI already used `uuid.uuid4()`, so the JS routers were the weak
  ones (broken parity).
- **Fix:** `spardaNonce()` → `'cfm_' + globalThis.crypto.randomUUID()` in the
  Express and Next.js templates (Web Crypto is a Node ≥18 / Next global; no new
  dep, no new placeholder). `errorId` (log correlation, non-security) left as-is.
- **Rule:** anything that GATES a state change is security-sensitive — mint it
  with a CSPRNG, never `Math.random()`. Keep the three router templates at parity.

## E-020 — Canonical graph not byte-identical across locales (`localeCompare`)
- **Symptom:** the UBG canonical serialization promised "byte-identical, machine
  after machine" (schema.js) but could differ across hosts. `canonicalizeGraph`
  sorted NODES by code unit yet EDGES by `String.prototype.localeCompare` — whose
  collation depends on the host ICU/locale. Under a locale collation `order_items`
  sorts before `Orders`; under code units the reverse. Same graph → different bytes
  on a differently-localed machine.
- **Blast radius:** not just edge order. `localeCompare` also drove graph *content*
  decisions — SQL table dedup tie-break (which duplicate definition "wins"), the
  translator's first-wins helper pick, the state-minimization merge-pair pick — plus
  stored meta arrays (state-machine transitions, SQL/Prisma invariants). All
  locale-dependent, so two machines could compile the *same* code to *different*
  graphs, undermining `apocalypse` baseline diffs and the `verify` determinism claim
  across machines (same-machine runs stayed stable, so CI never caught it).
- **Fix:** one exported deterministic comparator `cmp(a,b)` (UTF-16 code units) in
  `schema.js`, used in `canonicalizeGraph` (nodes + edges) and every graph-affecting
  sort: `sql.js` (table dedup + invariants), `prisma.js` (invariants), `translate.js`
  (helper pick), `state-machines.js` (transitions), `state-minimization.js` (merge
  pick). Verified: `Orders`/`order_items` edge order now identical under `LC_ALL=C`
  and `LC_ALL=en_US.UTF-8`; 399 tests green.
- **Rule:** determinism that must hold ACROSS machines uses code-unit ordering, never
  `localeCompare`. Report/human-facing sorts may keep locale order; anything that
  reaches the canonical bytes (or a content decision behind them) must use `cmp`.

## E-021 — Node 18 CI red: `globalThis.crypto` is undefined (regression from E-019)
- **Symptom:** after E-019 switched the confirm-nonce to `globalThis.crypto.randomUUID()`,
  the Node 18 CI cell failed — `TypeError: Cannot read properties of undefined (reading
  'randomUUID')` in the generated Express router (sparda.test.js) and the standalone
  Next.js route (nextjs.test.js). Node 22 was green, so local runs never caught it.
- **Root cause:** `globalThis.crypto` (Web Crypto) only became a **default global in
  Node 19**; on Node 18 (in the engines range `>=18` and the CI matrix) it is undefined.
  My E-019 comment claimed it was a "Node >=18 global" — wrong.
- **Fix:** split by runtime.
  - **Express router** runs in the host's arbitrary Node ≥18 process, so it must not
    depend on a global: added a `__CRYPTO_IMPORT__` placeholder rendering
    `import spardaCrypto from 'node:crypto'` / `require('node:crypto')` (whose
    `randomUUID` exists since Node 14.17), wired in `generator/express.js` and
    `tests/router-selftest.cjs`. `spardaNonce` → `spardaCrypto.randomUUID()`.
  - **Next.js route** is web-standard and always runs in a Next runtime that provides
    `globalThis.crypto` (both Node and Edge), so it keeps `globalThis.crypto.randomUUID()`;
    the standalone unit test polyfills `globalThis.crypto = webcrypto` on Node < 19,
    emulating the runtime it bypasses.
- **Rule:** the engines floor is Node 18 — never use a Node-19+ global unguarded. Web
  Crypto as a bare global is 19+; `node:crypto.randomUUID` is the 18-safe CSPRNG. A green
  local run on Node 22 is not proof; the CI matrix's lowest cell is the oracle.

## E-022 — Node 18 CI red: mirror-stateful tests time out (undici stale keep-alive)
- **Symptom:** `tests/mirror-stateful.test.js` passed on Node 22 but every `fetch`
  against the mirror timed out (5000ms) on the Node 18 CI cell. curl was always fine.
- **Root cause:** the Mirror VM served HTTP/1.1 keep-alive. Each test spins up an
  ephemeral server (port 0), and the OS recycles port numbers across tests. Node 18's
  undici caches a keep-alive socket by origin (host:port) and, on the next test that
  lands on the same recycled port, reuses that now-dead socket — and hangs. (rawRequest
  hung the same way under rapid sequential reuse; curl opens fresh, so it never saw it.)
- **Fix:** the mirror now sends `Connection: close` on every response. A mock has no
  need for keep-alive, and closing per response means no client — undici, the raw-socket
  helper, anything — can cache or reuse a socket to a since-recycled port. `req.resume()`
  is kept to drain any request body before close.
- **Rule:** an ephemeral test server that a pooling client (undici/fetch) hits across
  many short-lived instances must not invite socket reuse — send `Connection: close` (or
  disable keep-alive). A green Node 22 run is not proof; undici's pooling differs by
  Node/undici version, and the CI matrix's lowest cell is the oracle.
