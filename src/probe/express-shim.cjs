/**
 * SPARDA — Express GFP Shim v2 (CJS, loaded via --require / createRequire)
 *
 * CRITICAL FIX over v1: v1 patched RouterClass.prototype[method] where
 * RouterClass = express.Router. On Express 4, Router has NO prototype HTTP
 * methods — they live on express.application and on the Router function object
 * itself. v1 captured ZERO routes on any normal app.get/post/... call.
 *
 * v2 wraps ALL THREE public surfaces with feature-detection:
 *   - express.application          → catches app.get/post/... (Express 4 & 5)
 *   - express.Router (fn object)   → catches router.get/... in Express 4
 *   - express.Router.prototype     → catches router.get/... in Express 5
 *
 * Also fixed: app.listen is on express.application, not Router.prototype.
 * Fixed: callback passed to app.listen is now called so post-listen routes
 *        are captured (ANALYSE-POST-LIVRAISON §2).
 * Added: proactive require.cache patch for monorepos (ANALYSE §1).
 *
 * Communication: fork IPC (process.send) preferred, TCP fallback on
 * SPARDA_IPC_PORT for spawn() callers.
 *
 * CJS because Node's --require only loads CommonJS modules.
 */

'use strict';

if (!process.env.SPARDA_PROBE) {
  module.exports = {};
} else {
  installShim();
}

function installShim() {
  const net = require('net');
  const Module = require('module');

  const IPC_PORT = parseInt(process.env.SPARDA_IPC_PORT, 10) || 0;

  // ── Transport: fork IPC or TCP fallback ────────────────────────────────────

  let socket = null;
  let socketReady = false;
  const pending = [];

  function connectTcp() {
    if (socket || !IPC_PORT) return;
    socket = new net.Socket();
    socket.connect(IPC_PORT, '127.0.0.1', () => {
      socketReady = true;
      for (const line of pending) socket.write(line);
      pending.length = 0;
    });
    socket.on('error', () => {
      socket = null;
      socketReady = false;
    });
  }

  function sendLine(line) {
    if (typeof process.send === 'function') {
      try {
        process.send(JSON.parse(line.trimEnd()));
        return;
      } catch {}
    }
    connectTcp();
    if (socketReady && socket) socket.write(line);
    else pending.push(line);
  }

  function sendMsg(obj) {
    sendLine(JSON.stringify(obj) + '\n');
  }

  function sendDone() {
    if (typeof process.send === 'function') {
      try {
        process.send({ type: '__done__' });
      } catch {}
      return;
    }
    const finish = () => {
      if (socket) socket.write('__SPARDA_DONE__\n', () => socket.destroy());
    };
    if (socketReady) finish();
    else if (socket) socket.once('connect', finish);
  }

  // ── Idle-flush timer ───────────────────────────────────────────────────────

  const IDLE_MS = 300;
  let idleTimer = null;

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(sendDone, IDLE_MS);
  }

  function record(method, path) {
    sendMsg({ type: 'route', method, path });
    resetIdle();
  }

  // ── HTTP method list ───────────────────────────────────────────────────────

  const HTTP_METHODS = [
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'del',
    'head',
    'options',
    'all',
  ];

  // ── Core wrapper — works on any target object ──────────────────────────────
  //
  // §A.3 exact algorithm: wrap each HTTP method on `target` if present.
  // Guard with __sparda_wrapped__ so re-entrant calls from require.cache
  // patch (monorepo) don't double-wrap.

  function wrapMethods(target) {
    if (!target || target.__sparda_wrapped__) return;
    for (const m of HTTP_METHODS) {
      if (typeof target[m] !== 'function') continue;
      const orig = target[m];
      target[m] = function spardaWrap(path, ...rest) {
        // Express 4: app.get('view engine') with ONE arg is a settings getter.
        // Only record route registrations (path + at least one handler/middleware).
        if (typeof path === 'string' && rest.length > 0) {
          const verb = m === 'del' ? 'DELETE' : m.toUpperCase();
          record(verb, path);
        }
        return orig.call(this, path, ...rest);
      };
    }
    try {
      Object.defineProperty(target, '__sparda_wrapped__', {
        value: true,
        configurable: true,
      });
    } catch {}
  }

  // ── listen patch — lives on express.application ───────────────────────────
  //
  // §A.4: listen is NOT on Router; it's on express.application.
  // We intercept it to:
  //   (a) call any callback immediately (captures post-listen routes, §ANALYSE §2)
  //   (b) flush DONE so parent knows all sync routes are registered
  //   (c) return a fake server — no real socket opened in probe mode

  function patchListen(appProto) {
    if (!appProto || appProto.__sparda_listen_patched__) return;
    if (typeof appProto.listen !== 'function') return;
    try {
      Object.defineProperty(appProto, '__sparda_listen_patched__', {
        value: true,
        configurable: true,
      });
    } catch {}
    appProto.listen = function spardaListen(...args) {
      clearTimeout(idleTimer);
      // §ANALYSE §2: call the listen callback so routes registered inside it are captured
      const cb = args.find((a) => typeof a === 'function');
      if (cb) {
        try {
          cb();
        } catch {}
      }
      sendDone();
      // Do NOT call origListen — no real socket in probe mode
      return {
        on() {
          return this;
        },
        close() {},
        address() {
          return { port: 0, address: '127.0.0.1', family: 'IPv4' };
        },
      };
    };
  }

  // ── Patch all three surfaces of an express export ─────────────────────────

  function patchExpress(exp) {
    if (!exp || exp.__sparda_factory_patched__) return;
    try {
      Object.defineProperty(exp, '__sparda_factory_patched__', {
        value: true,
        configurable: true,
      });
    } catch {}

    // Surface 1: express.application — catches app.get/post/... (Express 4 & 5)
    if (exp.application) {
      wrapMethods(exp.application);
      patchListen(exp.application);
    }

    // Surface 2: express.Router (function object) — catches router.get/... in Express 4
    if (exp.Router) {
      wrapMethods(exp.Router);
    }

    // Surface 3: express.Router.prototype — catches router.get/... in Express 5
    if (exp.Router && exp.Router.prototype) {
      wrapMethods(exp.Router.prototype);
    }
  }

  // ── Intercept require('express') via Module._load ─────────────────────────

  const originalLoad = Module._load;
  Module._load = function spardaLoad(request) {
    const result = originalLoad.apply(this, arguments);
    if (request === 'express') patchExpress(result);
    return result;
  };

  // ── Monorepo: proactive patch if express already in require.cache ─────────
  // §ANALYSE §1: if another workspace module already required express before
  // this shim loaded, Module._load hook fires too late. Patch the cached export.

  try {
    const expressPaths = Object.keys(require.cache).filter((k) =>
      /[/\\]express[/\\]index\.js$/.test(k),
    );
    for (const p of expressPaths) {
      const cached = require.cache[p];
      if (cached && cached.exports) patchExpress(cached.exports);
    }
  } catch {}

  // ── Safety nets ────────────────────────────────────────────────────────────

  process.on('exit', () => {
    try {
      sendDone();
    } catch {}
  });
  process.on('SIGTERM', () => {
    sendDone();
    setTimeout(() => process.exit(0), 200);
  });

  module.exports = { record, sendDone };
}
