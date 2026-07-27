// limits-surface.test.js — E-065 (X3): resource caps must never abandon silently.
// The mount-depth bound and the flattenSetup depth/statement caps used to drop the
// remaining surface without a trace, quietly inflating the coverage ratio. Every
// limit now surfaces as a HIGH-risk skipped-surface entry, and the flattener
// reports its own truncation to the caller.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { compileUBG } from '../src/ubg/compile.js';
import { flattenSetup } from '../src/ubg/express.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('mount depth limit is declared, never silent (E-065)', () => {
  const FIX = path.join(here, 'fixtures', 'ubg-mount-depth');
  const { report } = compileUBG(FIX, { write: false });

  it('the router beyond the depth bound becomes a HIGH-risk skipped surface', () => {
    const hit = report.skipped.find((s) => s.reason.includes('mount depth limit'));
    expect(hit).toBeDefined();
    expect(hit.risk).toBe('high');
    expect(hit.reason).toContain('/a/b/c'); // the unexplored prefix is named
  });

  it('routes within the bound are still extracted', () => {
    expect(report.routes).toBe(2); // /a/one and /a/b/two; /a/b/c/three is the declared unknown
  });
});

describe('flattenSetup caps report their own truncation (E-065)', () => {
  it('statement cap → limit reason, stream bounded', () => {
    const src = Array.from({ length: 8100 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const body = parse(src, { sourceType: 'unambiguous' }).program.body;
    const flat = flattenSetup(body);
    expect(flat.limit).toContain('statement cap');
    expect(flat.statements.length).toBeLessThanOrEqual(8000);
  });

  it('nesting cap → limit reason', () => {
    let src = 'const app = 1;';
    for (let i = 0; i < 9; i++) src = `function f${i}() { ${src} }`;
    const body = parse(src, { sourceType: 'unambiguous' }).program.body;
    const flat = flattenSetup(body);
    expect(flat.limit).toContain('nesting deeper');
  });

  it('an unbounded setup has NO limit and full sequential order stamps', () => {
    const src = `const a = 1;\nif (x) { const b = 2; }\nconst c = 3;`;
    const body = parse(src, { sourceType: 'unambiguous' }).program.body;
    const flat = flattenSetup(body);
    expect(flat.limit).toBeNull();
    const orders = flat.statements.map((s) => flat.info.get(s).order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b)); // strictly sequential
    // the statement inside the if is conditional; the top-level ones are not
    const conds = flat.statements.map((s) => flat.info.get(s).conditional);
    expect(conds).toContain(true);
    expect(conds.filter((c) => !c).length).toBe(3); // a, the if itself, c
  });
});
