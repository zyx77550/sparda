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

  // Which shim FLAG is used turns out not to matter, and that is worth stating because the
  // obvious "fix" for E-109 was to detect `"type": "module"` here and switch to `--import`. It
  // changes nothing measurable: `--require` preloads the CJS shim fine ahead of an ESM entry, and
  // the shim's own eager `require('express')` is what actually closes the hole. A second
  // mechanism that no test can distinguish is dead weight — E-106, one week old, is what happens
  // when such a line is kept.
  const isEsm = ext === '.mjs';
  const shimFlag = isEsm ? ['--import', SHIM_ESM] : ['--require', SHIM_CJS];

  const routes = [];
  let child;

  // WHY the probe saw nothing is a different fact from THAT it saw nothing, and the old code
  // could only say the second (E-109). It reported every silence as "the app did not boot",
  // which sent users to debug a healthy app while the real cause was the shim never hooking.
  // `shimPatched` stays null until the child says; the child's stderr is KEPT rather than
  // dropped on the floor, because it is the only place an app's own crash is written down.
  let shimPatched = null;
  let timedOut = false;
  let exitCode = null;
  let stderrTail = '';

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
      // Non-enumerable so `probeRoutes` keeps returning exactly an array of routes: every
      // existing caller and assertion is untouched, and the reason travels with it.
      Object.defineProperty(result, 'diagnostic', {
        value: diagnose({
          count: result.length,
          shimPatched,
          timedOut,
          exitCode,
          stderrTail,
        }),
        enumerable: false,
      });
      resolve_(result);
    }

    killTimer = setTimeout(() => {
      timedOut = true;
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

    // KEPT, capped. The target's own boot error ("cannot connect to postgres") is written
    // nowhere else, and discarding it is what made a shim that hooked nothing look identical
    // to an app that refused to start.
    child.stderr?.on('data', (chunk) => {
      if (stderrTail.length < 4000) stderrTail += String(chunk);
    });

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === '__shim__') {
        shimPatched = msg.patched === true;
        return;
      }
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

    // `exit` gives the code; `close` is the one that means the stdio streams have been fully
    // drained. Settling on `exit` races the last chunk of the child's stderr — under load the
    // diagnostic came out without the very error it exists to carry.
    child.on('exit', (code) => {
      exitCode = code;
    });
    child.on('close', () => settle(routes));
  });
}

/**
 * Why did the probe see what it saw? Four distinguishable states, and the point of naming them
 * is that three of them used to print as the fourth (E-109):
 *
 *   observed        routes came back — nothing to explain
 *   not-instrumented the shim never got hold of express. NOT a boot failure: the app may be
 *                   running perfectly. This is the ESM case, and the one that hid for a release.
 *   no-routes       express WAS instrumented and the app registered none before we stopped.
 *   did-not-start   the child never reported in at all, or exited non-zero — the app itself.
 *
 * `reason` is the sentence a user acts on, so it must never assert the app is broken when what
 * actually happened is that SPARDA could not look.
 */
export function diagnose({ count, shimPatched, timedOut, exitCode, stderrTail }) {
  const tail = String(stderrTail || '')
    .trim()
    .split('\n')
    .slice(-3)
    .join(' | ')
    .slice(0, 300);
  if (count > 0)
    return { state: 'observed', reason: `${count} route(s) observed at runtime` };
  // A non-zero exit wins over everything below: whatever we managed to instrument, the app
  // itself died, and that is the fact its author needs. (Our own timeout SIGKILLs the child,
  // which leaves exitCode null — so this cannot swallow the timeout cases.)
  if (exitCode != null && exitCode !== 0)
    return {
      state: 'did-not-start',
      reason: `the app exited ${exitCode} before serving anything`,
      stderrTail: tail,
    };
  if (shimPatched === false)
    return {
      state: 'not-instrumented',
      reason:
        'the probe never got hold of the express module, so nothing could be observed — the app may well be running fine (this is not a boot failure)',
      stderrTail: tail,
    };
  if (shimPatched === true)
    return {
      state: 'no-routes',
      reason: timedOut
        ? 'express was instrumented but no route was registered before the timeout — the app may boot slowly or block on a dependency'
        : 'express was instrumented and the app registered no routes',
      stderrTail: tail,
    };
  return {
    state: 'did-not-start',
    reason: `the probe child never reported in${exitCode != null ? ` (exit ${exitCode})` : ''} — the app did not start`,
    stderrTail: tail,
  };
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
