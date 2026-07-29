# Error knowledge base (append-only)

The project's own immune memory. Every non-trivial bug gets an entry:
**Symptom / Root cause / Fix / Rule**. Check here _before_ debugging
anything that smells familiar. Newest last.

---

## E-001 — MCP client shows "connection closed" / garbage JSON-RPC

- **Symptom:** bridge dies instantly or client reports protocol errors.
- **Root cause:** something printed to stdout — stdout _is_ the MCP stream.
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
  baseline-vs-live-event. A _new_ bridge feature (`sparda_get_context`)
  also fetches `/mcp/events`, consumed the mock's baseline slot, and the
  bridge's own baseline poll then swallowed the live event
  (`lastSeq === null → discard`).
- **Fix:** commit `364b826` — context-tool assertions moved _after_ the
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
  pollution was _stable_ there.
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
  catch it: `true` is a syntactically valid _identifier_ — it only explodes
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
  (`+.sparda/` + a blank line). All injected _code_ came back byte-identical;
  only the gitignore edit survived. Found by the 2026-06-11 desktop E2E
  (Phase 1, reconfirmed Phase 3 on a multi-file app).
- **Root cause:** `init`'s `ensureGitignore` appends `\n.sparda/\n` (or creates
  the file) but `remove` never reverted it — `remove.js` even printed
  _"clean (minus a .gitignore line)"_, normalizing the violation of hard
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
  `index.js` only exits non-zero on a _thrown_ error and doctor catches its
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
- **Root cause:** someone had run `npm install` _inside_
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
  router templates — every 4xx (a _valid_ client answer) inflated the same
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
  built the confirm `instruction` with a conditional _inside_ the f-string
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
  the same string is in the _literal_ part, which is always legal.) 125/125
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
  only _logged_, never _gated on_.
- **Fix:** if any file failed to revert, STOP before any deletion — preserve
  `sparda.json`, generated files and `.sparda/backup/`, set `exitCode=1`, tell
  the operator what to restore. Nothing is removed until the tree is known-clean.
- **Rule:** never destroy a recovery artifact on the same path that recommends
  it. Gate destructive cleanup on the success of every reversible step (rule #4).

## E-018 — Injection removal left a stray blank line at the top of a file

- **Symptom:** `init → remove` produced a non-clean `git diff` (one extra blank
  line) when the marked block sat at the very top of the entry file
  (`insertAt === 0`).
- **Root cause:** injection inserts the block as whole lines _before_ an existing
  line, adding the block + a _trailing_ newline (the leading newline was already
  the file's). Removal consumed the _leading_ newline instead — byte-perfect for
  a mid-file block, off-by-one-newline for a top-anchored one. Express and
  FastAPI each carried their own copy of this regex, free to drift.
- **Fix:** one shared contract, `src/generator/injection.js` —
  `stripForRemoval` consumes the block + its _trailing_ newline (the exact byte
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
- **Blast radius:** not just edge order. `localeCompare` also drove graph _content_
  decisions — SQL table dedup tie-break (which duplicate definition "wins"), the
  translator's first-wins helper pick, the state-minimization merge-pair pick — plus
  stored meta arrays (state-machine transitions, SQL/Prisma invariants). All
  locale-dependent, so two machines could compile the _same_ code to _different_
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

## C-001 — Parser coverage gaps found in the real-repo corpus run

- **Symptom:** two real public Express repos compiled to **0 nodes** — SPARDA
  emitted no routes. Worse, apocalypse then printed **"PROVEN over 0 nodes"** and
  **exited 0**: a parser-coverage miss silently read as a green proof.
- **Root cause (two classes):**
  - **C-001a — inline-require router mounts.** `app.use('/users',
require('./users/users.controller'))` (rootpath-style apps): `handleUse`
    only matched an _Identifier_ router arg, so an inline `require()` mount was
    dropped and the controller's routes never scanned.
  - **C-001b — TypeScript DI route loaders.** `export default (app) => {…}` /
    `routes(app)`: the router is a function _parameter_, never an `express()`
    binding, so there is no literal `app.METHOD(...)` call site to anchor on.
- **Fix:**
  - **The risk class is closed for good (the real "never again"):** `verdictOf`
    is now provability-aware — a graph with **zero entrypoints is `provable:
false`**, which forces `safe`/`clean` false. apocalypse and review print
    **`✗ NO PROOF`** and **exit 1** on a blind compile. A coverage miss can no
    longer masquerade as a proof, on _any_ repo, ever. (`src/ubg/apocalypse.js`
    `verdictOf`; wired in `src/commands/apocalypse.js` + `review.js`.)
  - **C-001a fixed:** `handleUse` now resolves an inline-`require()` mount via
    `mountTargetFile` (`src/ubg/express.js`). Unlocked `cornflourblue`
    (0 nodes → 7 routes, correct PROVEN). Regression fixture:
    `tests/fixtures/ubg-inline-mount/`.
  - **C-001b still backlog** — but now _safe_: it yields NO PROOF (exit 1), not a
    false PROVEN. Reproduces on `tests/fixtures/ubg-blind/`. Widening the parser
    to follow DI loaders (treat a route-module's first param as a router) is the
    next coverage item, no longer a correctness risk.
- **Rule:** "PROVEN over 0 nodes" is **vacuous** — a zero-entrypoint compile is a
  coverage miss, never a pass. Enforce it at the verdict, not per-command: any
  verdict emitter that can't see a route surface must say NO PROOF and fail CI.

## E-023 — `sparda immunize` crashed on a fresh project (no `.sparda/` dir)

- **Symptom:** `sparda immunize` in a directory that had never been compiled threw
  `ENOENT: … open '.sparda/immunity.json.sparda-tmp'` and exited 2. It only "worked"
  in dev when another command (`ubg`, `apocalypse`) had already created `.sparda/`.
  Caught by a smoke test Gemini added (`command-smoke` — the test was right, the code
  was wrong).
- **Root cause:** `runImmunize` called `atomicWrite(outPath, …)` without first creating
  the `.sparda/` directory. `atomicWriteFileSync` writes a `*.sparda-tmp` sibling then
  renames — both fail if the parent dir doesn't exist. `apocalypse`/`serialize` both
  `mkdirSync(recursive)` first; `immunize` (new in 0.15.0) forgot to.
- **Fix:** `fs.mkdirSync(path.dirname(outPath), { recursive: true })` before the write
  in `src/commands/immunize.js`.
- **Rule:** any command that writes into `.sparda/` must `mkdirSync(recursive)` the
  parent first — never assume a prior command created it. A file-writing command must be
  runnable standalone on a virgin checkout.

## E-024 — Derived artifacts not byte-identical across locales (`localeCompare` again)

- **Symptom:** E-020 fixed the _graph's_ determinism (in `canonicalizeGraph`), but the
  DERIVED emitters still sorted with `String.prototype.localeCompare`: apocalypse
  findings + the per-entrypoint iteration order (→ `polarity`, `immunize`, `review`
  outputs), the emitted OpenAPI spec, the mirror node dump, and the `ubg` report. For
  mixed-case / punctuation-leading routes the collation diverges from code units, so a
  machine in a different ICU/locale emits a _different byte stream_. Proven: `/Users`,
  `/_debug`, `/admin`, `/users` sort in a completely different order under `cmp` vs
  `localeCompare('en-US')`. (It slipped past earlier because the test fixtures have only
  lowercase routes, where the two orders happen to agree.)
- **Root cause:** the determinism contract (`cmp`, code units) was enforced only at
  `canonicalizeGraph`, not in the artifact emitters downstream of it.
- **Fix:** replaced every output-reaching `localeCompare` with the exported `cmp` in
  `src/ubg/apocalypse.js` (entrypoints, findings sort, aggregate-domain sort),
  `src/ubg/openapi-emit.js`, `src/ubg/mirror.js`, `src/commands/ubg.js`. Regression:
  `tests/determinism.test.js` builds a graph whose routes make the two orders diverge and
  asserts the output follows `cmp`, never `localeCompare`.
- **Rule:** `cmp` (code units), never `localeCompare`, for ANY ordering that reaches a
  serialized or printed artifact — not just the canonical graph. `localeCompare` is
  _specified_ to be locale-dependent; a green run in one locale is not proof.
- **Follow-up (logged, not a bug today):** several graph-BUILDING sorts (in `ubg/express`,
  `nextjs`, `sql`, `prisma`, `link`, `reach`, and the `passes/*`) still use `localeCompare`.
  They feed `canonicalizeGraph`, which re-sorts by `cmp`, so they don't change the final
  `ubg.json` bytes today — but convert them for defense-in-depth if any ever starts
  assigning order-dependent ids/ordinals.

## C-001b — RESOLVED for NestJS: DI-framework apps compiled to 0 routes

- **Symptom:** NestJS / Medusa / Inversify apps compiled to **0 nodes** (NO PROOF).
  Routes are `@Get()` decorators, not `app.get()`; the real write lives in a DI'd
  service; and Nest parameter decorators (`@Body()`) even broke the parse.
- **Fix (ADR-039):** `src/ubg/nestjs.js` — decorator route table + `@UseGuards` +
  **static DI resolution via constructor parameter types** (follow `this.svc.m()` to the
  service method). Plus `extract.js` reads `this.<field>` effects, and the parser uses
  `decorators-legacy`. A Nest app now yields real findings (proof: `tests/nestjs.test.js`).
- **Remaining (tracked, not a bug):** string-token runtime DI (`resolve('userService')`)
  and file-based routing conventions are the next ingestion rungs; non-JS via `--openapi`.
- **Rule:** ingestion is a LADDER, not one detector. When a framework hides its routes
  behind decorators/DI/conventions, add a rung that reads the static signal that IS there
  (here: constructor types) — never just throw "not supported".

## C-001c — RESOLVED for Medusa: file-based routes compiled to 0 (the real wall)

- **Symptom:** a real `medusajs/medusa` checkout still compiled to **0 routes** even
  after the Nest extractor — Medusa has **no `@Controller` classes**. Routes are a
  _filesystem convention_ (`src/api/<path>/route.ts`, verb = exported const name), and
  the DB write lives in a **workflow** call, not an ORM call. NestJS's decorator scan
  found nothing → NO PROOF on the biggest JS commerce app. This is the wall an automated test re-hit.
- **Fix (ADR-040):** `src/ubg/medusa.js` — walk `src/api/**/route.{ts,js}`; path from the
  directory (`[id]`→`:id`); exported `GET/POST/…` = methods; **inverted** auth convention
  (`export const AUTHENTICATE = false` is the _only_ opt-out, else guarded); and a
  **workflow-verb effect heuristic** (`create*Workflow`→`db_write insert`, `list*`→read)
  since `scanFunction` sees no ORM op in the body. Detected from `@medusajs/*` + `src/api`.
- **Proof:** real Medusa (319 route files) went **0 → 476 routes** in ~0.5s, 0 skipped —
  435 db*writes, 121 state tables, 474 guards, verdict \_provable & clean* (honest: Medusa
  guards nearly every mutation). Fixture: `tests/medusa.test.js` (6). One critical caught
  on the `AUTHENTICATE=false` public cart mutation — the inversion works.
- **Remaining rung:** Medusa declares data models in its own DML (not `.sql`/`.prisma`),
  so O2 (field validation) has no constraint set on Medusa yet. Next rung: DML parsing.

## E-025 — Hollow PROVEN: a green verdict on apps with ZERO resolved behavior

- **Symptom:** the multi-repo organ stress test found SPARDA printing **✓ PROVEN** on
  immich (281 NestJS routes, 1 effect), GitHub's OpenAPI (1196 routes, 0 effects), and a
  stock Express boilerplate (8 routes, 0 effects). "No obligations to fault" was reported as
  a clean bill of health, when the truth was "SPARDA saw the route surface but not what the
  code does" (a spec has no bodies; DI/external-controller effects weren't followed).
- **Fix (ADR-042):** the **behavior guard** — `countObserved(graph)` (state + db/http/fs
  effects; entropy excluded) in `apocalypse.js`. Routes but `observed===0` → **SURFACE ONLY**,
  a distinct third verdict: `clean` (PROVEN) requires `!surfaceOnly`, but `safe` (the CI gate)
  does not (unprovable ≠ unsafe → still exit 0). Shared by verdict, `buildCapsule`, `immunize`,
  and `dossier` so no two artifacts disagree.
- **Proof:** immich + GitHub-OpenAPI flipped to SURFACE ONLY; dub/Medusa unchanged. New
  `tests/fixtures/ubg-proven` is the suite's first _genuine_ PROVEN — the old "clean app" test
  had been asserting a hollow proven on an effect-less echo app the whole time.
- **Rule:** a behavior compiler that resolved no behavior must not print the same green as one
  that proved everything. Absence of findings is only a proof when there was something to fault.

## E-026 — NestJS monster read as 1 effect / hollow PROVEN (immich)

- **Symptom:** the stress test found immich (281 NestJS routes) resolving **1 effect** → a
  hollow PROVEN. Routes were read but the behavior behind them was invisible.
- **Root cause (four stacked):** (1) immich imports via tsconfig `baseUrl` (`src/services/x`),
  which `resolveRelImport` didn't handle; (2) the DB write is 2 DI hops down (controller →
  service → repository), the resolver did 1; (3) the repository is injected in a `BaseService`
  the service `extends` (inherited DI — the type is imported in the base module); (4) the DB
  layer is Kysely (`db.insertInto`) and guards are `@Authenticated()` not `@UseGuards()`.
- **Fix (ADR-043):** tsconfig `baseUrl`/`paths` resolution; recursive bounded DI (`followDI`);
  DI map built up the `extends` chain with each entry tagged by its declaring module
  (`diMapWithMod`); Kysely ops in the scanner; guard-by-decorator-name.
- **Proof:** immich → **310 effects, 45 tables, 253 guards, NOT PROVEN with 2 genuine** OAuth
  findings. Fixture `ubg-nestjs-deep` + `nestjs-deep.test.js`. dub/Medusa/OpenAPI unchanged.
- **Rule:** once you resolve effects deeper, you MUST resolve guards as deep, or precision
  collapses into false-positive noise (125 → 2 here). Effect depth and guard depth ship together.

## E-027 — stock Express boilerplate read as 0 effects / SURFACE ONLY

- **Symptom:** a standard Express app (external controllers + services) resolved **0 effects**
  → SURFACE ONLY. Routes read, behavior invisible.
- **Root cause (three stacked):** (1) the extractor resolved the `controller.method` handler but
  not the `service.method()` calls inside it; (2) services are imported through a barrel
  (`const { x } = require('./services')`, index.js re-exports each); (3) the leaf is Mongoose
  (`Model.create()`), unrecognised.
- **Fix (ADR-044):** recursive module-member deep scan (`deepScan`/`followMembers`, express.js);
  barrel re-export resolution (`parseModule` records `module.exports.x = require`, destructured
  imports resolve through it); Mongoose ops in the scanner (Capitalized receiver + known op).
- **Proof:** boilerplate → **9 effects, 2 tables, NOT PROVEN with 3 genuine** findings. Fixture
  `ubg-express-deep` + `express-deep.test.js`. immich/dub/Medusa unchanged.
- **Rule:** the CommonJS `obj.method()` chain is the exact analogue of Nest's `this.dep.method()`
  DI chain — resolve it the same way (recursive, bounded), or the flagship framework stays blind.

## E-028 — Express detection hard-failed on a non-standard entry filename

- **Symptom:** `findExpressEntry` threw "Could not locate your Express entry" on apps whose
  entry isn't named `app/server/index/main.{ts,js}` — e.g. parse-server (`src/ParseServer.ts`).
  A real, supported app was rejected before any analysis ran.
- **Root cause:** detection only probed a fixed candidate-filename list; anything else missed.
- **Fix (ADR-045):** a bounded source-tree fallback (`searchExpressEntry`) — scan for a bare
  `express()` app-factory call, rank a `.listen()`ing server first, exclude node_modules/tests/
  examples, cap at 400 files. Mirrors the existing FastAPI `searchPyFiles` fallback.
- **Proof:** parse-server detects as `express @ src/ParseServer.ts` (then honest NO PROOF — a
  library). Fixture `ubg-express-weird-entry` (entry `bootstrap.ts`) → detected + 2 routes.
- **Rule:** detection must never hard-fail on a _naming_ convention — probe the fast named
  paths, then fall back to the semantic signal (the `express()`/`FastAPI()` call itself).

## E-029 — Over-broad deny detection turned throwing business logic into fake guards

- **Symptom:** while hardening guard semantics (ADR-046), treating a bare `throw` / `next(err)`
  as a deny signal made express-boilerplate flip NOT PROVEN→PROVEN and dub drop 156→152
  findings — real unguarded mutations got HIDDEN.
- **Root cause:** `isGuardLike(name, scan)` credits any `scan.guardSignals.deniesWithStatus`
  as a guard. A service throwing `ApiError(400)` on bad input then classified as a "guard" on
  the mutation path → the route read as guarded.
- **Fix:** deny recognition stays **auth-specific** — `res.status(401|403)` / `sendStatus`
  only, never a generic throw. The no-op-guard downgrade (structural) and `verified` provenance
  are the safe parts kept.
- **Rule:** a "deny" that feeds guard classification must be auth-specific (a 401/403), not any
  error path — or validation logic becomes counterfeit auth and masks the very bugs we hunt.

## E-030 — Express app built inside createApp() read as 0 routes

- **Symptom:** directus (and most real Express apps) compiled to **0 routes / NO PROOF** — the
  whole app is built inside `export default function createApp() { const app = express(); …
app.use('/x', xRouter); return app; }`.
- **Root cause:** the extractor walked only `mod.ast.program.body` (module top level), so the
  `express()` var and every mount — one level down inside the function — were invisible.
- **Fix (ADR-047):** `flattenSetup` descends into setup-function bodies + their control-flow
  blocks (if/for/try/while/block), never into function _arguments_ (handlers stay opaque), and
  feeds the flattened stream to collectAppVars/collectRouteArrays/the route walk.
- **Proof:** directus 0 → 239 real routes; node-express-boilerplate 8 → 9 (recovered an
  if-gated `/v1/docs`). Fixture `ubg-express-factory` + `express-factory.test.js`. 532 green.
- **Rule:** production apps wrap setup in a function — a top-level-only walk misses the whole
  app. Descend into setup bodies and control flow; stop at function arguments (handlers).

## E-031 — Instantiated services were invisible: directus read SURFACE ONLY

- **Symptom:** after ADR-047 recovered its 239 routes, directus still compiled to 0 effects —
  `surfaceOnly`, no real verdict. Every handler builds its service with
  `new ItemsService(…)` and the DB calls live on the base class it extends.
- **Root cause:** the Express deep scanner followed module-member calls and Nest DI, but not
  `new X()` instances; additionally its handlers are _inline_ `asyncHandler(async…)` wrappers
  (blind nodes), and the base-class effects sit behind `this.<m>()`/`super.<m>()` hops and
  `this.knex('t')` builder calls — four independent blinders stacking on the same app.
- **Fix (ADR-048):** unwrap inline wrapped handlers; map `const svc = new X(…)`; resolve
  `svc.method()` up the `extends` chain with `this` re-dispatch from the instantiated class and
  `super` from the declaring base; read `this.knex('t')` as a table op. Memoized per
  (class, method) — no perf cliff (E-027's lesson applied from the start).
- **Proof:** directus SURFACE ONLY → real verdict with observed effects; corpus unchanged
  everywhere else; fixture `ubg-express-instance` + 4 tests. 536 green.
- **Rule:** blindness stacks. When an app reads as SURFACE ONLY, hunt for ALL the idioms in its
  handler → effect path — fixing one blinder and re-testing per-blinder is how you find the
  next one, and they usually ship together or not at all.

## E-032 — "PROVEN" was silently standing in for "omniscient"

- **Symptom:** twenty/formbricks/open-webui/directus all read PROVEN while SPARDA had resolved a
  small fraction of their behavior (GraphQL, un-followed services, Python depth, dynamic query
  builders). A green verdict looked identical whether SPARDA saw everything or almost nothing.
- **Root cause:** the verdict reported what was proven but never quantified what was UNSEEN.
  `surfaceOnly` was all-or-nothing (0 effects); a partially-blind app fell through as clean.
- **Fix (ADR-049):** the blindspot ledger — opaque-target / blind-mutation / unverified-guard /
  skipped-surface, ranked by what each could hide, plus a coverage ratio. Reported under every
  verdict (apocalypse), in the dossier, and as `sparda blindspots` (exit 1 on high+). Verdicts
  unchanged — it only makes the blindness visible.
- **Proof:** twenty PROVEN → "coverage 8%, 406 blind"; directus PROVEN → "coverage 13%, 15 high";
  dub NOT PROVEN → "99%". Fixture `ubg-blindspots` + 7 tests. 543 green.
- **Rule:** a prover must report the boundary of its own sight. "I proved X" is only honest next
  to "and here is what I could not see." Measure the unknown; never let green imply omniscient.

## E-033 — directus's real table was one class and one middleware-slot away

- **Symptom:** after ADR-050, directus still read PROVEN at 13% coverage — the main `/items`
  CRUD produced ZERO db effects.
- **Root cause (two stacked):** (1) the table is chosen at the route as a constructor arg
  (`new ItemsService(req.collection)`), stored on `this.collection`, and used deep in inherited
  methods — a cross-class hop the within-handler resolver couldn't follow; (2) directus puts the
  business logic in a MIDDLEWARE slot with a `respond` formatter last, and the translator only
  attached effects from the TERMINAL chain step, so the real handler's effects were dropped.
- **Fix (ADR-051):** a symbolic `this`-environment bound at the `new X()` site and threaded
  through the class-method bundle; both knex builder orders (`.knex(t)` and `.select().from(t)`);
  effects attached from every chain step with a body; collision-aware effect ids so two bindings
  of one method line coexist.
- **Proof:** directus coverage 13% → 95%, db effects 11 → 344, `:collection` resolving; corpus
  verdicts/findings byte-identical. Fixture `ubg-crossclass-table` + 3 tests. 546 green.
- **Rule:** in real apps the effect is rarely in the last slot of the last function. Follow the
  value across the class boundary AND scan every chain step — the business logic hides in the
  middle as often as at the end.

## E-034 — Corpus drift: Nest monsters now detect as Express (direct `express` dep wins)

- **Symptom:** `compileUBG` on today's HEAD of immich (`server/`) and twenty
  (`packages/twenty-server`) hard-fails with "Could not locate your Express entry
  file" — apps that compiled fine in the v0.32.0 baseline runs.
- **Root cause:** NOT a regression (verified via `git stash` old-code re-probe —
  the playbook's oracle; identical failure on both). Upstream drift: both apps now
  list `express` as a DIRECT dependency, and `detectStack` checks `deps.express`
  BEFORE `@nestjs/*`, so the Express branch wins and then hard-fails hunting an
  `express()` entry that doesn't exist.
- **Fix:** none yet (recorded, out of ADR-054 phase-1 scope — it changes detection
  behavior). Candidate: on `findExpressEntry` failure, fall through to the
  Nest/Medusa checks instead of throwing (mirrors the "unprovable ≠ crash" rule).
  Workaround for corpus work: force the lowering (probe calls `extractNest`
  directly) or pin corpus clones by SHA.
- **Rule:** corpus baselines are only comparable at pinned SHAs; before blaming a
  diff for a corpus change, re-probe the OLD code first (this is the second and
  third time that rule paid for itself).

### E-034 — RESOLVED (fall-through shipped)

- **Fix:** `detectStack` wraps the Express branch: if `deps.express` is present but
  no `express()` entry resolves AND the app carries a Nest/Medusa marker, detection
  falls through to those checks instead of throwing. An app with an express dep and
  no other marker keeps the original E-028 error. immich full-pipeline reads
  281r / NOT PROVEN F=2 and twenty 145r / PROVEN — both at their baseline verdicts.
  Fixture `ubg-nestjs-express-dep` + 2 tests in `nestjs.test.js`.

## E-035 — Phantom FastAPI extraction failure: spawnSync's 1 MiB default buffer

- **Symptom:** `compileUBG` on open-webui threw "FastAPI UBG extraction failed:"
  followed by the START of perfectly valid JSON output.
- **Root cause:** deep-scanned route facts (456 routes, every chain step carrying
  a merged scan) exceed `spawnSync`'s default 1 MiB `maxBuffer`; Node kills the
  child mid-write, `status != 0`, and the wrapper surfaces truncated stdout as
  the "error" — a resource limit masquerading as a parse failure.
- **Fix:** `extractFastAPI` passes `maxBuffer: 64 MiB` (0.34.0).
- **Rule:** when a child process "fails" while printing valid output, check the
  buffer/timeout limits BEFORE debugging the child. Any subprocess whose output
  scales with project size needs an explicit maxBuffer.

## E-036 — A real Express giant hard-failed at detection (entry scan budget too small)

- **Symptom:** `sparda apocalypse` on Ghost (TryGhost, ~1381 source files) threw
  "Could not locate your Express entry file" — a genuine Express app, unanalyzable.
- **Root cause:** `searchExpressEntry`'s tree scan capped at 400 files on an
  unprioritized walk; Ghost's `core/shared/express.js` sits past that cap, so it
  was never read. A bare `express()` app that SPARDA simply never reached.
- **Fix:** entry-named files (`express`/`app`/`server`/`index`/`main`/`bootstrap`/
  `application`/`boot`) get their OWN scan budget (600), separate from the general
  400 — they are rare, so scanning them tree-wide is cheap and finds the entry at
  any depth. Ghost now detects `core/shared/express.js` → honest NO_PROOF (its
  custom routing layer is unseen, the correct verdict), not a crash.
- **Rule:** a bounded scan on a giant must be PRIORITIZED, not just capped — cap by
  category (entry-named vs bulk), never let the bulk starve the signal.

## E-037 — Reads-only hollow PROVEN (a proof about nothing)

- **Symptom:** Vendure (312 routes, GraphQL-first) read **PROVEN** at **0% coverage**
  — 0 writes, 26 reads (its TypeORM-via-custom-connection writes weren't resolved).
- **Root cause:** `surfaceOnly` was gated on `observed === 0`, and `observed`
  counts `db_read`. An app with reads but no writes has observed > 0 → not surface →
  clean → PROVEN. But every obligation SPARDA discharges (guard, atomicity,
  reversibility, unbounded-target) is about a MUTATION; reads discharge none. A
  reads-only PROVEN is vacuous.
- **Fix:** `countProvable` (db_write/http_call/fs_write only, read-only state
  excluded); `surfaceOnly` is now gated on it. Reads-only ⇒ SURFACE. Every app with
  a real write is unaffected (corpus + fixtures byte-identical).
- **Rule:** a positive proof must be ABOUT something. If SPARDA resolved zero
  state-changing behavior, the honest verdict is SURFACE, never PROVEN — the
  effect-level twin of the provability guard (ADR-034).

## E-038 — Monorepo app dir crashed at detection (framework config lives elsewhere)

- **Symptom:** `compileUBG` on Ghostfolio's `apps/api` (Nx) and Langflow's
  `src/backend/base/langflow` threw "No supported framework found" — both are
  analyzable apps (34 @Controller files; a FastAPI backend).
- **Root cause:** detection reads only the pointed dir's package.json /
  requirements. In an Nx monorepo the app dir has a `project.json`, not a
  package.json (deps at root); in the Python monorepo the pyproject with fastapi
  sits one directory up. Detection was too LOCAL.
- **Fix:** two structural last resorts before the final throw (only reached when
  detection would otherwise fail, so zero effect on apps that detect normally):
  (1) `decoratorFrameworkDir(cwd)` — a decorator app detected by its @Get/@Post-on-
  class structure alone (no deps needed); (2) `fastAPIUpTree(cwd)` — a bounded
  4-level up-walk for a requirements/pyproject declaring fastapi. Ghostfolio → NOT
  PROVEN 116 routes / 75%; Langflow → honest NO_PROOF (detected, routing unseen).
- **Rule:** detection must not assume config is co-located with source. When the
  local manifest is silent, fall back to STRUCTURE (the source itself) and to a
  bounded up-tree search — never crash on a real app because of monorepo layout.

## E-039 — every alias hop silently dead on any tsconfig with a path glob (dub)

- **Symptom:** dub (Next, `apps/web`) read **152 UNGUARDED_MUTATION** — 147 of them
  false. Its routes authenticate through HOC wrappers imported by alias
  (`import { withWorkspace } from "@/lib/auth"`), yet `mod.imports` came back EMPTY
  for every route: not one `@/…` import resolved. Not just guards — every
  cross-module hop through an alias was dead.
- **Root cause:** `readTsconfig` stripped JSONC comments with a regex,
  `.replace(/\/\*[\s\S]*?\*\//g, '')`. A tsconfig `paths` value is a glob:
  `"@/pages/*": ["pages/*"]` contains `/*`, and a later `["**/*.ts"]` contains
  `*/`. The block-comment regex matched from the first `/*` **inside a string** to
  the next `*/` **inside another string**, deleting the entire span between them —
  the whole `paths` block. `JSON.parse` then threw, and the `catch` returned
  `{ baseDir, paths: {} }` (empty), so every alias resolved to null. Silent: a
  broken config looked exactly like "no aliases."
- **Fix:** replace the regex with `stripJsonc`, a string-aware scan that only treats
  `//` and `/* */` as comments **outside** string literals (plus trailing-comma
  removal). A regex fundamentally cannot do this — JSONC needs a tokenizer that
  tracks string state. dub: **152 → 5 UNGUARDED** once aliases resolved and the HOC
  wrappers below became reachable; cal.com verified guards rose too.
- **Rule:** never strip comments from JSONC (or any string-bearing grammar) with a
  regex. Values can contain the comment delimiters. Scan with string-awareness, and
  a config that fails to parse must be loud enough to notice, not silently empty.

## E-040 — CQRS command factories misread as db_writes (novu: 612 of 636 phantom)

- **Symptom:** novu (NestJS CQRS) read **636 db_write effects, 612 of them phantom** —
  tables like `getworkflowruncommand`, `builddeliverytrendchartcommand`. Its
  UNGUARDED_MUTATION count and whole verdict were dominated by writes that don't exist.
- **Root cause:** the active-record rule matches a Capitalized receiver with a write op —
  `User.create(...)`, `Post.save(...)`. In CQRS/DDD code the SAME shape is a command/query
  FACTORY: `GetWorkflowRunCommand.create({...})` constructs a command object and touches no
  database. The capitalization heuristic can't tell a model from a command class.
- **Fix:** a `NON_MODEL_RECEIVER` gate — a capitalized receiver ending in a DI/CQRS infra
  suffix (`Command`, `Query`, `UseCase`, `Handler`, `Dto`, `Service`, `Repository`,
  `Controller`, `Resolver`, `Gateway`, …) is not a model, so its `.create()`/`.save()` is
  not a write. novu: **636 → 24 db_writes, UNGUARDED 21 → 2**; dub/twenty/immich/cal.com
  unchanged; no app flips to a cleaner verdict (no false negative introduced).
- **Rule (SOUNDNESS Direction 1):** removing a db_write is the DANGEROUS direction — a
  wrongly-dropped write hides a real mutation. So the exclusion list contains ONLY suffixes
  that can never name an ORM model. Ambiguous nouns that CAN be models (`Event`, `Entity`,
  `Schema`, `Payload`) are deliberately KEPT as writes — over-flagging is the safe error,
  blindness is the unforgivable one.

### Known, deferred — crypto hash misread as a db_write (`sha256`)

- novu's 2 residual UNGUARDED findings are `mutates sha256`: `createHash('sha256').update(x)`
  / `createHmac('sha256', k)` — `builderTableOf`'s `isBaseCall` treats ANY `func('str')` as
  a knex table constructor, so the algorithm string becomes a "table". It is the SAFE kind
  of wrong (over-approximation / noise). The obvious fix — restrict `isBaseCall` to DB-named
  receivers — risks the UNSAFE direction (hiding a real `myKnex('t')` write behind an
  aliased connection), so it is NOT rushed. Deferred until a soundness-preserving gate is
  designed (e.g. a crypto-receiver denylist, symmetric to E-040's NON_MODEL_RECEIVER).

## E-041 — prisma `...OrThrow` / `createManyAndReturn` unrecognized: missed reads AND writes

- **Symptom:** while measuring the BOLA surface, dub's `findUniqueOrThrow({ where: { id,
projectId: workspace.id } })` — the ownership-scoping fetch that precedes a delete — was
  invisible, so a properly-scoped route (`DELETE /api/webhooks/:webhookId`) read as an
  unscoped BOLA candidate. dub gained **+104 db_reads** once fixed.
- **Root cause:** `PRISMA_OPS` listed `findUnique`/`findFirst`/`create` but not their
  common variants `findUniqueOrThrow`, `findFirstOrThrow`, `createManyAndReturn`, `groupBy`.
  The `...OrThrow` reads are exactly where apps put the authorization fetch; missing
  `createManyAndReturn` is worse — a WRITE SPARDA didn't see (a Direction-1 blind spot: a
  missed write can hide a real mutation, the one unforgivable error).
- **Fix:** completed `PRISMA_OPS` (the `...OrThrow` reads, `createManyAndReturn` insert,
  `groupBy` read). Additive, safe direction: dub reads 435 → 539, no verdict/finding change;
  corpus oracle re-baselined.
- **Rule:** an ORM op table must be COMPLETE for the writes especially — enumerate every
  mutating variant, because a missing write op is blindness, not noise. When adding an ORM,
  cross-check its full method list, not just the textbook four.

## E-042 — a called helper with a guard-ish NAME fabricates a guard (blocks bare-call following)

- **Symptom:** an attempt to follow BARE function calls (`getCustomerOrThrow(...)`, the
  precision enabler for BOLA/taint) made immich's `POST /auth/admin-sign-up` — a genuinely
  PUBLIC bootstrap route — read as GUARDED, silently dropping its UNGUARDED_MUTATION. The
  "guard" was `mapUserAdmin`: a MAPPER function, matched as a guard because its name contains
  "admin" (`GUARD_NAME = /…|admin|…/`). A fabricated guard hiding a real finding — the one
  unforgivable error (SOUNDNESS Direction 2).
- **Root cause:** translate classifies ANY reachable helper as a guard if its NAME matches
  `GUARD_NAME`, even a plain called function with no deny path. Chain steps (middleware /
  decorators) are legitimately name-trusted (`@Authenticated` is asserted-by-name); a helper
  reached through a CALL is not — it is logic that happens to be named `mapUserAdmin`,
  `isAdmin`, `sessionStore`, `authorMapper`, … Bare-call following exposed this at scale
  (member-call following can hit it too; the pinned corpus just didn't surface a case).
- **Fix (shipped, 0.49.0):** the translate helper loop now classifies a called helper as a
  guard ONLY by a proven deny (`scan.guardSignals.deniesWithStatus`), NEVER by name.
  Name-trust stays for explicit chain steps (`ensureChainNode`). Corpus: dub guards 514 →
  513 (one fabricated helper-guard corrected), zero finding/verdict change anywhere — a clean
  SAFE-direction tightening. Oracle re-baselined (dub guards=513 pins the fix). A minimal
  in-repo repro proved impractical (the fabrication needs a specific reachability/linking
  that only manifests on real code), so the corpus oracle IS the regression guard here — the
  purpose it was built for (E-039). This unblocks bare-call following (next).
- **Rule:** name-trust is for the chain (a middleware you SEE gate the route), never for a
  function you merely CALL. A guard you reached by following a call must PROVE it can deny.

### E-037 addendum — coverage-graded verdict (the residue)

- The reads-only fix (E-037) was necessary but not sufficient: cal-api-v2 (175
  routes, ONE non-read effect, ~0% coverage) still read PROVEN. Closed in 0.39.0
  (ADR-056): a CLEAN app below a 5% blindspot-coverage floor is SURFACE, not
  PROVEN. Guarded on findings.length===0 so coverage never hides a NOT_PROVEN.
- **Rule:** a proof over ~none of the behavior is not a proof. PROVEN requires
  BOTH a real mutation to reason about AND meaningful coverage of the surface.

## E-043 — Medusa mis-detected as a 1-route express app (corpus route count non-reproducible)

- **Symptom:** the flagship stress-test's Medusa number (~476 routes) was NOT reproducible
  out-of-the-box on the framework repo itself. A skeptic cloning Medusa and running SPARDA on
  `packages/medusa` got 1 route (mis-detected as express), 0 from the monorepo root — enough
  to conclude "bullshit" in two minutes. The heroic figure only appeared on a `create-medusa-
app` scaffold (which carries the runtime dep).
- **Root cause:** two-fold. (1) Medusa detection keyed off a runtime dep
  (`@medusajs/medusa`/`@medusajs/framework`), but the framework's OWN packages list
  `@medusajs/framework` in **devDeps** and never depend on themselves — so a dep check misses
  the framework repo. (2) `packages/medusa` lists `express` transitively; the express block
  ran BEFORE the Medusa block, `findExpressEntry` found a stray `express()` in the tree, and
  detection returned `express` (1 route) instead of falling through to Medusa's file-based
  routing (hundreds of `src/api/**/route.ts`).
- **Fix (shipped):** detect Medusa by its STRUCTURAL signature — a `src/api`/`api` tree of
  `route.ts` files exporting HTTP-verb handlers (`export const GET = …`) — with NO dep
  required, checked BEFORE the express block (`medusaApiDir`, detect.js). Cheap on a non-
  Medusa app (two statSync calls when the dir is absent); bounded + short-circuits at the
  first hit. `packages/medusa` now detects medusa/`src/api` → **477 routes** (reproduces the
  claim). Regression: `ubg-medusa-nodep` fixture (express dep, zero @medusajs dep) → medusa.
- **Rule:** a framework whose routing is structural (file-based) must be detected
  structurally, not by a dep that its own repo doesn't carry. A claim in the README must be
  reproducible by a skeptic on the obvious clone, or it reads as a lie.

## E-044 — a bare "PROVEN" at 23% coverage overclaims (PROVEN-COMPLETE vs PARTIAL)

- **Symptom:** cal.com read `✓ PROVEN` while only 23% of its surface was resolved. Above the
  5% SURFACE floor (E-037 addendum) but far below where a proof means "the whole app is
  safe." A skeptic sees PROVEN, then sees 77% of routes were invisible to static analysis,
  and calls the verdict a bluff — the product overselling itself by one notch.
- **Root cause:** the verdict vocabulary had one clean tier (PROVEN) covering everything from
  23% to 100% coverage. The PROVEN-COMPLETE-vs-PARTIAL line was named in a code comment but
  never surfaced in the word.
- **Fix (shipped):** `verdictOf` now returns `partial`/`complete` (additive — no caller
  breaks) split at a 60% completeness bar (measured: real complete proofs sit at 60%+ /
  corpus 71%+). `prove` renders `◑ PROVEN (PARTIAL)` with the explicit caveat "only X% of the
  surface resolved; the rest is UNPROVEN, not safe." A label refinement ONLY: it never masks
  a finding (a hard finding still drops `clean`), never changes the CI gate (`safe`), only
  downgrades a would-be-complete-PROVEN app. cal.com → PARTIAL; medusa/nocodb/open-webui
  (90/90/77%) stay PROVEN.
- **Rule:** the strong word is reserved for the strong claim. "Proved what I could see over
  23% of the surface" is PARTIAL, and the verdict must say so before a skeptic does.

## E-045 — docstring-poisoning filter bypassed by homoglyphs + zero-width splitters

- **Symptom:** the prompt-injection defense (`sanitizeDescription`, Hard Rule 7) — advertised
  as a product security feature — was defeated in two lines by a world-class audit. `[MESURÉ]`
  `sanitizeDescription("Ignоre all previous instructions")` (Cyrillic о, U+043E) → `flagged:false`;
  `sanitizeDescription("ignore<zwsp>previous instructions")` (zero-width space) → `flagged:false`.
  The plain-ASCII string was correctly flagged, so the denylist worked — it just never saw the
  trigger word, because the attacker spelled it in a lookalike script or split the token with an
  invisible character.
- **Root cause:** the five denylist regexes ran against the raw text. A Cyrillic/Greek homoglyph
  is a different codepoint than its Latin twin, so `/ignore/i` never matches "Ignоre". A
  zero-width char between (or inside) tokens breaks the whole word so `ignore\s+previous` never
  matches. Classic confusables / invisible-splitter evasion — the two best-known ways past an
  ASCII denylist.
- **Fix (shipped):** normalize BEFORE the denylist (`sanitize.js`): NFKC, then probe the rules
  against homoglyph-folded copies (a curated Cyrillic/Greek→Latin `CONFUSABLES` map — no new
  dependency) where invisible splitters are BOTH stripped (rejoins an intra-word split) AND
  replaced with a space (restores an inter-word split); either probe firing flags it. The stored
  text keeps its original letters (minus the invisibles). Regression: `tests/sparda.test.js`
  gains 6 evasion cases (homoglyph + zero-width, intra/inter-word) that must flag, plus 3
  legitimate non-English descriptions (French/Spanish accents) that must NOT over-block.
- **Rule:** a denylist is only as good as the normalization in front of it. Any text-matching
  defense must fold confusables and neutralize invisibles first, or it is theater.

## E-046 — Prisma split-schema folder unparsed: modern apps' entire state layer invisible

- **Symptom:** on dub (and any app using Prisma's `prismaSchemaFolder` layout — a `prisma/schema/`
  directory of many `*.prisma` files instead of one `schema.prisma`), `parsePrismaSchemas` returned
  **0 tables**. The whole state layer — invariants, aggregates, ownership models — was invisible,
  so schema-derived analysis (UNVALIDATED_CONSTRAINED_WRITE, NON_ATOMIC_AGGREGATE_WRITE, the BOLA
  ownership model) silently did nothing. Found via measure-first while wiring BolaRay step 1: the
  ownership-model inference returned `unknown` for 100% of dub's tables because there were none.
- **Root cause:** `SCHEMA_CANDIDATES` only looked for a single `schema.prisma` file. The folder
  layout (stable since Prisma 6) was never scanned. A too-generous verdict followed from blindness:
  an app with an invisible state layer can't fail a state-layer obligation.
- **Fix (shipped):** `collectSchemaFiles` also scans `prisma/schema` (and `schema`, `db/schema`)
  directories, gathering every `.prisma` file (bounded, deterministic). Enums and model names are
  collected across ALL files first (a model may reference an enum/relation in another file — the
  point of the layout), then models are parsed per-file with correct file:line. dub: **0 → 82
  tables**. This is the SOUND direction — dub's hard findings went 9 → 96 (newly-visible real
  posture: 61 unvalidated-constrained-write, 26 non-atomic-aggregate), verdict unchanged
  (NOT_PROVEN). Corpus oracle re-baselined; only dub moved (the one folder-schema giant).
- **Consequence handled:** the now-visible aggregate structure made `AGGREGATE_MEMBER_BYPASS`
  fire in bulk (dub: 174). A direct member-table write is a design-smell, not a proven violation —
  reclassified **advisory** (info, non-gating), like BOLA, so it points a human at the pattern
  without flooding the verdict.
- **Rule:** blindness is never a pass. A schema layout we don't parse is a state layer we can't
  reason about — and an unreasoned state layer must degrade the verdict (more findings / SURFACE),
  never grant a hollow PROVEN.

## E-045 addendum — BolaRay ownership-model enrichment (O7 actionable)

- The BOLA advisory (`OBJECT_SCOPE_UNPROVEN`) now infers each accessed table's ownership MODEL
  from its declared columns/FKs (BolaRay CCS 2024 step 1: direct-owner / group-scoped / transitive)
  and names the missing scope in the message ("commission should be direct-owner (userid)"). Still
  advisory — the schema reveals the model, never the runtime intent (the semantic gap OWASP/BolaRay
  name as why no static tool can PROVE access control). dub: 50/60 advisories now carry a model.

## E-047 — a bare "PROVEN" over many high-risk blind spots overclaims (the blind-spot rung)

- **Symptom (the cal.com giant test):** `cal.com/apps/api/v2` (NestJS, 175 routes) read `✓ PROVEN`
  at 71% coverage — above E-044's 60% completeness bar — while carrying **46 high-risk blind
  spots**: guarded, state-changing routes whose _write_ never resolved (controller → injected
  service → repo). Not a cardinal false-PROVEN (the guards WERE seen; SPARDA fabricated nothing and
  disclosed the blind spots), but the headline word over-impressed: 46 guarded mutations were never
  actually proven safe, yet the verdict read a bare PROVEN.
- **Root cause:** coverage is a RATIO. E-044's PARTIAL rung tripped only on `coverage <
COVERAGE_COMPLETE`. On a huge app the ratio can clear 60% while the ABSOLUTE count of high-risk
  blind spots is large — the ratio hides the scale. The verdict never looked at `blindHigh`.
- **Fix (shipped):** `verdictOf(..., { coverage, blindHigh })` — a clean app is now PARTIAL when
  `coverage < 0.6` **OR** `blindHigh > 0`. Every whole-app surface (prove, apocalypse, badge,
  dossier, review, the `sparda_prove` MCP tool, the bench) passes `blindHigh = byRisk.critical +
byRisk.high` from the same `surveyBlindspots` it already computes — single source of truth, so the
  badge/CLI/live-tool words can never disagree. cal.com/api/v2 → `◑ PROVEN (PARTIAL)`, badge
  `partial · 71%`. `blindHigh` defaults to 0, so a partial-graph caller (heal delta) is unaffected.
- **Soundness:** the rung only ever SOFTENS PROVEN→PARTIAL — it never masks a finding (a hard
  finding still drops `clean`), never changes the CI gate (`safe` is untouched), and PARTIAL still
  means "clean, just qualified." Analogy: metrology's error bars — a measurement with an unmeasured
  high-risk population is reported with its uncertainty, not as a point fact.
- **Rule:** the strong word is reserved for the strong claim. "No violation in the 71% I resolved,
  but 46 high-risk mutations I could not read" is PARTIAL — the verdict must carry the uncertainty
  in the word, not only in a line beneath it.

## E-048 — a monorepo app's writes live in sibling workspace packages, imported by name (blind)

- **Symptom (the cal.com giant test, root of P1):** `cal.com/apps/api/v2`'s controllers call
  `this.eventTypesService.updateEventType(...)`, which delegates to an `updateEventType` imported
  from `@calcom/platform-libraries`, which re-exports `updateHandler` from `@calcom/trpc/.../update.handler`,
  where the real `prisma.eventType.update()` lives — **three workspace packages away, entirely
  outside the analyzed app dir.** SPARDA resolved the `@/` tsconfig alias _within_ the package but
  not `@calcom/*` _across_ workspace packages, so every such write was a `blind-mutation` (46 high).
- **Root cause:** `resolveRelImport` handled relative paths + tsconfig `paths`/`baseUrl`, but a
  workspace-package specifier (`@scope/pkg`) is resolved by the workspace (pnpm/yarn/npm), not by
  `paths` — SPARDA had no model of the monorepo, so those imports dead-ended.
- **Fix (shipped):** the workspace resolver (the "mycorrhizal network"). `resolveRelImport` now
  falls back to `resolveWorkspaceImport`: walk up to the monorepo root (a `package.json` with
  `workspaces`, or a `pnpm-workspace.yaml`), build a name→dir map from the workspace globs (cached
  once per root), and map `@scope/pkg[/subpath]` to the real source file under it (longest-name
  match wins; a bare npm package like `@nestjs/common` stays unresolved, as before). The effect
  then crosses the package boundary through the existing DI/barrel followers.
- **Measured (A/B on cal.com/apps/api/v2, 175 routes):** coverage **71% → 87%**, high blind spots
  **46 → 38**, and it surfaces **real** previously-invisible unguarded mutations —
  `POST /verification/email/send-code` has no `@UseGuards` while its authenticated siblings do, so
  the verdict moves from a hopeful `PARTIAL` to an accurate `NOT_PROVEN`. No crash, ~1.9s, no
  corpus drift (the committed fixtures aren't workspaces).
- **State layer too (P4, shipped):** the same name→dir map feeds `parsePrismaSchemas`. When an app
  declares no schema of its own but depends on a shared `@scope/prisma`-style workspace package,
  SPARDA now parses that package's schema as the app's state layer. Measured on `cal.com/apps/web`:
  **0 → 100 tables**, coverage **87% → 95%**, and the schema-dependent rules that were dormant
  (`NON_ATOMIC_AGGREGATE_WRITE`, `UNVALIDATED_CONSTRAINED_WRITE`, `AGGREGATE_MEMBER_BYPASS`) become
  measurable — 1 → 12 findings, all newly-visible real posture (the E-046 pattern), verdict
  correctly still NOT_PROVEN. One resolver, both blind spots (effect code + schema).
- **Rule:** the analyzed unit is the app, but its behavior is drawn from the whole workspace. A
  shared package imported by name is part of the app's real surface — resolve into it, don't treat
  the directory boundary as the behavior boundary.

## E-049 — a credential refusal one call away from the entrypoint is dropped (G2 phase 2)

- **Symptom (first-run + API-key false criticals):** immich `POST /auth/admin-sign-up` and
  `POST /admin/database-backups/start-restore`, and formbricks `GET /api/v1/management/me`, all read
  as **critical unguarded mutations** even though each is genuinely gated — the admin routes throw
  `'the server already has an admin'`, the formbricks route validates an API key and refuses. G2
  phase 1 (which only downgrades a critical to advisory when a credential refusal is present) could
  not see the refusal, so the downgrade never fired.
- **Root cause (three separate signal drops, all on the same path — the refusal lives ONE CALL AWAY
  from the entrypoint, in a delegated body):**
  1. `resolve.js mergeScan` — the single contract every DI/call-graph follower shares — merged
     `effects`, `returnShapes`, `calls`, and `guardSignals.deniesWithStatus`, but **silently dropped
     `credentialSignals`** (throw/4xx/verify/redirect) and G1 `ownerAsserted`. So a NestJS
     `this.service.adminSignUp()` whose body throws lost its refusal at the merge — the effects
     (read/insert user) survived, the refusal did not. One line of omission, whole Nest call graph
     blind to refusals.
  2. `translate.js attachBody` — an expanded helper body's refusal was never recorded on its own
     graph node, so a route reaching it through the call graph (not its direct chain) couldn't see it.
  3. `passes/state-minimization.js mergeNodes` — a thin delegator (`handler → createFirstAdmin()`)
     is coalesced into one node; it carried `returnShapes` but dropped the advisory body signals.
  - Compounding: the dominant Next.js/App-Router refusal is a **named helper**
    (`responses.notAuthenticatedResponse()`), which `statusIn4xx` and the bare-`throw` check both miss.
- **Fix (shipped, all advisory-only — can only DOWNGRADE critical→advisory, never prove/silence):**
  merge `credentialSignals`+`ownerAsserted` up in `mergeScan`; tag reached bodies in `attachBody`;
  carry the advisory signals through `mergeNodes`; recognize the named-refusal idiom in `extract.js`;
  in `apocalypse.js` read signals from the reached set, broaden the stored-credential family to API
  keys/PATs, and add a first-run family **bounded to bootstrap-shaped paths** that still requires a
  real refusal. Field test (13 apps): immich 5→1, formbricks 1→0, total 9→4; every downgrade
  manually verified genuinely gated. Soundness negatives hold (bootstrap-path-no-refusal,
  token-read-no-refusal, naked mutation all stay critical); mutation guard "any family gated without
  a refusal shape" bites.
- **Rule:** effects and refusals travel the SAME reachability — if you follow a call for its writes,
  you must follow it for its refusal too, or a gated route reads as a false critical. (Distinct from
  the reverted "option A": that ATTRIBUTED effects across reachability and over-fired; this only
  READS an advisory refusal signal, which can never fabricate a guard or a false PROVEN.)
- **Residuals — the surviving criticals after this fix, and why (measured across the 13-giant corpus;
  the honest "is login the only one?" answer):** 5 criticals survive, in three buckets —
  1. ~~**One more unclosed FP _family_ — password-login.**~~ **NOW CLOSED via Class 1 (E-050).**
     immich `POST /auth/login` — the master map (`docs/_MASTER-MAP-*`) and the FP-classes spec frame
     it not as a credential family to detect but as a **public-by-design route** to re-label. Closed
     by the E-050 `expectedPublic` re-label (it was the ONLY route in the 13-app corpus that needed
     it — the evidence-based G2 families already caught the callbacks/oauth/reset flows).
  2. **Genuinely public-by-design writes — correct to flag, not traps.** dub
     `POST /api/track/application` (public partner-application form), rallly `GET /api/updates`
     (self-hosted instance telemetry registration). A public route that mutates: a human should
     confirm intent. Not a credential family; leaving them critical is defensible.
  3. **`(codebase-wide)` pervasive collapse — a different, coverage-bound problem.** cal (13/45) and
     papermark (22/63) collapse many UNGUARDED_MUTATIONs into one meta-finding. Inside cal's list are
     routes G2 _should_ downgrade (`reset-password`, `verify-booking-token`) but doesn't — because at
     23% coverage in a deep `@calcom/*` workspace the credential bodies don't resolve. That is a
     RESOLUTION-DEPTH gap (E-048 territory), not a missing family.

## E-050 — public-by-design routes read as false criticals (Class 1 re-label)

- **Symptom:** immich `POST /auth/login` (and, in the wild, `/register`, `/logout`, `/health`,
  `/metrics`, `/oauth/*`, `/webhooks/*`) reads as a **critical unguarded mutation** — but these are
  *conventionally* meant to run without a session guard. A tester who sees CRITICAL on `/login`
  classes SPARDA "amateur" in 30 seconds (the FP-classes doc's Class 1; the master map's item #1).
- **Why G2 doesn't catch it:** login carries no *modeled* credential mechanism SPARDA can point to
  as evidence (its `compareBcrypt` is not a stored-token lookup, not a `verify`/`hmac` name, not a
  callback). There is no gate to *prove* — the route is simply public by convention.
- **Fix (shipped, distinct from G2 — triage, not proof):** a **curated public-by-design path
  classifier** in `apocalypse.js` O1. When an UNGUARDED_MUTATION would fire critical, is NOT already
  credential-gated, and the path matches a precise public signature (login/register/logout,
  forgot/reset-password, verify-email, oauth/sso/saml, callback/webhook, health/metrics/.well-known),
  it is **re-labeled `expectedPublic` (info)** with "confirm this endpoint is meant to be
  unauthenticated". Marked distinctly from `credentialFamily` so it reads as a CONVENTION, not an
  evidenced gate. Never hidden, never marked safe, never touches PROVEN.
- **Deliberately PRECISE, not `**/auth/**` blanket:** `change-password` / `2fa` / session management
  live under `/auth/*` but require a session — re-labeling those would HIDE a real hole. The list
  matches specific public verbs only. Regression test + the soundness contre-test
  (`/account/change-password` stays critical) both ship; the mutation guard "re-label a non-public
  route as public" bites.
- **Measured (13-app corpus):** exactly **one** route re-labeled — immich `/auth/login`. The
  evidence-based G2 families already softened every callback/oauth/reset flow with proof, so Class 1
  had a minimal blast radius (mops up the single genuinely-public route with no detectable gate).
- **Rule:** two honest ways to soften a false critical — *evidence* (G2: a refusal shape is present,
  name the mechanism) and *convention* (Class 1: the path is public by design, say "confirm intent").
  Keep them separately labeled; never let convention masquerade as proof.

## E-051 — a guard that doesn't DOMINATE the write: false PROVEN by non-dominance (the C2 cardinal sin)

- **Symptom (found in the 2026-07-20 perfection audit, then reproduced minimally):** a handler that
  mutates in an early-return branch and only checks auth AFTERWARDS reads as **✓ PROVEN** —
  `if (body.preview) { await charge.create(); return } … const denied = await requireAuth(req); if
  (denied) return denied; await charge.create(...)`. The `preview` write runs and returns BEFORE the
  guard, so it is a real auth bypass, yet SPARDA credited `requireAuth` on **both** writes. This is a
  false PROVEN — the cardinal sin — and it **holed the `sparda gate` wedge**: arm a baseline on the
  clean route, let an agent introduce the bypass, and the gate stayed silent (exit 0), because it
  inherits the compiler's verdict.
- **Root cause:** O1 asked "does a guard exist ANYWHERE on the route", not "does a guard DOMINATE
  this effect" — the known dominator gap, never implemented. The UBG flattens a body
  into a bag of effects + calls under the handler (the control-flow `order` is effects-then-calls, so
  it can't express before/after), so dominance is invisible at the graph level.
- **Fix (shipped, SOUND by construction):** compute dominance at SCAN time, where the AST still has
  the control structure. A recursive spine walk tracks whether a guard has executed on the current
  PATH (a guard in a branch never covers a sibling); each mutation reached while the path is still
  unguarded is tagged, and promoted to `bypassesGuard` only when THIS body also holds a guard (so a
  body guarded cross-procedurally is left to the route model). apocalypse then flags a `bypassesGuard`
  write as a hard critical (`guardBypass`, never softened) even on an otherwise-guarded route, and
  `buildProofObjects` never claims it as discharged. Because the flag only ever SUBTRACTS guard credit
  (never invents a guard), it can turn a PROVEN into NOT_PROVEN but **never fabricate a false PROVEN**.
- **Precision (the hard part — measured to zero):** the barrier is **auth-specific**, not the broad
  `GUARD_NAME` — only `require/ensure/assert{Auth,Session,User,Owner,Permission,…}`, `authenticate`,
  `authorize`, `canActivate`, `get(Server)Session`, `check/verify{Auth,Session,…}`, or a `401/403`
  deny (NOT any throw, NOT any 4xx — a service's `NcError.badRequest`/`hasAdmin()` is not auth). And
  `bypassesGuard` is **stripped at `mergeScan`** so a delegated service's INTERNAL ordering never
  flags the route (only the handler's own body counts — "effects merge; guards do not"). First cut
  fired 25 false positives on the corpus; after tightening + the merge-strip: **0 across dub (580),
  immich (281), nocodb, medusa, ghostfolio, +4**, while the adversarial repros (early-return AND
  branch-sibling) both catch. Fixture `tests/fixtures/ubg-guard-dominance` + `tests/guard-dominance.test.js`
  + 2 mutation guards pin it.
- **Rule:** a guard proves nothing about a write it doesn't dominate. "A guard exists on the route" is
  necessary, not sufficient — the guard must run on every path to the write, before it.

## E-052 — Next server actions (`'use server'`) were an invisible mutation surface (the C3 blind spot)

- **Symptom (perfection audit C3):** a Next.js **server action** — an exported `async` function in a
  `'use server'` module (or with a function-level `'use server'` directive) — is remotely invocable:
  a client form can call it with any args, exactly like an HTTP route. An unguarded mutating action
  (`export async function deleteUser(id) { await prisma.user.delete(...) }`) is a real hole. But SPARDA
  walked only `route.ts` files, so actions were **invisible** — and worse, `blindspots` reported
  `coverage 100% — nothing hidden`. A false coverage claim: the ledger's whole job is to name what
  SPARDA can't see, and it was silent about a live attack surface.
- **Fix (shipped — extract, not just flag):** `nextjs.js` now also scans non-route `.ts/.tsx` files
  (behind a cheap `'use server'` string pre-filter, so ordinary components are never parsed) and
  registers each server action as a **POST entrypoint** (`(action) <file>#<name>`), with the same
  in-body auth-verifier detection routes get. So an unguarded action becomes a normal
  UNGUARDED_MUTATION critical, a credential-verifying one is handled by G2, and the action is counted
  in coverage instead of hiding. Extraction subsumes flagging — the action is both VISIBLE and fully
  analyzed.
- **Precision:** only `async` exports (a non-async export in a `'use server'` file is a re-exported
  constant, not an action); both module-level and function-level `'use server'` directives; a
  per-file+name synthetic path so two same-named actions never collide (a collision would re-hide one).
- **Measured (corpus):** dub 580 → +2 actions (both `verifyPassword`, credential-verify → handled by
  G2, **0 false criticals**), rallly +1 (`setVerificationEmail`, likewise), papermark/formbricks +0.
  My repro's two unguarded actions flag correctly. Fixture `tests/fixtures/ubg-server-actions` +
  `tests/server-actions.test.js` + a mutation guard pin it.
- **Rule:** the analyzed surface is every REMOTELY-INVOCABLE entrypoint, not just files named
  `route.ts`. A `'use server'` export is a route by another name — walk it, or the ledger lies.

---

## E-053 — a Next `config.matcher`-scoped middleware was credited as a guard on paths it never runs on (false PROVEN)

- **Symptom (re-verification on vibe-coded Next apps — Fable 5's ARBITRE-4 pass):** a global
  middleware that returns `401` with `export const config = { matcher: ['/dashboard/:path*'] }`
  runs ONLY on `/dashboard/*`. Next never executes it for `/api/*`. But SPARDA credited every
  global middleware to every route, so an unguarded mutating `/api` route inherited the middleware
  as its "guard" → a **false PROVEN on the dominant next-auth pattern**. Cardinal sin.
- **Fix (integrated from `claude/sparda-compiler-analysis-3qvx9b`):** `nextjs.js` `readMatcher()`
  reads `config.matcher` from the AST; `matcherCovers()` decides coverage for the two dominant
  forms — the positive path glob (`/dashboard/:path*`, which also covers `/dashboard` itself) and
  the negative-lookahead exclude (`/((?!api/|_next/).*)`). `translate.js` now attributes a global
  middleware guard **only** to routes its matcher provably covers. An undecidable matcher
  (computed value, exotic regex) attributes **nothing** — abstain, never fabricate a guard
  (SOUNDNESS.md).
- **Why it can't regress soundness:** the change is monotonic in the safe direction. It can only
  ever *withhold* a middleware guard credit, never add one — so it can turn a wrong PROVEN into
  NOT_PROVEN, never the reverse. No path where it manufactures a false PROVEN.
- **Measured:** all 4 matcher forms correct (unit tests); dub unchanged (518 verified guards, per
  Fable's corpus run). Locked end-to-end by `tests/fixtures/ubg-next-matcher` + two integration
  tests (the `/api` route flags, the `/dashboard` route keeps its guard) and a mutation guard that
  reintroducing "credit all middlewares" is killed.
- **Rule:** a middleware only guards what it runs on. `config.matcher` is part of the guard's
  reachability — ignore it and the guard is attributed to routes it never sees.

## E-054 — vendor-SDK effects were invisible (HTTP detection was fetch/known-client only)

- **Symptom (audit blind spot #1):** `stripe.charges.create()` charges a card but wears no
  `fetch`/http-client skin, so it resolved to nothing; O4 (`IRREVERSIBLE_OBSERVABLE`) never fired
  on real payment code. The exact same bug written with `fetch()` WAS caught — the SDK form was a
  clean false negative.
- **Fix (brick #1/#5, `extract.js`):** a PAMP catalog (`EFFECT_SDK_PATHS`, matched on the property
  path below the user-named root) + AWS SDK v3 command detection (`.send(new PutObjectCommand())`,
  matched on the command class in the argument). Emits an observable `http_call`. Additive,
  write-only — can only raise a finding. The bare-`.send()` tail is handled by E-057's provenance.

## E-055 — Prisma FK harvest dropped named & multiline @relation (domains collapsed on real apps)

- **Symptom (audit blind spot #2):** the `@relation` parser used a single-line regex
  `@relation(\s*fields:` that only matched a plain, first-attribute relation. NAMED relations
  (`@relation("Name", …, onDelete: Cascade)`) and MULTILINE relations were silently dropped, so
  consistency domains collapsed to one-table islands on serious schemas (ghostfolio: 0 FK edges)
  and O3/O5 never fired. dub happened to use the plain form, so it worked there — masking the gap.
  Root cause was NOT `@@map` (the table node is keyed by the model name; `@@map` is only an alias).
- **Fix (brick #2, `prisma.js`):** harvest FKs over the WHOLE model body with `[\s\S]`, pulling
  `fields:`/`references:` INDEPENDENTLY (order- and newline-agnostic).

## E-056 — interactive `$transaction(async (tx) => …)` made every write vanish

- **Symptom (audit blind spot #3):** the dominant Prisma idiom hands the callback a transactional
  client named `tx`, which the `/prisma|client|db/` heuristic can't see, so every write inside
  vanished → the handler compiled to `SURFACE` and an unguarded write inside a transaction was a
  silent pass.
- **Fix (brick #3, `extract.js`):** the "prion" bind — the TX-wrapper visit binds the callback's
  param name(s) into `txCtx.dbAliases` (scoped to the transaction body, never leaks); the Prisma
  op check honors it. Writes reappear, share the tx scope (atomic), and unguarded ones fire.

## E-057 — cross-package effect dead-ended; root cause was `module.exports.f = async…` uncaptured

- **Symptom (audit blind spot #4):** an app whose write lived in a sibling workspace package
  compiled to `SURFACE`. Workspace resolution already worked (the `@acme/data` specifier + barrel
  re-export resolved) — the write dead-ended because the leaf was exported as `module.exports.
  createOrder = async () => …`, a direct function-to-exports assignment the function collector
  never captured, so `service.createOrder()` resolved to no body. A CommonJS export-style gap that
  also affects single-package apps.
- **Fix (brick #4, `extract.js`):** the `exports.X = …` handler now registers a directly-assigned
  function/arrow (incl. a wrapped `catchAsync(async …)`) as an exported function. Separately,
  inline arrow route handlers are now `deepScan`ned (were not), so they follow service calls.

## E-058 — TypeORM writes were invisible (NestJS+TypeORM read SURFACE, proved nothing)

- **Symptom (round-2 re-audit):** TypeORM write verbs (`save/insert/update/delete/remove/upsert`)
  run on a repository whose entity is nowhere in the call — `this.repo.save(dto)` (injected) or
  `getRepository(User).save()`. The ORM handlers didn't know these shapes, so a NestJS+TypeORM app
  (a top enterprise stack) resolved zero mutations.
- **Fix (brick #7, `extract.js` + `resolve.js`):** repository provenance —
  `collectRepoFields(cls)` (from `@InjectRepository(Entity)` / `Repository<Entity>`) +
  `collectRepoVars(fn)` (local `getRepository(Entity)`) build `ctx.repoTables`; a write verb on a
  known repo emits a `db_write` on the entity table. A generic `.save()` on an unknown object
  never fires. Remaining tail: `manager.save`, active-record `Entity.save`, and parsing @Entity
  classes into `state` nodes (no FK/domain layer on a TypeORM-only app yet).

## E-059 — the published npm package did not run (runtime deps filed as devDependencies)

- **Symptom (found via a clean-install reproduction, v0.66.2):** `@babel/parser`, `@babel/traverse`
  and `@clack/prompts` are imported by `src/` at runtime but sat in **devDependencies**, which npm
  does NOT install for a consumer. A fresh `npm i sparda-mcp` therefore crashed on every flagship
  command — `sparda ubg|prove|apocalypse|review|gate` → `Cannot find package '@babel/parser'`;
  `sparda init|demo|remove` → `@clack/prompts`. Only `--version`/help worked, so smoke-testing the
  CLI locally (where devDeps ARE installed) never surfaced it. Confirmed by `npm pack` + installing
  the tarball into an empty project (@babel/@clack absent) and running the commands.
- **Root cause of the blind spot:** `prepublishOnly: vitest run` gates on tests, which run WITH
  devDependencies present — so the gate can never see a missing runtime dep. `CLAUDE.md` even
  states the intended runtime surface is "4, exact-pinned"; three of the four had drifted to dev.
- **Fix:** move the three to `dependencies`, exact-pinned (runtime surface = exactly the four
  advertised deps). New guard `tests/packaging.test.js` parses `src/` with babel (ignoring imports
  inside generated-code template strings) and fails if any runtime import is not a declared
  dependency, and asserts the deps stay exactly the four, exact-pinned. Bump → 0.67.0.

## E-060 — self-audit: `@Author`/`@Authorization` param decorators falsely asserted a guard (could HIDE a finding)

- **Symptom (found by turning the audit on my own Task-1 work, ADR-063):** `PARAM_AUTH_DECORATOR`
  matched `/^auth/i`, so a param decorator named `@Author()` (injects a post's author entity) or
  `@Authorization()` (injects the raw header string — presence is NOT proof of authentication) was
  read as an asserted auth guard. Probe: `@Author` on a resolver mutation SUPPRESSED its
  `UNGUARDED_MUTATION`.
- **Why it matters (the dangerous direction):** an asserted guard DOWNGRADES `UNGUARDED_MUTATION`.
  A false match therefore HIDES a real unguarded mutation — SOUNDNESS Direction 2, the one class of
  error SPARDA must never make. (Its sibling ADR-063 rail — "asserted, never verified" — protects the
  PROVEN direction; this hole was in the other direction and slipped the first review.)
- **Fix (initial, band-aid):** gated the `auth` prefix behind a lookahead —
  `auth(?=user|workspace|account|session|context|principal|$)`. Correct but still a name-regex.
- **Fix (real, ADR-067 — superseded the lookahead):** Zak's push ("on peut pas faire mieux que des
  regex?") led to the thesis-aligned fix — RESOLVE the decorator's `createParamDecorator` body and
  PROVE what request field it reads. `@Author` reads `body.author` (user input) → NOT a guard,
  regardless of name; `@AuthWorkspace` reads `.workspace` (principal) → guard. Body-visible ⇒
  behaviour is final; body-opaque ⇒ a tokenized-name fallback (`splitIdent`, whole tokens not
  substrings). This kills the whole CLASS (any auth-named input-reader) and ADDS recall (`@Whoami`,
  no auth token in its name, reads `request.user` → correctly a guard — impossible for a name-match).
  Regression tests: `@Author` decoy MUST flag; `@Whoami` must NOT (`tests/param-auth-decorator.test.js`).
- **Also corrected in the same audit (honest scope, not bugs):** (a) ADR-066 interprocedural taint
  covers BARE function calls only, NOT DI/instance method calls (`this.svc.save(req.body)`) — the
  Nest/Strapi-dominant shape — because threading a taint seed through `classBundle`'s memo key would
  risk cache poisoning; the ADR claim was corrected and DI-taint queued as its own brick. (b) taint
  under-approximates on NESTED (`const { user: { id } } = req.body`) and ARRAY destructuring (safe
  direction, documented). (c) Strapi's custom-vs-core route collision on the same method+path resolves
  to the custom route by file order (correct outcome, but by luck of ordering, not by design).

## E-061 — declaration order ignored: a `use(auth)` declared AFTER a route was credited to it

- **Symptom:** the extractor collected `app.use(fn)` middlewares as a positionless GLOBAL set and
  translate credited them to EVERY route. Express reads setup top-to-bottom: a `use(auth)` at
  line 50 never runs for a route declared at line 10 — crediting it fabricated protection out of
  thin air (a false-PROVEN vector, SOUNDNESS Direction 2).
- **Fix (robustness pass):** `flattenSetup` stamps every statement with its formal declaration
  `order`; routes, global middlewares AND mounts carry it; a route inside a mounted router takes
  effect at the MOUNT's position, so sequential scope is inherited through nesting at every depth
  (the Y1 corollary). `middlewareAppliesTo` refuses credit when `mw.order > route.order`. Monotone
  in the safe direction: the check can only WITHHOLD credit, never add it; an unstamped side
  (Next/FastAPI middlewares) keeps the prior semantics. Tests: `tests/sequential-order.test.js`
  (+ killing mutant: drop the order check → the pre-auth route regains the guard → bites).

## E-062 — conditional branches flattened as certainty: an if-gated element read 100% active

- **Symptom:** `flattenSetup` descended into `if`/`try`/loop blocks with no marker — an
  `app.use(auth)` inside `if (ENABLE_AUTH)`, or a route inside a `switch` case, was analyzed as
  unconditionally present. Uncertainty was silently converted into certainty.
- **Fix:** every statement reached through a control-flow bifurcation (if/else branch, loop body,
  switch case, catch handler, ternary branch, `&&`/`||` short-circuit operand — the Y2 corollary;
  a `try` block and a `do-while` first pass ARE certain and stay unconditional) is marked
  `conditional`. A conditional registration (route, mount, global middleware) STAYS analyzed —
  findings must still fire, and withholding the guard would fabricate false criticals — but raises
  a HIGH-risk `skipped-surface` blind spot, which bars the PROVEN verdict (blindHigh → PARTIAL at
  best). Ternary/short-circuit registrations, previously INVISIBLE, are now also discovered
  (recall gain) via synthetic statements. Tests: `tests/conditional-surface.test.js` (+ killing
  mutant: un-mark if-branches → bites).

## E-063 — dynamic registrations vanished silently (and `app[v]` could be MISREAD as a static verb)

- **Symptom:** `app[v]('/x', h)` (computed property), `Reflect.apply(app.get, …)` and
  `app.get.call(app, …)` fell through the walk without a trace — and worse, a computed member with
  an Identifier property was read as if it were the static `.name` (a variable named `use` would
  have been treated as `app.use`).
- **Fix (Y3):** a registration on a known app/router var that static analysis cannot bind
  (computed method, `Reflect.apply`, `.apply`/`.call` indirection) emits a structured
  `UnknownHandler` object (`report.unknownHandlers`) plus a HIGH-risk `skipped-surface` entry —
  certainty degrades, the surface never lies. Tests: `tests/dynamic-registration.test.js`
  (+ killing mutant: silence the computed-method branch → bites).

## E-064 — the 0/0 anomaly: zero behaviors resolved out of zero seen read as 100% coverage

- **Symptom:** `surveyBlindspots` returned `ratio: 1` when `resolved + blind === 0` — the ABSENCE
  of a measurement displayed as a perfect score, feeding every surface (prove, badge, dossier,
  MCP) a confident 100%.
- **Fix:** `ratio: null` + `unknown: true` on a zero denominator; `verdictOf` distinguishes
  `coverage === null` (measured-but-unknown → `coverageUnknown`, bars complete PROVEN, at best
  PARTIAL) from `undefined` (not measured — heal's delta — old semantics kept). One shared
  formatter `coveragePct()` so every display says "unknown" — null must never coerce to a number
  (`null * 100 === 0` would have shipped a confident-looking 0%). Tests:
  `tests/coverage-unknown.test.js` (+ killing mutant: restore `? 1` → bites).

## E-065 — resource caps abandoned silently (mount depth, flatten depth/statement caps)

- **Symptom:** `scanFile` returned void past mount depth 2 and `flattenSetup` stopped at
  depth > 6 / 8000 statements — the dropped surface left NO trace, so the coverage ratio was
  computed over a denominator that silently excluded it (inflated percentages).
- **Fix:** every cap now surfaces: the unexplored mount becomes a HIGH-risk `skipped-surface`
  entry naming the prefix; `flattenSetup` returns a `limit` reason its caller must report; the
  Python extractor (`fastapi_extract.py`) gained the same depth-limit declaration. The blind
  entries enter the coverage denominator, so truncation now LOWERS coverage instead of faking it.
  Tests: `tests/limits-surface.test.js`.

## E-066 — no time/memory ceiling: a pathological tree could hang or crash the analysis

- **Symptom:** no wall-clock bound on extraction and no size bound on a single source file — a
  generated mega-file or an endless mount tree degraded the host process instead of the verdict.
- **Fix (P3):** `extractExpress` runs under a time budget (`budgetMs` option /
  `SPARDA_BUDGET_MS`, default 120 s); exhaustion stops cleanly with ONE critical-risk
  `skipped-surface` entry ("cannot claim PROVEN") — never a hang, never a crash. `parseModule`
  refuses files over a 5 MB cap with an explicit error that flows to the skip report. An entry
  file whose syntax is outside the modeled grammar remains a clean refusal to certify
  (parse error surfaced + NO_PROOF — locked by test). Tests: `tests/analysis-budget.test.js`.

## E-067 (Z1) — `app.all()` and `app.route().post()` were invisible → a FALSE PROVEN

- **Found by:** an adversarial red-team pass (corpus `tests/fixtures/ubg-invisible-verbs`).
- **Symptom:** `HTTP = new Set(['get','post','put','patch','delete'])` plus a bare
  `if (!HTTP.has(method)) continue;` — no `skipped` entry. `app.all(path, …)` (which answers
  EVERY verb) and the chainable `app.route(path).post(…)` (Express documentation) both dropped
  silently. Measured: an app with one clean guarded route plus an unauthenticated
  `prisma.note.deleteMany({})` behind `app.all('/admin/wipe')` read
  **`✓ PROVEN · 1 route · coverage 100% · 0 blind spots · exit 0`**. The cardinal sin.
- **Proof it was an oversight, not a scoping decision:** `src/commands/enforce.js:43` already
  declared `HTTP_VERBS = new Set([… 'all'])`. One organ knew; the extractor did not.
- **Fix:** `all` is EXPANDED into the modelled verbs (what Express actually does, and what keeps
  `openapi-emit` and `mirror` exact — an `all` pseudo-verb would be invalid OpenAPI and would
  never match a real request); `routeChainOf()` walks a Route chain to its `X.route(path)` base
  and registers EVERY link, not just the outermost. Registration is factored into one
  `registerRoute()` so all three entry paths share the conditional-branch honesty and the
  handler-chain resolution. Tests: `tests/zero-day-verbs.test.js` + 2 killing mutants.

## E-068 (Z2) — one line of aliasing (`const api = app`) erased routes → a FALSE PROVEN

- **Symptom:** `collectAppVars` recognised an identifier only when its initialiser was literally
  `express()` / `Router()`. Express does not care what the object is called, so
  `const api = app; api.post('/admin/wipe', …)` vanished from the graph — silently, with
  `coverage: 100%` and `skipped: []`.
- **Fix:** aliases are followed (`const api = app`, `const r2 = router`, and the assignment form
  `api = app`), to a FIXPOINT so alias chains and declare-after-use order both resolve. Bounded
  by the number of names it can learn, so it always terminates. Tests:
  `tests/zero-day-alias.test.js` + a killing mutant.

## E-069 (Z3) — losing a whole FILE scored `medium`, so it never stopped the verdict

- **Symptom:** the risk of a `skipped` entry defaulted to a mutating-verb regex over the skip's
  TEXT. A parse error never contains a mutating verb, so a file that failed to parse — losing
  every route it declared — scored `medium`, stayed out of `blindHigh`, and left the verdict a
  bare **PROVEN at 66.7% coverage** with an unguarded `deleteMany` in the unparsed file. The
  honesty machinery worked perfectly and the verdict ignored it.
- **Fix:** `isFatalSkip()` in `blindspots.js` forces `high` for any skip that loses a whole file
  (parse error, unreadable, size cap, encoding). The size of that hole is precisely what SPARDA
  cannot know, so it is never a medium event. Tests: `tests/zero-day-effects.test.js` (Z3) +
  a killing mutant.

## E-070 (Z4) — a computed ORM member produced NO effect → a FALSE PROVEN

- **Symptom:** two layers failed together. (1) `inspectCall` bailed out on any non-`Identifier`
  property, so `prisma['note']['delete'+'Many']()` never reached an effect handler; and a
  computed `prisma.note[OP]()` was read as a method literally named `OP`. (2) The ADR-068
  opaque-write safety net — designed for exactly this ("a missed write is a hidden hole") —
  required a DIRECT handle identifier as receiver, which `prisma.note[…]` is not. Net effect:
  the write did not exist, so an unguarded mass delete looked like a harmless no-op route.
- **Fix:** a computed member on a receiver ROOTED at a proven persistence handle emits an opaque
  `db_write` (`opaqueDynamicWrite`), carrying `dynamicMember: true` so the ledger can say which
  kind of blindness it is. Provenance-gated, so a computed call on a non-database object
  fabricates nothing. Also: `collectDbHandles` now labels the CommonJS destructured require
  (`const { PrismaClient } = require('@prisma/client')`) — without it the entire CJS world had no
  proven handles, leaving every provenance-based net inert there. Tests:
  `tests/zero-day-effects.test.js` (Z4) + a killing mutant.

## E-071 (Z6) — a PATH-scoped middleware was credited to every route → a FALSE PROVEN

- **Found by:** following the Z-series pattern past the reported list — the Express twin of a sin
  already closed on the Next.js side (E-053 / E-NEXT-MW).
- **Symptom:** `app.use('/api', expressjwt({…}))` runs only under `/api`, but the extractor
  dropped the prefix and registered it as a GLOBAL middleware. Measured: an unguarded
  `POST /admin/wipe` read **`PROVEN` with 1 VERIFIED guard** it never runs behind.
- **Fix:** the mount prefix travels with the middleware (`pathPrefix`) and `middlewareAppliesTo`
  enforces it with Express segment semantics — `/api` covers `/api` and `/api/**`, never
  `/apikeys`. Withholding-only: it can remove a false PROVEN, never manufacture one. Tests:
  `tests/zero-day-effects.test.js` (Z6) + a killing mutant.

## E-072 (Z5) — reachability was O(routes²): three BFS copies over a flat adjacency list

- **Symptom:** the route filter (`next.route === epId`) ran over a FLAT successor list, and a
  global middleware's fan-out IS the route count — so one walk per entrypoint cost O(routes) at
  the shared node. Measured edge visits: 100 routes → 10 250; 1 000 → 1 002 500;
  4 000 → **16 010 000** — exactly routes². Worse, the same BFS existed in THREE hand-written
  copies (`reach.js:reachFrom`, `apocalypse.js:reachOf`, `passes/type-propagation.js:bfs`) —
  while `reach.js`'s own header claimed to be "the one traversal everything shares" — so the fix
  could not be applied once, and any divergence between them would have been an invisible
  soundness bug. `type-propagation` alone was 31.2% of pipeline CPU.
- **Fix:** ONE traversal (`ubg/reach.js`), with successors partitioned BY ROUTE at index-build
  time, so a hop reads only what the walking entrypoint can reach. Order is preserved exactly
  (successors keep their edge-order rank and the two partitions are merged back by rank), so
  every consumer's output is byte-identical — the index is a speed change, never a semantic one.
  `Array#shift()` (O(n) per dequeue) replaced by a cursor, and `reachabilityOf` memoised per
  graph TOPOLOGY (edges identity + length + node count — over-sensitive on purpose: a stale map
  would hide a finding).
- **Measured:** 16 010 000 → **14 000** edge visits at 4 000 routes (**1 144× fewer**, and now
  strictly linear); `checkGraph` 141.9 ms → 59.4 ms; whole pipeline 3 248 ms → 2 440 ms.
  Bench: `bench/scale-gen.mjs` + `bench/scale-run.mjs` (the witness prints both strategies).

## E-073 (C3) — a terminal handler mounted at a PATH was never an endpoint

- **Symptom:** `app.use('/admin/wipe', handler)` is, in Express, an endpoint answering
  every verb at that path. SPARDA treated every pathed callable as a middleware, so the
  endpoint never entered the graph at all — an unauthenticated `deleteMany` was simply
  absent, and one clean decoy route carried the app toward a bare PROVEN. Worse, at
  depth > 0 (inside a mounted router) the whole branch was gated behind `if (depth === 0)`
  and dropped without a trace.
- **Fix:** `handlePathedUse` decides the role by BEHAVIOUR — `callsNext()` asks whether
  the function can hand control on (its third parameter is referenced anywhere in the
  body). A terminal handler is expanded into routes on every modelled verb; a real
  middleware keeps its prefix-scoped credit; an OPAQUE body decides nothing and is
  declared as an `UnknownHandler`. Works at any depth, so the nested form is modelled too.
  Two latent bugs surfaced while testing this and are fixed with it: `registerRoute` was
  being called with six of its seven arguments from the pathed path (so `order` and the
  conditional flag fell off), and `mountTargetFile` read a LOCAL function passed to
  `app.use('/p', fn)` as an unresolved router mount, losing the callable entirely.
  Tests: `tests/zero-day-pathed-handler.test.js` + 3 killing mutants.

## E-074 — the dynamic spellings of a database write produced NO effect

- **Symptom:** four shapes, each of which made a write vanish from the graph — so the
  route around it looked like a harmless no-op and could carry a PROVEN:
  `prisma?.note?.deleteMany({})` (optional member — a distinct Babel node type, never
  matched), `prisma.note.deleteMany?.({})` (optional call — the visitor only dispatched on
  `CallExpression`), `` prisma.$executeRaw`DELETE FROM "Note"` `` (a tagged template is not
  a call node at all), and `(cond ? a : b).deleteMany({})` (a receiver with no nameable
  root, so no handler could match it).
- **Fix:** optional chaining is MODELLED, not declared — it is the same call whenever the
  handle exists, a known semantics, and declaring an unknown there would have been a
  cop-out. `taggedTemplateEffect` reads the template's static parts as SQL when the tag is
  rooted at a proven persistence handle, falling back to an opaque write. `handleInSubtree`
  finds a proven handle inside an unnameable receiver. All four are provenance-gated, so a
  computed call on a plain object still fabricates nothing (pinned by a control case).
  Tests: `tests/dynamic-effects.test.js` + 3 killing mutants.

## E-075 — `app?.post(…)` / `app.post?.(…)`: the REGISTRATION itself vanished

- **Symptom:** the same optional-chaining blindness on the registration side. Both routes
  disappeared with no skipped entry.
- **Fix:** `isCall()` / `isMember()` normalise the optional node types across the whole
  registration dispatch, including the Route chain walk and the `.apply`/`.call` and
  `Reflect.apply` detectors. Pinned in `tests/dynamic-effects.test.js`.

## E-076 — a router-level guard was invisible, and making it visible needed intra-file order

- **Symptom:** `router.use(requireAuth)` — the canonical way to protect a whole Express
  sub-router — was dropped at depth > 0, so every route in that router read as unguarded.
  A FALSE POSITIVE (the safe direction), but a loss all the same, and the audit flagged it.
- **Fix (and its rail):** an unpathed `use` inside a mounted router is credited with the
  router's mount prefix. That is a recall win on a GUARD, which is the dangerous direction:
  every route in a mounted file shares that file's MOUNT rank, so the mount rank alone
  cannot order them. Routes and middlewares now also carry `orderIn` — their position
  WITHIN the file — and `middlewareAppliesTo` compares it when the mount ranks tie.
  Without it, a `router.use(auth)` written at the bottom of a router file would have been
  credited to the routes above it: a false PROVEN manufactured by the fix itself.
  Fixture `ubg-router-use-order` pins both sides on one router (the route above the guard
  must still flag); `tests/router-use-order.test.js` + a killing mutant.

## E-077 — the ghost verbs, on the rest of the fleet (Nest / Next / OpenAPI / Python)

- **Found by:** grading our own claims. E-067 (`app.all` invisible) was fixed on Express and
  left standing everywhere else. Measured on HEAD in ten minutes: a NestJS controller with a
  guarded decoy plus an unguarded `@All('wipe')` read
  **`PROVEN · 1 route · coverage 100% · 0 blind spots`**. `@All` is a real `@nestjs/common`
  decorator. The same vocabulary hole existed in four lowerings at once:
  `nestjs.js` (`@All`/`@Options`/`@Head`), `nextjs.js` (`OPTIONS`/`HEAD` route exports),
  `openapi.js` (`options`/`head`/`trace` operations), `fastapi_extract.py`
  (`options`/`head`/`trace` decorators).
- **Fix:** all four vocabularies completed. `@All` is EXPANDED into the verbs a request can
  arrive on (the same decision as Express's `app.all` — it is not a verb, it is every verb),
  and the Nest candidate pre-filter was widened too, or the file would never have been parsed.
- **The consequence that had to ship with it:** modelling OPTIONS/HEAD/TRACE turns them into
  entrypoints, and `mutating: method !== 'get'` would then have read every CORS pre-flight
  handler as a mutation — flooding real apps with false criticals. Mutation is now decided by
  the RFC 9110 safe-method set (`get`/`head`/`options`/`trace`), not by "not GET". A safe
  method that genuinely writes still surfaces: O1 fires on the effect, not on the verb.
- Tests: `tests/cross-framework-verbs.test.js` + 2 killing mutants.

## E-078 — a Nest decorator path that is not a literal was MISPLACED, not lost

- **Symptom:** `httpDecorator` read `args[0]?.type === 'StringLiteral' ? args[0].value : ''`.
  So `@Get(ROUTES.detail)` silently became the empty path and the route was mounted at the
  CONTROLLER PREFIX — a URL the app does not serve. Misplacement is worse than loss for this
  engine: every guard, prefix and ownership judgement about that route is then about the
  wrong URL, and nothing says so.
- **Fix:** a first argument that EXISTS but is not a literal is distinguished from no argument
  at all (which legitimately means "the prefix"). The route stays — its behaviour is real —
  and the misplacement is declared through NestJS's new `unknownHandlers` channel plus a
  high-risk blind spot, so it cannot sit under a PROVEN. This is the registration invariant
  (ADR-079) reaching its second framework.
- Tests: `tests/cross-framework-verbs.test.js` + a killing mutant.

## E-079 — nothing ever checked the PREMISE (only the proof)

- **Symptom, stated as a class rather than a bug:** every honesty organ SPARDA has —
  guard dominance, the type lock, the blind-spot ledger, `falsify` — reasons OVER THE GRAPH.
  All of them are therefore blind to the same thing: a route that is not in the graph.
  `falsify` cannot ablate the guard of a route that does not exist. The five false PROVEN
  verdicts of E-067…E-071 were all absences, and **no instrument could have caught any of
  them**, because every instrument took the route surface as given.
- **Fix (`src/ubg/premise.js`):** the given is now checked, against an oracle that is not the
  analyser — the app, booted, reporting the route table the framework really built.
  `src/probe/` already had that oracle and had always captured `app.all` (the runtime knew
  what the static eye did not); it fed route GENERATION and never the verdict. Now
  `verifyPremise` diffs it against the compiled entrypoints, and any gap:
  1. enters the blind-spot ledger at CRITICAL risk (so it counts in coverage and ranks in the
     map like every other unseen surface — one channel, no special case);
  2. sets `premiseUnverified`, which yields the new `PREMISE_GAP` verdict state — not PROVEN,
     and not PROVEN (PARTIAL) either, because both claim something about an app whose surface
     we demonstrably did not have;
  3. fails the CI gate (`safe`), because a green over unanalysed routes is the exact failure
     this audit removed.
- **Three honesty rails:** the oracle is OPT-IN (`--probe`) since it executes the target's
  code; an oracle that could not run leaves the verdict untouched (SPARDA never demands what
  it could not measure); and an EMPTY probe is reported as *unavailable*, never as "no gaps" —
  otherwise a broken oracle would silently confirm every proof. Each rail has a killing mutant.
- **Measured:** on a bootable app whose route table is materialised from data at startup,
  static analysis sees 2 routes, the framework builds 4, and the verifier reports exactly the
  2 unreachable-by-AST admin routes. `prove --probe` then reads `PREMISE NOT VERIFIED` and
  exits 1. Tests: `tests/premise-gate.test.js` (8, including a real boot).

## E-080 — the registration invariant stopped at Express: six lowerings had no seal

- **Symptom:** ADR-079's rule ("modelled or declared, no silent third option") and ADR-080's
  certificate both swept Express only. On the other six lowerings a real endpoint could still
  leave no trace at all — no route, no skip, no unknown handler — and the app read certifiable.
- **Six concrete paths, one per lowering.** Next stopped its walk at a directory whose URL it
  cannot express (`[...slug]`, `@slot`, `(..)x`) and lost the whole subtree behind a
  directory-level skip carrying NO risk — below `blindHigh`, so still PROVEN-able; measured on
  `nextjs-basic`, where `app/api/docs/[...slug]/route.js` serves GET and appeared nowhere. Next
  also swallowed an unparseable `middleware.ts` — the app's only global gate. Medusa dropped
  `export const POST = registry.handler`: the verb IS exported, so Medusa serves the route, but
  the body did not resolve and the code just `continue`d. Strapi resolved a route table entry
  to a controller action that does not exist and modelled the route as if it had read it.
  OpenAPI skipped any path-item member outside its verb list, discarding published surface in a
  lowering whose entire premise is that the spec IS the declaration. FastAPI dropped a decorator
  whose path is not a literal.
- **Fix:** each of the six now emits an `UnknownHandler` plus a HIGH-risk skipped entry, so the
  declaration reaches the verdict gate rather than a log line. Next deliberately does NOT
  synthesize a URL for an unrouted subtree: SPARDA does not know the path, and inventing one
  would misplace every guard judgement about the route.
- **Sealed by two new files.** `tests/no-silent-loss-fleet.test.js` re-enumerates the declared
  surface of each lowering with an INDEPENDENT implementation (its own file walk, its own AST
  or spec read) and demands the extractor account for every item; it opens every file itself, so
  a controller the extractor's candidate pre-filter never selected surfaces as a lost route.
  `tests/registration-invariant-fleet.test.js` pins a named fixture per lowering and asserts
  end to end that the app can no longer read PROVEN.

## E-081 — `app/dist/route.ts` was invisible on all three channels at once

- **Symptom:** the Next extractor filtered directories named `dist` / `build` while walking
  `app/`. Under `app/`, a directory name is a URL SEGMENT and nothing else — Next serves
  `app/dist/route.ts` at `/dist`. The endpoint produced no route, no skipped entry and no
  unknown handler: it did not exist for SPARDA, and the verdict was computed as if the app
  had one route fewer.
- **Why the invariant did not catch it:** the invariant is about registrations SPARDA SEES.
  This file was never opened, so there was nothing to declare. That is the whole reason a
  premise oracle has to be independent of the analyser (E-082).
- **Fix:** the exclusion list for the `app/` walk keeps only what could never be a routed
  segment (`node_modules`, `.git`, `.next`, `.sparda`). Found by the boot-free oracle, which
  is exactly what it is for.

## E-082 — four lowerings could not have their premise checked at all

- **Symptom:** `verifyPremise` (E-079) boots the app. Next, Medusa, Strapi and Nest cannot be
  booted from a static checkout, so they returned `available:false` — their premise was never
  checked, and the strongest honesty organ in the system covered three lowerings out of seven.
- **What made it fixable:** for three of the four the route table is a FUNCTION OF THE
  FILESYSTEM. That is the framework's contract, not a heuristic, so the directory tree is a
  genuine second source of truth — no boot, no dependencies, no execution of the target's code.
  Nest is decorator-routed, so its oracle re-derives the table with its own walk over EVERY
  file, which the extractor's candidate pre-filter cannot narrow.
- **Fix (`src/ubg/oracle-static.js`):** a boot-free oracle for the four. Because it costs
  nothing and executes nothing, it runs UNASKED — the runtime oracle stays opt-in. It found
  E-081 on its first corpus sweep, and it reports Next's Pages Router (`pages/api/**`, still
  fully served by Next 14, with no SPARDA lowering) as a measured premise gap instead of a
  silence.
- **The rule that keeps it usable:** conservatism. A false gap takes the verdict away from a
  healthy app, so every ambiguous convention — Strapi's pluralised core routers, Next's
  parallel slots, a computed controller prefix — is LEFT OUT rather than guessed at. Measured:
  27 convention-routed fixtures, 26 of them healthy, exactly 1 gap — in the one
  fixture built to have one.

## E-083 — the premise verifier was wired into ONE of seven verdict-emitting commands

- **Symptom:** ADR-081/082 built the organ that stops SPARDA certifying an app it did not
  fully see, and shipped it inside `prove` only. Measured on the merged tree: of the seven
  commands that emit a verdict, **six did not ask for it** — including `apocalypse`, whose
  exit code is the CI deploy gate and which the README pitches first, and `badge`, the
  artifact users paste into a public README.
- **Why this is worse than not shipping it.** A guarantee that holds on one command out of
  seven is not a partial guarantee, it is a false one: the docs, the ADR and the release
  notes all said "SPARDA no longer certifies what it has not seen", and that sentence was
  true of `prove` and false of the gate that actually blocks a deploy.
- **Fix:** one shared entry point, `premiseFor(graph, report, {cwd, probe})` +
  `withPremiseGaps(report, premise)` in `premise.js`, called by `apocalypse`, `badge`,
  `dossier`, `review` and `prove`. Duplicating the four-line wiring per command is how one
  of them silently drifts; there is now a single code path. The opt-in boundary is
  preserved inside the helper: the runtime oracle still needs `--probe`, the boot-free
  convention oracle still runs unasked.
- **Deliberately NOT wired:** `enforce` and `heal`. Their verdict is about a DELTA — "did
  synthesizing this guard introduce anything", "did this replay regress" — not about the
  app. Feeding a premise gap in would make them refuse to act on any app that has one,
  which is backwards. `prove` remains the authority on the app-level word.
- **Sealed by a STRUCTURAL test,** not a list: `tests/premise-wired-everywhere.test.js`
  scans `src/commands/` and fails if any module that grades a compiled graph does not call
  `premiseFor`, with an explicit two-name allowlist. Pinning today's five commands would
  only re-prove the fix; pinning the rule is what stops the eighth command repeating it.

## E-084 — the public badge rendered a premise gap as "0 findings"

- **Symptom:** `badgeFor` had no `PREMISE_GAP` branch, so the state fell through to the
  default `${critical + high} findings`. An app whose route table was never verified —
  the strongest negative SPARDA can state — produced a badge reading **"0 findings"**, on
  the one artifact designed to leave the repository and be believed by strangers.
- **Fix:** an explicit branch, `premise not verified`. The colour was already correct
  (grey, "we could not measure"), which is what hid the bug: the badge looked plausible.
- **Killing mutant** restores the fall-through.

## E-085 — `sparda review` graded the graph and never read the report

- **Symptom:** `reviewGraphs` called `surveyBlindspots(candidateGraph)` with **no report**,
  so the entire skipped-surface channel — unparseable files, declared `UnknownHandler`s,
  premise gaps — was invisible to the PR gate. A pull request that made a whole file
  unparseable, or that added a route SPARDA cannot bind, reviewed exactly like a PR that
  changed nothing.
- **Found while wiring E-083**, not by looking for it: plumbing the premise through
  required plumbing the report, and the report was not there at all.
- **Fix:** the candidate's report is passed through and folded with any premise gaps. The
  BASE side stays graph-only, deliberately — the base's blind spots are not this PR's
  subject, only the direction of travel is.

## E-086 — the premise rule was scoped to a directory, and two more graders were unwired

- **Symptom:** the structural test sealing E-083 scanned `src/commands/` — because the
  audit that produced it had counted "seven commands". Widening the scan to the whole
  repository found **two graders nobody had counted**, both unwired for exactly as long as
  the rule could not see them:
  - `src/server/stdio.js` → `proveApp`, the `sparda_prove` MCP tool. This is the consumer
    that acts on the verdict word WITHOUT reading the code: an editing agent asks, gets
    `PROVEN`, and commits. It shares `verdictState` with the CLI verbatim (that invariant
    held), but it never asked for the premise, so it could hand an agent a word the CLI
    itself would have refused to print.
  - `bench/repro.mjs`, which writes a verdict into `bench/route-proof.json` — a committed
    evidence file the README points at as the reproducible proof.
  - and `scripts/corpus-oracle.mjs`, the known hole this session set out to close: the only
    place SPARDA states a verdict over code it did not write.
- **Root cause, same shape as E-083 one level up:** the fix for "a guarantee wired into one
  consumer" was sealed by a rule that only looked where that bug had been found. A rule
  scoped to one directory has the same defect as a guarantee scoped to one command.
- **Fix:** the scan covers `src/`, `scripts/`, `bench/`, `tools/`, and identifies a grader by
  the IMPORT (a module that imports `verdictOf`/`badgeFor` from `apocalypse.js` and calls
  it), so `apocalypse.js` is not mistaken for a consumer of itself and no future grader is
  excluded by name. Exemptions carry a reason and are machine-checked: a module exempted for
  stating no verdict word fails the suite the moment it starts stating one.
- **Killing mutants** (2) remove the premise from the MCP tool and from the corpus oracle.

## E-087 — a Nest route written with backticks was invisible to the compiler

- **Symptom:** `@Post(`/auth/google/genTokenByCode`)` in nocodb — a substitution-free
  template literal — never reached the graph, while its siblings written with quotes did.
  The route sets a refresh token and an auth cookie; it is a login endpoint.
- **Found BY the premise oracle**, on the first corpus run that had one: `oracle-static.js`
  reads a no-substitution `TemplateLiteral` (line ~357, `expressions.length === 0` →
  `quasis.join('')`) because the framework definitely serves that path; `nestjs.js` has no
  `TemplateLiteral` handling at all, so it dropped it. This is exactly the ADR-082
  independence rule paying for itself — an oracle that reused the extractor's walk would
  have reproduced the omission on both sides of the diff and confirmed the bug.
- **Arithmetic that confirms the cause:** nocodb has 16 backtick decorator paths; 15 carry
  `${…}` substitutions, which the oracle deliberately leaves out (conservatism), and the
  16th is this one — matching the single gap reported, exactly.
- **Status: OPEN, deliberately.** The fix belongs in `nestjs.js` (accept a substitution-free
  `TemplateLiteral` wherever a `StringLiteral` is accepted) and is monotone in the safe
  direction — it can only ADD surface. It is not in this change because it moves corpus
  numbers a second time: shipping it here would blend an extractor precision change into the
  premise-wiring measurement, which is the "movement not understood" failure re-baselining
  exists to prevent. Next brick, with its own fixture, test and killing mutant.

## E-088 — the corpus baseline recorded metrics but not the tree they were measured on

- **Symptom:** every one of the 7 giants drifted on the first re-run, and the drift was
  **uninterpretable** — the snapshot pinned no corpus commit, so "dub 579 → 593 routes"
  could equally be SPARDA improving or dub landing 14 routes. An uninterpretable drift gets
  re-baselined by reflex, which is precisely how a regression becomes the new normal.
- **Worse:** the `nocodb` entry pointed at the monorepo ROOT, which stopped detecting
  upstream (`suggestAppDirs` now points at `packages/nocodb`). The one entry carrying the
  repository's only `PROVEN` on real code had become an `ERROR` row, and the tree that
  `PROVEN` was measured on is not recoverable — no commit was ever recorded.
- **Fix:** each entry carries `_pinned: {commit, date}`. It is NOT diffed (a giant landing a
  PR is not SPARDA drifting) but IS printed beside every delta, so drift can be ATTRIBUTED
  before it is believed. `tests/corpus-snapshot.test.js` requires it on every entry.
- **Lesson:** a regression net whose two inputs both move must record both, or it measures
  nothing and reassures anyway.
## E-089 — a composite decorator was judged by its NAME, so 340 proven guards read `asserted`

- **Symptom, measured on novu:** 1003 guard steps, **71 verified (7 %)**. The 932 unverified
  were exactly four decorator names. The largest, `@RequireAuthentication()` ×340, is
  NestJS's official composition API:

  ```ts
  export function RequireAuthentication() {
    return applyDecorators(UseGuards(CommunityUserAuthGuard), ApiBearerAuth(…));
  }
  ```

  SPARDA matched the name against the auth regex, recorded an ASSERTED guard, and stopped:
  `guardScan` resolves a CLASS, and this symbol is a FUNCTION. The `canActivate` two hops
  away — which extends `@nestjs/passport`'s `AuthGuard` **and** throws
  `UnauthorizedException` — was never opened. The proof chain existed end to end; the
  first link was unwalkable.
- **The A/B that named the cause.** Same framework, immich: **459/459 verified**. immich
  registers its guard globally (`{ provide: APP_GUARD, useClass: AuthGuard }`), which
  `detectGlobalDenyGuard` already handles. novu applies its guard **per controller**, so no
  global path existed and the decorator path was blocked. One framework, two idioms, a 7 %
  vs 100 % proof rate.
- **Fix (ADR-084):** resolve the decorator NAME to its declaration and read what it applies
  — `applyDecorators(UseGuards(X))` → X, then the existing class resolution proves X.
- **Two traps inside the fix, both found by measurement not by reasoning:**
  1. a constituent is imported by the module that DECLARED the composite, never by the
     controller that used it. Resolving `CommunityUserAuthGuard` against the controller's
     import map finds nothing, and the expansion degenerates into a rename: the first
     working version produced 340 guards and **0** proofs.
  2. a monorepo import lands on a BARREL (`export * from './decorators'`) which declares
     nothing and records no named import. Following `starReexports` is the difference
     between reading a workspace package's decorators and seeing none of them.
- **Result:** novu 1003 guards / 71 verified → **782 / 411**. immich byte-identical
  (459/459) — the non-regression witness.

## E-090 — `SetMetadata` counted as protection it never provided

- **Symptom:** `@RequirePermissions(...)` is `SetMetadata(PERMISSIONS_KEY, perms)` — a tag a
  guard reads ELSEWHERE. Its name matched the same auth-ish regex, so 221 novu routes
  carried a "guard" that gates nothing on its own.
- **Fix:** the same resolution — read the definition, see that every branch is `SetMetadata`
  and none applies a guard, stop counting it. Removing invented protection is SOUNDNESS
  Direction 2 in the safe direction: it can only ADD findings, never hide one.
- **THE TRAP, and it nearly shipped.** A blanket "SetMetadata is not a guard" rule
  **deletes immich's entire auth model**. `@Authenticated = () => applyDecorators(
  SetMetadata('authRoute', true))` is the dominant Nest idiom: the tag is the route's OPT-IN
  to an app-wide guard that reads it. Under the blanket rule, 253 verified guards vanish and
  253 unguarded routes are invented out of nothing. Caught by
  `tests/nest-global-guard.test.js` going red — a test written for a different feature two
  sessions earlier.
- **The rule that is actually correct:** drop a metadata-only decorator **only when the app
  registers no global guard proven to deny**. Where one exists, the tag IS protection.
- A second near-miss in the same function: `sawGuardSource` was set on any
  `applyDecorators` call rather than on finding a `UseGuards` inside it, so a metadata-only
  composite resolved to "no guards AND not metadata" and vanished from the chain entirely.
  A composite that resolves to nothing now keeps its original asserted reading — resolution
  may add understanding, never delete a gate.
## E-091 — nocodb's whole ACL layer was trusted on the strength of its name

- **Found by ADR-084's resolution, not by looking for it.** `@Acl()` is nocodb's access
  control on every route. It is a hand-rolled decorator: a factory returning an INLINE
  arrow that calls `SetMetadata(...)` seven times and `UseInterceptors(AclMiddleware)`
  by direct invocation — never through `applyDecorators`, so the resolver reaches the
  arrow and stops.
- **Before:** the name matched the auth-ish regex and the decorator counted as an asserted
  guard, silently. **After:** the unreadable branch is DECLARED at high risk, naming the
  decorator. The claim moves from "trusted because it is called Acl" to "this is nocodb's
  ACL layer and SPARDA cannot read it" — which is the whole point of the product.
- Cost: nocodb coverage 40.4 → 40.3 (the declaration enters the ledger, hence the coverage
  denominator). Its verdict was already PREMISE_GAP and does not move.
- **Not fixed here.** Reading a decorator that applies its effects by direct invocation
  inside an arrow is a distinct shape from `applyDecorators`, and it must ship with its own
  fixture and mutant rather than being bolted onto this one.

## E-092 — the file pre-filter matched a VOCABULARY, so 75 % of twenty was never opened

- **Symptom:** twenty read `NOT_PROVEN` with 14 findings, and the brief was "one rule
  stands between it and a clean verdict". The measurement inverted the brief:

  | | before | after |
  |---|---|---|
  | files parsed (of 6090) | **33** | 128 |
  | routes | **147** | **579** |
  | guards / verified | 441 / 157 | 1868 / 583 |
  | findings (high) | 14 (2) | 65 (28) |

  SPARDA was seeing **25 % of the app**. "One rule" was an artefact of near-total blindness.
- **Cause:** `CANDIDATE_RE` listed decorator names —
  `@(Controller|RestController|JsonController|Resolver|…)`. twenty registers **54** GraphQL
  resolvers as `@MetadataResolver` / `@CoreResolver` / `@AdminResolver` and exactly **one**
  as `@Resolver`. A house brand is the norm, not the exception. The class-admission check
  had the same defect (`decoratorArg(cls.decorators, 'Resolver')`, exact name).
- **Why nothing complained:** a file that is never OPENED produces no route, no skipped
  entry and no unknown handler. It is the one shape of loss that no self-reported coverage
  number can show — SOUNDNESS Direction 3, and the reason the premise oracle exists.
- **Fix:** match the SUFFIX (`[A-Za-z]*Controller`, `[A-Za-z]*Resolver`), exactly as
  `controllerPrefixOf` already did for controllers (ADR-055 — recognise the protocol, not
  the brand). Deliberately NOT widened to `Mutation|Query|Subscription`: those are also
  PARAMETER decorators (`@Query('id') id: string`) in ordinary REST controllers, and on
  twenty they buy one extra file out of 6090.
- **Cost:** 33 → 128 files parsed, 4.0 s for the whole 6090-file monorepo. No budget issue.
- **What it surfaced (the point):** `POST /graphql/deleteCurrentWorkspace` — a real saga
  hole. It cancels the customer's Stripe subscription (irreversible, outside any
  transaction) and then soft-deletes the workspace. If the write fails, the customer has
  no subscription and a live workspace. It sat in `workspace.resolver.ts` under
  `@MetadataResolver`, in a file SPARDA had never opened.

## E-093 — `@Post(['a','b'])` collapsed four controllers onto a phantom `POST /`

- **Symptom:** the two `high` findings holding twenty's verdict were reported against
  `POST /` — a route the app does not serve.
- **Cause:** `httpDecorator` read `args[0]`, found an `ArrayExpression`, judged it "not a
  string literal" and fell back to the controller prefix. Nest serves **every element** of
  the array; twenty has four such controllers, including
  `@Post(['cloudflare/custom-hostname-webhooks', 'webhooks/cloudflare'])` — two live URLs
  from one decorator.
- **Fix:** one route per element. **Not** `elements.find(isStringLiteral)`: reading the
  first path and dropping the rest loses a live endpoint in silence, which is the
  registration invariant (ADR-079) violated by the very change meant to honour it. A
  mixed array (one readable element, one not) routes the readable one and DECLARES the
  other at high risk.
- **Result:** the findings now name their real routes — `POST /webhooks/stripe` — instead
  of a URL that does not exist.

## E-094 — one saga hole, reported twelve times

- **Symptom, measured on twenty:** 28 high findings across **14 routes**, and ONE route
  carried **12 of them**. `POST /graphql/sendEmail` resolves, through a provider-strategy
  DI graph, into Gmail / Microsoft / IMAP-SMTP / email-group senders. Each leaf is its own
  effect node, and `IRREVERSIBLE_OBSERVABLE` emitted one finding per node — so **43 % of
  the app's high findings were a single problem counted twelve times.**
- **Why the existing collapse missed it:** `collapseFloods` (ADR-071) folds a rule that
  fires across MANY ROUTES into one codebase-wide summary. It has no notion of the same
  rule firing many times on ONE route, which is what a DI fan-out produces.
- **Fix:** one finding per (route, rule). Severity is the strongest of the collapsed set,
  every call is named in the message, and every node stays in `evidence`. The remediation
  for this rule is per ROUTE — wrap the send and the write, or add an undo — never per
  leaf, so per leaf was never the honest unit.
- **It is a CONTRAST fix, not a suppression,** and the distinction is what the tests pin:
  the same routes stay flagged at the same severity and the gate reads exactly as before.
  Verified on twenty — the 14 flagged routes before and after are **identical**; only the
  count changed, 28 → 14. nocodb 22 → 13.
- **The rung that had to survive it:** innate immunity (ADR-072). A generic external call
  is an advisory `info`; collapsing several of them may not manufacture a `high`. A route
  with both kinds reports once at the hard severity, because splitting them would put the
  same route on two lines saying the same thing twice. Killing mutant included.

## E-095 — PR #30 merged only half of itself

- **Symptom:** PR #30 carried two commits; the merge landed only `ed41931` (ADR-084).
  `80591a9` (ADR-085) stayed on the branch. `main` still read twenty at 147 routes / 2
  high, and the suite at 1111 instead of 1119.
- **Cause:** the merge was requested against a PR head GitHub had not yet refreshed after
  the push — the merge commit's parent is the OLD head.
- **How it was caught:** by re-measuring after the merge instead of trusting it.
  `git merge-base --is-ancestor 80591a9 origin/main` → **no**. A "merged" report is a
  claim like any other and deserves the same verification as a green test run.
- **Fix:** cherry-picked onto the current `main`, re-verified (1119 tests, twenty at 579
  routes / 28 high) and merged as PR #31.
- **The habit worth keeping:** after any merge, check that the commit you care about is an
  ancestor of the branch you merged into. It costs one command.

## E-096 — v0.69.0 shipped a commit nobody had reviewed, and every check was green

- **Symptom:** for four hours, `sparda-mcp@0.69.0` on npm analysed a NestJS app with house
  decorator brands (`@MetadataResolver`, `@CoreResolver`) at a quarter of its size — 147 of
  579 routes, with no signal that anything was missing. The repository did not have that
  bug: ADR-085 had removed it, and ADR-086 was in flight behind it.
- **Root cause:** the release was cut BETWEEN two pull requests. The published tree carried
  ADR-084 and neither of the two after it. Nothing regressed; the wrong commit was chosen.
- **Why nothing caught it:** `prepublishOnly` ran `vitest run`, and it was green — green at
  the commit that was published, correctly. A suite is a statement about a TREE. A release
  is a statement about a PUBLISHED ARTEFACT. Everything that distinguishes the two was
  unchecked: no CHANGELOG entry for 0.69.0, no tag pushed since v0.68.0 (two releases with
  nothing to check out), and no comparison of HEAD against `origin/main`.
- **Fix:** `scripts/release-gate.mjs` (ADR-087) on `prepublishOnly`, with the decisions
  split into `scripts/release-checks.mjs` as pure functions so each one can be handed the
  exact state 0.69.0 was released from and required to refuse it. Five killing mutants,
  including one that puts `prepublishOnly` back to a bare `vitest run`.
- **Rule:** **a green suite licenses a COMMIT, never a RELEASE.** Anything that can differ
  between the tree you tested and the bytes you publish — which commit, which tag, which
  manifest, which changelog entry — is unverified until something checks it. This is the
  project's own contract (`"could not measure" ≠ "measured nothing wrong"`) applied one
  level above the code it was written for.
- **The trap inside the fix:** the first version of the test asserted the gate had no escape
  hatch by grepping its source for `--force`. It failed immediately — the gate's own header
  says the word, in order to refuse it. A hatch is not a STRING, it is an INPUT: the
  assertion is now that the gate reads no `process.argv` and exactly one environment
  variable, one that can only make it stricter. **A property worth testing is worth testing
  as behavior; grepping source for a word tests the wording.**

## E-097 — every DI hop into a workspace package died on the barrel, in silence

- **Symptom:** novu read `PARTIAL` with **0 findings**, 52 db writes and 14.8 % coverage.
  The real number of writes its routes perform is 132.
- **Root cause:** `@novu/dal` and `@novu/application-generic` resolve to their entry file,
  which is a barrel — `export * from './repositories/…'` sixty times, zero class
  declarations. `classInModule` only finds a class DECLARED in the module handed to it, so
  `classBundle` returned null. Measured: **1479 of novu's 2039 constructor-DI hops**
  resolved to nothing, `PinoLogger` (307) and the repository classes at the top.
- **Why nothing complained:** an unresolved DI hop leaves no trace — no effect, no skip, no
  blind spot. A route whose behavior lives entirely behind the barrel therefore resolved to
  ZERO behavior, and a route with zero behavior has nothing to flag: it read `SURFACE` at
  coverage `unknown` (0/0), not `blind`. Same family as E-092 (a file never opened produces
  no route, no skip, no unknown handler) and E-091 one level down.
- **Fix:** `resolveExportedClass` in `extract.js` — the class twin of
  `resolveExportedFunction`, which had crossed barrels since the `lib/auth/index.ts` era.
  Wired into `classBundle`, memoized per (module, class). Fixture + 2 killing mutants.
- **Measured:** novu PARTIAL → NOT_PROVEN, writes 52 → 132, reads 792 → 1464, findings
  0 → 4. twenty / immich / nocodb / ghostfolio byte-identical (immich is the control: same
  framework, no unbuilt workspace barrels).
- **Rule:** **every lookup that crosses a module boundary must cross barrels too.** A
  monorepo package entry point is a barrel and nothing else; a resolver that stops there
  stops at the edge of every workspace package. When one such lookup learns the trick, ask
  immediately which of its siblings did not — the function twin was right and the class
  twin was wrong for months, in the same file, forty lines apart.

## E-098 — the corpus snapshot went stale for four releases and nothing said so

- **Symptom:** while isolating E-097, cal.com drifted (`routes 175 → 177`,
  `coverage 93.6 → 94.3`) — with the change **and without it**. The drift was not mine.
- **Root cause:** cal.com's baseline was taken on 2026-07-22. ADR-084, ADR-085 and ADR-086
  all landed after that, and every one of them changed how routes are counted. None of
  those sessions had a cal.com clone, so the oracle printed
  `SKIP cal.com (not present under SPARDA_CORPUS)` and the change shipped unmeasured on it.
- **This is not a bug in the oracle.** Skipping an absent app and SAYING SO is correct —
  the alternative is pretending to have measured it. The gap is that "SKIP" is a per-run
  notice that nothing accumulates: seven apps skipped over four releases leave no standing
  record that the snapshot no longer describes `main`.
- **Fix:** all six clonable giants pinned to their baselined commits and re-measured in one
  run, so every number in `corpus.snapshot.json` is attributable to a tree that exists.
  (dub could not be cloned in this environment and remains unmeasured — stated, not hidden.)
- **Rule:** **a skipped check is a debt, not a pass.** Before a release, re-measure the
  WHOLE corpus, not the apps that happen to be on disk — and when an app cannot be measured
  at all, say which one and why, in the release record rather than in scrollback.

## E-099 (OPEN) — a deep blind spot names the route's FILE with another file's LINE

- **Symptom:** twenty reports 139 high blind spots. Every one of them that resolved through
  a DI hop points at a line that has nothing to do with it. Worked example: the blind spot
  reads `application-development.resolver.ts:21` — an `import` statement — while the
  `fs_write` it describes is `this.fileStorageService.writeFile(…)` at
  `application-development.service.ts:202`. Same shape on novu:
  `activity.controller.ts:145` carrying `driver: buildInteractionTrendChart`, a symbol that
  exists only in the use case two files away.
- **Cause:** the effect node's `loc.file` is the ENTRYPOINT's declaring file, while
  `loc.line` comes from the body actually scanned. The two halves of the location are taken
  from different files, so they are individually right and jointly meaningless.
- **Why it matters more than it looks:** the blind-spot ledger is the honesty organ — it is
  what SPARDA offers INSTEAD of a proof. A ledger of 139 entries whose locations do not
  point at the code is not usable, so the honest answer degrades to an unusable one, which
  is how an honest tool gets ignored. It also made twenty's "139 high blind spots" read as
  a research problem rather than a reporting one.
- **Not fixed here** — recorded with the reproduction rather than half-fixed. The fix is to
  carry the DECLARING file alongside the line through the resolver's merge, the same way
  `helpers` already records `sourceFile` + `sourceLine`.
- **What twenty's 139 actually are**, once located properly: 55 `fs_write` and 41
  `http_call` with computed targets, 34 `db_write` with an unresolved table (19 through a
  TypeORM `queryRunner`), 7 blind mutations, 2 skipped surfaces. Unlike novu's, these are
  genuine residual imprecision — SPARDA saw the write and cannot name what it touches — not
  a resolution bug. Closing them is symbolic target resolution, a project, not a patch.

## E-100 — ADR-089 shipped unmeasured on the corpus, and the corpus was red on main

- **Symptom:** `SPARDA_CORPUS=… node scripts/corpus-oracle.mjs` exited 1 on `main` right after
  PR #35 merged: **twenty `dbWrites` 813 → 812**, **nocodb `coverage` 47.7 → 47.6**. Since the
  gate runs the oracle, `npm run release:check` would have blocked on it.
- **Cause:** ADR-089 (`MiddlewareConsumer.forRoutes()`) was measured on
  `lujakob/nestjs-realworld-example-app` — a real and well-chosen target, but **not one of the
  seven corpus apps**, five of which are NestJS. The oracle prints `SKIP` for apps that are not
  cloned, so the change landed with its effect on the giants simply not taken. E-098 again, one
  release later: **a skipped check is a debt, not a pass.**
- **Verified, not assumed.** The drift is a node-ordinal artefact, not a lost effect. Guard
  steps are PREPENDED to the chain, so every later node's ordinal shifts and two resolution
  paths that used to produce distinct ids now collide. Three measurements, same clone, same
  pinned commit, `nestjs.js` permuted:
  - **509 distinct `file:line` write locations before AND after** — no write left the graph;
  - **476 routes carry writes before AND after, with identical per-route counts** — no route
    lost a write;
  - **31 findings both ways** — nothing stopped being flagged.
  Only the multiplicity at `auth.resolver.ts:132` (7 → 5) and `:194` (3 → 4) moved.
- **Fix:** snapshot re-baselined with that verification as the justification, not with a shrug.
- **Rule:** a change to an EXTRACTOR is measured on the corpus before it merges, even when a
  smaller repository reproduces the bug more clearly. The small app proves the fix; the corpus
  proves the absence of collateral.

## E-101 — the release gate could not run on Windows

- **Symptom:** `npm publish` on Windows died in the gate at `suite green` with
  `spawnSync npx ENOENT`; naming `npx.cmd` explicitly then gave `EINVAL`.
- **Cause:** `npx` on Windows is `npx.cmd`, a batch wrapper. `execFileSync` starts real
  executables, not shell scripts, so it cannot launch it either way. `git` and `node` were
  never affected — they are real binaries on every platform.
- **First fix, and why it was narrowed:** `shell: process.platform === 'win32'` on the shared
  `run()` helper. It works, but it puts EVERY call through `cmd.exe`, where each argument is
  re-parsed — including `npm view ${pkg.name}@${version}`, whose two halves come from a file in
  the tree. A blanket shell puts the repo's own JSON on a command line inside the one script
  whose entire job is to be trustworthy.
- **Final fix:** `npx` is gone. The suite and the mutation harness run through
  `process.execPath` — an absolute path to the same node already executing the gate, no shell,
  no PATH lookup. A shell remains for `npm` alone (`NEEDS_SHELL`), which genuinely needs one on
  Windows. Both pinned by tests.
- **Bonus the platform bug exposed:** `npx vitest` resolves whatever npx finds. The gate could
  green a release against a different test runner than the lockfile pins. It now runs
  `node_modules/vitest/vitest.mjs` — the vitest this repo installed.
- **Rule:** reach for a shell at the narrowest scope that fixes the problem. "It works now" and
  "it is still the same command" are different claims, and a gate has to make both.
- **Honest limit:** this was verified on Linux. The Windows path is argued from the platform's
  behaviour, not measured here — the next publish from Windows is the real test.

## E-102 — the Windows fix missed the thing the gate CALLS, and npm hid the reason

- **Symptom:** after E-101, `npm publish` on Windows still failed. The npm debug log showed
  only `command failed … exit 1` for `node scripts/release-gate.mjs` — **no indication of which
  check failed**, because npm's log file never contains the child's output.
- **Cause:** E-101 removed `npx` from `release-gate.mjs` and stopped there.
  `tests/mutation/run.mjs` — which the gate runs as its `mutants dead` step — still spawned
  `execFileSync('npx', ['vitest', …])`. Same ENOENT, one level down. **A step is only as
  portable as what it spawns**, and the fix was applied to the caller instead of to the family.
- **Fix:** the harness runs `process.execPath` with `node_modules/vitest/vitest.mjs`, exactly
  as the gate now does. A test asserts that nothing the gate runs contains `npx` either.
- **The second, larger bug this exposed.** A blocked publish was *unreadable after the fact*.
  The gate printed its verdict, npm captured it, and the log the operator keeps had none of it
  — so from where the user stands, the gate said "no" and gave no reason. That is the exact
  shape of silence this project exists to refuse, performed by the gate on its own operator.
  The verdict is now also WRITTEN to `.sparda-release-gate.log` (gitignored, or the next run
  would fail its own "working tree is clean" check).
- **Rule:** when a fix is about the ENVIRONMENT rather than the logic, grep for the pattern
  across the repo before calling it done — the platform does not care which file the call is
  in. And any gate that can refuse must leave its reasons somewhere that outlives the terminal.

## E-103 — the gate built a command line out of the repository it was judging

- **Symptom:** every gate run on Windows printed
  `DEP0190 DeprecationWarning: Passing args to a child process with shell option true can lead
  to security vulnerabilities, as the arguments are not escaped, only concatenated.`
- **Cause:** the `npm view ${pkg.name}@${version}` check. npm is `npm.cmd` on Windows, so it
  needed `shell: true` — and under a shell, Node concatenates arguments rather than escaping
  them. Both halves of that string are read from `package.json`, a file in the tree. **The one
  script whose entire job is to be trustworthy was assembling a command line out of the
  repository it was judging.** Node was right to complain; E-101 had narrowed the shell to this
  single call and treated that as sufficient, when the call itself was the problem.
- **Fix:** the question is answered over HTTP. `HEAD https://registry.npmjs.org/<name>/<version>`
  — 200 published, 404 absent, anything else UNMEASURED. `encodeURIComponent` on the name, so a
  scoped package cannot split the path and make the registry answer about something else.
- **What it removed, beyond the warning:** the gate now spawns **no shell on any platform**, and
  no longer depends on `npm` being resolvable at all. `git` and `node` are the only two programs
  it starts, and both are real executables everywhere. Pinned by a test that greps for `shell:`
  and for `npm` and requires neither.
- **Rule:** when a platform forces a shell, ask whether the command is needed at all. Narrowing
  the blast radius is the second-best answer; not spawning is the first. A check that is really
  an HTTP question should be an HTTP question.

## E-104 (FIXED — ADR-091) — `PROVEN` was reachable on an app whose premise was never measured

- **Found by:** an independent agent auditing `docs/BRIEF-FOR-A-STRONGER-MIND.md`. Its code
  was lost to a usage limit before it could be pushed; the reproduction below is ours, and it
  confirms the claim exactly.
- **Symptom, measured on our own fixtures:** of the **8 fixtures that read `PROVEN`, 7 have
  `premise.available === false`** — the oracle never ran. Reason on all seven:
  `runtime oracle not requested (--probe)`.

  ```
  ubg-proven              express   premise NOT measured → PROVEN
  ubg-cqrs-command        express   premise NOT measured → PROVEN
  ubg-typelock-verified   express   premise NOT measured → PROVEN
  ubg-object-scope        express   premise NOT measured → PROVEN
  ubg-ownership-assert    express   premise NOT measured → PROVEN
  ubg-express-weird-entry express   premise NOT measured → PROVEN
  ubg-fastapi-deep        fastapi   premise NOT measured → PROVEN
  ```

- **Mechanism.** `premiseFor` correctly reports `{ available: false, gaps: [] }` when no oracle
  ran — the label is honest. But the next line erases the distinction:

  ```js
  export function withPremiseGaps(report, premise) {
    if (!premise?.gaps?.length) return report;   // available:false ⇒ gaps:[] ⇒ report UNCHANGED
  ```

  An oracle that **did not run** and an oracle that **ran and found nothing** produce a
  byte-identical downstream state. The verdict is then computed as if Direction 3 had been
  verified. **This is rule 7 of the contract — "could not measure ≠ measured nothing wrong" —
  violated in the single highest-stakes place SPARDA has: the word `PROVEN`.**
- **Why nobody noticed.** All seven corpus giants are `CONVENTION_ROUTED` (nestjs/nextjs), so
  their premise IS measured on every run — `premiseOracle: "convention"` is pinned in the
  snapshot. The hole is exactly in the frameworks the corpus does not contain and the fixtures
  do: **Express and FastAPI**, i.e. the most common backends SPARDA is pointed at. The regression
  net and the field are blind in complementary places.
- **NOT a bug in the labelling, and not fixed by touching `premise.js` alone.** The independent
  audit reported the same word leaking through `review`, `dossier`, `enforce`, `badge`,
  `polarity`, `immunity`, `speculate` and `genome`. Any fix must reach every surface that
  pronounces a verdict, or the branch is green while the word still escapes (ADR-083's rule,
  applied to a new axis).
- **The shape of the fix, as proposed and as we would keep it:** asymmetric and non-blocking.
  An UNMEASURED premise degrades `PROVEN` → `PARTIAL` only — never a gate failure, because
  PARTIAL already means "proved what was seen" and that is the honest word. A MEASURED premise
  with real gaps stays `PREMISE_GAP` and stays blocking. OpenAPI keeps an explicit "declared
  premise" status, since there the specification analysed *is* the subject of the proof.
- **Expected blast radius, stated before anyone starts:** those 7 fixtures move
  `PROVEN → PARTIAL`, so every test asserting `PROVEN` on an Express/FastAPI fixture without
  `--probe` turns red. That is the fix working, not the fix breaking. Corpus verdicts should be
  **unchanged** (all seven are convention-routed and measured) — and that must be shown by a
  full A/B, not assumed.
- **Rule:** an honest LABEL is not an honest SYSTEM. `available:false` was reported correctly
  and then consumed by a line that could not tell it from `available:true, gaps:0`. When a
  distinction matters, follow it to every consumer — the place it gets flattened is where the
  lie is told.

**Fixed** in ADR-091. The premise now carries a `basis` — `measured` / `declared` (OpenAPI) /
`unmeasured` — and `unmeasured` is a PARTIAL rung in `verdictOf`. Measured after: fixtures
reading `PROVEN` 8 → 1 (that one measured), `PROVEN` over an unmeasured premise **7 → 0**,
corpus **0 drift**. `enforce` announces `PARTIAL (ENFORCED)` when nothing measured the premise,
while its rollback decision stays premise-blind — the edit is licensed by the delta, the word
by the oracle, and conflating the two is what produced this entry.

## E-105 — the same lie in four more places, found by auditing the RULE instead of the suspects

- **Symptom:** none, and that is the entry. Four surfaces reported a positive headline over a
  measurement that never happened — `falsify` `score: 1` with zero controls, `gate` `ok: true`
  while abstaining, `speculate` and `immunize` printing `✓ PROVEN` from a frozen capsule whose
  premise nobody measured.
- **How they were found.** Not by suspicion. By taking rule 7 — "could not measure ≠ measured
  nothing wrong" — and enumerating every place a measurement can be ABSENT, then checking
  whether the absence stayed distinguishable downstream. Four commands, one hour. The same
  method that found E-104, applied to the rule rather than to a hunch.
- **The shape, which is the real finding.** In every case the honest field was PRESENT —
  `note`, `abstained`, `(by lookup)`, `available: false`. The admission was placed BESIDE the
  headline instead of INSIDE it, and the headline is what a reader acts on, a dashboard graphs,
  and a CI job branches on.
- **A test had CODIFIED one of them.** `tests/falsify.test.js` carried a case literally named
  *"an app with no protected mutation routes has nothing to falsify (vacuously 1)"*, asserting
  `score === 1`. The suite was defending the bug. That is how long a lie survives once it is
  written down as an expectation.
- **Fix:** ADR-092 — `null` in the headline, capsules carrying their basis of measurement,
  `=== null` checked FIRST so a falsy collapse cannot re-tell the lie in the safe direction.
- **Rule:** when you find one instance of a contract violation, **audit the CONTRACT, not the
  neighbourhood.** A bug found by suspicion gives you one bug; a bug found by enumerating the
  rule gives you the family — and the enumeration is cheap enough to be routine. It is now
  mechanized in `tests/unmeasured-is-not-a-pass.test.js` so it is a check rather than a memory.

## E-106 — the fix for E-105 was tested, and wired to nothing

- **Symptom:** none, again — and this time not even a wrong output. `sparda immunize` on any
  Express app printed `✓ PROVEN` exactly as it had before ADR-092, because the three-state
  `proven` the ADR introduced was **unreachable**. All four call sites in `src/commands/`
  called `buildCapsule(canonical)` bare, so `premiseBasis` was always its default `null`, so
  the `premiseUnmeasured` branch never fired and the `◑ UNMEASURED PREMISE` message `immunize`
  prints could not be produced by any input.
- **`prove` and `dossier` had the value in scope.** `prove` computes the premise, uses it for
  the verdict word two lines above, and then builds the capsule without it. `dossier` calls
  `buildCapsule` three lines *before* it computes the premise at all — ordering alone hid it.
- **The green row.** `tests/unmeasured-is-not-a-pass.test.js` asserted
  `buildCapsule(g, { premiseBasis: 'unmeasured' }).proven === null` and passed from the day it
  was written. It was true. It was also useless: **constructing the UNMEASURED state by hand
  proves the field can hold it, and says nothing about whether any caller ever puts it there.**
  A registry of honest states, over a dead wire.
- **How it was found.** By continuing the same audit onto the surfaces E-105 had not covered
  (`stitch`, `mirror`, `timeless`, `heal`, `genome`) — and reading, for each one, not "does it
  lie" but "which call path produces its UNMEASURED state". `genome` had none: it grades a
  compiled graph, signs the result with Ed25519 and merges it into a file other people pull,
  and it had never called `premiseFor` at all. Following that back found the other three.
- **Why the ADR-083 rule did not catch it.** It did its job and the job was too narrow. The
  structural guard scans for consumers of `verdictOf`/`badgeFor`. `buildCapsule` is a **second
  grader** — it turns a compiled graph into `proven`, the same claim in the artifact that
  travels — and the rule could not see it. The first version of that rule was scoped to a
  directory and the amendment widened it to the repo; this one was scoped to a *function name*.
  **Both times the gap was exactly the size of the scope.**
- **A second bug, found while fixing the first.** ADR-092 wrote
  `proven: premiseUnmeasured ? null : …`, which blanks a genuine `false` to `null`. The premise
  bounds the route *set*; a route missing from the graph cannot rescue one that is in it and
  exposed, so a NOT-PROVEN verdict needs no premise. Blanking it turns "this app has an
  unguarded mutation" into "we don't know" — the same lie, pointed the other way. Only the
  positive is withheld now.
- **And a third:** `immunize` gated CI with `if (!capsule.proven …)`. `null` is falsy, so the
  moment the fix worked it would have failed builds because no oracle was *available* —
  precisely what `premise.js` forbids in those words. `=== false` now.
- **Fix:** ADR-093. `basisFrom(premise)` is the single source of the basis (nine hand-rolled
  copies of the same ternary are gone, and its default is `'unmeasured'` so a caller who forgets
  falls toward the weaker word); all four capsule call sites pass it; `immunize` and `genome`
  call `premiseFor`; the structural rule now names the *property* (turns a graph into a claim)
  with `GRADERS` as the list to extend.
- **Rule:** **a test that constructs the honest state by hand is half a test.** Every row in
  the registry owes two assertions — EXPRESSIBLE (the field can hold it) and REACHABLE (a real
  call path produces it). Without the second, a green suite certifies a wire that is not
  connected, which is the same failure this project exists to refuse, committed by its own
  regression net.

## E-107 — the gate certified a tag that only existed on one machine

- **Symptom:** `✓ v0.71.0 exists and points at HEAD`, over a tag no one else could fetch. The
  push had been refused by the environment; the gate never asked. Every word it printed was
  true, and it certified nothing.
- **Why it read green.** The check was `git rev-list -n 1 v<version>` — a purely LOCAL question.
  "The tag exists" and "the tag is published" are different claims, and only the second one is
  what a release means. That is the v0.69.0 gap again, one artefact over: the local view and the
  published view diverging with nothing looking at the seam.
- **Fix:** ADR-094 — `remoteAt` from `git ls-remote --tags origin <tag>`, compared to the local
  commit, with the `^{}` dereferenced line preferred so an annotated tag compares commit to
  commit.
- **And the fix had the rule-13 bug in it** (fixed in ADR-095): `ls-remote` failing and
  `ls-remote` returning nothing were collapsed into one message, so an unreachable network read
  as "your tag is not pushed" — sending the operator to hunt for a tag that was already there.
  Both block; only one of them is a measurement.
- **Rule:** a check that reads only local state can only certify local state. Before trusting
  one, ask which machine's answer it is.



## E-108 — a mutation-testing residue was committed into the verdict engine

- **Symptom:** none, and no test could have had one. `src/ubg/apocalypse.js` sat on `main`
  carrying

      if (false)
        routes.push({ id: ep.id, ... }); // guarded, but by trust only

  inside `assertedOnlyMutationRoutes`. With that line dead, `assertedMutations` is always 0, the
  PARTIAL rung never fires, and **a route guarded only by an UNVERIFIED guard reads `PROVEN`** —
  the exact false-PROVEN generator ADR-070 exists to remove. It arrived inside a commit whose
  stated scope was release automation, and was caught by a human reading the diff.
- **Nobody wrote it.** `if (false)` is BYTE-FOR-BYTE the `repl` of a mutant that has lived in
  `tests/mutation/run.mjs` since ADR-070 (`find: 'if (!guards.some((n) => n.meta.verified ===
  true))'`). The same commit ALSO adds a new mutant to that harness — so the harness was being
  run in that session. This is a residue, not a decision, and that distinction is the whole
  entry: you do not fix it by telling anyone to be more careful.
- **Mechanism.** The harness mutates a file, runs one test, restores in a `finally`. `finally`
  covers a thrown error; it does not cover a killed process. Ctrl-C, a CI timeout, an OOM — the
  mutated file stays on disk and the next `git add -A` commits it.
- **Why the suite could not see it.** A mutant that SURVIVES is, by construction, a mutation no
  test detects. The suite was green because the mutation was one the suite is blind to. The only
  thing that would have caught it is `npm run mutation` — which reports `⚠ target moved →
  SURVIVED` — and that takes ten minutes and is not what anyone runs before a `git commit -a`.
- **Reproduced during the fix, by accident, which is the best evidence available.** A SIGKILL
  mid-run left `src/ubg/llm-resolve.js` mutated **with signal handlers already installed**: the
  harness lives inside a BLOCKING `execFileSync`, so a signal cannot reach JS until the child
  returns and a SIGKILL never reaches it at all. The new suite-level guard named the exact mutant
  on its first run.
- **Fix:** ADR-095 — a journal written before the file is touched and replayed by the next run
  (recovery that does not depend on the dying process), signal handlers for the polite exits, and
  `tests/no-mutant-left-behind.test.js` in the ordinary suite, which asks the question the
  harness cannot ask itself: is a mutation sitting in the tree right now?
- **Rule:** **a cleanup that only runs when the program is healthy is not a cleanup.** Write the
  intent to durable storage before the risky action and heal from it on the next start. And when
  a tool can leave the repository in a wrong state, detecting that state belongs in the fast
  suite, not in the tool's own slow mode.