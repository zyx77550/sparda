// gate.test.js — the edit-loop gate judges the DELTA only: a regression speaks,
// pre-existing state stays silent (noise on unchanged code is fatal to an edit gate).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph } from '../src/ubg/apocalypse.js';
import { gateDelta } from '../src/commands/gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const graphOf = (fixture) =>
  canonicalizeGraph(
    compileUBG(path.join(here, 'fixtures', fixture), { write: false }).graph,
  );
const clone = (g) => JSON.parse(JSON.stringify(g));

describe('sparda gate — delta-only judgment', () => {
  const baseline = graphOf('ubg-semantics');

  it('an unchanged tree is clean, even when the app has pre-existing findings', () => {
    // ubg-semantics carries a real UNGUARDED_MUTATION — the gate must NOT repeat it
    expect(checkGraph(baseline).findings.length).toBeGreaterThan(0);
    const { findings, blocking } = gateDelta(baseline, clone(baseline));
    expect(findings).toEqual([]);
    expect(blocking).toEqual([]);
  });

  it('dropping a guard blocks with GUARD_REMOVED (critical)', () => {
    const candidate = clone(baseline);
    const guardIds = new Set(
      candidate.nodes.filter((n) => n.kind === 'guard').map((n) => n.id),
    );
    candidate.nodes = candidate.nodes.filter((n) => !guardIds.has(n.id));
    candidate.edges = candidate.edges.filter(
      (e) => !guardIds.has(e.from) && !guardIds.has(e.to),
    );
    const { blocking } = gateDelta(baseline, candidate);
    expect(blocking.some((f) => f.rule === 'GUARD_REMOVED')).toBe(true);
  });

  it('a finding the edit INTRODUCES blocks; the same finding pre-existing does not', () => {
    // baseline without the offending route = the edit "adds" an unguarded mutation
    const offender = 'entrypoint:DELETE /orders/:id';
    const before = clone(baseline);
    const reach = new Set([offender]);
    // drop the entrypoint and its private logic chain so the route truly pre-dates nothing
    before.edges.filter((e) => e.from === offender).forEach((e) => reach.add(e.to));
    before.nodes = before.nodes.filter((n) => !reach.has(n.id));
    before.edges = before.edges.filter((e) => !reach.has(e.from) && !reach.has(e.to));

    const introduced = gateDelta(before, baseline);
    expect(
      introduced.blocking.some(
        (f) => f.rule === 'UNGUARDED_MUTATION' && f.entrypoint === offender,
      ),
    ).toBe(true);

    const preExisting = gateDelta(baseline, clone(baseline));
    expect(preExisting.findings.some((f) => f.entrypoint === offender)).toBe(false);
  });

  it('medium/info regressions report but never block', () => {
    const shrunk = clone(baseline);
    const ep = shrunk.nodes.find((n) => n.id === 'entrypoint:POST /transfer');
    delete ep.meta.mutatesDomains;
    // baseline had no domains on the route; candidate (real graph) grew them
    const { findings, blocking } = gateDelta(shrunk, baseline);
    const grew = findings.find((f) => f.rule === 'BLAST_RADIUS_GREW');
    expect(grew?.severity).toBe('medium');
    expect(blocking).not.toContain(grew);
  });
});
