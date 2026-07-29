# Session 2026-07-03 — Next.js App Router: the third framework

**Agent:** Claude (Fable 5) · **Roadmap slot:** adoption item ② (owner GO).

## Design decision — file-based injection

Next.js has no `app = express()` line to inject after: the filesystem IS the
router. So on Next, SPARDA's "injection" is a **generated catch-all route
handler** at `<appDir>/mcp/[...sparda]/route.js` — nothing in the user's code
is ever modified, and `remove` = delete the file + prune the now-empty dirs
(byte-identical tree, pinned by test). Hard rule #4 holds trivially.

The template (`templates/nextjs-router.txt`) is **web-standard
Request/Response with zero imports** — it needs neither `next` nor `express`
at runtime, compiles in TS projects (Next manages `allowJs`), and can even be
imported and driven directly by vitest, which is how the test suite executes
it for real without installing Next.

## What shipped

- `src/detect.js` — `next` dep checked BEFORE `express` (a project with next
  IS a Next app); `app/` or `src/app/` required (Pages Router → USER error);
  port from `next dev -p N` / `.env PORT` / 3000.
- `src/parser/nextjs.js` — walks the app dir: route groups `(x)` stripped,
  `[id]` → `:id`, `[...slug]`/`[[...slug]]`/`@slot`/`(.)x` skipped with
  reasons, `_private` folders ignored, `/mcp/*` blocked, group-collision
  dedupe. Per file: `export async function GET/POST/…`, `export const VERB =`
  arrows, bare re-exports (low confidence). Leading comments → descriptions;
  query params via `searchParams.get/getAll('x')` (bounded 15).
- `templates/nextjs-router.txt` — full organ port from the Express template:
  spardaProof + compile-time policies, write-safety, **two-phase commit**
  (202 + single-use nonce + `/invoke/confirm`), quarantine (3×5xx, half-open),
  latency baseline events, purity observation, recycling gauge, gossip CRDT
  merge/tick, 64KB body cap, JSON 400/404/405/413 everywhere, error envelope
  with `errorId`, hot-reload guard (`globalThis.__SPARDA_WIRED__`) for the
  process listener and gossip timer. `export const dynamic/runtime` pinned.
- `src/generator/nextjs.js` — same manifest contract as Express (carry-over,
  fingerprints, sparding memory, gitignore recording); `injectedFiles: []`.
- Wiring: init (no inject prompt on nextjs, `--probe` politely refused),
  sync, remove (dir pruning), doctor + bridge start hints (`npm run dev`).
- Fixture `tests/fixtures/nextjs-basic` (groups, dynamic, catch-all, slot,
  self-referential `/mcp/ping` user route, `_lib`) + `tests/nextjs.test.js`
  (14 tests) incl. **standalone execution of the generated handler**: 401 key,
  tools, 404/405 JSON, 403 write-safety with proof, 400 args:null, 202 gated
  write + 409 replayed token, stats gauges.

## State

Suite **255/255** passed. ESLint 0 · Prettier clean · zero new runtime dependencies. PR #14 has been squash-merged on the public repository, public tag `v0.6.0` has been pushed, and version `0.6.0` is staged.

## Known limits (honest, documented)

- Catch-all routes are skipped in v1 (variable-arity paths).
- On serverless deploys each instance keeps its own RAM gauges (inherent).
- Middleware-protected routes: the proxy hits 127.0.0.1 like any client, so
  auth middleware applies to SPARDA's proxied calls too (compose keys via
  args if needed — same story as Express).

## Next steps (for Zak)

1. **Publish to npm** : Run `npm publish` in `_public_sync` to release version `0.6.0`.
2. **Publish to MCP Registry** : Run `.\mcp-publisher.exe publish` in `_public_sync` to update the registry listing to `0.6.0`.
3. **Dogfood** on a real Residual Next app (Audit/Reach/Publish) → case study for residual-labs.fr + the launch post.
4. **Roadmap slot ③** : negentropy `doctor --app`.
