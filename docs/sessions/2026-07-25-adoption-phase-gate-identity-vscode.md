# 2026-07-25 — Adoption phase: gate in the loop, one identity, an editor

**Scope:** After the trust-layer hardening (ADR-063→074), turn to adoption — but NOT by playing the
SAST giants' game. Strategic reframe with Zak: Rice caps everyone on the 8 shared axes; we win in a
category they can't follow (PROVEN + honesty + act-not-observe), keeping the table-stakes (DX, false
positives) just good enough. Focus: the wedge "AI writes → SPARDA proves, in the edit loop".
**Branch:** `claude/sparda-mcp-security-audit-nw3kek` · **Tests:** 810 / 3 skipped · **Mutants:** 33/33.

## Done (all merged via #21 + #22, then this doc pass)
- **`gate` explanations** — `remediationFor` adds an imperative `↳ fix:` per regression (stderr +
  `--json` `fix` field), never empty. `tests/gate.test.js` extended.
- **One-command Claude Code install** — `sparda gate --install-claude` / `--uninstall-claude`, new
  pure `src/commands/claude-hook.js` (idempotent, preserves the user's own hooks, byte-for-byte clean
  round-trip on standard settings, rule #4). `remove` strips it too. `tests/claude-hook.test.js`.
- **Identity realign** — killed the pre-pivot "MCP server" pitch at the source: the live
  `sparda_info` text (stdio.js), the `index.js` header, and `tools/publish/public/README.md` now lead
  with "the trust layer for AI-written code". Registry manifests bumped to 0.68.0 (release-sync caught
  the drift).
- **VS Code extension** — `integrations/vscode/` (extension.cjs + pure lib.cjs + manifest), 4
  commands, status-bar verdict, findings → Problems panel. `tests/vscode-extension.test.js` (pure
  logic). 0 runtime deps; not in the npm `files` allowlist.
- **Multi-loop doc** — `integrations/agent-loops.md` (Claude Code one-command; Cursor/Copilot via
  `gate --hook`; `apocalypse` at the merge boundary).
- ROADMAP Round 9, HANDOFF Brick #21.

## Not done / deferred (needs accounts or credentials, not code — delegated)
- **VS Code Marketplace publish** (Azure DevOps publisher + PAT + `vsce publish`) → brief handed to
  Gemini (`GEMINI-PUBLISH-VSCODE-AND-IDENTITY.md`).
- **Public repo `zyx77550/sparda` About + topics** + delete the leftover branch
  `claude/new-session-cn4abd` → same Gemini brief (a Claude session already aligned the public repo's
  files but its tools/proxy blocked GitHub settings + branch delete).
- **MCP registry re-publish** — NOT urgent: the live `latest` (0.67.0) already shows the new pitch;
  the old "turn any … into an MCP server" only survives on immutable old versions (0.10–0.12). And
  the registry `description` is capped at **100 chars** — the 198-char canonical must be shortened
  before any re-publish (short line provided).

## Decisions / corrections
- **npm name stays `sparda-mcp`** — npm blocks `sparda` (too close to `isparta`).
- **Why identity "doesn't stick":** it lives in ~5 channels (frozen registry snapshot, shipped
  strings, search/AI cache); updating some ≠ all. A published snapshot only changes when you actively
  re-push to THAT channel. My earlier "registry frozen on the old pitch" premise came from a stale
  2026-07-19 note and was corrected by the public-repo session.
- **Extension untested at the host layer** — the pure parsing logic is unit-tested; the editor wiring
  (commands/status bar/diagnostics) uses standard VS Code APIs but couldn't run without a VS Code host
  here. Validates on first `vsce package` / F5.

## Notes for next session
- Next natural wedge work: wire an MCP-sampling generator behind the ADR-074 verifier (the recall
  multiplier), and/or the `PROVEN-ENFORCED` verdict tier (validated as a spike, not integrated).
- GitHub Actions minutes are exhausted until Aug 1 (quota, $0 budget → blocked, no charge) — CI can't
  go green on new PRs until then; merge admin, proven green locally.
