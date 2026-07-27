// premise-wired-everywhere.test.js — the premise check reaches EVERY gate, not one.
//
// The verifier (ADR-081/082) shipped wired into `prove` alone. That is worse than not
// shipping it: `apocalypse` — the command whose exit code decides whether a tree deploys
// — could still exit 0 over an app whose route table nobody had checked, and `badge`
// could still put a green artifact in a public README. The organ existed, the guarantee
// sounded universal, and six of the seven consumers did not have it.
//
// Two kinds of test here, and the first matters more than the rest:
//
//   1. a STRUCTURAL guard that fails when a NEW verdict-emitting consumer forgets the
//      premise. Pinning today's commands would only re-prove the fix; pinning the RULE is
//      what stops the next consumer from repeating it.
//   2. end-to-end assertions per consumer, on a fixture that really has a gap.
//
// REVISED (ADR-083 cont.): the structural guard used to scan `src/commands/` only, because
// the audit that produced it counted "seven commands". The corpus oracle was known to be
// outside it; widening the scan found two MORE unwired graders nobody had counted — the MCP
// tool `sparda_prove` (src/server/) and the route-proof bench (bench/). A rule that only
// looks where the last bug was found is the same failure it was written to prevent.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runApocalypse } from '../src/commands/apocalypse.js';
import { runBadge } from '../src/commands/badge.js';
import { runDossier } from '../src/commands/dossier.js';
import { proveApp } from '../src/server/stdio.js';
import { badgeFor, verdictState } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (n) => path.join(here, 'fixtures', n);
const GAP = fix('ubg-next-premise-gap'); // Pages Router surface, absent from the graph
const CLEAN = fix('ubg-guard-dominance'); // ordinary Next app, no gap

const quiet = async (fn) => {
  const log = console.log;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  try {
    return { result: await fn(), out };
  } finally {
    console.log = log;
  }
};

// ---------------------------------------------------------------------------
// 1 — the structural rule
// ---------------------------------------------------------------------------

describe('every verdict-emitting consumer asks for the premise', () => {
  // THE SCAN IS REPO-WIDE, and that is the whole point of this revision. The first version
  // of this rule read `src/commands/` only, because the audit that produced it counted
  // "seven commands". Three consumers grade a graph and state a verdict word from OUTSIDE
  // that directory, and all three were unwired for exactly as long as the rule could not
  // see them: `src/server/stdio.js` (the MCP tool an editing agent calls — the consumer
  // that acts on the word without reading the code), `scripts/corpus-oracle.mjs` (the only
  // place SPARDA states a verdict over code it did not write), and `bench/repro.mjs`
  // (which writes a verdict into a committed evidence file the README points at). A rule
  // scoped to one directory is the same mistake as a guarantee scoped to one command.
  const ROOTS = ['src', 'scripts', 'bench', 'tools'];

  // Exemptions, each with a reason — and each MACHINE-CHECKED below, so an exemption can
  // never become a place to hide a real verdict.
  //
  //   DELTA    the verdict is about a CHANGE, not about the app. `enforce` compares the
  //            finding set before and after synthesizing a guard; `heal` compares findings
  //            across a replay. Feeding a premise gap into either would make them refuse to
  //            act on any app that has one, which is precisely backwards.
  //   NO_WORD  it calls verdictOf for its counts or its timing and never states a verdict
  //            word about an app. `scale-run` is a stopwatch; `tools/corpus/run.mjs` is a
  //            counts scoreboard. The exemption holds only while that stays true.
  const EXEMPT = new Map([
    ['src/commands/enforce.js', 'DELTA'],
    ['src/commands/heal.js', 'DELTA'],
    ['bench/scale-run.mjs', 'NO_WORD'],
    ['tools/corpus/run.mjs', 'NO_WORD'],
  ]);

  const files = (dir, out = []) => {
    for (const e of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) files(abs, out);
      else if (/\.m?js$/.test(e.name)) out.push(abs);
    }
    return out;
  };

  const root = path.join(here, '..');
  const graders = ROOTS.flatMap((r) => files(path.join(root, r)))
    .map((abs) => ({
      rel: path.relative(root, abs).split(path.sep).join('/'),
      src: fs.readFileSync(abs, 'utf8'),
    }))
    // "grades a compiled graph" = it IMPORTS the grader and calls it. Keyed on the import
    // so that `apocalypse.js`, which defines `verdictOf`/`badgeFor`, is not mistaken for a
    // consumer of itself — and so that any future module that defines a grader is excluded
    // for a reason, instead of by name.
    .filter(
      (f) =>
        /import\s*\{[^}]*(verdictOf|badgeFor)[^}]*\}\s*from\s*['"][^'"]*apocalypse\.js['"]/s.test(
          f.src,
        ) && /verdictOf\(|badgeFor\(/.test(f.src),
    );

  it('nothing anywhere grades a compiled graph without premiseFor()', () => {
    const offenders = graders
      .filter((f) => !EXEMPT.has(f.rel) && !/premiseFor\(/.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('a NO_WORD exemption really states no verdict word', () => {
    // The self-policing half. `verdictState`/`badgeFor` are the two functions that turn a
    // graded graph into a claim a human or an agent reads; a module exempted for stating
    // none may not quietly start stating one.
    const liars = graders
      .filter((f) => EXEMPT.get(f.rel) === 'NO_WORD')
      .filter((f) => /verdictState\(|badgeFor\(/.test(f.src))
      .map((f) => f.rel);
    expect(liars).toEqual([]);
  });

  it('the guard is not vacuous — it really is looking at every consumer', () => {
    // if the detection above ever stops matching, `offenders` is empty for the wrong
    // reason and the rule silently stops being enforced
    expect(graders.map((f) => f.rel).sort()).toEqual([
      'bench/repro.mjs',
      'bench/scale-run.mjs',
      'scripts/corpus-oracle.mjs',
      'src/commands/apocalypse.js',
      'src/commands/badge.js',
      'src/commands/dossier.js',
      'src/commands/enforce.js',
      'src/commands/heal.js',
      'src/commands/prove.js',
      'src/commands/review.js',
      'src/server/stdio.js',
      'tools/corpus/run.mjs',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2 — end to end, per gate
// ---------------------------------------------------------------------------

describe('the CI gate refuses to certify an unverified premise', () => {
  it('apocalypse reports PREMISE_GAP and exits non-zero', async () => {
    const before = process.exitCode;
    try {
      const { result, out } = await quiet(() => runApocalypse({ cwd: GAP }));
      expect(verdictState(result.verdict)).toBe('PREMISE_GAP');
      expect(process.exitCode).toBe(1); // ← the whole point: the tree does not ship
      expect(out.join('\n')).toMatch(/PREMISE NOT VERIFIED/);
      // the missing route is NAMED, not just counted
      expect(out.join('\n')).toMatch(/GET \/api\/legacy\/purge/);
      expect(result.premise.gaps).toHaveLength(1);
    } finally {
      process.exitCode = before;
    }
  });

  it('and stays quiet on a healthy app of the same framework', async () => {
    const before = process.exitCode;
    try {
      const { result } = await quiet(() => runApocalypse({ cwd: CLEAN }));
      expect(result.premise.available).toBe(true);
      expect(result.premise.gaps).toEqual([]);
      expect(verdictState(result.verdict)).not.toBe('PREMISE_GAP');
    } finally {
      process.exitCode = before;
    }
  });
});

describe('the public artifacts cannot carry a green claim over a gap', () => {
  it('the badge says "premise not verified", never a finding count', async () => {
    const { result } = await quiet(() =>
      runBadge({ cwd: GAP, out: path.join(GAP, '.sparda', 'badge.svg') }),
    );
    expect(result.data.verdict).toBe('PREMISE_GAP');
    fs.rmSync(path.join(GAP, '.sparda'), { recursive: true, force: true });
  });

  it('badgeFor never renders a PREMISE_GAP as "0 findings"', () => {
    // The bug this pins: PREMISE_GAP had no branch in badgeFor, so it fell through to
    // `${critical + high} findings` — a badge reading "0 findings" on an app whose
    // surface we demonstrably did not have. The most misleading string in the product.
    const verdict = {
      provable: true,
      premiseUnverified: true,
      clean: true,
      partial: false,
      safe: false,
      surfaceOnly: false,
      counts: { critical: 0, high: 0, medium: 0, info: 0 },
    };
    const { state, message } = badgeFor(verdict, { coverage: 0.67 });
    expect(state).toBe('PREMISE_GAP');
    expect(message).toBe('premise not verified');
    expect(message).not.toMatch(/findings/);
  });

  it('the dossier — the public HTML report — states PREMISE_GAP', async () => {
    const { result } = await quiet(() => runDossier({ cwd: GAP, json: true }));
    expect(result.data.state).toBe('PREMISE_GAP');
    expect(result.data.proven).toBe(false);
  });
});

describe('the MCP tool tells the editing agent the same truth as the CLI', () => {
  // `sparda_prove` is the consumer that acts on the verdict word WITHOUT reading the code:
  // an agent asks, gets a word, and commits. It lives in src/server/, so the first version
  // of the structural rule above — which read src/commands/ only — could not see it, and it
  // graded graphs with no premise check for exactly as long.
  it('sparda_prove reports PREMISE_GAP over an app with unseen routes', async () => {
    const r = await proveApp(GAP);
    expect(r.verdict).toBe('PREMISE_GAP');
  });

  it('and never invents one on a healthy app of the same framework', async () => {
    const r = await proveApp(CLEAN);
    expect(r.verdict).not.toBe('PREMISE_GAP');
  });
});

// ---------------------------------------------------------------------------
// 3 — the second hole found while wiring: `review` graded the GRAPH, never the REPORT
// ---------------------------------------------------------------------------

describe('review grades the skipped surface, not only the graph', async () => {
  const { reviewGraphs } = await import('../src/commands/review.js');
  const { compileUBG } = await import('../src/ubg/compile.js');
  const { canonicalizeGraph } = await import('../src/ubg/schema.js');

  it('a premise gap on the candidate reaches the PR verdict', () => {
    const compiled = compileUBG(GAP, { write: false });
    const canonical = canonicalizeGraph(compiled.graph);
    const premise = {
      available: true,
      oracle: 'convention',
      probed: 3,
      gaps: [{ method: 'GET', path: '/api/legacy/purge' }],
    };
    const withGap = reviewGraphs(canonical, canonical, compiled.report, premise);
    expect(verdictState(withGap.verdict)).toBe('PREMISE_GAP');
    expect(withGap.verdict.safe).toBe(false); // review gates CI on this

    // and without the report plumbed through — the old call shape — the same PR read
    // clean, which is the regression this pins
    const graphOnly = reviewGraphs(canonical, canonical);
    expect(verdictState(graphOnly.verdict)).not.toBe('PREMISE_GAP');
  });

  it('the candidate report carries declared surface into the review verdict', () => {
    // `ubg-next-broken-middleware`: the app's only global gate does not parse. Reviewing
    // the graph alone made that invisible — the PR read exactly like one that changed
    // nothing.
    const dir = fix('ubg-next-broken-middleware');
    const compiled = compileUBG(dir, { write: false });
    const canonical = canonicalizeGraph(compiled.graph);
    const withReport = reviewGraphs(canonical, canonical, compiled.report, null);
    const graphOnly = reviewGraphs(canonical, canonical);
    // the fixture really does declare a high-risk hole — otherwise this proves nothing
    expect(compiled.report.skipped.filter((sk) => sk.risk === 'high')).not.toHaveLength(
      0,
    );
    // and reading the report must move the coverage the reviewer sees: the declared
    // surface enters the denominator, which graph-only review never did
    expect(withReport.coverage.now).toBeLessThan(graphOnly.coverage.now);
  });
});
