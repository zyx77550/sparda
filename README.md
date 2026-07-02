# SPARDA

<div align="center">
  <img src="assets/logo-presentation.png" alt="SPARDA Banner" width="800" />
</div>

<br/>

**Your AI can write code. It still can't operate your app.**

Claude, Cursor & friends read your *files* — not your *running product*. They can
refactor a controller, but they can't create an order, fetch a real user, or see why
production is failing. And giving an AI real access to your API usually means: write
an OpenAPI spec, build an MCP server, host it, secure it, keep it in sync with every
route change — and pray it never `DELETE`s the wrong row. Days of glue code, per
project, forever drifting.

SPARDA deletes that work:

```bash
npx sparda-mcp init   # scan your Express/FastAPI app, inject the MCP router — 3 minutes
npx sparda-mcp dev    # connect Claude Desktop / Claude Code. Done.
```

No OpenAPI spec. No account. No API key. No server to host.

## Quickstart

1. **Scan + inject** — run once, from your app's directory:
   ```bash
   npx sparda-mcp init
   ```
   SPARDA parses your routes (AST), generates a marked `/mcp` router, injects it into
   your app (with a backup), and writes `sparda.json`. Every step is reversible.

2. **Start your app, then start the bridge:**
   ```bash
   npx sparda-mcp dev
   ```

3. **Connect your client.** `init` prints a ready-to-paste block for
   `claude_desktop_config.json`, pre-filled with your app's name and path:
   ```json
   {
     "mcpServers": {
       "your-app": {
         "command": "npx",
         "args": ["sparda-mcp", "dev"],
         "cwd": "/absolute/path/to/your-app"
       }
     }
   }
   ```
   Claude Code connects to the same bridge. That's it — your running app is now a set
   of MCP tools your AI can call.

## Try the Standalone Demo

To see SPARDA in action instantly without modifying your codebase:
```bash
npx sparda-mcp demo
```
This runs the entire lifecycle (detect → parse → generate → inject → remove) on a bundled demo app in a temporary folder, illustrating all six guarantees in 10 seconds.

## Black Box Report

SPARDA is designed as a local organism. To see what it remembers and how much compute it has recycled:
```bash
npx sparda-mcp report
```
This prints a terminal dashboard aggregating your exposed tools, write opt-ins, proof journal decisions, and crystallized composite tools.

To write a self-contained, offline HTML dashboard at `.sparda/report.html`, append the `--html` flag:
```bash
npx sparda-mcp report --html
```

To output raw JSON for integration:
```bash
npx sparda-mcp report --json
```

To undo everything: **`npx sparda-mcp remove`** restores your code byte-for-byte.

## The promise — every word is backed by a test in CI

<div align="center">
  <img src="assets/features-presentation.png" alt="SPARDA Features" width="800" />
</div>

<br/>

1. **Three minutes, one command.** AST scan, router generation, reversible injection — no config.
2. **Try it for free, leave for free.** `npx sparda-mcp remove` restores your code **byte-for-byte** (tested on JS, TS, Python, even Windows CRLF files). No trace, no lock-in.
3. **The AI cannot write until you say so.** Every POST/PUT/DELETE is disabled by default; you enable per tool, and your choice survives every re-run.
4. **Your app defends itself.** A route failing 3 times in a row is quarantined — the AI can't hammer your broken production. Latency anomalies are flagged. Zero LLM needed.
5. **Nothing leaves your machine.** No telemetry to us, no cloud, local key auth, 4 exact-pinned dependencies.
6. **What it learns is never lost.** Diagnoses, descriptions, settings — versioned with your git, surviving every re-init.

What we *don't* promise: the honest limits in [docs/SECURITY.md](./docs/SECURITY.md).

## How it works

1. `npx sparda-mcp init` parses your codebase (AST), extracts every route, and injects a tiny marked router (`/mcp`) into your app — fully reversible with `npx sparda-mcp remove`.
2. Tool calls run **inside your live app process** — warm DB pools, real auth chain, real data. SPARDA adds no infrastructure: compute comes from your host process, intelligence from your AI client's own model (MCP sampling), storage from `sparda.json` + git.
3. Write tools (POST/PUT/DELETE) are **disabled by default**. You opt in per tool in `sparda.json` — your choices survive re-runs.
4. Suspicious docstrings are sanitized before they ever reach the AI (prompt-injection defense).

## What SPARDA gives your AI

### Operate, not just read
Every route becomes a tool that runs against your live process — real auth, real data,
warm connections. One call to **`sparda_get_context`** hands the AI the whole living
picture: enabled tools, suggested workflows, runtime telemetry, quarantine state, and
immune memory — so every session resumes where the last one stopped.

### Write-safety: the AI can't write until you say so
- Writes (POST/PUT/DELETE) ship **disabled**. Enable them per tool in `sparda.json`; your choice survives every re-init.
- An enabled write is **never executed on the first call**. SPARDA returns an `awaiting_confirmation` envelope — a single-use token plus a preview of the action — and commits only after an explicit confirm step.
- When your client supports MCP elicitation, that confirmation prompt appears **in the AI's own UI**.
- **Proof-after-write**: every successful write is followed by a read-back of the same resource, so the AI — and you — see the real effect, not a hopeful guess.

### Your app defends itself — zero LLM on the hot path
- **Quarantine.** A tool that returns 3 consecutive 5xx is quarantined: further calls get a `503` with a reason and a retry delay instead of hammering your broken route. After a cooldown it half-opens for a single probe.
- **Latency & anomaly flags.** The router learns each route's baseline and flags deviations locally, in a few lines of math.
- **Adaptive diagnosis, only on surprise.** A genuinely new failure wakes your AI client's own model to diagnose it once; the diagnosis is cached as an "antibody" in `sparda.json`, so the same failure later costs zero tokens. Cloning your code doesn't clone its immune memory.

### A free intelligence layer, zero API key
On first connection your AI client's own model (via MCP sampling) rewrites raw routes
into business-language tool descriptions and proposes multi-step workflows — cached in
`sparda.json` and exposed as MCP prompts. Nothing to configure, nothing to pay.

### It gets cheaper the more you use it
- **Response recycling.** When a read keeps returning the same answer, SPARDA serves the next identical call straight from memory — without touching your host app. Reads only; writes always hit the host.
- **A recycling gauge.** `GET /mcp/stats` counts how many calls were answered from SPARDA's own knowledge vs. how many paid the host route. It reads 0% on day one and fills with usage — a measure, never a promise.

### Tools nobody wrote — Labs, opt-in, default OFF
Turn it on with `"labs": { "recordSequences": true }` in `sparda.json`. SPARDA then
notices when one tool's output feeds the next tool's input and records the *circuit* —
structure only (tool names, argument names, counts), never your data. A read-only
circuit seen enough times **crystallizes into a composite tool**, announced
mid-session: one call runs the whole chain, auto-feeding each step from the previous
step's real response. Write routes are never absorbed — their per-call confirmation
always stands.

### Living context & telemetry
`GET /mcp/stats` (per-tool calls/errors, tool "purity", quarantine state) and
`GET /mcp/events` (errors, latency anomalies, cached diagnoses) expose exactly what
your app is doing — surfaced to the AI as live notifications.

## Built for AI clients: the bundled Skill
SPARDA ships with an Agent Skill ([`SKILL.md`](./SKILL.md)) that teaches any compatible
AI client how to drive a SPARDA server to its **full potential** — call
`sparda_get_context` first, exploit response recycling, honor quarantine, prefer
crystallized circuits over re-walking a chain, and follow the two-phase write-confirm
protocol. The live, per-project tool list always comes from `sparda_get_context` at
runtime, so the guidance never goes stale.

## Supported frameworks
Express 4/5 (JS/TS, ESM/CJS) and FastAPI today. We are actively expanding SPARDA internally to support more Node.js environments (including NestJS, Fastify, and Next.js API routes) in the near future.

## Security posture (honest)
- 4 runtime dependencies, exact-pinned.
- Local key on every router call; self-reference loop protection; 30s timeouts; 8 KB output truncation.
- AST-positioned injection with backup and post-injection re-parse; `npx sparda-mcp remove` leaves a clean git diff.
- Persistence is **value-free**: SPARDA records structure (tool names, field names, fingerprints), never your payloads.

Full threat model and known gaps: [docs/SECURITY.md](./docs/SECURITY.md).

## Documentation
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how `init`, the injected router, and the bridge fit together, plus the `sparda.json` schema.
- [docs/SECURITY.md](./docs/SECURITY.md) — threat model, defenses, and honest known gaps.
- [docs/TESTING.md](./docs/TESTING.md) — how the promises above are kept honest in CI.
- [docs/ERRORS.md](./docs/ERRORS.md) — the error knowledge base.

## Beyond the open core
SPARDA is free, including in production (see License). Team-scale capabilities —
fine-grained per-person access policies and a signed, tamper-evident audit log — are
planned for a future paid tier. The open core stands on its own; nothing here is
crippled to upsell you.

## License
[Business Source License 1.1](./LICENSE) — free to use, including in production.
You may not resell SPARDA or offer it as a competing commercial service.
Each version converts to Apache 2.0 four years after its release.

<div align="center">
  <img src="assets/github-star.png" alt="Leave a Star" width="600" />
</div>

<br/>

By [Residual Labs](https://residual-labs.fr)
