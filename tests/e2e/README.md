# tests/e2e — scripted real MCP client (Voie B)

The only complete **real MCP client** we have for SPARDA: a scripted JSON-RPC
client over stdio that declares `sampling` + `elicitation` capabilities and
answers the bridge's server→client requests by hand. This is what closed the
"never exercised through a real MCP client" gap before the v0.3.0 publish — it
drives the actual MCP wire protocol, not the injected router's HTTP layer.

**Not wired into `vitest` — manual use only.** These spawn long-lived host +
bridge processes and play the human-as-LLM contract; they're validation
scenarios, not unit tests. `npm test` does not run them.

## Files

| File | What it does |
|---|---|
| `harness.mjs` | `Harness` class: spawns the host demo app + `node src/index.js dev` bridge, speaks JSON-RPC, answers `sampling/createMessage` + `elicitation/create`. Exported `SPARDA` / `APP` paths. |
| `phase1.mjs` | Phase 1 — MCP protocol checklist (init, list, call, context, sampling+cache, quarantine 3-strikes + recovery + re-arm, antibody, stdout discipline). |
| `phase2.mjs` | Phase 2 — hardened app (nested params + encoding, sub-router, write-safety, docstring defense, latency antigen, big payload, concurrency, name collision, CJS variant, invalid input). |
| `phase3_write.mjs` | Phase 3.3 — write opt-in + native elicitation accept/decline + proof-after-write. |

## Prerequisites

- A host demo app on disk. By default the harness points at
  `C:/Users/zakwi/Desktop/sparda-demo-app` (a hardened Express ESM app).
- `phase2.mjs`'s CJS section additionally expects a CommonJS demo app
  (`sparda-demo-cjs`). Recreate it if you deleted it.
- The SPARDA CLI. By default resolved **relative to this file**
  (`../../src/index.js`), so it works from any checkout.

## Paths / overrides

`harness.mjs` resolves paths in this order:

```
SPARDA CLI : $SPARDA_E2E_CLI  ||  <repo>/src/index.js   (relative to this file)
demo app   : $SPARDA_E2E_APP  ||  C:/Users/zakwi/Desktop/sparda-demo-app
```

Override via env when your layout differs:

```powershell
$env:SPARDA_E2E_APP = "C:\path\to\your\demo-app"
node tests/e2e/phase1.mjs
```

## Run

```powershell
node tests/e2e/phase1.mjs        # prints a JSON report to stdout, logs to stderr
node tests/e2e/phase2.mjs
node tests/e2e/phase3_write.mjs
```

Each script writes its final result as JSON to **stdout** (human logs go to
**stderr**). The full per-phase verdicts + raw evidence are captured in
`docs/sessions/debrief_phase{1,2,3}.md`.
