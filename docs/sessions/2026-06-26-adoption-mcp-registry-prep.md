# 2026-06-26 — Adoption pivot + MCP registry metadata prep

**Scope:** Strategic pivot — with the eval closed, the public release out, and the
E2E blind spot shut, the owner's call is **adoption before monetization** (no free
users yet ⇒ the paid Shadow tier waits). First concrete, can't-fail move: prepare
SPARDA's listing on the **official MCP registry** (metadata only, zero runtime code
touched). **Commits:** this session · **Branch:** `main` (`sparda-hq`) ·
**Tests:** 230/230 Vitest green (unchanged — additive metadata only).

## Done
- **Researched the registry submission path (busted the "npm = compliqué" fear).**
  The official registry (`registry.modelcontextprotocol.io`) is a **metadata-only
  catalogue** — it points at npm, doesn't host. npm is a first-class supported source.
  Requirements for an npm server: (1) an `mcpName` field in `package.json` (ownership
  marker), (2) a schema-valid `server.json`, (3) `mcp-publisher login` (GitHub namespace
  proof) + `publish`. Namespace `io.github.zyx77550/*` is proven by logging into GitHub
  as `zyx77550` — we own it. Total ≈ 1–2h, no code risk.
- **Added the ownership marker** — `package.json` now carries
  `"mcpName": "io.github.zyx77550/sparda-mcp"` (always shipped in the npm tarball's
  package.json regardless of the `files` array).
- **Wrote `server.json`** at repo root, schema `2025-12-11`, validated as JSON +
  matched field-for-field to the official npm example (`registryType`,
  `registryBaseUrl`, `transport.type:stdio`, `packageArguments:["dev"]`,
  two optional non-secret env vars `SPARDA_FLYWHEEL` / `SPARDA_RECORD_SEQUENCES`).
  `repository.url` points at the **public** repo `github.com/zyx77550/sparda` (not HQ).
- **Full suite re-run 230/230** — additive metadata cannot affect tests; verified anyway
  (hard rule #9). `publish-gate.test.js` still 18/18.

## The honest catch (why we PREPPED but should not blind-publish yet)
The registry is built for **plug-and-play** connectors (`npx x-mcp` → works). SPARDA is
a **dev tool**: `sparda dev` only works after `sparda init` in a target Express/FastAPI
app **and** with that host running. A registry user who runs `npx sparda-mcp dev` cold
gets nothing. So the listing **converts only once the `demo` standalone mode exists**
(below). Recommendation: hold the actual `publish` until `demo` ships — the metadata is
ready either way.

## Publish runbook (owner — gated on npm + GitHub auth)
1. **Ship a version to npm that carries `mcpName`.** Live check (2026-06-26): npm
   `latest` is already **`0.5.3`** (the HANDOFF "unreleased to npm" line was stale) and it
   does **not** carry the `mcpName` marker; npm forbids republishing an existing version.
   So the repo is bumped to **`0.5.4`** (carries `mcpName`); `npm login` then `npm publish`
   ships `sparda-mcp@0.5.4`. `server.json` references `0.5.4` to match. The registry
   verifies the npm package at that version contains `mcpName`.
2. **Install `mcp-publisher`** (Go binary; prebuilt release on the registry repo, or
   Homebrew on mac). See the canonical quickstart: modelcontextprotocol.io/registry/quickstart.
3. **`mcp-publisher login github`** → browser auth as `zyx77550` (proves the
   `io.github.zyx77550` namespace).
4. **`mcp-publisher publish`** from the dir holding `server.json` → validates + lists it.

## Not done / next (the real adoption bricks, in order)
1. **`npx sparda-mcp demo` standalone mode — the actual unlock.** One command that runs a
   working MCP server on the bundled `express-demo` fixture (init + host + bridge, all
   already proven programmatically by `tests/e2e/phase4.mjs`). Makes the registry listing
   try-able in 10s and is the first-run "wow". Build needs: ship the fixture in the npm
   `files` array, temp-dir + free-port handling, cleanup, cross-platform.
2. **Next.js route-handler parsing** — highest-leverage framework add for reach (dominant
   JS framework, owner dogfoods it). A new parser path.
3. **Then** publish to the registry (runbook above), pointing the listing at `demo`.

## Decisions made
- **Adoption before monetization.** Paid Shadow tier + §6 security chantiers are parked
  until there are free users (owner call). Direction is now distribution/first-run, not
  more engine.
- **Prep, don't blind-publish.** The metadata is safe to commit now; the publish waits for
  `demo` so the listing isn't a dead end. Honest UX-fit over a vanity listing.
- **`server.json` references the public repo, never HQ.** No leak.

## Notes for the next session
- `server.json` lives in HQ root; for transparency it should be **allowlisted** to sync to
  public (`tools/publish/allowlist.json`) — not a blocker for publishing (Zak can run
  `mcp-publisher` from the HQ checkout), do it opportunistically.
- When `demo` ships, bump `server.json` `packageArguments` from `["dev"]` to `["demo"]`
  (or add a second package entry) so the registry try-it path works standalone.

## Update 2026-06-26 (same session, live-verified)
- **Registry: confirmed NOT listed.** Queried the live registry API
  (`registry.modelcontextprotocol.io/v0/servers?search=sparda`) → `servers: []`. We are
  not in the official catalogue (expected — never published).
- **npm: confirmed `0.5.3` is `latest`** (`npm view sparda-mcp version` → 0.5.3,
  `dist-tags.latest = 0.5.3`), and `npm view sparda-mcp mcpName` → **empty** (the published
  tarball predates the marker). HANDOFF's "unreleased to npm" was stale.
- **Bumped repo `0.5.3` → `0.5.4`** in `package.json`, `package-lock.json`, `server.json`
  so the next npm publish carries `mcpName` at a fresh version. Suite re-run 230/230. The
  publish runbook above now targets `0.5.4`.

> Remember: `docs/HANDOFF.md` updated alongside this file.
