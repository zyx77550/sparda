// mirror.test.js — the Mirror VM contract: the graph answers HTTP without the
// framework that produced it. Guards deny, shapes come out typed, unknown
// paths are discoverable. If these pass, SBIR is an executable IR — not a
// diagram format.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { createMirrorServer } from '../src/ubg/mirror.js';
import { rawRequest } from '../src/flight/replayer.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function serve(graph, fn) {
  const { server, routes } = createMirrorServer(graph);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await fn(port, routes);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// the mirror consumes the SERIALIZED artifact — exactly what ships in ubg.json
const graphOf = (fixture, opts = {}) =>
  canonicalizeGraph(
    compileUBG(path.join(here, 'fixtures', fixture), {
      write: false,
      ...opts,
    }).graph,
  );

describe('Mirror VM: a compiled Express app serves without Express', () => {
  const graph = graphOf('ubg-express');

  it('guarded entrypoints deny without credentials — gates are real', async () => {
    await serve(graph, async (port) => {
      const denied = await rawRequest({
        port,
        method: 'POST',
        path: '/users',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(denied.status).toBe(401);
      expect(JSON.parse(denied.body).guard).toContain('requireAuth');

      const allowed = await rawRequest({
        port,
        method: 'POST',
        path: '/users',
        headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
        body: '{}',
      });
      expect(allowed.status).toBe(201);
      expect(JSON.parse(allowed.body)).toEqual({ ok: true });
    });
  });

  it('responses render the compiled return schema, path params echo back', async () => {
    await serve(graph, async (port) => {
      const res = await rawRequest({ port, method: 'GET', path: '/users/42' });
      expect(res.status).toBe(200);
      expect(res.headers?.['x-sparda-mirror'] ?? 'true').toBeTruthy();
      expect(JSON.parse(res.body)).toEqual({
        id: '42', // the path param, echoed
        email: 'mirror', // string zero-value
        active: true, // boolean zero-value
      });
    });
  });

  it('unknown paths 404 with the full route table — discoverable by design', async () => {
    await serve(graph, async (port) => {
      const res = await rawRequest({ port, method: 'GET', path: '/nope' });
      expect(res.status).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.knownRoutes).toContain('GET /users/:id');
      expect(body.knownRoutes).toContain('POST /users');
    });
  });
});

describe('Mirror VM: an OpenAPI spec serves — a backend that was never written', () => {
  const graph = graphOf('ubg-openapi', { openapi: 'openapi.json' });

  it('serves typed responses from the spec alone', async () => {
    await serve(graph, async (port) => {
      const res = await rawRequest({ port, method: 'GET', path: '/orders/123' });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ id: 0, amount: 0, status: 'mirror' });
    });
  });

  it('spec-declared security gates the mirror too', async () => {
    await serve(graph, async (port) => {
      const denied = await rawRequest({
        port,
        method: 'POST',
        path: '/orders',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(denied.status).toBe(401);
      const allowed = await rawRequest({
        port,
        method: 'POST',
        path: '/orders',
        headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
        body: '{}',
      });
      expect(allowed.status).toBe(201);
    });
  });
});
