# sparda-gate — the behavior gate for AI edits (Claude Code plugin)

Your agent just edited a route. Did it quietly replace an auth wrapper with an
identity function, drop a route, or grow a write's blast radius? This plugin runs
`sparda gate` after every `Edit`/`Write`/`MultiEdit` and tells the agent — in under
two seconds, deterministically, offline, with no API key — **the moment the
regression lands, so it fixes it in the same session** instead of it slipping into
a commit. (For a hard pre-commit / CI block, the same engine runs as
`sparda apocalypse` in a git hook or the GitHub Action.)

```
✗ SPARDA GATE — this edit changed the app's proven behavior (1.6s, deterministic):
  [critical] GUARD_REMOVED — POST /api/links was guarded in the baseline and is
             now reachable without any guard (app/api/links/route.ts:56)
  → fix the edit or, if intended, accept it with `sparda gate --arm`.
```

It is built to disappear when there's nothing to say:

- **Silent when clean.** No output, no interruption on a benign edit.
- **Never fights your in-progress work.** A route that vanished only because its
  file doesn't parse yet (the normal mid-multi-edit state) is *held*, never
  blocked — the gate abstains until the file parses again.
- **Delta-only.** It reports what *this* edit changed, never pre-existing findings.
- **Zero config.** The first run arms a baseline from your current tree; every
  edit after is proven against it. Re-arm intended changes with `sparda gate --arm`.

## Install

```
/plugin marketplace add zyx77550/sparda
/plugin install sparda-gate@sparda
```

Requires Node ≥ 18. The hook shells out to `npx sparda-mcp gate --hook`; nothing is
installed globally and nothing leaves your machine.

**Monorepo:** point the gate at the app dir by editing the hook command to
`npx -y sparda-mcp gate --hook --dir apps/web`.

## What it proves (and what it doesn't)

`sparda gate` compiles your backend (Express · Next.js · NestJS · Medusa · FastAPI)
to a deterministic behavior graph and diffs it against the armed baseline. It proves
the *delta*: no guard removed, no route dropped, no blast radius grown, no new
unguarded mutation introduced. It is **honest about coverage** — a guard hidden in
an unresolved imported helper is a blind spot, reported as such, never silently
passed as safe. It does not replace review or tests; it catches the one class of
regression an LLM cannot reliably catch in itself: *did my own edit quietly remove a
protection?*

Full docs: https://github.com/zyx77550/sparda
