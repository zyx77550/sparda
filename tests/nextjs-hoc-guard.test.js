// nextjs-hoc-guard.test.js — Next.js authenticates through a HOC auth wrapper far more
// often than an inline guard: `export const POST = withWorkspace(handler)`. The wrapper
// IS the guard. SPARDA used to unwrap it for the handler body but discard the wrapper,
// so every HOC-gated mutation read as a false UNGUARDED_MUTATION (dub: 89 of them). Now
// the wrapper is resolved and, when it PROVABLY denies (401/403, an auth exception, or a
// `{ code: "unauthorized" }` error shape — deep-scanned into the returned inner fn), it
// becomes a VERIFIED guard. A wrapper we cannot prove to deny is left out, so a genuinely
// open mutation still flags — the recognition suppresses false positives, never real ones.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nextjs-hoc-guard');

const compiled = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, findings };
})();

describe('Next.js HOC auth wrappers recognised as verified guards', () => {
  it('the wrapper becomes a VERIFIED guard — it provably denies', () => {
    const g = compiled.graph.nodes.find(
      (n) => n.kind === 'guard' && n.label === 'withWorkspace',
    );
    expect(g).toBeTruthy();
    expect(g.meta.verified).toBe(true);
  });

  it('the HOC-gated mutation is NOT a false UNGUARDED_MUTATION', () => {
    const unguarded = compiled.findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).not.toContain('entrypoint:POST /api/workspaces');
  });

  it('a genuinely open mutation still flags — no false negative', () => {
    const unguarded = compiled.findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).toContain('entrypoint:POST /api/open');
  });

  it('an in-body verifier (bare call that provably denies) counts as a guard', () => {
    // POST /api/cron gates itself with `verifySignature(req)` — no wrapper, deny one
    // hop away through a bare imported call. Recognised, so no false UNGUARDED_MUTATION.
    const unguarded = compiled.findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).not.toContain('entrypoint:POST /api/cron');
  });

  it('a verb alias (PUT = POST) carries the wrapper guard through', () => {
    const unguarded = compiled.findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(unguarded).not.toContain('entrypoint:PUT /api/workspaces');
  });
});
