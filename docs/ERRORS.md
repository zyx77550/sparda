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
