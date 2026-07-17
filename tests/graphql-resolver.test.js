// graphql-resolver.test.js — GraphQL resolvers as first-class entrypoints (Vague 2).
// twenty and countless Nest apps are GraphQL-first: the behavior lives in @Resolver
// classes with @Query/@Mutation methods, wired by the SAME constructor DI as controllers.
// The extractor now reads them onto the graph's verbs — @Query = read (get), @Mutation =
// state change (post) — so every downstream pass (guard proof, blast radius, coverage)
// works unchanged. This locks: op recognition, verb mapping, the graphql/ namespace,
// guards on a mutation, DI effect resolution, and the unguarded-mutation finding.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf } from '../src/ubg/apocalypse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-graphql-resolver');

const compiled = (() => {
  const { graph, report } = compileUBG(FIX, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  return { graph: c, report, findings, verdict: verdictOf(findings, c) };
})();

const eps = () =>
  compiled.graph.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.label);

describe('GraphQL resolver extraction', () => {
  it('maps @Query to a read and @Mutation to a state change, namespaced under graphql/', () => {
    const labels = eps();
    expect(labels).toContain('GET /graphql/users'); // @Query(name:'users')
    expect(labels).toContain('POST /graphql/createUser'); // @Mutation → post
    expect(labels).toContain('POST /graphql/deleteAllUsers');
  });

  it('resolves the resolver method effect through constructor DI to the service', () => {
    const writes = compiled.graph.nodes.filter(
      (n) =>
        n.kind === 'effect' &&
        n.meta.effectType === 'db_write' &&
        n.meta.table === 'users',
    );
    // both mutations delegate to userService.create → db('users').insert
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const reads = compiled.graph.nodes.filter(
      (n) =>
        n.kind === 'effect' &&
        n.meta.effectType === 'db_read' &&
        n.meta.table === 'users',
    );
    expect(reads.length).toBeGreaterThanOrEqual(1); // the users query
  });

  it('flags the UNGUARDED mutation, not the @UseGuards-protected one', () => {
    const unguarded = compiled.findings.filter((f) => f.rule === 'UNGUARDED_MUTATION');
    const eps = unguarded.map((f) => f.entrypoint);
    expect(eps).toContain('entrypoint:POST /graphql/deleteAllUsers');
    expect(eps).not.toContain('entrypoint:POST /graphql/createUser');
  });
});
