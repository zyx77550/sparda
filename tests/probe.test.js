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
import 'express'; // side-effect import: the probe forks a host that require()s express — fail loudly here if it is missing
import { reconcile } from '../src/probe/reconcile.js';
import { gapToStaticRoute, discoverDynamicRoutes } from '../src/probe/integrate.js';
import { diagnose, probeRoutes } from '../src/probe/probe.js';
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
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'probe-fix', version: '0.0.0' }),
  );
  made.push(dir);
  return { dir, entry: path.join(dir, 'index.js') };
}

// The same fixture as ESM — `"type": "module"` with a `.js` entry, which is how a modern
// Express app is written. It needs to exist because the CJS one above passed for a year while
// the ESM path was completely inert (E-109): `Module._load`, the shim's whole interception
// mechanism, is never called for `import express from 'express'` on Node 22.
function makeEsmFixture(src) {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP, 'probe-esm-'));
  fs.writeFileSync(path.join(dir, 'index.js'), src);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'probe-fix-esm', version: '0.0.0', type: 'module' }),
  );
  made.push(dir);
  return { dir, entry: path.join(dir, 'index.js') };
}
afterAll(() => {
  for (const d of made) {
    try {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
});

// ── 1. Unit: gap → SPARDA rich shape ────────────────────────────────────────────

describe('Dynamic route probe (Brief #3) — enrichment unit', () => {
  it('maps a READ gap to the exact field set the generator consumes (express :id)', () => {
    const r = gapToStaticRoute(
      { method: 'GET', path: '/users/:id', pathParams: ['id'], writeClass: 'read' },
      'express',
    );
    expect(r.method).toBe('get'); // generator lowercases anyway, but parity matters
    expect(r.path).toBe('/users/:id'); // express style preserved
    expect(r.mutating).toBe(false);
    expect(r.confidence).toBe('low'); // never statically verified
    expect(r.source).toBe('dynamic');
    expect(r.params).toEqual([
      {
        name: 'id',
        in: 'path',
        type: 'string',
        required: true,
        description: 'path parameter',
      },
    ]);
    // shape parity with the static parser: every field the generator reads is present
    for (const k of [
      'method',
      'path',
      'mutating',
      'params',
      'description',
      'confidence',
    ]) {
      expect(r).toHaveProperty(k);
    }
  });

  it('maps a WRITE gap with a body param, and converts :id → {id} for FastAPI', () => {
    const r = gapToStaticRoute(
      { method: 'POST', path: '/items/:id', pathParams: ['id'], writeClass: 'write' },
      'fastapi',
    );
    expect(r.method).toBe('post');
    expect(r.path).toBe('/items/{id}'); // FastAPI brace style, matching the static parser
    expect(r.mutating).toBe(true);
    expect(r.params.find((p) => p.in === 'body')).toMatchObject({
      name: 'body',
      in: 'body',
      type: 'object',
    });
    expect(r.params.find((p) => p.in === 'path')).toMatchObject({
      name: 'id',
      required: true,
    });
  });

  it('is domain-blind: write-class drives mutating; path value never branches logic', () => {
    const a = gapToStaticRoute(
      { method: 'DELETE', path: '/acme/:id', pathParams: ['id'], writeClass: 'write' },
      'express',
    );
    const b = gapToStaticRoute(
      { method: 'DELETE', path: '/globex/:id', pathParams: ['id'], writeClass: 'write' },
      'express',
    );
    // identical structure regardless of the tenant-looking path segment
    expect({ ...a, path: '', handlerName: '' }).toEqual({
      ...b,
      path: '',
      handlerName: '',
    });
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
      { method: 'GET', path: '/health', writeClass: 'read' }, // matches static → confirmed
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
    const staticKeys = staticRoutes
      .map((r) => `${r.method.toUpperCase()} ${r.path}`)
      .sort();
    expect(staticKeys).toEqual(['GET /health', 'POST /items']);

    // probe + reconcile + enrich
    const { added, probedCount } = await discoverDynamicRoutes({
      framework: 'express',
      entryFile: entry,
      projectRoot: dir,
      staticRoutes,
      timeoutMs: 8000,
    });

    expect(probedCount).toBeGreaterThanOrEqual(4); // all four observed at runtime

    const addedKeys = added.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(addedKeys).toEqual(['GET /dynamic/:id', 'PUT /things/:id']); // only the missed ones

    const getDyn = added.find((r) => r.path === '/dynamic/:id');
    expect(getDyn.mutating).toBe(false);
    expect(getDyn.confidence).toBe('low');
    expect(getDyn.params).toContainEqual({
      name: 'id',
      in: 'path',
      type: 'string',
      required: true,
      description: 'path parameter',
    });

    const putThing = added.find((r) => r.path === '/things/:id');
    expect(putThing.mutating).toBe(true);
    expect(putThing.params.some((p) => p.in === 'body')).toBe(true);
  }, 20000);

  it('observes an ESM app too — the case that was inert for a whole release (E-109)', async () => {
    // THE REGRESSION THIS PINS. The shim intercepts `require('express')` by patching
    // `Module._load`. On Node 22 an ESM `import express from 'express'` never goes through it —
    // measured — so for every Express app written in ESM (the modern default) the probe hooked
    // nothing, timed out, and reported "the app did not boot". The premise stayed `unmeasured`,
    // and since Express has no convention oracle, such an app could never reach PROVEN.
    //
    // Fixed by pre-requiring express from the ENTRY FILE's resolution root before the app runs:
    // express is CJS, so the app's later `import` receives the same, already-patched instance.
    const { dir, entry } = makeEsmFixture(`
import express from 'express';
const app = express();

app.get('/health', (req, res) => res.json({ ok: true }));      // literal → static SEES it

const dyn = '/dynamic/:id';
app.get(dyn, (req, res) => res.json({ id: req.params.id }));   // variable → static SKIPS

app.listen(0, () => {});
`);

    const staticRoutes = parseExpressProject(dir, 'index.js').routes;
    expect(staticRoutes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'GET /health',
    ]);

    const { added, probedCount } = await discoverDynamicRoutes({
      framework: 'express',
      entryFile: entry,
      projectRoot: dir,
      staticRoutes,
      timeoutMs: 8000,
    });

    // the whole point: the runtime oracle RAN on an ESM app
    expect(probedCount).toBeGreaterThanOrEqual(2);
    expect(added.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'GET /dynamic/:id',
    ]);
  }, 20000);

  it('reports a mounted router at the path it is SERVED from, not the one it was declared with (E-110)', async () => {
    // `router.get('/:id')` runs at import; `app.use('/api/users', router)` runs later. Emitting at
    // registration therefore reported `GET /:id`, which reconcile compared against the compiler's
    // (correct) `/api/users/:id` and called a route the app serves and the compiler never saw.
    //
    // Those FALSE gaps are in the safe direction for a verdict — they only make SPARDA refuse to
    // claim PROVEN — which is exactly how they went unnoticed. They are in the wrong direction for
    // anything reading gaps as findings, and every real Express app mounts routers.
    const { dir, entry } = makeFixture(`
const express = require('express');
const app = express();

const users = express.Router();
users.get('/:id', (req, res) => res.json({}));      // declared '/:id'   → served '/api/users/:id'
users.post('/', (req, res) => res.status(201).json({}));

const admin = express.Router();
admin.get('/stats', (req, res) => res.json({}));    // nested two levels deep

app.use('/api/users', users);
app.use('/api/users/:id/admin', admin);
app.get('/health', (req, res) => res.json({}));     // not mounted — must stay '/health'

app.listen(0, () => {});
`);

    const probed = await probeRoutes({
      framework: 'express',
      entryFile: entry,
      projectRoot: dir,
      timeoutMs: 8000,
    });
    const keys = probed.map((r) => `${r.method} ${r.path}`).sort();
    expect(keys).toEqual([
      'GET /api/users/:id',
      'GET /api/users/:id/admin/stats', // the prefix composes through nesting
      'GET /health', // an unmounted route is NOT given a prefix
      'POST /api/users', // '/' under a mount is the mount itself, not '<mount>/'
    ]);
    // and the bare declared paths are gone — those were the false gaps
    expect(keys).not.toContain('GET /:id');
    expect(keys).not.toContain('POST /');
  }, 20000);

  it('degrades to static-only when the app throws on import — never breaks init', async () => {
    const { dir, entry } = makeFixture(
      `throw new Error('boom before anything is registered');\n`,
    );
    const staticRoutes = [
      { method: 'get', path: '/x', mutating: false, confidence: 'high', params: [] },
    ];

    const { added, probedCount } = await discoverDynamicRoutes({
      framework: 'express',
      entryFile: entry,
      projectRoot: dir,
      staticRoutes,
      timeoutMs: 8000,
    });

    expect(added).toEqual([]); // nothing added → init proceeds with the static floor
    expect(probedCount).toBe(0); // graceful: the broken app yields no observations, no throw
  }, 20000);
});

// ── 4. The enriched gap survives the generator as a write-safe tool ───────────────

describe('the probe says WHY it saw nothing, and never blames a healthy app (E-109)', () => {
  // Three of these four states used to print as the fourth. "The app did not boot" over an app
  // that was serving traffic is a wrong DIAGNOSIS, not just a missing detail: it sends the user
  // to debug their own code while the actual cause is that SPARDA could not look.
  it('separates "could not look" from "nothing to see" from "the app never started"', () => {
    expect(diagnose({ count: 6, shimPatched: true }).state).toBe('observed');

    const blind = diagnose({ count: 0, shimPatched: false, timedOut: true });
    expect(blind.state).toBe('not-instrumented');
    expect(blind.reason).toMatch(/not a boot failure/i);
    expect(blind.reason).not.toMatch(/did not (boot|start)/i); // the wrong sentence, gone

    expect(diagnose({ count: 0, shimPatched: true, timedOut: true }).state).toBe(
      'no-routes',
    );

    const dead = diagnose({
      count: 0,
      shimPatched: null,
      exitCode: 1,
      stderrTail: 'Error: connect ECONNREFUSED postgres:5432',
    });
    expect(dead.state).toBe('did-not-start');
    expect(dead.stderrTail).toMatch(/ECONNREFUSED/); // the app's own error, no longer discarded
  });

  it("carries the app's OWN error out, instead of dropping it on the floor", async () => {
    // The probe used to do `child.stderr.on('data', () => {})`, throwing away the only place a
    // target's boot failure is written down. That is what made "the shim hooked nothing" and
    // "the app refused to start" look identical, and it cost 20 minutes of bisecting to find.
    //
    // Asserted on BEHAVIOUR, not by grepping the source: a source pattern also matches the
    // comment that explains it, and a grep cannot tell a check from a sentence about one — the
    // third time that lesson has been paid for in this repo.
    const { dir, entry } = makeFixture(`
process.stderr.write('FATAL: connect ECONNREFUSED 127.0.0.1:5432\\n');
process.exit(1);
`);
    const probed = await probeRoutes({
      framework: 'express',
      entryFile: entry,
      projectRoot: dir,
      timeoutMs: 8000,
    });
    expect(probed).toEqual([]); // no routes — the array contract is unchanged
    // The app's OWN words, carried out. Which of the four states we land in depends on a race
    // between the child's exit and its last IPC message, so the state is unit-tested above and
    // what this integration test owns is the one thing that used to be impossible: seeing why.
    expect(probed.diagnostic.stderrTail).toMatch(/ECONNREFUSED/);
  }, 20000);
});

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
      gapToStaticRoute(
        { method: 'POST', path: '/dynamic/items', pathParams: [], writeClass: 'write' },
        'express',
      ),
      gapToStaticRoute(
        {
          method: 'GET',
          path: '/dynamic/feed/:id',
          pathParams: ['id'],
          writeClass: 'read',
        },
        'express',
      ),
    ];

    const { tools } = generateExpress({
      cwd: dir,
      entryFile: 'index.js',
      moduleType: 'cjs',
      port: 3000,
      routes: [...staticRoutes, ...enriched],
    });

    const all = Object.values(tools);
    const writeTool = all.find((t) => t.method === 'POST' && t.path === '/dynamic/items');
    const readTool = all.find(
      (t) => t.method === 'GET' && t.path === '/dynamic/feed/:id',
    );

    expect(writeTool, 'enriched write gap must produce a tool').toBeTruthy();
    expect(writeTool.enabled).toBe(false); // write-safety holds for dynamic routes too (R3)
    expect(readTool).toBeTruthy();
    expect(readTool.enabled).toBe(true);
    expect(readTool.pathParams).toContain('id'); // pathParams derived from the enriched params[]
  });
});
