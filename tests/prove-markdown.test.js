// prove-markdown.test.js — the PR-comment discovery surface (URGENT-ADOPTION J5). `prove
// --markdown` emits a sticky-comment body: the badge (inline via shields.io — the one place a
// hosted URL is right, a GH comment can't embed a repo SVG), the facts, and the findings. The
// word/colour come from badgeFor (shared with `badge` and the CLI), so the PR comment can
// never over-claim. postSticky must accept the body (it contains "SPARDA").
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProve } from '../src/commands/prove.js';
import { badgeFor, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(here, 'fixtures', name);

async function markdownOf(name) {
  const log = [];
  const spy = console.log;
  console.log = (s) => log.push(s);
  const prevExit = process.exitCode;
  try {
    await runProve({ cwd: fix(name), markdown: true });
  } finally {
    console.log = spy;
    process.exitCode = prevExit; // gate() sets exitCode; don't leak it into the runner
  }
  return log.join('\n');
}

describe('prove --markdown — the PR sticky-comment body', () => {
  it('is a valid sticky body (contains SPARDA + an inline shields badge)', async () => {
    const md = await markdownOf('ubg-medusa');
    expect(md).toContain('SPARDA');
    expect(md).toMatch(/!\[SPARDA\]\(https:\/\/img\.shields\.io\/badge\/SPARDA-/);
    expect(md).toContain('github.com/zyx77550/sparda');
  });

  it('a route with an unguarded mutation surfaces in the findings table', async () => {
    // the medusa fixture has the public cart mutation (a critical UNGUARDED_MUTATION)
    const md = await markdownOf('ubg-medusa');
    expect(md).toContain('| severity | route | finding |');
    expect(md.toLowerCase()).toContain('unguarded mutation');
  });

  it('the badge in the comment matches badgeFor (no divergence from the CLI/SVG)', async () => {
    // recompute the expected badge message independently and assert it appears verbatim
    const { compileUBG } = await import('../src/ubg/compile.js');
    const { canonicalizeGraph } = await import('../src/ubg/schema.js');
    const { checkGraph } = await import('../src/ubg/apocalypse.js');
    const { surveyBlindspots } = await import('../src/ubg/blindspots.js');
    const { graph, report } = compileUBG(fix('ubg-medusa'), { write: false });
    const c = canonicalizeGraph(graph);
    const { findings } = checkGraph(c);
    const blind = surveyBlindspots(c, report);
    const verdict = verdictOf(findings, c, { coverage: blind.coverage.ratio });
    const { message } = badgeFor(verdict, { coverage: blind.coverage.ratio });
    const md = await markdownOf('ubg-medusa');
    expect(md).toContain(encodeURIComponent(message));
  });
});
