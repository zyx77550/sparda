# Security model

Honest by design: defenses first, known gaps last. Update both when either
changes.

## Threat model

SPARDA sits between an AI client and a live application. The attack
surfaces, in order of severity:

1. **Prompt injection through the codebase** — hostile docstrings/comments
   become tool descriptions the AI reads.
2. **The AI itself as an unsafe operator** — writes to a live app, error
   loops hammering broken routes.
3. **Local network access to the injected router** — anything on localhost
   could call `/mcp/invoke`.
4. **LLM outputs as stored state** — sampling responses (semantic pass,
   immune diagnoses) are untrusted input that we persist and re-show.
5. **Supply chain** — our own dependency footprint.

## Defenses (current)

| Surface | Defense | Where |
|---|---|---|
| Docstring injection | regex deny-list, flagged → purged to fallback; `<>{}` stripped; 300-char cap | `security/sanitize.js`, applied at init *and* sync |
| LLM outputs | same sanitizer on every sampling result before storage/display | `stdio.js` (semantic pass, antibodies) |
| Unsafe writes | write tools `enabled: false` by default; per-write elicitation confirm; proof-after-write read-back | generators + `stdio.js` |
| Error-loop hammering | quarantine: 3 consecutive 5xx → 503 + cooldown, half-open probe | router templates (v0.3) |
| Local access | `x-sparda-key` (UUID) required on every router endpoint; 401 otherwise | router templates |
| Key at rest | ADR-022: no plaintext key in `sparda.json` or generated routes — resolved at runtime from `SPARDA_LOCAL_KEY` (env) → gitignored `.sparda/key`; **fail-closed 503** if neither is found, so an accidental commit/deploy of `/mcp` routes is safe by construction | `generator/*`, `manifest.js` |
| Self-reference loops | `/mcp*` paths blocked at parse time *and* invoke time | parser + router |
| Resource abuse | 30s timeouts, 8KB output truncation, events ring buffer (100), antibodies cap (50), stats are O(tools) | router + bridge |
| Host stability | `uncaughtExceptionMonitor` (observe-only — never alters crash behavior); injection is backed up, re-parsed, reversible byte-for-byte | templates + generators |
| Supply chain | 4 runtime deps, exact-pinned | `package.json` |

## Known gaps (honest)

- **Key comparison is `!==`, not constant-time.** The key guards a loopback
  interface (not an internet-exposed service), so a timing side-channel is
  low-impact — but it is a deviation from best practice, stated not hidden.
- **The `x-sparda-key` still guards weak-auth surface, not secret material.**
  Since ADR-022 the key is never at rest in a committable file and fails
  closed when absent (see Defenses), but treat the loopback interface as
  local-trust, not a hardened boundary.
- **No per-tool/per-person access policies** — planned for a future paid tier.
- **No signed audit log yet** (planned for a paid tier) — until then,
  actions are observable only via `/mcp/events` and client logs.
- **Sanitizer is a deny-list** — it blocks known patterns, not novel ones.
  Acceptable while descriptions are short and capped; revisit if we ever
  pass larger code context to clients.
- **The semantic/immune sampling prompts include app-derived text** (route
  descriptions, error messages). They are sanitized, but a hostile app
  could still try to steer its *own* diagnosis. Impact is bounded: output
  is re-sanitized and only ever shown as a one-line description.
