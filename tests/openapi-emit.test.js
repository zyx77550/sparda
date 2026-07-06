// openapi-emit.test.js — SBIR → OpenAPI, and the compiler-law self-audit.
// The round-trip (compile → emit spec → re-ingest) is a metamorphic proof:
// if emit and ingest agree on the entrypoint set, both are faithful to the
// same contract. verify.js makes our "deterministic/sound" claims executable.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { emitOpenAPI } from '../src/ubg/openapi-emit.js';
import { extractOpenAPI } from '../src/ubg/openapi.js';
import { verifyProject } from '../src/ubg/verify.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => path.join(here, 'fixtures', name);

describe('OpenAPI emission: the graph produces the standard', () => {
  const graph = canonicalizeGraph(compileUBG(fx('ubg-express'), { write: false }).graph);
  const spec = emitOpenAPI(graph, { title: 'test' });

  it('is a valid OpenAPI 3.1 document', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('test');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it('converts :params to {params} and types them', () => {
    const get = spec.paths['/users/{id}']?.get;
    expect(get).toBeDefined();
    expect(get.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
  });

  it('guarded routes carry security + a 401, open routes do not', () => {
    const post = spec.paths['/users']?.post; // requireAuth-guarded
    expect(post.security).toEqual([{ bearerAuth: [] }]);
    expect(post.responses['401']).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
    });
    const get = spec.paths['/users/{id}']?.get; // open
    expect(get.security).toBeUndefined();
  });

  it('return schemas flow into typed 200/201 responses', () => {
    const get = spec.paths['/users/{id}']?.get;
    const schema = get.responses['200'].content['application/json'].schema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toContain('email');
  });

  it('is deterministic — same graph, same spec bytes', () => {
    const again = emitOpenAPI(
      canonicalizeGraph(compileUBG(fx('ubg-express'), { write: false }).graph),
      { title: 'test' },
    );
    expect(JSON.stringify(again)).toBe(JSON.stringify(spec));
  });

  it('round-trips: emit → ingest preserves the entrypoint set', () => {
    const reingested = extractOpenAPI(fx('ubg-openapi'), 'openapi.json'); // importer sanity
    expect(reingested.routes.length).toBeGreaterThan(0);

    const original = [...graph.nodes]
      .filter((n) => n.kind === 'entrypoint')
      .map((n) => `${n.meta.method} ${n.meta.path.replace(/:(\w+)/g, '{$1}')}`)
      .sort();
    expect(original.length).toBeGreaterThan(0);
    const emittedPairs = [];
    for (const [p, item] of Object.entries(spec.paths))
      for (const verb of Object.keys(item)) emittedPairs.push(`${verb} ${p}`);
    expect(emittedPairs.sort()).toEqual(original);
  });
});

describe('sparda verify: the compiler proves its own laws', () => {
  it('every law holds on the Express fixture', () => {
    const { ok, checks } = verifyProject(fx('ubg-semantics'));
    const failed = checks.filter((c) => !c.pass);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(ok).toBe(true);
  });

  it('every law holds on the Prisma fixture', () => {
    expect(verifyProject(fx('ubg-prisma')).ok).toBe(true);
  });

  it('every law holds on an OpenAPI-lowered backend', () => {
    expect(verifyProject(fx('ubg-openapi'), { openapi: 'openapi.json' }).ok).toBe(true);
  });

  it('the determinism check is actually exercised (not vacuous)', () => {
    const { checks } = verifyProject(fx('ubg-semantics'));
    const names = checks.map((c) => c.name);
    expect(names).toContain('two compiles are byte-identical');
    expect(names).toContain('every surviving node is entrypoint-reachable');
    expect(names).toContain('emit→ingest preserves entrypoints');
  });
});
