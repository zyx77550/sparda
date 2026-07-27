# SPARDA in any AI edit loop

**AI writes. SPARDA proves — in the loop, wherever the writing happens.**

The gate is agent-agnostic. Its contract is one command:

```bash
sparda gate --hook
```

- **silent** when the edit lost no protection (no noise on clean work),
- on a real regression: prints the exact loss on **stderr** with a `↳ fix:` line and exits **2**
  (feedback the agent reads and self-heals from in the same turn),
- **abstains** (exit 0) while a file is mid-edit and doesn't parse yet — never a false alarm,
- **self-arms** on first run (zero config); re-arm intended changes with `sparda gate --arm`.

Any tool that can run a shell command after an edit can host it. Wiring per tool:

## Claude Code — one command
```bash
sparda gate --install-claude      # writes the PostToolUse hook into .claude/settings.json
sparda gate --uninstall-claude    # removes exactly it
```
Idempotent, preserves your other hooks, cleanly removable. That's the whole setup.

## Cursor / Windsurf / other agent IDEs
These run agent edit loops too. If the tool exposes a post-edit / post-action hook (a rule or task
that runs a command after file writes), point it at `sparda gate --hook` — same contract, same
stderr feedback. If it has no post-edit hook yet, run the gate from the integrated terminal
(`sparda gate`) after a batch of edits, or fall back to the pre-merge gate below.

## GitHub Copilot / any assistant without a post-edit hook
There is no standard post-edit hook to attach to, so use the **pre-merge** gate instead — the same
graph, one layer out:
```bash
sparda apocalypse        # exit 1 on any critical/high regression — run in a pre-commit hook or CI
```
This still catches a dropped guard or an exposed route before it merges; it just fires at commit
time rather than per edit.

## The VS Code extension
The [SPARDA VS Code extension](./vscode) exposes **Install the gate into Claude Code**, **Prove
workspace**, **Apocalypse** (findings → Problems panel), and **Gate — arm the baseline** as
commands — the same CLI, surfaced in the editor.

---

**One contract, every loop:** `gate --hook` per edit where the tool allows it, `apocalypse` at the
merge boundary everywhere else. Deterministic, offline, no API key — the proof never leaves your
machine.
