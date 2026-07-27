// dynamic-effects.test.js — the dynamic spellings of a database write.
//
// Each of these produced NO effect at all, so the route around it looked like a
// harmless no-op and the app could reach PROVEN over an unguarded mass delete:
//   prisma?.note?.deleteMany({})            optional member  → whole call dropped
//   prisma.note.deleteMany?.({})            optional call    → whole call dropped
//   prisma.$executeRaw`DELETE FROM …`       tagged template  → not a CallExpression
//   (cond ? a : b).deleteMany({})           unnameable root  → no receiver to match
//   app?.post(…) / app.post?.(…)            the REGISTRATION itself vanished
//
// Optional chaining is modelled (it is the same call whenever the handle exists — a
// known semantics, so declaring an unknown would have been a cop-out); the unnameable
// receiver is treated as an opaque write, provenance-gated so a non-database object
// fabricates nothing.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-dynamic-effects');

const r = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  const blind = surveyBlindspots(c, report);
  const verdict = verdictOf(findings, c, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
  });
  return {
    state: verdictState(verdict),
    graph: c,
    eps: c.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label),
    unguarded: findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint),
  };
})();

describe('dynamic effect spellings are still writes', () => {
  it('optional member on the handle — prisma?.note?.deleteMany()', () => {
    expect(r.unguarded).toContain('entrypoint:POST /a');
  });

  it('optional call on the method — prisma.note.deleteMany?.()', () => {
    expect(r.unguarded).toContain('entrypoint:POST /b');
  });

  it('tagged template raw SQL — prisma.$executeRaw`DELETE FROM …`', () => {
    expect(r.unguarded).toContain('entrypoint:POST /c');
  });

  it('a receiver with no nameable root — (cond ? a : b).deleteMany()', () => {
    expect(r.unguarded).toContain('entrypoint:POST /d');
  });

  it('the CALLEE itself unnameable — (cond ? db.wipe : db.nuke)()', () => {
    expect(r.unguarded).toContain('entrypoint:POST /g');
  });
});

describe('optional chaining on the app object still registers the route', () => {
  it('app?.post(…) and app.post?.(…) both enter the graph', () => {
    expect(r.eps).toContain('POST /e');
    expect(r.eps).toContain('POST /f');
    expect(r.unguarded).toContain('entrypoint:POST /e');
    expect(r.unguarded).toContain('entrypoint:POST /f');
  });
});

describe('provenance still gates — no fabricated writes', () => {
  it('a computed call on a NON-database object produces nothing', () => {
    expect(r.unguarded).not.toContain('entrypoint:GET /harmless');
    // exactly one write per POST route (a…g) and not one more: `helpers?.[KEY]?.()`
    // is a computed call on a plain object, so provenance must keep it silent
    const writes = r.graph.nodes.filter(
      (n) => n.kind === 'effect' && n.meta?.effectType === 'db_write',
    );
    expect(writes.length).toBe(7);
  });

  it('the corpus reads NOT_PROVEN — every hidden write is now visible', () => {
    expect(r.state).toBe('NOT_PROVEN');
  });
});
