// mirror-stateful.test.js — the Mirror VM LIVES the declared lifecycle (R5/M2).
// The compiler infers orders.status: pending→paid→refunded from the CHECK
// constraint + the INSERT/UPDATE literals. The mirror then serves that machine:
// a create seeds 'pending', a transition route advances it, a read reflects the
// current value, and an illegal transition (pay an already-paid order) is refused
// 409. Nothing is hand-written — the mock is synchronized with the code by
// construction, which is the one thing WireMock structurally cannot be.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { createMirrorServer } from '../src/ubg/mirror.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const graphOf = (fixture) =>
  canonicalizeGraph(
    compileUBG(path.join(here, 'fixtures', fixture), { write: false }).graph,
  );

// fetch is a well-behaved keep-alive client (unlike the raw-socket helper); it
// exercises the mirror exactly as a browser or curl would.
async function serve(graph, fn) {
  const { server } = createMirrorServer(graph);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const req = async (method, p) => {
    const res = await fetch(base + p, { method });
    return { status: res.status, body: await res.json() };
  };
  try {
    return await fn(req);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('Mirror VM (stateful): the graph lives the inferred lifecycle', () => {
  const graph = graphOf('ubg-lifecycle');

  it('a create seeds the initial state and mints an id', async () => {
    await serve(graph, async (req) => {
      const created = await req('POST', '/orders');
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('pending'); // ∅→pending, from the code
      expect(created.body.id).toBeDefined();
    });
  });

  it('a read reflects the current state, and it advances through legal transitions', async () => {
    await serve(graph, async (req) => {
      const { body: created } = await req('POST', '/orders');
      const id = created.id;

      expect((await req('GET', `/orders/${id}`)).body.status).toBe('pending');

      const paid = await req('PATCH', `/orders/${id}/pay`);
      expect(paid.status).toBe(200);
      expect(paid.body.status).toBe('paid');
      expect((await req('GET', `/orders/${id}`)).body.status).toBe('paid'); // reflected

      const refunded = await req('PATCH', `/orders/${id}/refund`);
      expect(refunded.body.status).toBe('refunded');
      expect((await req('GET', `/orders/${id}`)).body.status).toBe('refunded');
    });
  });

  it('refuses an illegal transition with 409 and names the legal source state', async () => {
    await serve(graph, async (req) => {
      const { body: created } = await req('POST', '/orders');
      const id = created.id;
      await req('PATCH', `/orders/${id}/pay`); // pending → paid

      const again = await req('PATCH', `/orders/${id}/pay`); // paid ↛ paid
      expect(again.status).toBe(409);
      expect(again.body.legalFrom).toBe('pending');
      expect(again.body.from).toBe('paid');
      expect(again.body.error).toMatch(/illegal transition/);
    });
  });

  it('refuses to refund an order that was never paid (pending ↛ refunded)', async () => {
    await serve(graph, async (req) => {
      const { body: created } = await req('POST', '/orders');
      const bad = await req('PATCH', `/orders/${created.id}/refund`);
      expect(bad.status).toBe(409);
      expect(bad.body.legalFrom).toBe('paid');
    });
  });

  it('an unknown resource reads as the lifecycle initial state (lazy seed)', async () => {
    await serve(graph, async (req) => {
      const res = await req('GET', '/orders/99999');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('pending');
    });
  });

  it('state is per-resource: paying #1 does not move #2', async () => {
    await serve(graph, async (req) => {
      const a = (await req('POST', '/orders')).body.id;
      const b = (await req('POST', '/orders')).body.id;
      await req('PATCH', `/orders/${a}/pay`);
      expect((await req('GET', `/orders/${a}`)).body.status).toBe('paid');
      expect((await req('GET', `/orders/${b}`)).body.status).toBe('pending');
    });
  });
});

describe('Mirror VM (stateful): apps without a state machine stay stateless', () => {
  it('a table with no lifecycle is served as a typed placeholder, unchanged', async () => {
    // ubg-express has a users table with no status/state field → no machine.
    await serve(graphOf('ubg-express'), async (req) => {
      const res = await req('GET', '/users/42');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: '42', email: 'mirror', active: true });
    });
  });
});
