// polarity.test.js — the ternary behavior algebra (ADR-036).
// Two load-bearing claims: (1) the polarity vector and the findings are the SAME
// truth — a -1 on an axis iff a finding of that axis's rule on that entrypoint
// (no drift, because checkGraph builds both together); (2) a PR review is a
// SUBTRACTION — removing a guard shows up as a negative delta on the auth axis.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import {
  AXES,
  posture,
  polarityDelta,
  provenByPolarity,
  exposedAxes,
} from '../src/ubg/polarity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const graphOf = (fx) =>
  canonicalizeGraph(compileUBG(path.join(here, 'fixtures', fx), { write: false }).graph);

const RULE_AXIS = {
  UNGUARDED_MUTATION: 'auth',
  UNVALIDATED_CONSTRAINED_WRITE: 'validation',
  NON_ATOMIC_AGGREGATE_WRITE: 'atomicity',
  IRREVERSIBLE_OBSERVABLE: 'reversibility',
  AGGREGATE_MEMBER_BYPASS: 'aggregate',
};

// A one-entrypoint canonical graph: a write, optionally behind a guard.
function repoGraph({ guard = false, member = false } = {}) {
  const ep = 'entrypoint:POST /x';
  const eff = 'effect:db_write:a.js:1:0';
  const st = 'state:sql:t';
  const nodes = [
    {
      id: ep,
      kind: 'entrypoint',
      label: '/x',
      loc: null,
      meta: { inputValidated: true },
    },
    {
      id: eff,
      kind: 'effect',
      label: 'w',
      loc: null,
      meta: { effectType: 'db_write', op: 'update' },
    },
    {
      id: st,
      kind: 'state',
      label: 't',
      loc: null,
      meta: member ? { role: 'member', consistencyDomain: 'D', table: 't' } : {},
    },
  ];
  const edges = [
    { kind: 'control_flow', from: ep, to: eff, meta: { route: ep } },
    { kind: 'mutation', from: eff, to: st, meta: {} },
  ];
  if (guard) {
    const g = 'guard:a.js#auth:1';
    nodes.push({ id: g, kind: 'guard', label: 'auth', loc: null, meta: {} });
    edges.push({ kind: 'control_flow', from: ep, to: g, meta: { route: ep } });
  }
  return { version: 'sparda-ubg/v1.2', meta: {}, nodes, edges };
}

describe('polarity ⇄ findings — one source of truth', () => {
  for (const fx of ['ubg-express', 'ubg-semantics', 'ubg-lifecycle']) {
    it(`every finding maps to a -1 and every -1 maps to a finding (${fx})`, () => {
      const { findings, polarity } = checkGraph(graphOf(fx));
      const byEp = new Map(polarity.map((p) => [p.entrypoint, p.vector]));

      // every finding → a -1 on its axis
      for (const f of findings) {
        const axis = RULE_AXIS[f.rule];
        if (!axis) continue;
        expect(byEp.get(f.entrypoint)?.[axis]).toBe(-1);
      }
      // every -1 → at least one finding of that axis on that entrypoint
      const findingAxes = new Set(
        findings.map((f) => `${f.entrypoint}|${RULE_AXIS[f.rule]}`),
      );
      for (const p of polarity)
        for (const axis of exposedAxes(p.vector))
          expect(findingAxes.has(`${p.entrypoint}|${axis}`)).toBe(true);
    });
  }
});

describe('review as subtraction — a removed guard is a negative delta', () => {
  it('base guarded (auth +1) → candidate unguarded (auth -1): delta -2, regressed [auth]', () => {
    const base = checkGraph(canonicalizeGraph(repoGraph({ guard: true }))).polarity;
    const cand = checkGraph(canonicalizeGraph(repoGraph({ guard: false }))).polarity;
    const delta = polarityDelta(base, cand);
    expect(delta).toHaveLength(1);
    expect(delta[0].deltas.auth).toBe(-2);
    expect(delta[0].regressed).toContain('auth');
  });

  it('identical graphs → no delta', () => {
    const g = checkGraph(canonicalizeGraph(repoGraph({ guard: true }))).polarity;
    expect(polarityDelta(g, g)).toEqual([]);
  });

  it('adding a guard is a POSITIVE delta, not a regression', () => {
    const base = checkGraph(canonicalizeGraph(repoGraph({ guard: false }))).polarity;
    const cand = checkGraph(canonicalizeGraph(repoGraph({ guard: true }))).polarity;
    const delta = polarityDelta(base, cand);
    expect(delta[0].deltas.auth).toBe(2);
    expect(delta[0].regressed).toEqual([]);
  });
});

describe('posture — the app exposure profile (column sums)', () => {
  it('counts protected / exposed / na per axis', () => {
    const { polarity } = checkGraph(
      canonicalizeGraph(repoGraph({ guard: false, member: true })),
    );
    const cols = posture(polarity);
    expect(cols.auth.exposed).toBe(1); // unguarded write
    expect(cols.aggregate.exposed).toBe(1); // member bypass
    for (const a of AXES) {
      const c = cols[a];
      expect(c.protected + c.exposed + c.na).toBe(polarity.length);
    }
  });
});

describe('provenByPolarity — the arithmetic verdict', () => {
  it('a gating -1 (auth) means NOT PROVEN', () => {
    const { polarity } = checkGraph(canonicalizeGraph(repoGraph({ guard: false })));
    expect(provenByPolarity(polarity)).toBe(false);
  });

  it('guarded + validated write is PROVEN', () => {
    const { polarity } = checkGraph(canonicalizeGraph(repoGraph({ guard: true })));
    expect(provenByPolarity(polarity)).toBe(true);
  });

  it('polarity is deterministic (byte-stable) across runs', () => {
    const g = graphOf('ubg-semantics');
    expect(JSON.stringify(checkGraph(g).polarity)).toBe(
      JSON.stringify(checkGraph(g).polarity),
    );
  });
});
