# What is SPARDA? — the full explainer

The long-form version of the README pitch: the problem, why in-process is
different, what actually happens when you run it, the safety model, and an
honest FAQ. Architecture internals live in [`ARCHITECTURE.md`](ARCHITECTURE.md);
founder's French summary in [`SPARDA-EXPLIQUE.md`](SPARDA-EXPLIQUE.md).

---

## The problem

AI assistants are spectacular at *writing* software and almost useless at
*operating* it. Claude can refactor your `createOrder` controller — but it
cannot create an order, look up a real customer, or tell you why production
started throwing 500s. Your running product is invisible to it.

The standard fix is to hand-build the connection: write an OpenAPI spec,
generate or code an MCP server, host it somewhere, wire authentication, keep
it synchronized with every route change — and accept that an AI now has raw
write access to your API. That is days of glue work per project, drifting out
of date from the first commit, with the scariest failure mode imaginable.

## The SPARDA answer

```bash
npx sparda-mcp init   # 3 minutes later: your app is an MCP server
npx sparda-mcp dev    # connect Claude Desktop / Claude Code
```

`init` parses your Express or FastAPI codebase (AST — your code is read, not
executed), extracts every literal route, and injects a small, clearly-marked,
fully reversible router block (`/mcp`) into your app. `dev` starts a stdio
bridge that speaks MCP to your AI client and HTTP to the injected router.

The key design choice — and the part nobody else does — is **where SPARDA
lives: inside your app's process.** Tool calls run through your real stack:
warm database pools, your actual auth chain, your real data. Not a mock, not
a proxy guessing from a spec.

## What the AI experiences

1. It connects and calls `sparda_get_context` — one tool that returns
   everything: available tools, workflows, live telemetry, quarantined
   routes, and the memory of past diagnosed failures.
2. Each of your routes is a typed tool (`get_api_users`, `post_items`…).
   Read tools work immediately. **Write tools exist but are disabled** until
   you enable them, one by one, in `sparda.json`.
3. If the client supports MCP *sampling*, your AI's own model (the one you
   already pay for) rewrites tool descriptions in business terms and proposes
   multi-step workflows — cached forever, costing you nothing.
4. When it writes (after your opt-in and, if supported, a per-write
   confirmation in your AI's UI), SPARDA re-reads the same resource and shows
   the AI the *actual* effect of its action (proof-after-write).
5. When your app throws errors, they stream to the AI as live notifications —
   with an instant cached diagnosis if this failure has been seen before.

## The immune system (v0.3 — why this isn't just a converter)

Because SPARDA lives in the process, it can do what no external generator can:

- **Learn "self":** every route's latency baseline and status profile,
  measured on real traffic. Pure arithmetic, no LLM.
- **Detect antigens:** a call 10× slower than baseline, or a burst of 5xx,
  is flagged locally.
- **Quarantine:** a tool failing 3 times in a row returns 503 with a retry
  delay instead of hammering your broken route; after a cooldown one probe
  is allowed through (half-open).
- **Remember:** new failure signatures get a one-sentence diagnosis from your
  AI (sampling), stored as an *antibody* in `sparda.json` — the same failure
  later is diagnosed instantly, zero tokens. The file is versioned with your
  git: your app's accumulated immunity survives restarts, re-inits, and
  travels with your repo.

This is the project's direction in one sentence: **your app doesn't just
become AI-operable — it defends itself, diagnoses itself, and remembers.**
(Where it goes next — tool condensation, prediction, compute recycling — is
in [`../ROADMAP.md`](../ROADMAP.md).)

## The safety model (summary — full version in SECURITY.md)

| Fear | Answer |
|---|---|
| "An AI will delete my data" | Writes disabled by default; per-tool opt-in; per-write UI confirmation; proof-after-write |
| "It will hammer my production" | Quarantine + 30s timeouts + loop protection |
| "Something on my machine could call it" | Local UUID key required on every router endpoint |
| "Hostile comments will manipulate the AI" | Docstring sanitizer (known prompt-injection patterns purged) — a deny-list, honestly documented as such |
| "It will slow my app down" | Observation is counters + ring buffers; nothing heavy on the request path; LLM never required |
| "My data will leak" | Nothing leaves your machine; no telemetry, no account, no cloud |
| "I'll be locked in" | `remove` restores your code byte-for-byte — tested on JS/TS/Python, LF and CRLF |

## FAQ

**Which frameworks?** Express 4/5 (JS/TS, ESM/CJS) and FastAPI. That's it for
now — vote for the next one in the pinned issue.

**Which AI clients?** Anything speaking MCP over stdio (Claude Desktop,
Claude Code, …). Core features work everywhere; semantic enrichment needs
sampling support, write confirmation needs elicitation support — both degrade
gracefully when absent.

**Does my app need to change?** One marked block is injected next to your
`app = express()` / `FastAPI()` line, plus one generated router file. Both
are removed cleanly by `npx sparda-mcp remove`.

**What about routes you can't parse?** Dynamic paths are skipped and reported
with a reason in `.sparda/scan-report.json`. SPARDA never silently guesses.

**What does it cost to run?** No subscription, no API key, no server. The
"intelligent" features borrow your AI client's own model via MCP sampling.

**What happens when I change my routes?** `npx sparda-mcp sync` re-syncs
(and `npx sparda-mcp hook` makes it automatic after every commit). Your
settings and learned memory survive — only changed routes are touched.

**Is it production-ready?** It is v0.x and honest about it: see
[`HANDOFF.md`](HANDOFF.md) for exactly what is tested, what isn't yet, and
what's next. The license is BUSL 1.1 — free to use, including production.
