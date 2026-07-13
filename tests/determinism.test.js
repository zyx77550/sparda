// determinism.test.js — the byte-identical promise for DERIVED artifacts (E-024).
// canonicalizeGraph fixed the graph's order with `cmp` (code units, locale-free).
// But the derived emitters (apocalypse findings, polarity, openapi) re-sorted with
// String.prototype.localeCompare — whose collation depends on the host ICU/locale.
// For mixed-case / punctuation-leading routes the two orders DIVERGE, so a machine
// in a different locale would emit a different byte stream. These lock the fix:
// derived output is ordered by `cmp`, never localeCompare.
import { describe, it, expect } from 'vitest';
import { checkGraph } from '../src/ubg/apocalypse.js';
import { cmp } from '../src/ubg/schema.js';

// Four routes whose code-unit order (cmp) differs from en-US collation.
const PATHS = ['/Users', '/_debug', '/admin', '/users'];

function unguardedWritesGraph(paths) {
  const nodes = [];
  const edges = [];
  for (const p of paths) {
    const ep = `entrypoint:GET ${p}`;
    const eff = `effect:db_write:f${p.replace(/\W/g, '')}:1:0`;
    const st = `state:sql:t${p.replace(/\W/g, '')}`;
    nodes.push({ id: ep, kind: 'entrypoint', label: p, loc: null, meta: {} });
    nodes.push({
      id: eff,
      kind: 'effect',
      label: 'w',
      loc: null,
      meta: { effectType: 'db_write', op: 'update' },
    });
    nodes.push({ id: st, kind: 'state', label: 't', loc: null, meta: {} });
    edges.push({ kind: 'control_flow', from: ep, to: eff, meta: { route: ep } });
    edges.push({ kind: 'mutation', from: eff, to: st, meta: {} });
  }
  return { version: 'sparda-ubg/v1.2', meta: {}, nodes, edges };
}

describe('derived-artifact ordering is locale-free (cmp, not localeCompare)', () => {
  it('the chosen routes actually expose the divergence (guards the test itself)', () => {
    const byCmp = [...PATHS].sort(cmp);
    const byLocale = [...PATHS].sort((a, b) => a.localeCompare(b, 'en-US'));
    expect(byCmp).not.toEqual(byLocale); // if this ever ties, pick nastier paths
  });

  it('polarity is ordered by code units, independent of locale collation', () => {
    const { polarity } = checkGraph(unguardedWritesGraph(PATHS));
    const order = polarity.map((p) => p.entrypoint);
    const expected = PATHS.map((p) => `entrypoint:GET ${p}`).sort(cmp);
    const localeOrder = PATHS.map((p) => `entrypoint:GET ${p}`).sort((a, b) =>
      a.localeCompare(b, 'en-US'),
    );
    expect(order).toEqual(expected);
    expect(order).not.toEqual(localeOrder); // proves the bug would have shown here
  });

  it('findings are ordered by code units too (same rule → tie-break on entrypoint)', () => {
    const { findings } = checkGraph(unguardedWritesGraph(PATHS));
    const eps = findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint);
    expect(eps).toEqual([...eps].sort(cmp));
  });
});
