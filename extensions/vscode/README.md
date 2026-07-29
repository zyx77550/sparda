# SPARDA for VS Code

**The trust layer for AI-written code. AI writes, SPARDA proves.**

Bring SPARDA's verdict into your editor. Deterministic, offline behavior proofs — no API key, no
cloud, nothing leaves your machine. The extension is a thin wrapper over the `sparda-mcp` CLI, so
its verdict never drifts from the CLI's.

## What it does

- **SPARDA: Prove workspace** — compiles your backend and shows the trust verdict
  (`PROVEN` / `PARTIAL` / …) in the status bar and a notification.
- **SPARDA: Apocalypse** — surfaces every finding (unguarded mutation, BOLA/IDOR, irreversible
  effect, …) in the **Problems panel** at its exact file:line.
- **SPARDA: Gate — arm the baseline** — freezes the current behavior as the accepted baseline.
- **SPARDA: Install the gate into Claude Code** — wires `sparda gate` into Claude Code's
  PostToolUse hook, so every AI edit is proven in the loop.

## Requirements

The `sparda-mcp` CLI must be reachable. By default the extension runs `npx --no-install sparda-mcp`;
point it at a global install or a custom path via the **`sparda.command`** setting.

## Privacy

100% local. The extension only ever runs the SPARDA CLI on your workspace and reads its JSON
output — no telemetry, no network calls of its own.

---

By [Residual Labs](https://residual-labs.fr) · [github.com/zyx77550/sparda](https://github.com/zyx77550/sparda) · BUSL-1.1
