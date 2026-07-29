# 2026-06-28 — `npx sparda-mcp demo` standalone mode (the adoption unlock)

**Scope:** Ship the zero-setup try-it the registry/adoption pivot needs — one
command that shows a first-time visitor exactly what SPARDA does, with no init,
no host, no client, no network, and no risk to their machine.
**Commits:** this session · **Branch:** `main` (`sparda-hq`) ·
**Tests:** 232/232 Vitest (+2 from `tests/demo.test.js`) + 10/10 router self-test.

## Done
- **`demo-app/`** (top-level, added to `package.json` `files` so it ships in the
  npm tarball — verified via `npm pack --dry-run`: 3 files, 39 total). It mirrors
  the proven `tests/fixtures/express-demo` so the demo exercises every showcase
  feature: read vs write routes, a prompt-injection docstring, a variable-built
  dynamic path. It is its own copy (not the fixture) so the demo never depends on
  test files and the two can't silently drift the demo's behavior.
- **`src/commands/demo.js`** (`runDemo(opts)`) — runs the **real** init pipeline
  (`detectStack` → `parseExpressProject` → `sanitizeDescription` → `generateExpress`
  → `removeInjection`) on a throwaway `os.tmpdir()` copy, narrating six steps:
  1. DETECT (Express ESM, entry, port — read from package.json+source, nothing run)
  2. GENERATE (5 routes → 5 MCP tools; 3 reads live ✓, 2 writes OFF ✗ write-safety)
  3. REFUSE TO GUESS (the `/v${VERSION}/meta` dynamic path is skipped, not invented)
  4. DEFEND (the "Ignore previous instructions…" docstring is purged)
  5. INJECT (shows the 4-line marked block — the *only* edit to the user's file)
  6. REMOVE = CLEAN DIFF (de-injects, then asserts the entry file is byte-identical
     to the pristine original → proves hard rule #4 live)
  Then a `finally` `fs.rmSync` wipes the temp dir. Branded clack/`ui/style.js` UI
  matching `init`; gated behind `!opts.quiet`. Returns a structured result
  (`{tmpDir, toolCount, enabled, disabled, skipped, flagged, cleanDiff}`) for tests.
- **Wired** `case 'demo'` + a help line (listed first, as the try-it entry) into
  `src/index.js`.
- **`tests/demo.test.js`** (2/2) pins the contract: 5 tools, 3 enabled / 2 disabled,
  ≥1 skipped, ≥1 flagged, `cleanDiff === true`, and the temp dir is gone afterward.
- **Smoke-tested** the real command (`node src/index.js demo`) — all six boxes
  render correctly on Windows.

## Why STATIC (the key decision)
The prior handoff imagined `demo` running a *live* MCP server on the fixture
(init + host + bridge). That hits a wall: **express is a `devDependency`**, so it
is **absent when the package is installed via `npx`**. Running the host would then
need either express as a real runtime dep (violates hard rule #8 — the 4-pinned-deps
selling point) or a hand-written express shim (~150–200 lines, a maintenance/escape
hatch risk). Both add failure surface to the one thing that must be can't-fail.

`detect`/`parse`/`generate`/`remove` are **pure AST + file operations** — they read
the demo app's *source*, never import or run it (confirmed by reading `detect.js`:
it keys off `package.json` `deps.express`, never `require`s express). So a static
tour reproduces the entire transformation **with zero runtime dependency**, no port
binding, no host process, no network — impossible to fail on a stranger's laptop.
That is the honest, "sans rater" version of the unlock.

## Not done / deferred
- **`demo` is a terminal try-it, NOT a registry auto-launch MCP server.** It prints
  a human tour to stdout and exits; it does not speak MCP over stdio. So the
  registry `server.json` `packageArguments` stays **`dev`** (the actual MCP server,
  for users who have run `init`) — it must NOT be changed to `demo` (a client that
  auto-launched `npx sparda-mcp demo` would get human text on stdout and a process
  that exits, breaking the MCP handshake). The registry/README *description* is what
  points at `npx sparda-mcp demo` for an instant "see it work".
- **A truly live plug-and-play registry connector** (auto-launch → working server)
  remains blocked by the express-devDependency reality above; not pursued.
- README still needs a `demo` section / asciinema as its centerpiece (cheap, not done).

## Decisions made
- **Static guided tour over a live server** for `demo` — bulletproof first-run beats
  a flashier-but-fragile live demo. (Durable; rationale above.)
- **Ship a dedicated `demo-app/`** rather than reuse/ship `tests/fixtures/**` — keeps
  the npm tarball clean and the demo's behavior pinned independent of test fixtures.
- **Registry publish is now unblocked** (the listing is no longer a dead end), but
  the command stays `dev`, and the actual `mcp-publisher publish` remains owner-gated
  on npm + GitHub auth (runbook in `2026-06-26-adoption-mcp-registry-prep.md`).

## Notes for the next session
- If `demo` ever needs to show MORE (e.g. an actual tool *invocation*), do it
  **statically** too: call the generated router's handlers via the parsed manifest,
  never by booting express. Keep the no-runtime-dep invariant — it's the whole point.
- `demo-app/src/app.js` must stay in sync with what the narration claims (5 routes,
  1 dynamic skip, 1 injection bait). `tests/demo.test.js` will catch a drift in the
  counts, but not a wording mismatch — eyeball both if you edit the demo app.
- Next highest-leverage adoption brick is **Next.js route-handler parsing** (new
  parser path) — unchanged from the prior handoff.

> Remember: `docs/HANDOFF.md` updated alongside this file.
