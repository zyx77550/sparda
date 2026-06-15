// tests/probe.test.js — Brief #3, opt-in dynamic route discovery.
//
// SPARDA's static AST scan is the FLOOR: it only records a route when the path is
// a literal string. Routes whose path is a variable, built in a loop, or registered
// by a helper are invisible to it. The `--probe` path forks the app under a shim
// that wraps express.application / express.Router, observes EVERY route the app
// actually registers, then reconcile() takes the set-difference against the static
// floor and integrate.js enriches each MISSED route into SPARDA's rich route shape
// so the existing generator emits a real (write-safe) MCP tool for it.
//
// These tests prove, against REAL express 4.21.2 (imported below so a missing
// install errors loudly instead of silently skipping — §A.5):
//   1. unit: a gap maps to the exact field set the generator consumes, per framework
//      (express ':id' vs fastapi '{id}'), write → body param + disabled, low confidence;
//   2. reconcile: probe-empty → static unchanged (the opt-in-OFF code path), and a
//      probed route that matches a static route is CONFIRMED, never a duplicate gap;
//   3. integration: the probe captures app.get/app.post/PUT routes the static scan
//      missed and reconcile surfaces exactly those as gaps;
//   4. the enriched write gap flows through generateExpress as a DISABLED tool (R3);
//   5. degradation: an app that throws on import yields static-only, never throws up.

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express'; // eslint-disable-line no-unused-vars — presence == "tests must run"
import { reconcile } from '../src/probe/reconcile.js';
import { gapToStaticRoute, discoverDynamicRoutes } from '../src/probe/integrate.js';
import { parseExpressProject } from '../src/parser/express.js';
import { generateExpress } from '../src/generator/express.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '.tmp');

// Each fixture is a throwaway dir UNDER tests/.tmp (so the forked child resolves
// 'express' by walking up to the repo's node_modules) — fresh per test, no coupling.
const made = [];
function makeFixture(src) {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP, 'probe-'));
  fs.writeFileSync(path.join(dir, 'index.js'), src);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'probe-fix', version: '0.0.0' }));
  made.push(dir);
  return { dir, entry: path.join(dir, 'index.js') };
}
afterAll(() => {
  for (const d of made) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});

// ── 1. Unit: gap → SPARDA rich shape ────────────────────────────────────────────

describe('Dynamic route probe (Brief #3) — enrichment unit', () => {
  it('maps a READ gap to the exact field set the generator consumes (express :id)', () => {
    const r = gapToStaticRoute(
      { method: 'GET', path: '/users/:id', pathParams: ['id'], writeClass: 'read' },
      'express',
    );
    expect(r.method).toBe('get');                 // generator lowercases anyway, but parity matters
    expect(r.path).toBe('/users/:id');            // express style preserved
    expect(r.mutating).toBe(false);
    expect(r.confidence).toBe('low');             // never statically verified
    expect(r.source).toBe('dynamic');
    expect(r.params).toEqual([
      { name: 'id', in: 'path', type: 'string', required: true, description: 'path parameter' },
    ]);
    // shape parity with the static parser: every field the generator reads is present
    for (const k of ['method', 'path', 'mutating', 'params', 'description', 'confidence']) {
      expect(r).toHaveProperty(k);
    }
  });

  it('maps a WRITE gap with a body param, and converts :id → {id} for FastAPI', () => {
    const r = gapToStaticRoute(
      { method: 'POST', path: '/items/:id', pathParams: ['id'], writeClass: 'write' },
      'fastapi',
    );
    expect(r.method).toBe('post');
    expect(r.path).toBe('/items/{id}');           // FastAPI brace style, matching the static parser
    expect(r.mutating).toBe(true);
    expect(r.params.find((p) => p.in === 'body')).toMatchObject({ name: 'body', in: 'body', type: 'object' });
    expect(r.params.find((p) => p.in === 'path')).toMatchObject({ name: 'id', required: true });
  });

  it('is domain-blind: write-class drives mutating; path value never branches logic', () => {
    const a = gapToStaticRoute({ method: 'DELETE', path: '/acme/:id', pathParams: ['id'], writeClass: 'write' }, 'express');
    const b = gapToStaticRoute({ method: 'DELETE', path: '/globex/:id', pathParams: ['id'], writeClass: 'write' }, 'express');
    // identical structure regardless of the tenant-looking path segment
    expect({ ...a, path: '', handlerName: '' }).toEqual({ ...b, path: '', handlerName: '' });
  });
});

// ── 2. reconcile floor semantics ─────────────────────────────────────────────────

describe('Dynamic route probe (Brief #3) — reconcile floor', () => {
  const staticRoutes = [
    { method: 'get', path: '/health', mutating: false, confidence: 'high', params: [] },
    { method: 'post', path: '/items', mutating: true, confidence: 'low', params: [] },
  ];

  it('probe-empty → static unchanged, zero gaps (this IS the opt-in-OFF path)', () => {
    const { routes, gaps, dynamicCount } = reconcile(staticRoutes, []);
    expect(gaps).toEqual([]);
    expect(dynamicCount).toBe(0);
    expect(routes).toHaveLength(staticRoutes.length);
  });

  it('a probed route matching a static route is confirmed, never a duplicate gap', () => {
    const probed = [
      { method: 'GET', path: '/health', writeClass: 'read' },     // matches static → confirmed
      { method: 'GET', path: '/secret/:id', writeClass: 'read' }, // only-probe → gap
    ];
    const { gaps } = reconcile(staticRoutes, probed);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].path).toBe('/secret/:id');
    expect(gaps.some((g) => g.path === '/health')).toBe(false);
  });
});

// ── 3. Integration: real fork, real express ──────────────────────────────────────

describe('Dynamic route probe (Brief #3) — live express probe', () => {
  it('captures app.get/app.post AND variable/loop routes the static scan missed', async () => {
    const { dir, entry } = makeFixture(`
const express = require('express');
const app = express();

app.get('/health', (req, res) => res.json({ ok: true }));       // literal → static SEES it
app.post('/items', (req, res) => res.status(201).json({}));     // literal → static SEES it

// patterns the static AST cannot resolve to a literal path:
const dyn = '/dynamic/:id';
app.get(dyn, (req, res) => res.json({ id: req.params.id }));    // variable path → static SKIPS
for (const name of ['things']) {
  app.put('/' + name + '/:id', (req, res) => res.json({ ok: 1 })); // computed in a loop → static SKIPS
}

app.listen(0, () => {});
`);

    // baseline: the static floor sees only the two literal-path routes
    const staticRoutes = parseExpressProject(dir, 'index.js').routes;
    const staticKeys = staticRoutes.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(staticKeys).toEqual(['GET /health', 'POST /items']);

    // probe + reconcile + enrich
    const { added, probedCount } = await discoverDynamicRoutes({
      framework: 'express',
      entryFile: entry,
      projectRoot: dir,
      staticRoutes,
      timeoutMs: 8000,
    });

    expect(probedCount).toBeGreaterThanOrEqual(4);     // all four observed at runtime

    const addedKeys = added.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(addedKeys).toEqual(['GET /dynamic/:id', 'PUT /things/:id']); // only the missed ones

    const getDyn = added.find((r) => r.path === '/dynamic/:id');
    expect(getDyn.mutating).toBe(false);
    expect(getDyn.confidence).toBe('low');
    expect(getDyn.params).toContainEqual({ name: 'id', in: 'path', type: 'string', required: true, description: 'path parameter' });

    const putThing = added.find((r) => r.path === '/things/:id');
    expect(putThing.mutating).toBe(true);
    expect(putThing.params.some((p) => p.in === 'body')).toBe(true);
  }, 20000);

  it('degrades to static-only when the app throws on import — never breaks init', async () => {
    const { dir, entry } = makeFixture(`throw new Error('boom before anything is registered');\n`);
    const staticRoutes = [{ method: 'get', path: '/x', mutating: false, confidence: 'high', params: [] }];

    const { added, probedCount } = await discoverDynamicRoutes({
      framework: 'express',
      entryFile: entry,
      projectRoot: dir,
      staticRoutes,
      timeoutMs: 8000,
    });

    expect(added).toEqual([]);     // nothing added → init proceeds with the static floor
    expect(probedCount).toBe(0);   // graceful: the broken app yields no observations, no throw
  }, 20000);
});

// ── 4. The enriched gap survives the generator as a write-safe tool ───────────────

describe('Dynamic route probe (Brief #3) — generator parity (R3)', () => {
  it('an enriched WRITE gap becomes a DISABLED tool; a READ gap stays enabled', () => {
    const { dir } = makeFixture(`
const express = require('express');
const app = express();
app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(0);
`);
    const staticRoutes = parseExpressProject(dir, 'index.js').routes;

    const enriched = [
      gapToStaticRoute({ method: 'POST', path: '/dynamic/items', pathParams: [], writeClass: 'write' }, 'express'),
      gapToStaticRoute({ method: 'GET', path: '/dynamic/feed/:id', pathParams: ['id'], writeClass: 'read' }, 'express'),
    ];

    const { tools } = generateExpress({
      cwd: dir, entryFile: 'index.js', moduleType: 'cjs', port: 3000,
      routes: [...staticRoutes, ...enriched],
    });

    const all = Object.values(tools);
    const writeTool = all.find((t) => t.method === 'POST' && t.path === '/dynamic/items');
    const readTool = all.find((t) => t.method === 'GET' && t.path === '/dynamic/feed/:id');

    expect(writeTool, 'enriched write gap must produce a tool').toBeTruthy();
    expect(writeTool.enabled).toBe(false);          // write-safety holds for dynamic routes too (R3)
    expect(readTool).toBeTruthy();
    expect(readTool.enabled).toBe(true);
    expect(readTool.pathParams).toContain('id');    // pathParams derived from the enriched params[]
  });
});
