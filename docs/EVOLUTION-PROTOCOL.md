# Evolution protocol — the Definition of Done

SPARDA is a **living system**: it evolves continuously, and that is a feature, not a risk — but
only because every meaningful evolution is *recorded* and every surface others can see is kept
current. A change that ships without updating the record is how a repo rots into something no one
can trust or hand off. This protocol is the contract that prevents it.

> **Rule.** No important evolution is "done" until the record and the visible surfaces are updated
> in the SAME change. If you shipped it, you documented it.

## What counts as an "important evolution"

Any of: a new capability or command, a behaviour change (verdict, output, API), a new ADR-worthy
decision, a bug found and fixed, a new dependency, a change to the public message, or a change to
how the tool is installed or invoked. (A pure typo fix or comment tweak does not.)

## The checklist (run it before you call a change done)

**Code**
- [ ] `npm test` green (full vitest suite) + router self-test 10/10; ESLint 0; Prettier clean.
- [ ] New behaviour ships with tests (a fixture + a test that pins it).
- [ ] `node tools/bench/run.mjs` is **byte-identical** on all pinned repos — OR, if the change
      legitimately alters output, the golden is re-consecrated with `--update` in the same commit
      (that commit IS the review of the diff).
- [ ] No source-corrupting bytes (`tests/source-hygiene.test.js` passes — no raw NUL in sources).

**The record (how context survives between sessions)**
- [ ] `docs/HANDOFF.md` — the "present state" header + a new dated session entry describing what
      changed, why, what is deferred, and what is next.
- [ ] `docs/sessions/<date>-<slug>.md` — the session record (use `TEMPLATE.md`).
- [ ] `docs/DECISIONS.md` — an ADR for any decision, new capability, or new dependency (with the
      C/P/R/D/A framing the other ADRs use).
- [ ] `docs/ERRORS.md` — an E-entry for any real bug found and fixed (symptom, root cause, fix,
      guard, rule).
- [ ] `CHANGELOG.md` — an entry for anything user-visible; bump the version when behaviour changes.
- [ ] `ROADMAP.md` — tick the item / adjust the plan if this advanced or reordered the roadmap.

**The surfaces others see (keep the message and the docs coherent everywhere)**
- [ ] `README.md` **and** the public override `tools/publish/public/README.md` — if the capability
      surface or the message changed. The public one is what the world reads; keep them in lockstep.
- [ ] `docs/VISION.md` — if the thesis, the moats, the doctrine, or the algorithmic roadmap moved.
- [ ] `package.json` + `server.json` `description`, and `SKILL.md` — if the one-liner / positioning
      changed (the canonical strings live in `docs/VISION.md` §2).
- [ ] Publish surfaces if you added user-facing files: `package.json` `files` (npm tarball) and
      `tools/publish/allowlist.json` (public mirror). Verify with `npm pack --dry-run`.
- [ ] Any integration or example touched (`integrations/**`) still runs — its demo self-verifies.

## Why this exists

- **Hand-off integrity.** A fresh session (human or AI) starts from `HANDOFF.md` + the session
  records. If they lie or lag, every future session pays for it.
- **Trust is the product.** SPARDA sells verifiable honesty; a repo whose own record drifts
  contradicts the pitch. The discipline inside the repo must match the discipline it proves in code.
- **Visible excellence compounds.** The people we want to notice SPARDA (serious engineers, labs)
  read the repo, not the tweet. Clean records + coherent surfaces are the signal.

Referenced by `CLAUDE.md` (the AI session entry point) and `CONTRIBUTING.md` (human contributors).
Both point here so there is one source of truth for "what done means."
