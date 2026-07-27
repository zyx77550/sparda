// cross-framework-verbs.test.js — the ghost verbs, on the rest of the fleet.
//
// E-067 was fixed on Express and left standing everywhere else. Measured on HEAD, in
// ten minutes: a NestJS controller with an unguarded `@All('wipe')` read
// `PROVEN · 1 route · coverage 100% · 0 blind spots`. `@All` is a real
// @nestjs/common decorator. The vocabulary was the hole, and it was the same hole in
// four lowerings.
//
// One consequence had to be handled with it: modelling OPTIONS/HEAD/TRACE means those
// verbs become entrypoints, and `mutating: method !== 'get'` would have read every CORS
// pre-flight handler as a mutation — flooding real apps with false criticals. Mutation
// is now decided by the RFC 9110 safe-method set, not by "not GET".
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-nest-all-verb');

const r = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  const blind = surveyBlindspots(c, report);
  return {
    report,
    blind,
    state: verdictState(
      verdictOf(findings, c, {
        coverage: blind.coverage.ratio,
        blindHigh: blind.byRisk.critical + blind.byRisk.high,
      }),
    ),
    graph: c,
    eps: c.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label),
    unguarded: findings
      .filter((f) => f.rule === 'UNGUARDED_MUTATION')
      .map((f) => f.entrypoint),
  };
})();

describe('NestJS — @All is every verb, not no verb', () => {
  it('expands into one route per verb a request can arrive on', () => {
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      expect(r.eps).toContain(`${verb} /posts/wipe`);
  });

  it('THE FALSE PROVEN: the unguarded endpoint now flags on every mutating verb', () => {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(r.unguarded).toContain(`entrypoint:${verb} /posts/wipe`);
    expect(r.state).toBe('NOT_PROVEN');
  });

  it('the guarded decoy stays clean — no collateral damage', () => {
    expect(r.unguarded).not.toContain('entrypoint:POST /posts/inline');
  });
});

describe('safe methods are modelled, and are not mutations', () => {
  it('@Options() becomes a route', () => {
    expect(r.eps).toContain('OPTIONS /posts/cors');
  });

  it('…and carries NO mutation obligation — a pre-flight handler is not a write', () => {
    const ep = r.graph.nodes.find((n) => n.label === 'OPTIONS /posts/cors');
    expect(ep.meta.mutating).toBe(false);
    expect(r.unguarded).not.toContain('entrypoint:OPTIONS /posts/cors');
  });
});

describe('NestJS gains the registration invariant', () => {
  it('a decorator path SPARDA cannot read is DECLARED, not silently mounted at the prefix', () => {
    const unknowns = r.report.unknownHandlers ?? [];
    expect(unknowns.length).toBe(1);
    expect(unknowns[0].via).toMatch(/^dynamic-decorator-path:/);
    expect(unknowns[0].kind).toBe('UnknownHandler');
  });

  it('…and the doubt reaches the ledger at high risk', () => {
    expect(r.blind.byRisk.critical + r.blind.byRisk.high).toBeGreaterThan(0);
  });
});

// The three other lowerings share the vocabulary bug; pin their verb sets directly so
// a future edit cannot quietly narrow them again.
describe('the fleet speaks the whole HTTP vocabulary', () => {
  const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8');

  it('Next.js route handlers accept OPTIONS and HEAD', () => {
    const m = read('src/ubg/nextjs.js').match(/const VERBS = new Set\((\[[^\]]*\])\)/);
    const verbs = eval(m[1]);
    for (const v of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])
      expect(verbs).toContain(v);
  });

  it('the OpenAPI lowering ingests options/head/trace operations', () => {
    const m = read('src/ubg/openapi.js').match(/const VERBS = new Set\(([\s\S]*?)\);/);
    const verbs = eval(m[1]);
    for (const v of ['options', 'head', 'trace']) expect(verbs).toContain(v);
  });

  it('the Python extractor knows options/head/trace', () => {
    const line = read('src/ubg/fastapi_extract.py').match(/HTTP_VERBS = \(([^)]*)\)/)[1];
    for (const v of ['options', 'head', 'trace']) expect(line).toContain(`"${v}"`);
  });
});
