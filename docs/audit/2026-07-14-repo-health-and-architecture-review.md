# Repo health & architecture review — 2026-07-14

**Scope:** whole-repo engineering pass requested by the owner ("review everything, improve the
axes, find bugs, judge the structure, be creative — the best engineering/architecture work").
Read the structure, hunted bugs on the session's diff at high effort, fixed what was safe under
the "sans faute" discipline (tests + golden bench byte-identical), and mapped what genuinely
merits a dedicated session. Nothing invented to pad the list.

## 0. The "design by Claude" question — answered

There is no gratuitous "design project" in this repo. SPARDA has exactly **two** design surfaces,
both minimal and both load-bearing:

1. **`src/ui/style.js` (78 lines)** — zero-dependency ANSI colouring for the *human* CLI commands
   (`init`, `remove`, `doctor`, `demo`, `report`). It honours `NO_COLOR`/`FORCE_COLOR`, degrades
   to plain text off-TTY, and is explicitly forbidden from the MCP bridge path (hard rule #2:
   stdout is the protocol). This is correct, necessary plumbing — not decoration.
2. **`src/commands/dossier.js` HTML** — "the human face of the proof": one self-contained, zero-CDN,
   theme-aware HTML page a non-technical reader can open to see the verdict, the safety matrix, the
   findings, and (new this session) the defect classes. It is polished (OKLCH, hover transitions)
   because it is the one *shareable* artifact SPARDA produces — the thing that goes on a screen in
   front of a buyer. The polish is proportionate to that job, and it stays deterministic + XSS-escaped.

**Verdict:** we do need both, and neither is over-built. No action required beyond keeping them lean.

## 1. Structural health — the repo is well-maintained

Measured, not asserted:

- **4 runtime dependencies, exact-pinned** (`@babel/parser`, `@babel/traverse`, `@clack/prompts`,
  `@modelcontextprotocol/sdk`); **`npm audit` = 0 vulnerabilities**; **0 TODO/FIXME/HACK/XXX** in `src`.
- **No dead code and no duplication found.** The two `fastapi_extract.py` files are *different
  concerns*, not a copy: `src/parser/` extracts route specs for the MCP router injection; `src/ubg/`
  lowers behaviour into the UBG. `negentropy` looked orphaned (no `case` in `index.js`) but is a
  sub-pass of `doctor --app`, imported + tested + documented. Every command file is either wired in
  `index.js` or a deliberate sub-command.
- **Clear layering:** `parser/` (MCP injection AST) · `ubg/` (behaviour compiler + passes) ·
  `commands/` (CLI) · `server/` (stdio bridge, runtime) · `flight/` (traffic recording) ·
  `generator/` (templates) · `probe/` (runtime route capture) · `security/` (docstring sanitize).
  The dependency direction is sane; the IR (`ubg/schema.js`) is the hub everything else consumes.
- **Determinism is real and now bench-locked** (ADR-056): 5 SHA-pinned repos, golden verdicts
  including the canonical-graph sha256, byte-identical on re-derive.

This is not a repo that needs rescuing. It needs *depth* in a few named places, below.

## 2. Bugs found and fixed this pass (all verified, bench byte-identical)

- **NUL byte in `src/ubg/classes.js` (this session's own bug, FIXED).** The defect-class grouping
  key `` `${f.rule} ${bh}` `` had its separator saved as a raw `0x00` instead of a space. Functionally
  invisible (an internal Map key stays consistent) but it made a source file **binary to git, grep
  and diff** — it silently drops out of code review. Replaced with a real space; grouping unchanged.
- **Literal NUL separators in `src/ubg/schema.js` (pre-existing, HARDENED).** `edgeSortKey` embedded
  three raw `0x00` bytes as field separators — deliberate, but it made the determinism-core file
  binary to tooling too. Converted to a unicode escape for the same separator: **the runtime string is identical**
  (proven — the golden bench's graph sha256 is unchanged on all 5 repos), the source is now text.
- **New guard: `tests/source-hygiene.test.js`.** Asserts no tracked text source contains a NUL byte.
  It immediately caught two *fresh* NULs (in its own comment) during authoring — it works. This class
  of defect can no longer reach `main` unseen.

## 3. Known limitation documented (not a regression, for a later session)

- **Python deep-follow memoisation can cache a depth-truncated result** (`fastapi_extract.py`,
  `follow_function`). The memo key is `(file, dispatch, method)` with no depth component, but a
  result computed when the `MAX_FOLLOW_DEPTH`/cycle bound cut its subtree is memoised and reused by a
  later shallower hit → that function's transitive effects can be *under-reported* depending on
  first-visit order. It is **deterministic** (sorted route order → stable), so verdicts are stable and
  the bench is green; the cost is completeness, not soundness, and only for functions first reached at
  depth ≥ 6. The JS engines share the shape. Fix belongs with the ADR-P2 engine unification (one
  resolver, one place to make the bound complete-by-construction), not a point patch here.

## 4. Prioritised opportunities (the honest architecture map)

Ranked by leverage. None is a rescue; each is a build-out.

1. **ADR-P2 — one interprocedural resolver (dedicated session).** `src/ubg/extract.js` is 1,389
   lines and the three follow engines (`followDI`, `deepScan`/`followMembers`, the new Python
   deep-follow) solve the same problem three times. Factoring them into one `ubg/resolve.js`
   (frameworks as configs) is the single highest-leverage refactor: it collapses four listed gaps,
   is the prerequisite for the dataflow IR (ADR-P1), and — done under the golden bench — is a
   *byte-identity-verifiable* refactor. This is where the depth-truncation limitation (§3) gets
   fixed correctly. Already the documented next step; this review reconfirms it as #1.
2. **ADR-P1 — dataflow edges in the IR (`bh2_`).** The envelope is already versioned for it
   (ADR-054, this quarter). Turns O2 from a boolean into a real taint counterexample. Depends on P2.
3. **Docs hygiene (cheap, do opportunistically).** `docs/` carries genuinely useful material but also
   drift: `KIMI_V2_ARCHITECTURE_MASTER.md` (assessed and rejected), `problème 0.4.0 à Gemini.md` /
   `problème 0.5.0 à Gemini.md` (transient notes), a binary `.docx`. Suggest an `docs/archive/` for
   superseded material so `docs/README.md`'s map stays the source of truth. **Not deleting anything
   without the owner** — flagged, not actioned.
4. **Source-hygiene generalisation.** The NUL guard is in; a natural sibling (a lint rule banning
   other invisible chars — zero-width spaces, BOM mid-file) could fold in if it ever bites. Not
   needed today.

## 5. What this review deliberately did NOT do

- No large refactor was attempted inline — ADR-P2/P1 each merit their own session, and doing them
  half-way would violate the "sans faute" bar. They are mapped, not rushed.
- No docs were deleted or moved (owner's call).
- No behaviour changed: every fix here is byte-identity-preserving, proven by the golden bench.

**Bottom line:** the repo is in good engineering health — minimal deps, clean layering, no dead
code, determinism now bench-locked. The one real bug in reach (a source-corrupting NUL) is fixed and
permanently guarded; the genuine growth is depth (P2 → P1), already ordered and now protected by the
bench that also lives in this branch.
