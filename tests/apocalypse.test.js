// apocalypse.test.js — the deployment prover is a PASS over the IR: it never
// parses source, only discharges obligations against the compiled graph.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, diffGraphs, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEMANTICS_FIXTURE = path.join(here, 'fixtures', 'ubg-semantics');
const EXPRESS_FIXTURE = path.join(here, 'fixtures', 'ubg-express');

const clone = (g) => JSON.parse(JSON.stringify(g));
const graphOf = (fixture) =>
  canonicalizeGraph(compileUBG(fixture, { write: false }).graph);

describe('Apocalypse: static proof obligations', () => {
  const graph = graphOf(SEMANTICS_FIXTURE);
  const { findings, obligations } = checkGraph(graph);
  const byRule = (rule) => findings.filter((f) => f.rule === rule);

  it('discharges obligations for every entrypoint', () => {
    expect(obligations).toBeGreaterThan(0);
  });

  it('O1 — catches the unguarded DELETE and nothing else', () => {
    const hits = byRule('UNGUARDED_MUTATION');
    expect(hits).toHaveLength(1);
    expect(hits[0].entrypoint).toBe('entrypoint:DELETE /orders/:id');
    expect(hits[0].severity).toBe('critical');
  });

  it('O2 — flags unvalidated writes into constrained tables, spares the validated one', () => {
    const eps = byRule('UNVALIDATED_CONSTRAINED_WRITE').map((f) => f.entrypoint);
    expect(eps).toContain('entrypoint:POST /transfer');
    expect(eps).not.toContain('entrypoint:POST /users'); // zod-validated
  });

  it('O3 — catches the non-atomic aggregate write, spares the transactional one', () => {
    const hits = byRule('NON_ATOMIC_AGGREGATE_WRITE');
    expect(hits).toHaveLength(1);
    expect(hits[0].entrypoint).toBe('entrypoint:POST /transfer');
    expect(hits[0].message).toContain('"Users"');
  });

  it('O4 — accepts /pay because the refund compensates the charge', () => {
    expect(byRule('IRREVERSIBLE_OBSERVABLE')).toHaveLength(0);
  });

  it('O5 — reports member mutations that bypass the aggregate root', () => {
    const eps = byRule('AGGREGATE_MEMBER_BYPASS').map((f) => f.entrypoint);
    expect(eps).toContain('entrypoint:DELETE /orders/:id');
    expect(eps).not.toContain('entrypoint:POST /transfer'); // touches the root too
  });

  it('verdict: not provable while a critical finding stands', () => {
    const verdict = verdictOf(findings);
    expect(verdict.safe).toBe(false);
    expect(verdict.counts.critical).toBe(1);
  });

  it('is deterministic — same graph, same findings, same order', () => {
    const again = checkGraph(graphOf(SEMANTICS_FIXTURE));
    expect(JSON.stringify(again.findings)).toBe(JSON.stringify(findings));
  });
});

describe('Apocalypse: O4 on a fixture without a compensator', () => {
  it('flags the webhook fired next to an uncompensated write', () => {
    const { findings } = checkGraph(graphOf(EXPRESS_FIXTURE));
    const hits = findings.filter((f) => f.rule === 'IRREVERSIBLE_OBSERVABLE');
    expect(hits).toHaveLength(1);
    expect(hits[0].entrypoint).toBe('entrypoint:POST /users');
    expect(hits[0].message).toContain('hooks.example.com');
  });
});

describe('Apocalypse: baseline diff obligations', () => {
  const baseline = graphOf(SEMANTICS_FIXTURE);

  it('D1 — a removed entrypoint is a breaking change', () => {
    const candidate = clone(baseline);
    candidate.nodes = candidate.nodes.filter((n) => n.id !== 'entrypoint:GET /status');
    candidate.edges = candidate.edges.filter(
      (e) => e.from !== 'entrypoint:GET /status' && e.to !== 'entrypoint:GET /status',
    );
    const { findings } = diffGraphs(baseline, candidate);
    const hit = findings.find((f) => f.rule === 'ENTRYPOINT_REMOVED');
    expect(hit?.entrypoint).toBe('entrypoint:GET /status');
  });

  it('D2 — dropping a guard from a guarded route is critical', () => {
    const candidate = clone(baseline);
    const guardIds = new Set(
      candidate.nodes.filter((n) => n.kind === 'guard').map((n) => n.id),
    );
    candidate.nodes = candidate.nodes.filter((n) => !guardIds.has(n.id));
    candidate.edges = candidate.edges.filter(
      (e) => !guardIds.has(e.from) && !guardIds.has(e.to),
    );
    const { findings } = diffGraphs(baseline, candidate);
    const hits = findings.filter((f) => f.rule === 'GUARD_REMOVED');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((f) => f.severity === 'critical')).toBe(true);
  });

  it('D3 — a grown blast radius is reported per entrypoint', () => {
    const shrunk = clone(baseline);
    const ep = shrunk.nodes.find((n) => n.id === 'entrypoint:POST /transfer');
    delete ep.meta.mutatesDomains;
    const { findings } = diffGraphs(shrunk, baseline);
    const hit = findings.find((f) => f.rule === 'BLAST_RADIUS_GREW');
    expect(hit?.entrypoint).toBe('entrypoint:POST /transfer');
    expect(hit?.evidence).toEqual(['Users']);
  });

  it('D4 — a dropped SQL invariant is caught with its exact clause', () => {
    const candidate = clone(baseline);
    const users = candidate.nodes.find((n) => n.id === 'state:sql:users');
    users.meta.invariants = users.meta.invariants.filter((i) => i.type !== 'check');
    const { findings } = diffGraphs(baseline, candidate);
    const hit = findings.find((f) => f.rule === 'INVARIANT_REMOVED');
    expect(hit?.message).toContain('CHECK (balance >= 0)');
  });

  it('identical graphs prove clean', () => {
    const { findings } = diffGraphs(baseline, clone(baseline));
    expect(findings).toEqual([]);
    expect(verdictOf(findings).clean).toBe(true);
  });
});
