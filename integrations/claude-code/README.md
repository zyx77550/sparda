# SPARDA × Claude Code

**Prove what the AI just wrote — every turn, locally, before it ever reaches a PR.**

Claude Code writes code fast. This integration makes SPARDA the _proof gate inside that loop_:
after each Claude Code turn, it runs `sparda review` and prints the **behavior diff** of the
change — guards dropped, blast radius grown, invariants removed, new endpoints — derived from the
compiled behavior graph, not from the text. The verdict is deterministic and re-derivable: anyone
can recompute it and get the same answer.

This is Act 1 of SPARDA ("AI writes. SPARDA proves.") wired exactly where the writing happens.

## The 60-second proof

```bash
node integrations/claude-code/demo.mjs
```

It builds a throwaway app with a guarded delete, drops the guard the way an assistant plausibly
might, and asks SPARDA to review the diff. SPARDA flags the removed guard as a **critical behavior
regression** — from the graph, before any merge. The script self-verifies (it exits non-zero if
SPARDA fails to catch it), so this demo can never rot into a lie.

## Install (in your own project)

1. Have SPARDA available in the project:
   ```bash
   npm i -D sparda-mcp
   ```
2. Copy the hook script into your project's Claude config dir:
   ```bash
   mkdir -p .claude && cp node_modules/sparda-mcp/integrations/claude-code/sparda-prove.mjs .claude/
   ```
3. Merge the `Stop` hook from [`settings.json`](./settings.json) into your project's
   `.claude/settings.json`.

That is it. From then on, every Claude Code turn that changes code prints a short SPARDA proof of
the behavior it changed.

## Design contract (why it is safe to leave on)

- **It never breaks the loop.** No git repo, no changes, an unsupported backend, or SPARDA not
  installed → it stays silent and always exits `0`. It nags at most once (the install hint).
- **It never runs your code.** SPARDA reads source and schema; the review is static.
- **It is fast and offline.** It only runs when there are changes, never triggers a network
  install, and times out at 60s.
- **Comment, not gate.** The hook reports; it does not block Claude Code. Gating belongs in CI
  (the GitHub Action, `mode: review` / `apocalypse`) where a human set the policy.

## Files

| File               | Role                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| `sparda-prove.mjs` | the hook wrapper — runs `sparda review --base HEAD` after a turn, gracefully |
| `settings.json`    | the drop-in Claude Code `Stop` hook block                                    |
| `demo.mjs`         | the self-verifying "AI writes, SPARDA proves" scene                          |

## The rest of the loop

- **In CI:** the same proof as a PR gate — see the root `action.yml` (`mode: review` comments the
  behavior diff on every PR; `mode: apocalypse` fails the build on critical/high).
- **For a human reader:** `sparda dossier` renders the whole proof as one shareable HTML page.
