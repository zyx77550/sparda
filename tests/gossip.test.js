// tests/gossip.test.js — Brief #2, horizontal scale via Quorum Sensing × G-Map CRDT.
// The learning layer (SPARDA_PURITY) is per-process RAM; on N replicas it would diverge.
// Gossip converges it WITHOUT a coordinator, store, or new dependency: each replica pushes
// its grow-only {repeats, mismatches} counts to its peers, and merge = max() per counter
// (commutative/associative/idempotent → eventual convergence). These tests prove convergence,
// the value-free wire (only tool NAMES + integer counts, never an argument or body), the
// bounded/injection-safe merge, the safe "mismatch anywhere → volatile everywhere" direction,
// and the zero-overhead solo path (no peers → no timer). Express runs in-process; FastAPI
// boots one uvicorn. Both assert the SAME wire shape, so the two host languages stay in parity.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import express from 'express';
import { parseExpressProject } from '../src/parser/express.js';
import { generateExpress } from '../src/generator/express.js';
import { parseFastAPIProject } from '../src/parser/fastapi.js';
import { generateFastAPI } from '../src/generator/fastapi.js';

const pythonCmd = (() => {
  for (const cmd of ['python3', 'python', 'py']) {
    const args = cmd === 'py' ? ['-3', '--version'] : ['--version'];
    try {
      const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 1000 });
      if (res.status === 0) return cmd;
    } catch {}
  }
  return 'python';
})();
const pythonArgs = (args) => (pythonCmd === 'py' ? ['-3', ...args] : args);
const hasFastAPIRuntime = (() => {
  try {
    // 30s (vs sparda.test.js's 10s): under full-suite parallel load this probe and the other
    // FastAPI suite can do simultaneous COLD `import fastapi, uvicorn`; 10s occasionally times
    // out → false → the runtime test flaky-skips. A longer budget makes it reliably run.
    return (
      spawnSync(pythonCmd, pythonArgs(['-c', 'import fastapi, uvicorn']), {
        timeout: 30_000,
      }).status === 0
    );
  } catch {
    return false;
  }
})();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// a stand-in peer replica: records every gossip POST it receives, replies 204 like a real one.
// Reachable from both the in-process Express router AND the spawned uvicorn (both hit 127.0.0.1).
function startMockPeer() {
  const received = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      received.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(204);
      res.end();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        received,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(r);
          }),
      });
    });
  });
}

// import the generated router with env vars set BEFORE evaluation (SPARDA_PEERS / SPARDA_GOSSIP_MS
// are read at module top-level), then restore env. A unique cache-bust gives a fresh module each
// call → isolated SPARDA_PURITY per test.
async function importRouterWithEnv(routerPath, env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await import(
      pathToFileURL(routerPath).href +
        `?t=${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

async function waitFor(predicate, { tries = 80, interval = 50 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = predicate();
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

// the security heart of #2: nothing but tool names + two integer counters may cross the wire.
function assertValueFree(body) {
  expect(body && typeof body === 'object' && !Array.isArray(body)).toBe(true);
  for (const [name, v] of Object.entries(body)) {
    expect(typeof name).toBe('string');
    expect(v && typeof v === 'object' && !Array.isArray(v)).toBe(true);
    expect(Object.keys(v).sort()).toEqual(['mismatches', 'repeats']); // EXACTLY these two — no body, no args
    expect(Number.isInteger(v.repeats)).toBe(true);
    expect(Number.isInteger(v.mismatches)).toBe(true);
  }
}

describe('Gossip CRDT — Express horizontal scale (Brief #2)', () => {
  it('a solo replica converges by merging a peer snapshot it never observed (receive/auth/bounded/idempotent/volatile)', async () => {
    const tmp = path.join(__dirname, '.tmp', 'gossip-express-recv');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.cpSync(path.join(FIXTURES_DIR, 'express-demo'), tmp, { recursive: true });

    const port = await freePort();
    const { routes } = parseExpressProject(tmp, 'src/app.js');
    const gen = generateExpress({
      cwd: tmp,
      entryFile: 'src/app.js',
      moduleType: 'esm',
      port,
      routes,
    });
    const key = gen.manifest.localKey;

    // solo: NO SPARDA_PEERS → the startup timer must never arm (zero infra).
    const { spardaRouter } = await importRouterWithEnv(
      path.join(tmp, 'src', 'sparda-router.js'),
    );
    const app = express();
    app.use('/mcp', spardaRouter);
    const sockets = new Set();
    const server = await new Promise((resolve) => {
      const s = app.listen(port, '127.0.0.1', () => resolve(s));
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    const base = `http://127.0.0.1:${port}/mcp`;
    const stats = () =>
      fetch(`${base}/stats`, { headers: { 'x-sparda-key': key } }).then((r) => r.json());
    const events = () =>
      fetch(`${base}/events`, { headers: { 'x-sparda-key': key } }).then((r) => r.json());
    const gossip = (body, withKey = true) =>
      fetch(`${base}/gossip`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(withKey ? { 'x-sparda-key': key } : {}),
        },
        body: JSON.stringify(body),
      });

    try {
      // /gossip sits behind the same x-sparda-key as every route — no key → 401 (no new auth surface).
      expect(
        (await gossip({ get_health: { repeats: 5, mismatches: 0 } }, false)).status,
      ).toBe(401);

      // this replica has observed NOTHING locally: get_health is unknown.
      let p = (await stats()).purity;
      expect(p.get_health).toEqual({ class: 'unknown', repeats: 0, mismatches: 0 });

      // a peer that DID observe it pure pushes its counts → we converge to pure without one local call.
      expect((await gossip({ get_health: { repeats: 5, mismatches: 0 } })).status).toBe(
        204,
      );
      p = (await stats()).purity;
      expect(p.get_health).toEqual({ class: 'pure', repeats: 5, mismatches: 0 });

      // grow-only + idempotent: re-merging the same (or a LOWER) count never moves the counter.
      await gossip({ get_health: { repeats: 5, mismatches: 0 } });
      await gossip({ get_health: { repeats: 2, mismatches: 0 } });
      p = (await stats()).purity;
      expect(p.get_health).toEqual({ class: 'pure', repeats: 5, mismatches: 0 });

      // bounded / injection-safe: a tool we don't own is dropped — it can never surface or grow RAM.
      expect(
        (await gossip({ not_a_real_tool: { repeats: 9999, mismatches: 0 } })).status,
      ).toBe(204);
      p = (await stats()).purity;
      expect(p.not_a_real_tool).toBeUndefined();

      // malformed counts (negative, non-numeric) are ignored — existing state is never corrupted.
      await gossip({ get_health: { repeats: -5, mismatches: 0 } });
      await gossip({ get_health: { repeats: 'abc', mismatches: 0 } });
      p = (await stats()).purity;
      expect(p.get_health).toEqual({ class: 'pure', repeats: 5, mismatches: 0 });

      // the SAFE direction: a single mismatch anywhere makes the route volatile everywhere.
      expect((await gossip({ get_health: { repeats: 5, mismatches: 1 } })).status).toBe(
        204,
      );
      p = (await stats()).purity;
      expect(p.get_health).toEqual({ class: 'volatile', repeats: 5, mismatches: 1 });

      // zero-overhead solo: with no peers, the gossip timer never started — no 'gossip' event exists.
      const ev = await events();
      expect(ev.events.some((e) => e.source === 'gossip')).toBe(false);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 15_000);

  it('pushes a value-free snapshot to its peers (only tool names + integer counts cross the wire)', async () => {
    const peer = await startMockPeer();
    const tmp = path.join(__dirname, '.tmp', 'gossip-express-push');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.cpSync(path.join(FIXTURES_DIR, 'express-demo'), tmp, { recursive: true });

    const port = await freePort();
    const { routes } = parseExpressProject(tmp, 'src/app.js');
    const gen = generateExpress({
      cwd: tmp,
      entryFile: 'src/app.js',
      moduleType: 'esm',
      port,
      routes,
    });
    const key = gen.manifest.localKey;

    // configured WITH a peer + a fast tick → the startup timer arms and gossips on a 60ms cadence.
    const { spardaRouter } = await importRouterWithEnv(
      path.join(tmp, 'src', 'sparda-router.js'),
      { SPARDA_PEERS: peer.url, SPARDA_GOSSIP_MS: '60' },
    );
    const app = express();
    app.get('/health', (_req, res) => res.json({ ok: true })); // stable body → repeats accumulate
    app.use('/mcp', spardaRouter);
    const sockets = new Set();
    const server = await new Promise((resolve) => {
      const s = app.listen(port, '127.0.0.1', () => resolve(s));
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    const base = `http://127.0.0.1:${port}/mcp`;
    const invoke = (tool, args = {}) =>
      fetch(`${base}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sparda-key': key },
        body: JSON.stringify({ tool, args }),
      });
    const events = () =>
      fetch(`${base}/events`, { headers: { 'x-sparda-key': key } }).then((r) => r.json());

    try {
      // observe get_health locally: 1st call records the sig, the next two repeat it (repeats → 2).
      for (let i = 0; i < 3; i++) {
        const r = await invoke('get_health');
        expect((await r.json()).upstreamStatus).toBe(200);
      }

      // wait for a background push that carries the learned count.
      const push = await waitFor(() =>
        peer.received.find(
          (r) => r.body && r.body.get_health && r.body.get_health.repeats >= 1,
        ),
      );
      expect(push, 'expected a gossip push carrying get_health.repeats>=1').toBeTruthy();

      // the wire: POST /mcp/gossip, authenticated with the shared key, value-free body.
      expect(push.method).toBe('POST');
      expect(push.url).toBe('/mcp/gossip');
      expect(push.headers['x-sparda-key']).toBe(key);
      assertValueFree(push.body);
      expect(push.body.get_health.mismatches).toBe(0);
      expect(push.body.get_health.repeats).toBeGreaterThanOrEqual(1);

      // the peer-mode startup event was emitted (proves the timer path activated under SPARDA_PEERS).
      const ev = await events();
      expect(ev.events.some((e) => e.source === 'gossip')).toBe(true);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
      await peer.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 15_000);
});

describe.skipIf(!hasFastAPIRuntime)(
  'Gossip CRDT — FastAPI horizontal scale (Brief #2)',
  () => {
    it('receives/merges over /mcp/gossip (auth, bounded, bool+negative rejected, volatile) and pushes value-free', async () => {
      const peer = await startMockPeer();
      const tmp = path.join(__dirname, '.tmp', 'gossip-fastapi');
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.cpSync(path.join(FIXTURES_DIR, 'fastapi-basic'), tmp, { recursive: true });

      const port = await freePort();
      const { routes, entryAppVars } = parseFastAPIProject(tmp, 'main.py', pythonCmd);
      const gen = generateFastAPI({
        cwd: tmp,
        entryFile: 'main.py',
        port,
        routes,
        entryAppVars,
        pythonCmd,
      });
      expect(gen.injection.injected).toBe(true);
      const key = gen.manifest.localKey;

      let uviErr = '';
      const uvicorn = spawn(
        pythonCmd,
        pythonArgs([
          '-m',
          'uvicorn',
          'main:app',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
        ]),
        {
          cwd: tmp,
          env: { ...process.env, SPARDA_PEERS: peer.url, SPARDA_GOSSIP_MS: '60' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      uvicorn.stderr.on('data', (d) => {
        uviErr += d.toString();
      });
      uvicorn.stdout.on('data', (d) => {
        uviErr += d.toString();
      });

      const base = `http://127.0.0.1:${port}/mcp`;
      const stats = () =>
        fetch(`${base}/stats`, { headers: { 'x-sparda-key': key } }).then((r) =>
          r.json(),
        );
      const events = () =>
        fetch(`${base}/events`, { headers: { 'x-sparda-key': key } }).then((r) =>
          r.json(),
        );
      const gossip = (body, withKey = true) =>
        fetch(`${base}/gossip`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(withKey ? { 'x-sparda-key': key } : {}),
          },
          body: JSON.stringify(body),
        });

      try {
        let up = false;
        for (let i = 0; i < 60 && !up; i++) {
          try {
            const r = await fetch(`${base}/tools`, {
              headers: { 'x-sparda-key': key },
              signal: AbortSignal.timeout(1000),
            });
            up = r.ok;
          } catch {
            /* not yet */
          }
          if (!up) await sleep(500);
        }
        if (!up) throw new Error(`uvicorn never came up.\n${uviErr}`);

        // same x-sparda-key as every route — no key → 401.
        expect(
          (await gossip({ get_health: { repeats: 5, mismatches: 0 } }, false)).status,
        ).toBe(401);

        // unknown locally → converge to pure purely by merging a peer's counts.
        expect((await stats()).purity.get_health).toEqual({
          class: 'unknown',
          repeats: 0,
          mismatches: 0,
        });
        expect((await gossip({ get_health: { repeats: 5, mismatches: 0 } })).status).toBe(
          204,
        );
        expect((await stats()).purity.get_health).toEqual({
          class: 'pure',
          repeats: 5,
          mismatches: 0,
        });

        // bounded: an unknown tool is dropped (never surfaces).
        await gossip({ not_a_real_tool: { repeats: 9999, mismatches: 0 } });
        expect((await stats()).purity.not_a_real_tool).toBeUndefined();

        // Python: bool is an int subclass — a JSON `true` must NOT pose as a count; negatives rejected too.
        await gossip({ get_health: { repeats: true, mismatches: 0 } });
        await gossip({ get_health: { repeats: -3, mismatches: 0 } });
        expect((await stats()).purity.get_health).toEqual({
          class: 'pure',
          repeats: 5,
          mismatches: 0,
        });

        // mismatch anywhere → volatile everywhere.
        expect((await gossip({ get_health: { repeats: 5, mismatches: 1 } })).status).toBe(
          204,
        );
        expect((await stats()).purity.get_health).toEqual({
          class: 'volatile',
          repeats: 5,
          mismatches: 1,
        });

        // the daemon push thread gossips our converged snapshot to the peer — value-free.
        const push = await waitFor(() =>
          peer.received.find((r) => r.body && r.body.get_health),
        );
        expect(
          push,
          'expected a daemon-thread gossip push carrying get_health',
        ).toBeTruthy();
        expect(push.method).toBe('POST');
        expect(push.url).toBe('/mcp/gossip');
        expect(push.headers['x-sparda-key']).toBe(key);
        assertValueFree(push.body);

        // peer-mode startup event present.
        const ev = await events();
        expect(ev.events.some((e) => e.source === 'gossip')).toBe(true);
      } finally {
        const exited = new Promise((r) => uvicorn.once('close', r));
        uvicorn.kill('SIGKILL');
        await exited;
        await peer.close();
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }, 60_000);
  },
);
