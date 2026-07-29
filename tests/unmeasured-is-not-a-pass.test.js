// unmeasured-is-not-a-pass.test.js — the family check for SPARDA's oldest rule, mechanized.
//
// THE RULE (SOUNDNESS §7): "we could not measure" and "we measured nothing wrong" are
// different states, everywhere, always.
//
// THE FAILURE MODE THIS FILE EXISTS FOR — and it is not the one anyone watches for. Every
// leak we have ever found had the honest field PRESENT. Nobody ever wrote `available: true`
// when the oracle had not run. What happened, five separate times, is that the admission was
// placed BESIDE the headline instead of INSIDE it:
//
//   where            the honest field, present     the headline that lied
//   ─────────────────────────────────────────────────────────────────────────
//   premise (E-104)  available: false              premiseGaps: 0      → PROVEN
//   falsify          note: 'nothing to falsify'    score: 1
//   gate             abstained: <reason>           ok: true
//   speculate        '(by lookup)'                 '✓ PROVEN'
//   immunize         —                             '✓ PROVEN'
//   stitch (E-106)   '✗ <dir>: <err>' (stderr)     'no cross-service calls resolved'
//   heal (E-106)     —                             '… zero protection lost. Ship it.'
//   timeless (E-106) —                             'every tap consumed, zero divergence'
//
// A reader acts on the headline. A dashboard graphs the headline. A CI job branches on the
// headline. The note is for the person who already suspects something is wrong — which is
// precisely the person who does not need it.
//
// So the rule has a sharper form, and this file is its enforcement:
//
//   **PUT THE ADMISSION INSIDE THE NUMBER, NEVER NEXT TO IT.**
//   `score: null` cannot be misread. `score: 1` with a note beside it always will be.
//
// AND THE SECOND HALF, learned the hard way (E-106). Constructing the UNMEASURED state BY HAND
// proves the field can hold it. It proves nothing about whether any caller ever puts it there.
// `buildCapsule(g, { premiseBasis: 'unmeasured' }).proven === null` passed from the day it was
// written, while all FOUR call sites in `src/commands/` called `buildCapsule(canonical)` bare —
// so the three-state `proven` was unreachable in production and `immunize` printed an
// "UNMEASURED PREMISE" branch no user could ever see. A green row over a dead wire.
//
// So every row owes TWO assertions:
//   1. EXPRESSIBLE — the headline field can hold the unmeasured state.  (hand-constructed)
//   2. REACHABLE   — a real call path actually produces it.             (§ reachability below)
//
// HOW TO EXTEND THIS FILE. When you add anything that emits a confidence, a verdict word, a
// score or an `ok`, add a row below: construct its UNMEASURED state and assert the headline
// does not read as a pass. If you cannot construct that state, that is the finding — a
// surface with no expressible "I don't know" will invent one under pressure. Then add the
// reachability row, or the first one is decoration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
import { falsifyGraph } from '../src/ubg/falsify.js';
import { buildCapsule } from '../src/ubg/immunity.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { publishedCheck } from '../scripts/release-checks.mjs';
import { presentationOf } from './helpers/vscode-lib.js';

// A minimal graph with one entrypoint and one guarded mutation — enough for the verdict
// machinery to have something to grade, so the rungs below are the only thing under test.
const graphWith = (extra = {}) => ({
  nodes: [
    {
      id: 'entrypoint:POST /x',
      kind: 'entrypoint',
      label: 'POST /x',
      meta: { method: 'post', path: '/x', mutating: true },
    },
    {
      id: 'effect:db_write:a.js:1:0',
      kind: 'effect',
      meta: { effectType: 'db_write', table: 't' },
    },
    ...(extra.nodes ?? []),
  ],
  edges: [],
});

describe('the verdict: an unmeasured PREMISE cannot license PROVEN (E-104)', () => {
  const base = { coverage: 1, blindHigh: 0, premiseGaps: 0 };

  it('unmeasured withholds the word, and says so in a field of its own', () => {
    const v = verdictOf([], graphWith(), { ...base, premiseBasis: 'unmeasured' });
    expect(v.premiseUnmeasured).toBe(true);
    expect(verdictState(v)).not.toBe('PROVEN');
  });

  it('measured does not withhold it', () => {
    const v = verdictOf([], graphWith(), { ...base, premiseBasis: 'measured' });
    expect(v.premiseUnmeasured).toBe(false);
  });

  it('DECLARED does not withhold it — an OpenAPI document IS its own route table', () => {
    // The one honest exception. Demanding a second witness here would be demanding that a
    // map be verified against itself, and refusing every OpenAPI proof for the sake of a
    // rule it cannot satisfy is not rigour, it is theatre.
    const v = verdictOf([], graphWith(), { ...base, premiseBasis: 'declared' });
    expect(v.premiseUnmeasured).toBe(false);
  });

  it('and `null` keeps the old semantics, for callers grading a partial graph', () => {
    // `heal` grades a regression delta, never a whole-app proof. A caller with no premise to
    // speak of is not making the claim this rung guards, so the rung must not fire on it.
    expect(verdictOf([], graphWith(), base).premiseUnmeasured).toBe(false);
  });
});

describe('falsify: a run that checked NOTHING does not score 1', () => {
  it('an empty control set scores null, not a perfect 1', () => {
    // score 1 means "every green provably depends on its guard". With zero protected
    // mutation routes, nothing was tested, and 1 is the number a dashboard would graph.
    const r = falsifyGraph({ nodes: [], edges: [] });
    expect(r.score).toBeNull();
    expect(r.controls).toEqual([]);
    expect(r.note).toMatch(/UNMEASURED/);
  });
});

describe('the capsule: a portable proof carries its own basis of measurement', () => {
  const g = graphWith();

  it('a capsule built over an unmeasured premise cannot claim proven', () => {
    // A capsule TRAVELS. Replayed in another repo by `speculate`, a frozen `proven: true`
    // is a claim re-asserted where its licence can no longer even be checked — worse than
    // E-104, where the oracle was one call away.
    const c = buildCapsule(g, { premiseBasis: 'unmeasured' });
    expect(c.proven).toBeNull();
    expect(c.premiseBasis).toBe('unmeasured');
  });

  it('a measured one still can, and says on what basis', () => {
    const c = buildCapsule(g, { premiseBasis: 'measured' });
    expect(c.proven).not.toBeNull();
    expect(c.premiseBasis).toBe('measured');
  });

  it('an older capsule with no basis keeps its previous meaning', () => {
    // Retroactively invalidating every capsule already in the wild would be a different
    // dishonesty: claiming to know something about proofs we never inspected.
    const c = buildCapsule(g);
    expect(c.proven).not.toBeNull();
  });

  it('only the POSITIVE is withheld — a real NOT-PROVEN survives an unmeasured premise', () => {
    // The asymmetry, and getting it backwards is a regression in the UNSAFE direction. The
    // premise bounds the route SET; a route missing from the graph cannot rescue one that is
    // in it and exposed. So `false` needs no premise. Blanking it to `null` would turn "this
    // app has an unguarded mutation" into "we don't know" — the same lie, pointed the other
    // way. A REAL compiled fixture, not a hand-built graph: the point is that polarity really
    // is exposed, and only the compiler can make that true.
    const risky = canonicalizeGraph(
      compileUBG(path.join(here, 'fixtures', 'ubg-semantics'), { write: false }).graph,
    );
    const c = buildCapsule(risky, { premiseBasis: 'unmeasured' });
    expect(c.proven).toBe(false);
    expect(c.proven).not.toBeNull();
  });
});

describe('basisFrom: the default is what a caller who never measured receives', () => {
  it('no premise at all is "unmeasured", never "measured"', async () => {
    // The fail-safe. Every CURRENT caller hands `basisFrom` a real premise object with `basis`
    // already set, so this default is never exercised in production — which is precisely why
    // it needs a test of its own: the line exists for the caller who has not been written yet,
    // and E-106 is the proof that such a caller shows up. Forgetting to measure must fall
    // toward the weaker word.
    const { basisFrom } = await import('../src/ubg/premise.js');
    for (const absent of [undefined, null, {}, { available: false }])
      expect(basisFrom(absent)).toBe('unmeasured');
    expect(basisFrom({ available: true })).toBe('measured');
    expect(basisFrom({ available: false, basis: 'declared' })).toBe('declared');
  });
});

describe('the registry check: unreachable is not absent', () => {
  it('a 500 or a dead network is UNVERIFIED, never "the version is free"', () => {
    for (const status of [0, 403, 500, 502])
      expect(publishedCheck({ status }).state).toBe('unverified');
    expect(publishedCheck({ status: 404 }).state).toBe('ok');
  });
});

describe('the editor: a verdict never obtained is never shown as one', () => {
  it('no result, a failed run and a parsed-but-verdictless payload all read UNKNOWN', () => {
    for (const r of [null, { ok: false, reason: 'cancelled' }, { ok: true, json: {} }]) {
      const view = presentationOf(r);
      expect(view.state).toBe('UNKNOWN');
      expect(view.tone).not.toBe('ok');
    }
  });
});

describe('the shape of the rule itself', () => {
  // Not a behaviour test — a statement of the invariant, so the next person to add a
  // headline field reads it here rather than rediscovering it the way we did, five times.
  it('every UNMEASURED state above is expressible IN the headline field', () => {
    const headlines = [
      falsifyGraph({ nodes: [], edges: [] }).score,
      buildCapsule(graphWith(), { premiseBasis: 'unmeasured' }).proven,
    ];
    // `null`, not `0`, not `false`, not `1`. Zero and false are ANSWERS — "we measured, and
    // the answer is none". Only null says "there is no answer here".
    for (const h of headlines) {
      expect(h).toBeNull();
      expect(h).not.toBe(0);
      expect(h).not.toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// § reachability — the half E-106 taught us. Every row above says the field CAN hold the
// unmeasured state. These say a real call path DOES put it there.
// ---------------------------------------------------------------------------

describe('reachability: the unmeasured state is produced, not merely representable', () => {
  const fix = (n) => path.join(here, 'fixtures', n);

  it('immunize on an express app with no oracle really yields proven: null', async () => {
    // Express is PROBEABLE but the runtime oracle is opt-in (`--probe` executes the target's
    // code), so an ordinary `sparda immunize` here has measured nothing. Before E-106 this
    // returned a boolean and the command's own UNMEASURED branch was dead code.
    const { runImmunize } = await import('../src/commands/immunize.js');
    const { capsule } = await runImmunize({ cwd: fix('ubg-express'), json: true });
    expect(capsule.premiseBasis).toBe('unmeasured');
    expect(capsule.proven).toBeNull();
  });

  it('no call site anywhere builds a capsule without saying on what basis', () => {
    // The structural half, and it is a source rule ON PURPOSE: "every call site passes this
    // argument" is a wiring property, and wiring cannot be observed by running one command —
    // which is exactly why four of them stayed unwired under a green suite.
    const root = path.join(here, '..');
    const walk = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs, out);
        else if (/\.m?js$/.test(e.name)) out.push(abs);
      }
      return out;
    };
    const sites = [];
    for (const abs of [
      ...walk(path.join(root, 'src')),
      ...walk(path.join(root, 'bench')),
    ]) {
      const src = fs.readFileSync(abs, 'utf8');
      if (!/import\s*\{[^}]*buildCapsule[^}]*\}/s.test(src)) continue; // the definition itself
      for (const call of src.match(/buildCapsule\([^;]*?\)/gs) ?? [])
        sites.push({
          rel: path.relative(root, abs).split(path.sep).join('/'),
          basis: /premiseBasis/.test(call),
        });
    }
    expect(sites.filter((s) => !s.basis).map((s) => s.rel)).toEqual([]);
    // not vacuous: the four commands E-106 found bare are really being looked at
    expect([...new Set(sites.map((s) => s.rel))].sort()).toEqual([
      'src/commands/dossier.js',
      'src/commands/genome.js',
      'src/commands/immunize.js',
      'src/commands/prove.js',
    ]);
  });
});

describe('stitch: half a join finds nothing, and must not report nothing found', () => {
  const fix = (n) => path.join(here, 'fixtures', n);

  it('a service that does not compile is named, gates CI, and qualifies the result', async () => {
    // The leak: cross-service BOLA is found by JOINING two graphs. Compile one of them and
    // the join yields zero edges and zero findings — printed as "no cross-service calls
    // resolved (targets may be dynamic or unrelated)", the most reassuring sentence available
    // for "we read half your system". The compile error went to stderr and nowhere else.
    const { runStitch } = await import('../src/commands/stitch.js');
    const before = process.exitCode;
    const log = console.log;
    const out = [];
    console.log = (...a) => out.push(a.join(' '));
    try {
      const r = await runStitch({ cwd: path.join(here, '..') }, [
        fix('ubg-express'),
        fix('does-not-exist-at-all'),
      ]);
      expect(r.unread).toHaveLength(1);
      expect(process.exitCode).toBe(1); // a partial join must not read as a clean CI pass
      const text = out.join('\n');
      expect(text).toMatch(/PARTIAL JOIN/);
      expect(text).toMatch(/1 of 2 service\(s\) read/);
      // and the reassuring parenthetical is gone when the set was incomplete
      expect(text).not.toMatch(/targets may be dynamic or unrelated/);
    } finally {
      console.log = log;
      process.exitCode = before;
    }
  });
});

describe('heal: "zero protection lost" is a delta, and a delta needs two sides', () => {
  it('the gate report records whether the guard delta was measured at all', async () => {
    // `sparda heal <id> --check` can run without the diagnose phase, so `baseline.json` may
    // not exist — and then `diffGraphs` never runs and no removed guard is detectable. The
    // headline said "zero protection lost" regardless: an outcome asserted for a check that
    // did not happen. `deltaMeasured` puts the admission in the report a CI job reads.
    const src = fs.readFileSync(
      path.join(here, '..', 'src', 'commands', 'heal.js'),
      'utf8',
    );
    expect(src).toMatch(/deltaMeasured\s*=\s*fs\.existsSync\(baselinePath\)/);
    // Assert the two ARMS, not a count of the phrase anywhere in the file — a comment that
    // explains the rule would otherwise fail the rule (the `--force` lesson, again).
    const arms = src.match(/deltaMeasured\s*\?\s*`([^`]*)`\s*:\s*`([^`]*)`/s);
    expect(arms).not.toBeNull();
    expect(arms[1]).toMatch(/zero protection lost/); // measured: the strong claim
    expect(arms[2]).not.toMatch(/zero protection lost/); // unmeasured: never
    expect(arms[2]).toMatch(/unmeasured/i);
  });
});

describe('timeless: a replay that virtualized nothing is not a deterministic replay', () => {
  it('zero recorded taps cannot report "every tap consumed, zero divergence"', () => {
    // The falsify bug's exact shape, in another organ: with an empty tap set, `leftover` and
    // `divergences` are empty because there was nothing to consume and nothing to diverge
    // from. A flight recorded before `box.wrapClient(db)` was installed captures no taps, so
    // the replay hit the LIVE dependency — the match says today's environment agreed, not
    // that the code is unchanged.
    const src = fs.readFileSync(
      path.join(here, '..', 'src', 'commands', 'timeless.js'),
      'utf8',
    );
    expect(src).toMatch(/if \(!flight\.taps\.length\)/);
    expect(src).toMatch(/determinism is UNMEASURED/i);
    // the ✓ line is now guarded and counts the taps it actually consumed, so it cannot be
    // printed over an empty set
    const proud = src.match(/[^\n]*byte-identical replay[^\n]*/g) ?? [];
    expect(proud).toHaveLength(1);
    expect(proud[0]).toMatch(/flight\.taps\.length/);
  });
});

describe('the gate: abstaining is not passing (ADR-092)', () => {
  it('the ABSTAIN payload carries no `ok: true` a CI job could branch on', () => {
    // The gate is right to abstain — the agent is mid-edit, and a false alarm there is worse
    // than silence. It still exits 0. What it must not do is answer the question it did not
    // ask: `ok` is null, so a consumer reading it gets "no answer", never "fine".
    const src = fs.readFileSync(
      path.join(here, '..', 'src', 'commands', 'gate.js'),
      'utf8',
    );
    const abstain = src.match(/abstained: err\.message[^\n]*/g) ?? [];
    expect(abstain.length).toBeGreaterThan(0);
    for (const line of abstain) expect(line).not.toMatch(/ok:\s*true/);
    expect(src).toMatch(/ok: null, abstained: err\.message/);
  });
});
