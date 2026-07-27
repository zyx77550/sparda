// falsify.test.js — Popper, compiled (ADR-077). The silent failure mode of every sound
// checker is the VACUOUS proof: a green that would still be green if the protection it names
// vanished (E-022/E-025/E-026 were exactly this class). `falsifyGraph` ablates every guard in
// memory — CONTRACTION, never deletion, so the handler stays reachable and "unreachable"
// can't masquerade as "clean" — and demands O1 re-fire on each route whose green depended on
// protection. These tests are also the PERMANENT negative control for O1's sensitivity: any
// future refactor that silently stops UNGUARDED_MUTATION from firing when guards vanish
// makes the healthy-fixture scores drop below 1 and bites here.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, indexGraph, reachOf } from '../src/ubg/apocalypse.js';
import {
  ablateGuards,
  protectedMutationRoutes,
  falsifyGraph,
} from '../src/ubg/falsify.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const graphOf = (fx) =>
  canonicalizeGraph(compileUBG(path.join(here, 'fixtures', fx), { write: false }).graph);

describe('falsifyGraph — the proof must be sensitive to its premises', () => {
  it('healthy apps are 100% falsifiable: every protected mutation route flips', () => {
    for (const fx of ['ubg-proven', 'ubg-typelock-verified', 'ubg-express']) {
      const r = falsifyGraph(graphOf(fx));
      expect(r.controls.length, fx).toBeGreaterThan(0);
      expect(r.holes, fx).toEqual([]);
      expect(r.score, fx).toBe(1);
    }
  });

  it('an app with no protected mutation routes has nothing to falsify (vacuously 1)', () => {
    const r = falsifyGraph(graphOf('ubg-bola-witness')); // guarded READS only
    expect(r.controls).toEqual([]);
    expect(r.score).toBe(1);
    expect(r.note).toMatch(/nothing to falsify/);
  });

  it('EXPOSES a blind checker: findings insensitive to the ablation → every control is a hole', () => {
    const graph = graphOf('ubg-proven');
    // a checker whose output never changes (what a vacuous-proof bug looks like from outside)
    const frozen = checkGraph(graph);
    const r = falsifyGraph(graph, { check: () => frozen });
    expect(r.holes.length).toBe(r.controls.length);
    expect(r.score).toBe(0);
  });

  it('unfolds a flood-collapsed UNGUARDED_MUTATION row (per-route attribution survives)', () => {
    const graph = graphOf('ubg-proven');
    const [target] = protectedMutationRoutes(graph);
    // real world: clean; ablated world: the pervasive codebase-wide row carries the route in
    // `evidence` — exactly what checkGraph emits when ablation makes UNGUARDED pervasive
    const check = (g) =>
      g.nodes.some((n) => n.kind === 'guard')
        ? { findings: [] }
        : {
            findings: [
              {
                rule: 'UNGUARDED_MUTATION',
                severity: 'critical',
                entrypoint: '(codebase-wide)',
                evidence: [target.id],
              },
            ],
          };
    const r = falsifyGraph(graph, { check });
    expect(r.controls.find((c) => c.route === target.label)?.flipped).toBe(true);
  });
});

describe('ablateGuards — contraction, not deletion', () => {
  it('removes every guard while keeping the route’s effects reachable', () => {
    const graph = graphOf('ubg-typelock-verified'); // ep → guard → handler → effect
    const ablated = ablateGuards(graph);
    expect(ablated.nodes.some((n) => n.kind === 'guard')).toBe(false);
    const g = indexGraph(ablated);
    const ep = g.entrypoints[0];
    const reached = [...reachOf(ep.id, g.cfOut)].map((id) => g.nodes.get(id));
    // the guard sat mid-chain: naive deletion would strand the handler and its writes
    expect(reached.some((n) => n?.kind === 'effect')).toBe(true);
  });

  it('is pure — the input graph is untouched', () => {
    const graph = graphOf('ubg-typelock-verified');
    const nodesBefore = graph.nodes.length;
    const edgesBefore = graph.edges.length;
    ablateGuards(graph);
    expect(graph.nodes.length).toBe(nodesBefore);
    expect(graph.edges.length).toBe(edgesBefore);
    expect(graph.nodes.some((n) => n.kind === 'guard')).toBe(true);
  });
});
