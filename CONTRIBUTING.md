# Contributing to SPARDA

Thanks for considering a contribution. SPARDA turns any Express/FastAPI app into
an MCP server with one command — and the bar for changes is high, because the
tool injects a router **inside people's live applications**. This is the short
version of how to land a change without breaking that trust.

## License & open-core, up front

SPARDA is **source-available under [BUSL-1.1](./LICENSE)** — not an OSI
open-source license. You can read, run, fork, and modify the code; production
use is governed by the license. By opening a pull request, you agree your
contribution is licensed under the same terms.

## Ground rules a PR may not break

These are the product's load-bearing invariants — they hold across the whole
codebase, and a change that violates one will be asked to change, however good
the idea:

1. **The host never pays for SPARDA's intelligence** — nothing heavy on the
   request path; ring buffers stay bounded; the LLM is summoned only on surprise.
2. **`stdout` is the MCP protocol** — every human-readable log goes to `stderr`.
3. **Write tools are disabled by default** — opt-in, per tool, never automatic.
4. **`sparda remove` leaves a byte-for-byte clean diff** — injection stays
   marked, idempotent, backed up, and re-parsed after every change.
5. **Carry-over is sacred** — `localKey`, per-tool `enabled`, `semantic`,
   `immune`, and `labs` survive re-init. Never regenerate them.
6. **Templates stay valid in every variant** — JS/TS × ESM/CJS, plus Python.
   Placeholders like `__ANY_TYPE__` exist for TS; keep them consistent.
7. **Every LLM output is sanitized** (`sanitizeDescription`) before it is stored
   or shown to a client.
8. **No new runtime dependency without an ADR** in `docs/DECISIONS.md`. We ship
   **4 exact-pinned** runtime deps and that count is a selling point — new **dev**
   dependencies are fine.
9. **Tests are green before commit; new behavior ships with tests.**

## Development setup

- **Node ≥ 18** and **Python ≥ 3.9** (the FastAPI parser fixtures shell out to
  Python).
- Install dev dependencies: `npm install`
- Run the CLI from a target app directory:
  `node src/index.js init|dev|sync|hook|remove|doctor`

## The checks your PR must pass

```bash
npm test             # vitest, full suite — must be green (currently 230/230)
npm run test:router  # injected-router contract self-test (10/10)
npm run test:all     # both of the above, in sequence
npm run lint         # ESLint 9 — zero errors
npm run format:check # Prettier — no diffs on JS files
npm run coverage     # optional: v8 coverage report over src/**
```

CI runs the test suite on **Node 18 & 22 × Ubuntu & Windows** (4 required
checks), plus a separate lint/format job. Reproduce those locally before you
push.

## Commit & PR conventions

- Commit messages: `feat(scope):`, `fix(scope):`, `docs:`, `chore:`.
- Keep the diff focused; explain **why** in the body, not just what.
- Comments explain **constraints**, not narration — match the surrounding
  density.
- On the public repo a PR needs **one approving review** (a code owner) and all
  required CI checks green before it can merge.
- If you change product behavior, say so clearly in the PR description and
  update any user-facing docs your change affects.

## Reporting bugs & security issues

- **Bugs / framework requests:** open an issue. There is a pinned issue to vote
  on the next framework SPARDA should support.
- **Security vulnerabilities:** please do **not** open a public issue. Read the
  threat model in [`docs/SECURITY.md`](./docs/SECURITY.md) and report privately to
  the maintainers at **contact@residual-labs.fr**.

By [Residual Labs](https://residual-labs.fr).
