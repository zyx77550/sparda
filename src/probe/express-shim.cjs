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

  // Did we ever get our hands on the express module? The probe used to report "the app did not
  // boot" for this, which is a WRONG diagnosis — sending the user to debug their app when the
  // app was fine and the SHIM never hooked (E-109). Reported to the parent so the reason it
  // prints is the true one.
  let patched = false;

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
    flush(); // the staged routes must go out BEFORE the parent is told there are no more
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

  // ── Routes are STAGED, not emitted — the mount point is not known yet ──────
  //
  // E-110. `usersRouter.get('/:id')` runs at import time; `app.use('/api/users', usersRouter)`
  // runs later. Emitting at registration therefore reported `GET /:id`, and reconcile compared
  // that against the compiler's (correct) `/api/users/:id` and called it a route the app serves
  // and the compiler never saw. On demo-app: two FALSE premise gaps out of three.
  //
  // False gaps are in the SAFE direction for a verdict — they only make SPARDA refuse to claim
  // PROVEN — which is exactly why this could sit unnoticed. They are in the WRONG direction for
  // anything that consumes gaps as findings: every real Express app uses routers, so the most
  // load-bearing signal the runtime oracle produces was also its noisiest.
  //
  // So: buffer each route with the OBJECT it was registered on, record the mount edges, and
  // resolve full paths once the app is fully wired (at `listen`, or on idle).
  const staged = [];
  const mounts = []; // { parent, child, path }
  let flushed = false;

  function stage(owner, method, path) {
    staged.push({ owner, method, path });
    resetIdle();
  }

  const joinPaths = (prefix, path) => {
    const a = String(prefix || '').replace(/\/+$/, '');
    const b = String(path || '');
    if (b === '/' || b === '') return a || '/';
    return a + (b.startsWith('/') ? b : '/' + b) || '/';
  };

  // Every full path this owner is reachable at. A router CAN be mounted more than once, and then
  // its routes genuinely exist at several paths — so this returns a list, never a single answer.
  function prefixesOf(owner, depth = 0) {
    if (depth > 12) return ['']; // pathological nesting or a cycle — stop, do not hang
    const edges = mounts.filter((m) => m.child === owner);
    if (edges.length === 0) return ['']; // a root (the app itself, or an unmounted router)
    const out = [];
    for (const e of edges) {
      for (const up of prefixesOf(e.parent, depth + 1)) out.push(joinPaths(up, e.path));
    }
    return out.length ? out : [''];
  }

  function flush() {
    if (flushed) return;
    flushed = true;
    const seen = new Set();
    for (const r of staged) {
      for (const prefix of prefixesOf(r.owner)) {
        const full = joinPaths(prefix, r.path);
        const key = `${r.method} ${full}`;
        if (seen.has(key)) continue; // the same route reached twice is one route
        seen.add(key);
        sendMsg({ type: 'route', method: r.method, path: full });
      }
    }
    staged.length = 0;
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
          stage(this, verb, path);
        }
        return orig.call(this, path, ...rest);
      };
    }

    // `use` is what makes a path mean something. Recorded, never altered: we only need to know
    // WHICH object was mounted WHERE, so a route registered on it can be reported at the address
    // the framework actually serves it from.
    if (typeof target.use === 'function' && !target.__sparda_use_wrapped__) {
      const origUse = target.use;
      target.use = function spardaUse(...args) {
        const mountPath = typeof args[0] === 'string' ? args[0] : '/';
        for (const h of args) {
          // A mounted router is a function carrying a middleware `stack` — that is what tells it
          // apart from a plain handler like `express.json()`.
          if (typeof h === 'function' && Array.isArray(h.stack))
            mounts.push({ parent: this, child: h, path: mountPath });
        }
        return origUse.apply(this, args);
      };
      try {
        Object.defineProperty(target, '__sparda_use_wrapped__', {
          value: true,
          configurable: true,
        });
      } catch {}
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
    if (request === 'express') {
      patched = true;
      patchExpress(result);
    }
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
      if (cached && cached.exports) {
        patched = true;
        patchExpress(cached.exports);
      }
    }
  } catch {}

  // ── ESM entries: the hook above CANNOT fire, so pull express in ourselves ──
  //
  // E-109. `Module._load` interception is a CJS-loader mechanism. On Node 22 an ESM
  // `import express from 'express'` does NOT go through `Module._load` — measured, and it
  // contradicts the comment this shim's ESM wrapper used to carry. So for every Express app
  // written in ESM (the modern default: `.mjs`, or `.js` under `"type": "module"`) the shim
  // installed itself and then intercepted nothing, forever. The probe reported a timeout, the
  // premise stayed `unmeasured`, and an ESM Express app could never reach PROVEN.
  //
  // The fix does not need a loader hook. express is CJS, and a CJS module loaded through the
  // ESM bridge comes from the SAME `require.cache`: so if we require it FIRST, the app's later
  // `import` receives the already-patched instance. Verified — the marker survives the import.
  //
  // Resolved from the ENTRY FILE, never from this shim's own directory: SPARDA carries express
  // as a devDependency, and patching SPARDA's copy while the app imports its own would hook a
  // module nobody uses — the same instance-identity trap, one level down.
  if (!patched) {
    try {
      const path = require('path');
      const from = process.argv[1] || path.join(process.cwd(), 'index.js');
      const appRequire = Module.createRequire(path.resolve(from));
      appRequire('express'); // goes through Module._load → sets `patched`, runs patchExpress
    } catch {
      // no express resolvable from the app — `patched` stays false and the parent is told so,
      // which is a different statement from "the app did not boot"
    }
  }

  sendMsg({ type: '__shim__', patched });

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

  module.exports = { stage, flush, sendDone };
}
