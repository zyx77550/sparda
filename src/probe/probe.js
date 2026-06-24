/**
 * SPARDA — Runtime Route Probe (orchestrator) v2
 *
 * Changes from v1:
 *   - checkCommand: 1500 ms kill timeout (§A.6 / ANALYSE §4: Windows MS Store hang)
 *   - FastAPI availability detection: spawnSync cross-platform, no shell string (§A.5.4)
 *   - Everything else kept verbatim (§B)
 *
 * Exports: async probeRoutes({ framework, entryFile, projectRoot, timeoutMs })
 *
 * ESM, Node ≥ 18. Zero new dependencies.
 */

import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';
import { platform } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SHIM_CJS = resolve(__dirname, 'express-shim.cjs');
const SHIM_ESM = resolve(__dirname, 'express-shim-esm.mjs');
const PY_PROBE = resolve(__dirname, 'fastapi-probe.py');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── Public API ─────────────────────────────────────────────────────────────────

export async function probeRoutes({
  framework,
  entryFile,
  projectRoot,
  timeoutMs = 8000,
}) {
  if (framework === 'express') return probeExpress({ entryFile, projectRoot, timeoutMs });
  if (framework === 'fastapi') return probeFastAPI({ entryFile, projectRoot, timeoutMs });
  throw Object.assign(new Error(`Unknown framework: ${framework}`), {
    code: 'USER',
    hint: 'framework must be "express" or "fastapi"',
  });
}

// ── Express probe ─────────────────────────────────────────────────────────────

async function probeExpress({ entryFile, projectRoot, timeoutMs }) {
  const ext = extname(entryFile);

  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    process.stderr.write(
      '[sparda] --probe skipped: .ts entry needs a runtime loader; static discovery still applied.\n',
    );
    return [];
  }

  const isEsm = ext === '.mjs';
  const shimFlag = isEsm ? ['--import', SHIM_ESM] : ['--require', SHIM_CJS];

  const routes = [];
  let child;

  return new Promise((resolve_) => {
    let settled = false;
    let killTimer;

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      try {
        child && child.kill('SIGKILL');
      } catch {}
      resolve_(result);
    }

    killTimer = setTimeout(() => {
      process.stderr.write(
        '[sparda] --probe: timeout waiting for Express routes; using static floor.\n',
      );
      settle(routes);
    }, timeoutMs);

    try {
      child = fork(entryFile, [], {
        cwd: projectRoot,
        execArgv: shimFlag,
        silent: true,
        env: { ...process.env, SPARDA_PROBE: '1' },
      });
    } catch (spawnErr) {
      process.stderr.write(
        `[sparda] --probe: failed to spawn child: ${spawnErr.message}\n`,
      );
      clearTimeout(killTimer);
      resolve_([]);
      return;
    }

    child.stderr?.on('data', () => {});

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === '__done__') {
        settle(routes);
        return;
      }
      if (msg.type === 'route') {
        const method = normalizeMethod(msg.method);
        const path = normalizePath(msg.path);
        routes.push({
          method,
          path,
          pathParams: extractPathParams(path),
          source: 'dynamic',
          writeClass: WRITE_METHODS.has(method) ? 'write' : 'read',
        });
      }
    });

    child.on('error', (err) => {
      process.stderr.write(`[sparda] --probe: child error: ${err.message}\n`);
      settle(routes);
    });

    child.on('exit', () => settle(routes));
  });
}

// ── FastAPI probe ─────────────────────────────────────────────────────────────

async function probeFastAPI({ entryFile, projectRoot, timeoutMs }) {
  const python = await resolvePython();
  if (!python) {
    process.stderr.write(
      '[sparda] --probe: python3/python not found; static discovery still applied.\n',
    );
    return [];
  }

  return new Promise((resolve_) => {
    let settled = false;
    let killTimer;
    const stdoutChunks = [];

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      try {
        child && child.kill();
      } catch {}
      resolve_(result);
    }

    killTimer = setTimeout(() => {
      process.stderr.write(
        '[sparda] --probe: FastAPI probe timeout; using static floor.\n',
      );
      settle(parsePythonOutput(Buffer.concat(stdoutChunks).toString('utf8')));
    }, timeoutMs);

    let child;
    try {
      child = spawn(python, [PY_PROBE, entryFile], {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
    } catch (err) {
      process.stderr.write(`[sparda] --probe: failed to spawn python: ${err.message}\n`);
      clearTimeout(killTimer);
      resolve_([]);
      return;
    }

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr?.on('data', () => {});
    child.on('error', (err) => {
      process.stderr.write(`[sparda] --probe: python child error: ${err.message}\n`);
      settle([]);
    });
    child.on('exit', () => {
      settle(parsePythonOutput(Buffer.concat(stdoutChunks).toString('utf8')));
    });
  });
}

function parsePythonOutput(raw) {
  try {
    const arr = JSON.parse(raw.trim());
    if (!Array.isArray(arr)) return [];
    return arr.map((r) => ({
      method: normalizeMethod(r.method),
      path: normalizeFastAPIParams(r.path ?? '/'),
      pathParams: extractPathParams(r.path ?? '/'),
      source: 'dynamic',
      writeClass: WRITE_METHODS.has(normalizeMethod(r.method)) ? 'write' : 'read',
    }));
  } catch {
    return [];
  }
}

// ── Python resolver (cross-platform, §A.5.4 + §A.6) ──────────────────────────
//
// §A.5.4: use spawnSync with separate args array — no shell string, works on
//         Windows cmd.exe (no `||`, no `2>/dev/null`).
// §A.6:   1500 ms timeout kills MS Store stub that never returns.

async function resolvePython() {
  const candidates = platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    if (await checkCommand(cmd)) return cmd;
  }
  return null;
}

function checkCommand(cmd) {
  return new Promise((res) => {
    let child;
    // §A.6: 1500 ms timeout — kills Microsoft Store python stub that hangs
    const timer = setTimeout(() => {
      try {
        child && child.kill();
      } catch {}
      res(false);
    }, 1500);

    try {
      child = spawn(cmd, ['--version'], { stdio: 'ignore' });
    } catch {
      clearTimeout(timer);
      res(false);
      return;
    }

    child.on('error', () => {
      clearTimeout(timer);
      res(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      res(code === 0);
    });
  });
}

// ── Normalization helpers ─────────────────────────────────────────────────────

function normalizeMethod(m) {
  const upper = (m ?? 'GET').toUpperCase();
  return upper === 'DEL' ? 'DELETE' : upper;
}

function normalizePath(p) {
  return ('/' + (p ?? '').replace(/^\/+/, '')).replace(/\/+/g, '/') || '/';
}

function normalizeFastAPIParams(path) {
  return (path ?? '/').replace(/\{([^}]+)\}/g, ':$1').replace(/\/+/g, '/') || '/';
}

function extractPathParams(path) {
  const params = [];
  for (const m of (path ?? '').matchAll(/:([a-zA-Z_]\w*)/g)) params.push(m[1]);
  for (const m of (path ?? '').matchAll(/\{([^}]+)\}/g)) {
    if (!params.includes(m[1])) params.push(m[1]);
  }
  return params;
}
