# Changelog

## 0.71.0
- **The CLI can be installed from the error.** When the engine is missing, the notification
  carries an **Install sparda-mcp** button. It runs in a terminal you can see — never a
  background install — using the package manager your lockfile names (pnpm / yarn / bun / npm),
  and always as a dev dependency: the version that proves your code should be the one your
  project pinned. The workspace re-proves itself the moment the binary appears.
- **The button is offered only when it is the right answer.** A configured `sparda.command`
  that fails, or a workspace binary that vanished, both report what actually happened instead —
  offering to install a second copy would be a wrong remedy delivered with a button.
- **The status bar is a menu.** Clicking it offers what the current state needs: install when
  the CLI is missing, the Problems panel when findings stand, re-prove otherwise.
- **A native walkthrough** — install the engine, get a verdict, arm the gate.
- **Lightbulbs on findings explain; they never claim to fix.** A finding says an authorization
  decision is missing, and that decision is a human's. The only write-adjacent action is
  `enforce`, offered on unguarded mutations alone and always as a dry run, because it is the one
  "fix" that re-derives its own result and reverts byte-for-byte if the app does not then prove.

## 0.70.1
- **Replaces the 0.70.0 placeholder.** 0.70.0 was published from a stub whose only command
  answered `Audit command triggered! (Integration pending)`; the working extension existed in
  another directory and was never the one shipped. This version is that extension: four
  commands, real Problems-panel diagnostics, status-bar verdict.
- The status bar can no longer show a verdict it did not obtain — a failed, missing or
  cancelled CLI run reads `UNKNOWN` with its reason, never a calm or stale bar. A failed
  `apocalypse` leaves the Problems panel untouched instead of clearing it.
- Never blocks the editor (`spawn`, cancellable, one run at a time), and never picks up a bare
  global `sparda` on `PATH`: it prefers the workspace's pinned binary, then
  `npx --no-install sparda-mcp`.
- Versioned with the CLI from here on, so the editor and the engine can never disagree.

## 0.1.0
- First release. Commands: Prove workspace, Apocalypse (findings → Problems panel), Gate — arm
  the baseline, Install the gate into Claude Code. Status-bar verdict. Thin wrapper over the
  `sparda-mcp` CLI — zero runtime dependencies, 100% local.
