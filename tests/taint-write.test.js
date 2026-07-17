// taint-write.test.js — taint as ENRICHMENT (ADR-P1 foothold, docs/SOUNDNESS.md).
// When request data provably flows into a write, SPARDA tags the write effect `tainted`
// and marks the resulting UNGUARDED_MUTATION `tainted: true`. It is a decoration on an
// ALREADY-emitted finding — never a finding of its own — so it sharpens the worst routes
// (open AND fed by user input) without risking a single false alarm. Under-approximated
// on purpose: a missed tag hides nothing, because the mutation still flags on its own.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-taint-write');

const compiled = (() => {
  const g = canonicalizeGraph(compileUBG(FIX, { write: false }).graph);
  const { findings } = checkGraph(g);
  const um = findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
  const byEp = (ep) => um.find((f) => f.entrypoint === `entrypoint:${ep}`);
  return { g, findings, um, byEp };
})();

describe('taint enrichment — request data flowing into an unguarded write', () => {
  it('an unguarded write of req.body is flagged AND tagged tainted', () => {
    const f = compiled.byEp('POST /open-tainted');
    expect(f).toBeTruthy();
    expect(f.tainted).toBe(true);
    expect(f.message).toMatch(/request data flows/i);
  });

  it('an unguarded write of a constant is flagged but NOT tainted (no false tag)', () => {
    const f = compiled.byEp('POST /open-literal');
    expect(f).toBeTruthy();
    expect(f.tainted).toBeUndefined();
  });

  it('taint is never a finding of its own — a guarded tainted write produces nothing', () => {
    // /secure-tainted writes req.body too, but a real guard denies, so there is no
    // UNGUARDED_MUTATION to decorate. The tag can only ever ride an existing finding.
    expect(compiled.byEp('POST /secure-tainted')).toBeUndefined();
    // the effect itself is still tagged in the graph (provenance is recorded regardless)
    const tagged = compiled.g.nodes.filter((n) => n.kind === 'effect' && n.meta.tainted);
    expect(tagged.length).toBe(2); // both /open-tainted and /secure-tainted writes
  });
});
