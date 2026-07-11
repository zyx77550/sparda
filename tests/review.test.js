// review.test.js — the semantic PR diff (R5/M3). Two layers: the pure core
// (reviewGraphs: two graphs in, a behavior review out) and one git-integration
// test that exercises the real base-ref worktree compile end to end.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { reviewGraphs, runReview } from '../src/commands/review.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEMANTICS = path.join(here, 'fixtures', 'ubg-semantics');
const clone = (g) => JSON.parse(JSON.stringify(g));
const graphOf = (dir) => canonicalizeGraph(compileUBG(dir, { write: false }).graph);

describe('reviewGraphs (pure core)', () => {
  const base = graphOf(SEMANTICS);

  it('identical trees prove clean: no findings, no surface change', () => {
    const r = reviewGraphs(base, clone(base));
    expect(r.verdict.clean).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.endpoints.added).toEqual([]);
    expect(r.endpoints.removed).toEqual([]);
  });

  it('a removed endpoint shows in the surface diff and as a finding', () => {
    const candidate = clone(base);
    candidate.nodes = candidate.nodes.filter((n) => n.id !== 'entrypoint:GET /status');
    candidate.edges = candidate.edges.filter(
      (e) => e.from !== 'entrypoint:GET /status' && e.to !== 'entrypoint:GET /status',
    );
    const r = reviewGraphs(base, candidate);
    expect(r.endpoints.removed).toContain('entrypoint:GET /status');
    expect(r.findings.some((f) => f.rule === 'ENTRYPOINT_REMOVED')).toBe(true);
  });

  it('an added endpoint shows as new attack surface', () => {
    const candidate = clone(base);
    candidate.nodes.push({
      id: 'entrypoint:GET /new',
      kind: 'entrypoint',
      label: 'GET /new',
      loc: null,
      meta: {},
    });
    const r = reviewGraphs(base, candidate);
    expect(r.endpoints.added).toContain('entrypoint:GET /new');
  });

  it('dropping every guard is NOT PROVEN and reports GUARD_REMOVED (critical)', () => {
    const candidate = clone(base);
    const guards = new Set(
      candidate.nodes.filter((n) => n.kind === 'guard').map((n) => n.id),
    );
    candidate.nodes = candidate.nodes.filter((n) => !guards.has(n.id));
    candidate.edges = candidate.edges.filter(
      (e) => !guards.has(e.from) && !guards.has(e.to),
    );
    const r = reviewGraphs(base, candidate);
    expect(r.verdict.safe).toBe(false);
    expect(r.findings.some((f) => f.rule === 'GUARD_REMOVED')).toBe(true);
  });

  it('does not blame this diff for a risk the base already carried', () => {
    // ubg-semantics already has the unguarded DELETE bait; base == candidate ⇒
    // that pre-existing critical is NOT reported as introduced by the diff.
    const r = reviewGraphs(base, clone(base));
    expect(r.findings.some((f) => f.rule === 'UNGUARDED_MUTATION')).toBe(false);
  });
});

describe('runReview (git integration)', () => {
  const tmps = [];
  afterEach(() => {
    for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  // capture console + isolate process.exitCode (review sets it to 1 to gate CI)
  async function run(opts) {
    const original = console.log;
    const prevExit = process.exitCode;
    const lines = [];
    console.log = (...a) => lines.push(a.map(String).join(' '));
    process.exitCode = 0;
    try {
      const result = await runReview(opts);
      return { result, out: lines.join('\n'), exitCode: process.exitCode };
    } finally {
      console.log = original;
      process.exitCode = prevExit;
    }
  }

  function gitRepoFromFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-review-it-'));
    tmps.push(dir);
    fs.cpSync(SEMANTICS, dir, { recursive: true });
    const git = (...args) =>
      execFileSync('git', ['-C', dir, ...args], {
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'base');
    return { dir, git };
  }

  it('clean when the working tree matches the base ref', async () => {
    const { dir } = gitRepoFromFixture();
    const { result, exitCode } = await run({ cwd: dir, base: 'HEAD' });
    expect(result.verdict.clean).toBe(true);
    expect(exitCode).toBe(0);
  });

  it('gates (exit 1) when the working tree removes a guard vs the base ref', async () => {
    const { dir, git } = gitRepoFromFixture();
    const appPath = path.join(dir, 'src', 'app.js');
    // base commit: guard the bait DELETE route
    fs.writeFileSync(
      appPath,
      fs
        .readFileSync(appPath, 'utf8')
        .replace(
          "app.delete('/orders/:id', async",
          "app.delete('/orders/:id', requireAuth, async",
        ),
    );
    git('commit', '-aqm', 'guard the delete');
    // working tree (the "PR"): remove the guard again
    fs.writeFileSync(
      appPath,
      fs
        .readFileSync(appPath, 'utf8')
        .replace(
          "app.delete('/orders/:id', requireAuth, async",
          "app.delete('/orders/:id', async",
        ),
    );
    const { result, out, exitCode } = await run({ cwd: dir, base: 'HEAD' });
    expect(result.verdict.safe).toBe(false);
    expect(exitCode).toBe(1);
    expect(out).toContain('GUARD_REMOVED');
  });
});
