// bench/flywheel-bench.mjs — honest, reproducible numbers to replace the phantom "97%".
//
// Run:  node bench/flywheel-bench.mjs
// Deps: none beyond the repo's own (express devDep + Node built-ins). No autocannon —
//       a hand-rolled sequential driver gives clean per-call latency and exact control.
//
// It measures the two numbers that actually matter for adoption, end-to-end on the
// real generated router + the real stdio bridge (the flywheel lives in the BRIDGE, not
// the router, so hammering /mcp/invoke would measure nothing — we drive the bridge):
//
//   PART 1 — Proxy overhead (the fear): host route direct vs the same call through the
//            injected /mcp/invoke router (SPARDING proof + telemetry). "What does it cost?"
//   PART 2 — Flywheel benefit (the pitch): a proven-stable read served from the bridge's
//            RAM vs paying the host round-trip, with SPARDA_FLYWHEEL on/off. Plus the
//            honest served-from-memory share on a repeat-heavy read stream.
//
// Every number is whatever this machine produces today. Nothing is hard-coded.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { parseExpressProject } from '../src/parser/express.js';
import { generateExpress } from '../src/generator/express.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'express-demo');

// ── tiny stats helpers ───────────────────────────────────────────────────────
const sorted = (a) => [...a].sort((x, y) => x - y);
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = sorted(a);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const ms = (n) => `${n.toFixed(3)}ms`;
const sleep = (n) => new Promise((r) => setTimeout(r, n));
async function freePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

// A constant prospects payload → a PURE read (arms the flywheel). /health carries
// process.uptime() → VOLATILE (never arms): the two halves of the contrast.
const PROSPECTS = {
  count: 3,
  prospects: [
    { id: 1, name: 'Sophro Paris 11', sector: 'sophrologie', score: 42 },
    { id: 2, name: 'Coiff & Moi', sector: 'coiffure', score: 67 },
    { id: 3, name: 'Auto-École 77', sector: 'auto-école', score: 31 },
  ],
};

// ── shared host: real generated router mounted on a controlled app ─────────────
async function startHost() {
  // temp lives INSIDE the repo so the generated router resolves `express` from the
  // repo's node_modules (Node walks up from the file's dir). os.tmpdir() would not.
  const tmpRoot = path.join(REPO, 'bench', '.tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'host-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const port = await freePort();
  const { routes } = parseExpressProject(tmp, 'src/app.js');
  const gen = generateExpress({
    cwd: tmp,
    entryFile: 'src/app.js',
    moduleType: 'esm',
    port,
    routes,
  });
  const { spardaRouter } = await import(
    pathToFileURL(path.join(tmp, 'src', 'sparda-router.js')).href + `?t=${Date.now()}`
  );

  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() })); // volatile
  app.get('/api/prospects', (_req, res) => res.json(PROSPECTS)); // pure
  app.use('/mcp', spardaRouter);
  const server = await new Promise((r) => {
    const s = app.listen(port, '127.0.0.1', () => r(s));
  });

  return {
    tmp,
    port,
    key: gen.manifest.localKey,
    close: () => new Promise((r) => server.close(r)),
  };
}

// ── PART 1: proxy overhead (pure HTTP, no bridge) ──────────────────────────────
async function part1ProxyOverhead({ port, key }, { warmup = 300, n = 3000 } = {}) {
  const direct = `http://127.0.0.1:${port}/api/prospects`;
  const mcp = `http://127.0.0.1:${port}/mcp/invoke`;
  const hitDirect = () => fetch(direct);
  const hitMcp = () =>
    fetch(mcp, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sparda-key': key },
      body: JSON.stringify({ tool: 'get_api_prospects', args: {} }),
    });

  for (let i = 0; i < warmup; i++) {
    await hitDirect();
    await hitMcp();
  }

  const timeIt = async (fn) => {
    const lat = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      const r = await fn();
      await r.text(); // drain the body — part of the real cost
      lat.push(performance.now() - t0);
    }
    return lat;
  };
  const d = await timeIt(hitDirect);
  const m = await timeIt(hitMcp);
  const stat = (a) => ({
    p50: pct(a, 50),
    p95: pct(a, 95),
    p99: pct(a, 99),
    mean: mean(a),
  });
  return {
    n,
    direct: stat(d),
    mcp: stat(m),
    overheadP50: pct(m, 50) - pct(d, 50),
    overheadP95: pct(m, 95) - pct(d, 95),
  };
}

// ── bridge driver (speaks MCP JSON-RPC over stdio, like a real client) ─────────
function makeBridge(cwd, extraEnv) {
  const stdioUrl = pathToFileURL(path.join(REPO, 'src', 'server', 'stdio.js')).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { startStdioBridge } from ${JSON.stringify(stdioUrl)}; await startStdioBridge({ cwd: process.cwd() });`,
    ],
    {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SPARDA_EVENT_POLL_MS: '10000', ...extraEnv },
    },
  );

  let buf = '';
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* notification / log */
      }
    }
  });
  let id = 0;
  const request = (method, params) => {
    const myId = ++id;
    const p = new Promise((resolve, reject) => {
      pending.set(myId, resolve);
      setTimeout(() => reject(new Error(`timeout ${method}\n${stderr}`)), 15000);
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n',
    );
    return p;
  };
  const notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const close = () =>
    new Promise((r) => {
      child.once('close', r);
      child.kill('SIGKILL');
    });
  return { request, notify, close, stderrText: () => stderr };
}

async function callTool(bridge, name, args = {}) {
  const t0 = performance.now();
  const res = await bridge.request('tools/call', { name, arguments: args });
  const dt = performance.now() - t0;
  const txt = res.result?.content?.[0]?.text ?? '';
  return { dt, servedByFlywheel: /"servedByFlywheel"\s*:\s*true/.test(txt), text: txt };
}

async function bootBridge(cwd, env) {
  const b = makeBridge(cwd, env);
  await b.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'bench', version: '0' },
  });
  b.notify('notifications/initialized', {});
  await b.request('tools/list', {});
  return b;
}

// ── PART 2a: flywheel ON — arm a pure read, then measure armed serves ──────────
async function measureFlywheelOn(cwd, { burst = 500, armCap = 12 } = {}) {
  const b = await bootBridge(cwd, { SPARDA_FLYWHEEL: 'on' });
  try {
    // warm up: paced calls so the idle harvester (1 job / 250ms tick) drains observations
    // and the read arms (MIN_HITS=3). Detect arming by the first served-from-RAM envelope.
    let warmupCalls = 0;
    let armed = false;
    for (let i = 0; i < armCap && !armed; i++) {
      const c = await callTool(b, 'get_api_prospects');
      warmupCalls++;
      if (c.servedByFlywheel) {
        armed = true;
        break;
      }
      await sleep(320);
    }
    if (!armed)
      throw new Error('flywheel never armed within warmup cap — check pacing / purity');

    // measure: armed burst — every call should be served from the bridge's RAM
    const lat = [];
    let hits = 0;
    for (let i = 0; i < burst; i++) {
      const c = await callTool(b, 'get_api_prospects');
      lat.push(c.dt);
      if (c.servedByFlywheel) hits++;
    }

    // pull the bridge's own honest counters
    const ctxRes = await b.request('tools/call', {
      name: 'sparda_get_context',
      arguments: {},
    });
    const ctx = JSON.parse(ctxRes.result.content[0].text);
    return {
      warmupCalls,
      armed,
      served: {
        p50: pct(lat, 50),
        p95: pct(lat, 95),
        p99: pct(lat, 99),
        mean: mean(lat),
      },
      hitRateInBurst: hits / burst,
      flywheel: ctx.recycling?.flywheel ?? null,
    };
  } finally {
    await b.close();
  }
}

// ── PART 2b: flywheel OFF — same read always pays the host round-trip ──────────
async function measureFlywheelOff(cwd, { burst = 500 } = {}) {
  const b = await bootBridge(cwd, { SPARDA_FLYWHEEL: 'off' });
  try {
    for (let i = 0; i < 5; i++) {
      await callTool(b, 'get_api_prospects');
      await sleep(320);
    } // same warmup shape
    const lat = [];
    let hits = 0;
    for (let i = 0; i < burst; i++) {
      const c = await callTool(b, 'get_api_prospects');
      lat.push(c.dt);
      if (c.servedByFlywheel) hits++;
    }
    return {
      served: {
        p50: pct(lat, 50),
        p95: pct(lat, 95),
        p99: pct(lat, 99),
        mean: mean(lat),
      },
      hitRateInBurst: hits / burst,
    };
  } finally {
    await b.close();
  }
}

// ── PART 2c: honest served-from-memory share on a repeat-heavy mixed stream ────
// A realistic read loop: one pure read repeated, interleaved with a volatile read.
// The pure one arms and is then free; the volatile one always pays. The resulting
// share is what an honest "recycling rate" looks like for THIS access pattern.
async function measureMixedHitRate(cwd, { rounds = 200 } = {}) {
  const b = await bootBridge(cwd, { SPARDA_FLYWHEEL: 'on' });
  try {
    for (let i = 0; i < 6; i++) {
      await callTool(b, 'get_api_prospects');
      await sleep(320);
    } // arm the pure read
    let served = 0;
    let total = 0;
    for (let i = 0; i < rounds; i++) {
      const pure = await callTool(b, 'get_api_prospects');
      total++;
      if (pure.servedByFlywheel) served++;
      const vol = await callTool(b, 'get_health');
      total++;
      if (vol.servedByFlywheel) served++;
    }
    return {
      pattern: '1 pure read + 1 volatile read per round',
      rounds,
      total,
      served,
      sharePct: Math.round((served / total) * 100),
    };
  } finally {
    await b.close();
  }
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.error('[bench] starting host (real generated router)…');
  const host = await startHost();
  const out = {
    meta: {
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      cpus: os.cpus()?.[0]?.model,
      when: new Date().toISOString(),
    },
  };
  try {
    console.error('[bench] PART 1 — proxy overhead (host-direct vs /mcp/invoke)…');
    out.proxyOverhead = await part1ProxyOverhead(host);

    console.error('[bench] PART 2a — flywheel ON (arming + armed serves)…');
    out.flywheelOn = await measureFlywheelOn(host.tmp);
    console.error('[bench] PART 2b — flywheel OFF (always pays host)…');
    out.flywheelOff = await measureFlywheelOff(host.tmp);
    console.error('[bench] PART 2c — honest hit-rate on a mixed read stream…');
    out.mixed = await measureMixedHitRate(host.tmp);
  } finally {
    await host.close();
    fs.rmSync(host.tmp, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }

  // ── report ──
  const p = out.proxyOverhead,
    on = out.flywheelOn,
    off = out.flywheelOff,
    mx = out.mixed;
  const speedup = on.served.p50 > 0 ? off.served.p50 / on.served.p50 : 0;
  console.log(`
SPARDA benchmark — ${out.meta.when}
  ${out.meta.platform} · Node ${out.meta.node}${out.meta.cpus ? ` · ${out.meta.cpus}` : ''}

PART 1 — Proxy overhead  (n=${p.n} sequential, GET /api/prospects)
  host route direct     p50 ${ms(p.direct.p50)}   p95 ${ms(p.direct.p95)}   p99 ${ms(p.direct.p99)}
  through SPARDA /mcp    p50 ${ms(p.mcp.p50)}   p95 ${ms(p.mcp.p95)}   p99 ${ms(p.mcp.p99)}
  → router + SPARDING proof overhead:  +${ms(p.overheadP50)} p50   +${ms(p.overheadP95)} p95

PART 2 — Flywheel  (bridge stdio, pure read armed after 3 stable observations)
  armed after ${on.warmupCalls} warmup calls
  served from RAM (ON)  p50 ${ms(on.served.p50)}   p95 ${ms(on.served.p95)}   p99 ${ms(on.served.p99)}
  pays host (OFF)       p50 ${ms(off.served.p50)}   p95 ${ms(off.served.p95)}   p99 ${ms(off.served.p99)}
  → armed serve is ${speedup ? speedup.toFixed(1) : '—'}× faster at p50; ${Math.round(on.hitRateInBurst * 100)}% of the armed burst served from memory
  bridge counters: servedFromMemory=${on.flywheel?.servedFromMemory ?? '—'}, armed=${on.flywheel?.armed ?? '—'}

PART 2c — Honest hit-rate on a repeat-heavy stream
  ${mx.pattern}: ${mx.served}/${mx.total} reads served from memory = ${mx.sharePct}%
  (workload-dependent: the pure read is free once armed, the volatile one always pays)
`);

  const file = path.join(__dirname, 'results.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.error(`[bench] wrote ${path.relative(REPO, file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
