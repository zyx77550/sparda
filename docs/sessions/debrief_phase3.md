# debrief_phase3 — full lifecycle: sync · carry-over · write opt-in · hook · doctor · remove

**Date:** 2026-06-11 · **Agent:** local Claude Code session on Zak's Windows
desktop · **Branch:** `main` (forge clone) · **SPARDA:** v0.3.0 · **Node:**
v24.5.0 · **App:** ESM `Desktop/sparda-demo-app` (git baseline `7ddee2d`).

## What this phase does

Phases 1–2 proved the runtime. Phase 3 exercises the **lifecycle commands**
around it: keeping the router in sync as routes change, preserving user/AI state
across re-runs, the human-in-the-loop write path, the git sentinel, the
diagnostic command, and a final clean removal. The state-mutating, MCP-only
parts (write opt-in + elicitation) ran over the real MCP wire
(`Desktop/sparda-e2e/phase3_write.mjs`); the CLI parts (`sync`, carry-over,
`hook`, `doctor`, `remove`) ran as the real CLI with on-disk / git assertions.

## Results — 8/9 green, 1 finding

| # | Channel | Expected | Observed | Verdict |
|---|---|---|---|---|
| 3.1 sync (add) | [CLI] | a route added after init is picked up by `sparda sync`, router regenerated | `+ GET /api/ping`; `get_api_ping` appears (17 tools) | PASS |
| 3.1 sync (remove) | [CLI] | deleting the route + `sync` drops the tool | `- GET /api/ping`; back to 16 tools | PASS |
| 3.1 sync carry-over | [CLI] | sync preserves `localKey` + semantic + write opt-in | localKey unchanged, `enrichedAt` unchanged, `post` still enabled | PASS |
| 3.2 carry-over (re-init) | [CLI] | `localKey`, `semantic`, `immune`, per-tool `enabled` survive a full re-init (hard rule #5) | localKey identical, semantic 16 desc unchanged, antibody preserved, `post` opt-in preserved | PASS |
| 3.3 write opt-in listed | [MCP] | after `enabled:true` + re-init, `post_api_products` IS listed | present in `tools/list` (16 tools) | PASS |
| 3.3a write accept | [MCP] | server issues `elicitation/create`; accept → POST 201 + proof-after-write reads the row back | elicitation fired, `upstreamStatus=201`, `proof.readBack=get_api_products`, new "Latte" row visible | PASS |
| 3.3b write decline | [MCP] | decline → write NOT executed, resource unchanged | elicitation fired, `isError=true`, "Write declined … NOT executed", row absent | PASS |
| 3.4 hook | [CLI] | `sparda hook` installs a non-blocking `post-commit` sentinel, idempotently | hook written w/ `# sparda-sentinel`, 2nd run "already installed", marker count 1 | PASS |
| 3.5 doctor exit codes | [CLI] | healthy vs broken app give **distinct exit codes** | text distinguishes (`✓`/`✗ Host … NOT reachable`) but **both exit 0** | **FINDING (P2)** |
| 3.6 final remove | [CLI] | init→remove leaves a byte-for-byte clean diff (hard rule #4) | `app.js` + `routes/v2.js` IDENTICAL (git hash-object); only `.gitignore` differs | PASS* |

\* the injected code (entry file + the mounted sub-router file) is byte-for-byte
perfect; the lone deviation is the `.gitignore` residue (P1, carried from
Phase 1 — see below).

## Bugs / findings

### P0
- none. **Carry-over is intact** — the highest-risk invariant (hard rule #5).
  Re-init kept the same `localKey` (a regenerated key would silently break every
  configured client — would have been P0), the cached `semantic` (no re-spend of
  client tokens), the `immune` antibody, and the user's write opt-in.

### P1 (carried from Phase 1, reconfirmed on a multi-file app)
- **`remove` is not byte-for-byte on `.gitignore`.** `init` appends
  `\n.sparda/\n` (`src/generator/express.js:204`) and `remove` never reverts it.
  After init→remove, `git diff` shows only:
  ```
   node_modules/
  +
  +.sparda/
  ```
  The entry file `app.js` AND the mounted sub-router `routes/v2.js` both come
  back byte-for-byte identical (verified via `git hash-object`, autocrlf-safe).
  `src/commands/remove.js:44` already prints *"clean (minus a .gitignore line)"*,
  so the code knows. Fix direction unchanged from Phase 1: `remove` should strip
  the exact `ensureGitignore` edit (the `.sparda/` line + the blank line it
  added; delete the file if SPARDA created it). Needs a regression test asserting
  a fully clean tree after init→remove, and an `ERRORS.md` entry. **Pending Zak's
  go-ahead** — it changes documented `remove` behavior.

### P2 (new this phase)
- **`doctor` does not signal health via exit code.** Healthy and broken apps
  both exit `0`. `runDoctor` prints `✗` lines but never sets `process.exitCode`;
  `index.js:75` only returns non-zero on a *thrown* error, and doctor catches its
  own detect failure. The diagnostic **text** is correct and distinct (host
  reachable ✓ vs `✗ Host app … NOT reachable`, quarantine state, etc.), so it is
  useful interactively — but CI/scripts cannot gate on `sparda doctor`. Fix
  direction: set `process.exitCode = 1` when a critical check fails (host
  unreachable, quarantined route present, invalid/missing manifest), keeping `0`
  for healthy. Low-risk, additive; worth doing before publish if "doctor in CI"
  is a selling point, otherwise backlog.

### Notes (not bugs)
- The `post-commit` hook runs `npx --no-install sparda-mcp sync --quiet || true`.
  Until `sparda-mcp` is published (or `npm link`-ed), `npx --no-install` can't
  resolve it, so the hook is a no-op — but `|| true` keeps commits unblocked, so
  this is safe by design. End-to-end auto-sync will work once the package is
  resolvable. (Not exercised with a real commit to avoid polluting the demo git
  history; install + idempotence verified.)
- `remove` does not uninstall the `post-commit` hook. Reasonable (the hook lives
  in `.git/hooks`, outside the tree, and is opt-in infra), but worth a one-line
  mention in the README so users know to remove it manually if desired.
- `remove` without `--yes` still crashes under non-TTY stdin (clack `p.confirm`,
  `uv_tty_init EBADF`) — same cosmetic from Phase 1; `remove --yes` is the
  documented non-interactive path.

## Appendix — raw

### 3.2 carry-over assertions (after a full re-init)
```
PASS  localKey unchanged (P0)            413fc21b-4db5-4806-b10c-7fef4c63c9d9
PASS  semantic.enrichedAt unchanged      2026-06-11T21:02:05.400Z
PASS  semantic descriptions preserved    16
PASS  immune antibody preserved          immune|get_api_timed|200
PASS  post_api_products.enabled override true
```

### 3.3 elicitation log (server→client requests answered by the MCP client)
```json
[
  { "message": "SPARDA: allow POST /api/products? This is a write operation on your live app.",
    "answer": { "action": "accept", "content": { "confirm": true } } },
  { "message": "SPARDA: allow POST /api/products? This is a write operation on your live app.",
    "answer": { "action": "decline" } }
]
```

### 3.3a proof-after-write (the AI sees the effect of its own write)
```json
{ "upstreamStatus": 201, "data": { "id": 3, "name": "Latte", "price": 5 },
  "proof": { "readBack": "get_api_products",
             "state": [ {"id":1,...}, {"id":2,...}, {"id":3,"name":"Latte","price":5} ] } }
```

### 3.6 byte-for-byte (git hash-object, autocrlf-normalized)
```
app.js       base f5023921…  post f5023921…  → IDENTICAL ✓
routes/v2.js base 285bb066…  post 285bb066…  → IDENTICAL ✓
.gitignore   base c2658d7d…  post 64cf01c2…  → DIFFERS ✗ (P1: appended .sparda/)
git status: " M .gitignore"   (app.js + routes/v2.js clean)
```

## Verdict

**Phase 3: 8/9 green, plus one new P2 finding (doctor exit codes).** The
lifecycle holds end to end: `sync` tracks routes both ways, **carry-over is
sacred and intact** (localKey/semantic/immune/enabled all survive re-init — no
P0), the write path gates on real MCP elicitation with proof-after-write, the
git sentinel installs idempotently and non-blockingly, and `remove` is
byte-for-byte clean on all injected code. Two pre-publish polish items remain:
the `.gitignore` residue (P1, needs Zak's go-ahead) and the advisory-only
`doctor` exit code (P2).
