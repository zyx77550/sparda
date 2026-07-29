// registration-invariant-fleet.test.js — the invariant, one framework at a time.
//
// `registration-invariant.test.js` locks the rule on Express; `no-silent-loss-fleet`
// sweeps the corpus for violations. This file is the third leg: a NAMED fixture per
// lowering, each reproducing one concrete way that lowering used to drop a real
// endpoint, and each asserting the same two things end to end —
//
//   1. the registration is DECLARED (an UnknownHandler + a HIGH-risk blind spot), and
//   2. the declaration actually reaches the gate: the app cannot read PROVEN.
//
// (2) is the part that matters. A declaration nobody grades is a log line. Every one of
// these fixtures used to produce a graph SPARDA was willing to certify while a real,
// unread, mutating endpoint sat outside it.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMedusa } from '../src/ubg/medusa.js';
import { extractStrapi } from '../src/ubg/strapi.js';
import { extractOpenAPI } from '../src/ubg/openapi.js';
import { extractNext } from '../src/ubg/nextjs.js';
import { extractFastAPI } from '../src/ubg/fastapi.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';
import { spawnSync } from 'node:child_process';

const detectedPython = (() => {
  for (const cmd of ['python3', 'python', 'py']) {
    const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
    try {
      const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 1000 });
      if (res.status === 0) return cmd;
    } catch {}
  }
  return null;
})();
const hasPython = detectedPython !== null;
const pythonCmd = detectedPython ?? 'python';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => path.join(here, 'fixtures', name);

// Every declaration must be twinned with a HIGH-risk blind spot: the UnknownHandler is
// for tooling, the risk is what the verdict reads. One without the other is decoration.
function expectDeclared(out, { via, file }) {
  const decl = out.unknownHandlers.find((u) => u.via === via);
  expect({ via, found: decl ? decl.via : out.unknownHandlers.map((u) => u.via) }).toEqual(
    { via, found: via },
  );
  expect(decl.kind).toBe('UnknownHandler');
  expect(decl.file).toBe(file);
  expect(out.skipped.some((s) => s.risk === 'high' && s.file === file)).toBe(true);
}

// The end-to-end claim: this app is not certifiable.
function verdictFor(dir, opts = {}) {
  const { graph, report } = compileUBG(dir, { write: false, ...opts });
  const canonical = canonicalizeGraph(graph);
  const { findings } = checkGraph(canonical);
  const blind = surveyBlindspots(canonical, report);
  const blindHigh = blind.byRisk.critical + blind.byRisk.high;
  return {
    blindHigh,
    state: verdictState(
      verdictOf(findings, canonical, { coverage: blind.coverage.ratio, blindHigh }),
    ),
  };
}

describe('registration invariant — Medusa', () => {
  const dir = fx('ubg-medusa-ghost');

  it('a verb export whose handler does not resolve is declared, not dropped', () => {
    const out = extractMedusa(dir, 'src/api');
    // `export const POST = handlers.createOrder` — Medusa serves POST, the body is a
    // member of an imported registry, so it never resolves. It used to `continue`.
    expectDeclared(out, {
      via: 'unresolved-route-export:post',
      file: 'src/api/admin/orders/route.ts',
    });
    // and the readable sibling is still fully modelled — declaring is not giving up
    expect(out.routes.map((r) => `${r.method} ${r.path}`)).toEqual(['get /admin/orders']);
  });

  it('the lost endpoint bars PROVEN', () => {
    const { blindHigh, state } = verdictFor(dir);
    expect(blindHigh).toBeGreaterThan(0);
    expect(state).not.toBe('PROVEN');
  });
});

describe('registration invariant — Strapi', () => {
  const dir = fx('ubg-strapi-ghost');

  it('a route table entry whose controller does not resolve is declared', () => {
    const out = extractStrapi(dir, 'src/api');
    expectDeclared(out, {
      via: 'unresolved-controller',
      file: 'src/api/order/routes/order.js',
    });
    // the ROUTE survives — the table declared it, so the URL is known even though the
    // behaviour is not. Dropping it would have hidden a public mutation entirely.
    expect(out.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'post /orders/:id/refund',
    ]);
  });

  it('the unread controller bars PROVEN', () => {
    const { blindHigh, state } = verdictFor(dir);
    expect(blindHigh).toBeGreaterThan(0);
    expect(state).not.toBe('PROVEN');
  });
});

describe('registration invariant — OpenAPI', () => {
  const dir = fx('ubg-openapi-ghost');

  it('an operation the lowering does not model is declared', () => {
    const out = extractOpenAPI(dir, 'openapi.json');
    // OpenAPI 3.2 adds QUERY as an HTTP method. The spec IS the declaration here, so a
    // path-item member this reader skips is published surface leaving no trace.
    expectDeclared(out, { via: 'unmodelled-operation:query', file: 'openapi.json' });
    expect(out.routes.map((r) => `${r.method} ${r.path}`)).toEqual(['get /reports']);
  });

  it('documentation members stay silent — summary/description/parameters are not ops', () => {
    const out = extractOpenAPI(dir, 'openapi.json');
    expect(out.unknownHandlers.map((u) => u.via)).toEqual(['unmodelled-operation:query']);
  });

  it('the unmodelled operation bars PROVEN', () => {
    const { blindHigh, state } = verdictFor(dir, { openapi: 'openapi.json' });
    expect(blindHigh).toBeGreaterThan(0);
    expect(state).not.toBe('PROVEN');
  });
});

describe('registration invariant — Next.js', () => {
  it('handlers under a segment SPARDA cannot express are declared, not skipped away', () => {
    const out = extractNext(fx('nextjs-basic'), 'app');
    // The walk stops at a catch-all / parallel slot because the URL is inexpressible.
    // The `route.js` files UNDER it are still modules exporting live handlers, and for
    // the catch-all Next really does serve them. Stopping used to lose the whole subtree
    // behind a directory-level skip with no risk — below `blindHigh`, so still PROVEN-able.
    const vias = out.unknownHandlers.map((u) => `${u.via} ${u.file}`).sort();
    expect(vias).toEqual([
      'unrouted-segment:GET app/@modal/thing/route.js',
      'unrouted-segment:GET app/api/docs/[...slug]/route.js',
    ]);
    for (const u of out.unknownHandlers)
      expect(out.skipped.some((s) => s.risk === 'high' && s.file === u.file)).toBe(true);
    // no invented URL: SPARDA does not know the path, and guessing one would misplace
    // every guard judgement about the route
    expect(out.routes.some((r) => r.path.includes('slug') || r.path.includes('@'))).toBe(
      false,
    );
  });

  it('an unparseable global middleware is declared at high risk', () => {
    const dir = fx('ubg-next-broken-middleware');
    const out = extractNext(dir, 'app');
    expectDeclared(out, { via: 'unparseable-middleware', file: 'middleware.js' });
    // the gate is gone, so the route below reads ungated — and that is the honest read
    expect(out.globalMiddlewares).toEqual([]);
    const { blindHigh, state } = verdictFor(dir);
    expect(blindHigh).toBeGreaterThan(0);
    expect(state).not.toBe('PROVEN');
  });
});

describe.skipIf(!hasPython)('registration invariant — FastAPI', () => {
  const dir = fx('ubg-fastapi-ghost');

  it('a decorator path that is not a literal is declared', () => {
    const out = extractFastAPI(dir, 'main.py', pythonCmd);
    expectDeclared(out, { via: 'dynamic-decorator-path:delete', file: 'main.py' });
    // the declaration names the HANDLER — the only stable identity a route without a
    // readable URL still has
    expect(out.unknownHandlers[0].target).toBe('wipe_orders');
    expect(out.routes.map((r) => `${r.method} ${r.path}`)).toEqual(['get /health']);
  });

  it('the unbindable DELETE bars PROVEN', () => {
    const { blindHigh, state } = verdictFor(dir);
    expect(blindHigh).toBeGreaterThan(0);
    expect(state).not.toBe('PROVEN');
  });
});
