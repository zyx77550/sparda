// taint-flow.test.js — the value-flow pass follows request data through the common shapes, and
// O2 (UNVALIDATED_CONSTRAINED_WRITE) becomes proof-grade when the flow is proven (ADR-064,
// Attack-Plan Task 2). Before this, taint only saw a DIRECT request member at the write site
// (`data: { title: req.body.title }`) — it missed object DESTRUCTURING (`const { title } =
// req.body`), which is how real handlers actually read the body, so the flagship "request data
// flows straight into the write" evidence never fired on the dominant idiom. Now taint follows
// destructuring and identifier aliases, and O2 names the proven source→sink. Locks:
//   1. destructured request data taints the write,
//   2. an identifier alias of the body taints the write,
//   3. O2 on a proven tainted flow is proof-grade (`tainted: true`),
//   4. O2 on a server-controlled constrained write STILL fires, but NOT proof-grade
//      (soundness: taint under-approximates, so a missing flow never drops the finding).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-taint-flow');

const compiled = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  return { graph: c, findings: checkGraph(c).findings };
})();

const o2For = (frag) =>
  compiled.findings.filter(
    (f) => f.rule === 'UNVALIDATED_CONSTRAINED_WRITE' && f.entrypoint.includes(frag),
  );

describe('value-flow taint + proof-grade O2', () => {
  it('taints a write fed by DESTRUCTURED request data', () => {
    // the /retitle update — request title reaches the column via `const { title } = req.body`
    const w = compiled.graph.nodes.find(
      (n) =>
        n.kind === 'effect' &&
        n.meta.effectType === 'db_write' &&
        n.meta.table === 'posts' &&
        n.meta.tainted === true,
    );
    expect(w).toBeTruthy();
  });

  it('O2 on the destructured flow is PROOF-GRADE (tainted, names the source→sink)', () => {
    const f = o2For('retitle');
    expect(f).toHaveLength(1);
    expect(f[0].tainted).toBe(true);
    expect(f[0].message).toMatch(/request data flow/i);
  });

  it('O2 on the identifier-aliased body flow is PROOF-GRADE', () => {
    const f = o2For('replace');
    expect(f).toHaveLength(1);
    expect(f[0].tainted).toBe(true);
  });

  it('O2 on a server-controlled constrained write STILL fires but is NOT proof-grade', () => {
    const f = o2For('publish');
    expect(f).toHaveLength(1);
    expect(f[0].tainted).not.toBe(true);
  });

  it('INTERPROCEDURAL: taint follows a request arg across a helper-call boundary (ADR-066)', () => {
    // /via-helper destructures req.body.title, passes it to applyTitle(id, title), whose body
    // does the constrained write — the taint must cross the call so O2 stays proof-grade.
    const f = o2For('via-helper');
    expect(f).toHaveLength(1);
    expect(f[0].tainted).toBe(true);
  });
});
