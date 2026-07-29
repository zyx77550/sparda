# debrief_phase1 — MCP-protocol checklist closed (the publish blocker)

**Date:** 2026-06-11 · **Agent:** local Claude Code session on Zak's Windows
desktop · **Branch:** `main` (forge clone) · **SPARDA:** v0.3.0 · **Node:**
v24.5.0 · **Demo app:** clean Express ESM app at
`C:\Users\zakwi\Desktop\sparda-demo-app` (git baseline `851ebb1`).

## How this closes the gap

The HANDOFF gap was: *"never exercised through a real MCP client"*. This run
drove SPARDA over the **real MCP wire protocol** end to end — not the injected
router's HTTP layer. A scripted JSON-RPC client (Voie B,
`Desktop/sparda-e2e/harness.mjs`) spawns the real host app **and** the real
`node src/index.js dev` bridge, declares `sampling` + `elicitation`
capabilities, and answers the bridge's `sampling/createMessage` requests by
hand (the human-plays-the-LLM contract). Every `[MCP]` line below is a genuine
`tools/list` / `tools/call` over stdio, not an HTTP shortcut.

This client supports sampling and elicitation, which the MCP Inspector blocked
in the previous (partial) desktop pass — so the items that were red there
(Tools tab, `sparda_get_context`, sampling, quarantine 3-strikes, remove) are
all green here.

## Results — 13/13 green

| # | Channel | Expected | Observed | Verdict |
|---|---|---|---|---|
| init | [MCP] | `initialize` → serverInfo `sparda-*`, caps tools/prompts/logging, protocol `2025-06-18` | `serverInfo.name = sparda-sparda-demo-app`, caps `[tools, prompts, logging]` | PASS |
| 1.1 list | [MCP] | all GET tools + `sparda_get_context` + `sparda_list_disabled_tools` listed; `post_api_products` absent | listed 4 GET tools + 3 sparda_* tools; POST absent (write-safety) | PASS |
| 1.1 get_health | [MCP] | live app data, `isError=false` | `{upstreamStatus:200, data:{ok:true, uptimeSec:4, products:2}}` | PASS |
| 1.2 context | [MCP] | tools + workflows + runtime telemetry + immune memory in one call | full context returned (see appendix) | PASS |
| 1.3 sampling | [MCP] | bridge issues `sampling/createMessage` for semantic pass; cached in `sparda.json.semantic` | 1 semantic sampling answered; 5 descriptions + 1 workflow cached; `source=mcp-sampling` | PASS |
| 1.3b cache | [MCP] | restarting `dev` does **not** re-issue the semantic sampling | semantic samplings before=1 / after restart=1 (Δ0) | PASS |
| 1.4 quarantine | [MCP] | 3×5xx then 4th = 503 quarantined, `isError=true`, carries `retryInMs` | 4th body `{error:"tool quarantined…", reason:"3 consecutive 5xx", retryInMs:2811}` | PASS |
| 1.4 stats | [HTTP direct] | `/mcp/stats` lists `get_api_flaky` in quarantine map | quarantine map shows `get_api_flaky` with `since/until/reason` | PASS |
| 1.4 recover | [MCP] | after cooldown, half-open probe passes and disarms | probe `isError=false, {ok:true}` | PASS |
| 1.4 rearm | [MCP] | in half-open a **single** probe 5xx re-quarantines (cold needs 3, half-open needs 1) | probe reaches upstream 500 → next call 503 `quarantined` | PASS |
| 1.5 antibody | [MCP] | a diagnostic sampling fires; antibody stored bounded in `sparda.json.immune` | 2 diagnosis samplings; antibody `invoke|get_api_flaky|500` stored | PASS |
| 1.5 in-context | [MCP] | the diagnosis surfaces in `sparda_get_context` | `immuneMemory` carries `get_api_flaky|500` | PASS |
| stdout | [MCP] | no non-JSON-RPC text on the bridge stdout (hard rule #2) | clean — 0 violations | PASS |

## 1.6 — `remove` byte-for-byte (run separately)

On-disk sha256 cycle (independent of git autocrlf), pre-init → init → remove:

```
app.js     pre-init  5a2e0db…   post-remove 5a2e0db…   → BYTE-FOR-BYTE IDENTICAL ✓
.gitignore pre-init  853bdb9…   post-remove de2b0e1…   → DIFFERS ✗
```

- The **entry file** (`app.js`) and the generated router are removed
  byte-for-byte perfect — the headline promise (#2 / hard rule #4) holds for
  the injected code.
- **But the whole-tree byte-for-byte promise fails on `.gitignore`.** `init`
  appends `\n.sparda/\n` (`src/generator/express.js:204`, `ensureGitignore`)
  and `remove` never reverts it. The residual `git diff`:

```
 node_modules/
+
+.sparda/
```

  `src/commands/remove.js:44` even prints *"git diff should be clean (minus a
  .gitignore line)"* — the deviation is known to the code but contradicts the
  stated "byte-for-byte clean diff" rule. **See P1 below.** `sparda.json` and
  `.sparda/` are fully deleted (not left untracked).

## Bugs / findings

### P0
- none.

### P1
- **`remove` is not byte-for-byte on `.gitignore`.** Violates hard rule #4 /
  README promise #2 in the letter, though the injected *code* is clean.
  Repro above. Fix direction: `remove` should reverse the exact
  `ensureGitignore` edit (strip the appended `.sparda/` line + the blank line
  it added; if SPARDA created the file from scratch, delete it). Needs a
  regression test asserting a fully clean tree after init→remove, and an
  `ERRORS.md` entry. Pending owner go-ahead because it changes documented
  `remove` behavior.
- **Port mis-detection on env-based ports.** The demo app declares
  `const PORT = Number(process.env.PORT ?? 4477)`. `detect.js` did not extract
  the `?? 4477` fallback literal and defaulted `sparda.json.port` to **3000**.
  Harmless when the host happens to run on the detected port, but for an app
  whose only port hint is an env fallback, the bridge will probe the wrong port
  out of the box. Cosmetic-to-P1 depending on how common that pattern is in the
  target audience. Workaround: run the host on the detected port, or set a
  literal port. (This E2E aligned the host to the detected port 3000.)

### Cosmetic
- `remove` without `--yes` crashes under a non-TTY stdin with
  `uv_tty_init returned EBADF` (clack `p.confirm`). Fine interactively and
  `remove --yes` is the documented non-interactive path, but the crash is ugly
  for CI/scripts. Could fall back to a non-interactive default when stdin is
  not a TTY.

## Appendix — raw logs

### `sparda_get_context` (excerpt — full living context in one call)
```json
{
  "project": "sparda-demo-app", "framework": "express", "port": 3000,
  "tools": { "get_health": {...}, "get_api_products": {...},
             "get_api_products_by_id": {...}, "post_api_products": {"enabled": false},
             "get_api_flaky": {...} },
  "workflows": [{ "name": "inspect_then_list", "steps": ["get_health", "get_api_products"] }],
  "runtime": { "uptimeSec": 8, "stats": {...}, "quarantine": {} },
  "recentEvents": [...], "immuneMemory": {...}
}
```

### Quarantine 4th call (`[MCP]` tools/call → isError=true)
```json
{ "error": "tool quarantined (immune system): get_api_flaky",
  "reason": "3 consecutive 5xx", "retryInMs": 2811 }
```

### `/mcp/events` ring buffer during the quarantine cycle
```
seq1 invoke get_api_flaky 500 "upstream exploded"
seq2 invoke get_api_flaky 500
seq3 immune get_api_flaky 503 "quarantined after 3 consecutive 5xx (cooldown 3000ms)"
seq4 invoke get_api_flaky 500
seq5 invoke get_api_flaky 500
seq6 invoke get_api_flaky 500
```

### Immune memory persisted to `sparda.json` (antibody, zero-token on repeat)
```json
"invoke|get_api_flaky|500": {
  "diagnosis": "Upstream route returns 5xx repeatedly — check the failing dependency…",
  "firstSeen": "2026-06-11T20:44:54.191Z", "lastSeen": "…", "hits": 7 }
```

### Bridge stderr (human logs correctly on stderr, not stdout)
```
[sparda] MCP bridge running. 4 tools enabled, 1 disabled (write-safety). Host: http://127.0.0.1:3000
[sparda] semantic pass done: 5 descriptions, 1 workflows (cached in sparda.json)
[sparda] immune: antibody stored for invoke|get_api_flaky|500
[sparda] immune: antibody stored for immune|get_api_flaky|503
```

## Verdict

**Phase 1 functional checklist: 13/13 green through a real MCP client.** The
validation gap that blocked npm publish is closed. The one caveat before
calling Phase 1 *strictly* 100% is the `.gitignore` residue on `remove` (P1) —
the injected code is byte-for-byte clean, only the gitignore line is not
reverted.
