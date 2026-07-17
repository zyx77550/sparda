// ubg/nextjs.js — Next.js App Router → route facts for the UBG translator.
// Same filesystem-is-the-router walk as parser/nextjs.js, but each verb export
// carries its function body so the microscope can scan effects and response
// shapes. Middleware.ts (root) is surfaced as a global guard candidate —
// Next's convention puts auth there more often than anywhere else.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule, resolveExportedFunction, scanFunction } from './extract.js';
import { walkCalls } from './resolve.js';

const VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ROUTE_FILES = new Set([
  'route.js',
  'route.ts',
  'route.mjs',
  'route.jsx',
  'route.tsx',
]);
const EXCLUDE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.sparda']);

export function extractNext(cwd, appDir) {
  const routes = [];
  const globalMiddlewares = [];
  const helpers = [];
  const skipped = [];
  const scannedFiles = [];
  const seen = new Set();

  // root middleware.ts — global gate over matched paths
  for (const mwName of ['middleware.ts', 'middleware.js', 'src/middleware.ts']) {
    const abs = path.resolve(cwd, mwName);
    if (!fs.existsSync(abs)) continue;
    const mod = parseModule(abs);
    if (mod.error) continue;
    const fn = mod.functions.get('middleware') ?? mod.functions.get('default');
    if (fn) {
      globalMiddlewares.push({
        name: 'middleware',
        role: 'middleware',
        sourceFile: rel(abs),
        sourceLine: fn.line,
        fn: fn.node,
      });
      scannedFiles.push(rel(abs));
    }
    break;
  }

  walk(path.resolve(cwd, appDir), []);
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { routes, globalMiddlewares, helpers, skipped, scannedFiles };

  function walk(dir, segments) {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        const name = item.name;
        if (EXCLUDE.has(name) || name.startsWith('_')) continue;
        if (name.startsWith('@')) {
          skipped.push({
            reason: `parallel route slot ${name} — not a URL segment, skipped`,
            file: rel(abs),
          });
          continue;
        }
        if (/^\(\.{1,3}\)/.test(name)) {
          skipped.push({
            reason: `intercepting route ${name} — UI-layer routing, skipped`,
            file: rel(abs),
          });
          continue;
        }
        if (/^\[\[\.\.\..+\]\]$/.test(name) || /^\[\.\.\..+\]$/.test(name)) {
          skipped.push({
            reason: `catch-all segment ${name} — variable-arity paths not supported`,
            file: rel(abs),
          });
          continue;
        }
        if (/^\(.+\)$/.test(name)) {
          walk(abs, segments); // route group — stripped from the URL
          continue;
        }
        const m = name.match(/^\[(.+)\]$/);
        walk(abs, [...segments, m ? `:${m[1]}` : name]);
      } else if (item.isFile() && ROUTE_FILES.has(item.name)) {
        parseRouteFile(abs, '/' + segments.join('/') || '/');
      }
    }
  }

  function parseRouteFile(absFile, urlPath) {
    const mod = parseModule(absFile);
    const relFile = rel(absFile);
    if (mod.error) {
      skipped.push({ reason: `${mod.error} in ${relFile}`, file: relFile });
      return;
    }
    scannedFiles.push(relFile);

    for (const [name, f] of mod.functions) {
      if (VERBS.has(name)) continue; // verbs become route chains, not helpers
      helpers.push({ name, sourceFile: relFile, sourceLine: f.line, fn: f.node });
    }

    const handlers = verbHandlers(mod);
    for (const verb of [...VERBS].sort()) {
      const f = handlers.get(verb);
      if (!f) continue;
      const key = `${verb} ${urlPath}`;
      if (seen.has(key)) {
        skipped.push({
          reason: `route group collision: ${key} already extracted`,
          file: relFile,
          line: f.line,
        });
        continue;
      }
      seen.add(key);
      // A Next route usually authenticates through a HOC auth wrapper —
      // `export const POST = withWorkspace(handler)`. The wrapper is the guard; the
      // handler is the body. Resolve each wrapper and, when it PROVABLY denies
      // (401/403, an auth exception, or a `{ code: "unauthorized" }` error shape),
      // prepend it as a VERIFIED guard step so the mutation reads as gated — not a
      // false UNGUARDED_MUTATION. Wrappers we cannot prove to deny are left out, so
      // a genuinely open route still flags. (dub: withWorkspace/withSession.)
      const guardSteps = [];
      for (const wname of f.wrappers) {
        const scan = wrapperGuardScan(wname, mod);
        if (scan)
          guardSteps.push({
            name: wname,
            role: 'middleware',
            sourceFile: relFile,
            sourceLine: f.line,
            fn: null,
            scan,
          });
      }
      // In-body verifier: a plain handler that gates itself by calling an imported
      // auth-verifier which provably denies — `verifyQstashSignature(req)` throws
      // `{ code: "unauthorized" }` before any write (dub's cron routes, no wrapper). A
      // guard, just inlined. Gated on BOTH a verifier-shaped name AND a proven deny, so
      // it never suppresses a real hole on some unrelated 401 deep in a helper.
      if (guardSteps.length === 0 && f.fn) {
        const bg = bodyGuardScan(f.fn, mod);
        if (bg)
          guardSteps.push({
            name: bg,
            role: 'middleware',
            sourceFile: relFile,
            sourceLine: f.line,
            fn: null,
            scan: {
              effects: [],
              returnShapes: [],
              calls: [],
              async: true,
              validatesInput: false,
              guardSignals: { deniesWithStatus: true },
            },
          });
      }
      routes.push({
        method: verb.toLowerCase(),
        path: urlPath,
        sourceFile: relFile,
        sourceLine: f.line,
        params: [...urlPath.matchAll(/:(\w+)/g)].map((m) => ({
          name: m[1],
          in: 'path',
          type: 'string',
          required: true,
        })),
        chain: [
          ...guardSteps,
          {
            name: verb,
            role: 'handler',
            sourceFile: relFile,
            sourceLine: f.line,
            fn: f.fn, // resolved handler node, or null (route registered, body blind)
          },
        ],
        description: '',
      });
    }
  }

  function rel(abs) {
    return path.relative(cwd, abs).split(path.sep).join('/');
  }
}

// Every exported HTTP verb in a route file → { fn|null, line }. A route EXISTS as soon
// as it exports `GET`/`POST`/… — regardless of whether we can see the handler body. Real
// Next apps rarely inline the handler: they alias it (`export const GET = handler`), wrap
// it (`export const POST = withAuth(postHandler)`), or re-export it (`export { GET }`).
// The old lookup only matched an inline function, so it silently dropped ~90% of routes on
// cal.com / formbricks. We register the route either way, resolving the body when we can
// (a local function, or the wrapped/aliased local function) and leaving it blind otherwise.
function verbHandlers(mod) {
  const out = new Map();
  const set = (name, fn, line, wrappers) => {
    if (VERBS.has(name) && !out.has(name))
      out.set(name, { fn: fn ?? null, line: line ?? 0, wrappers: wrappers ?? [] });
  };
  for (const node of mod.ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    const d = node.declaration;
    if (d?.type === 'FunctionDeclaration' && d.id) {
      set(d.id.name, d, d.loc?.start.line);
    } else if (d?.type === 'VariableDeclaration') {
      for (const decl of d.declarations) {
        if (decl.id?.type === 'Identifier') {
          const { fn, wrappers } = resolveHandlerExpr(decl.init, mod);
          set(decl.id.name, fn, decl.loc?.start.line, wrappers);
        }
      }
    } else if (!d && node.specifiers) {
      // export { GET, postHandler as POST } — resolve the local binding to a function
      for (const spec of node.specifiers) {
        if (spec.type !== 'ExportSpecifier' || spec.exported.type !== 'Identifier')
          continue;
        set(
          spec.exported.name,
          mod.functions.get(spec.local.name)?.node,
          spec.local.loc?.start.line,
        );
      }
    }
  }
  return out;
}

// resolve an `export const VERB = <init>` right-hand side to a scannable function node
// (or null — route still registered, body blind) PLUS the names of any HOC wrappers the
// handler is nested inside. Handles inline fns, local aliases, and wrapper calls whose
// handler is an inline fn or a local-function identifier argument. The wrapper names feed
// guard resolution: `withWorkspace(handler)` is auth, not just a passthrough.
function resolveHandlerExpr(init, mod) {
  if (!init) return { fn: null, wrappers: [] };
  if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
    return { fn: init, wrappers: [] };
  if (init.type === 'Identifier') {
    // alias to another verb: `export const PUT = PATCH` where `const PATCH =
    // withWorkspace(handler)`. Follow the alias to its initializer so the wrapper
    // (the guard) is carried, not dropped — else PUT reads as unguarded while PATCH
    // reads as guarded, on byte-identical behavior. (dub: PUT = PATCH on 3 routes.)
    const aliased = localConstInit(init.name, mod);
    if (aliased && aliased.type === 'CallExpression')
      return resolveHandlerExpr(aliased, mod);
    return { fn: mod.functions.get(init.name)?.node ?? null, wrappers: [] };
  }
  if (init.type === 'CallExpression') {
    const wrappers = wrapperNamesOf(init);
    for (const a of init.arguments)
      if (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')
        return { fn: a, wrappers };
    for (const a of init.arguments)
      if (a.type === 'Identifier' && mod.functions.get(a.name))
        return { fn: mod.functions.get(a.name).node, wrappers };
    return { fn: null, wrappers };
  }
  return { fn: null, wrappers: [] };
}

// the initializer of a top-level `const <name> = <init>` in this module (plain or
// `export const`) — used to follow a verb alias to the wrapped handler it points at.
function localConstInit(name, mod) {
  for (const node of mod.ast.program.body) {
    const d =
      node.type === 'ExportNamedDeclaration' && node.declaration
        ? node.declaration
        : node;
    if (d.type !== 'VariableDeclaration') continue;
    for (const decl of d.declarations)
      if (decl.id?.type === 'Identifier' && decl.id.name === name) return decl.init;
  }
  return null;
}

// the wrapper callee names around a handler, outermost first — `withWorkspace(...)` and
// any nested `withA(withB(handler))`. Both plain (`withWorkspace(h)`) and member
// (`auth.protect(h)`) callees count.
function wrapperNamesOf(callNode) {
  const names = [];
  let cur = callNode;
  while (cur && cur.type === 'CallExpression') {
    const n = calleeNameOf(cur.callee);
    if (n) names.push(n);
    cur = cur.arguments.find((a) => a.type === 'CallExpression');
  }
  return names;
}
function calleeNameOf(callee) {
  if (callee?.type === 'Identifier') return callee.name;
  if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier')
    return callee.property.name;
  return null;
}

// Resolve a HOC wrapper by name to its defining function and prove whether it can DENY
// (401/403, an auth exception, or a `{ code: "unauthorized" }` error shape) — deep-scanned
// so a deny buried in the wrapper's returned inner function still counts. Returns a minimal
// scan carrying ONLY the deny signal (never the wrapper's own reads), so the guard node
// earns `verified` without importing the wrapper's behavior into the app graph. null when
// the wrapper is unresolvable or cannot be proven to deny — a route stays honestly open.
function wrapperGuardScan(name, mod) {
  const file = mod.imports.get(name);
  if (!file) return null;
  const hit = resolveExportedFunction(parseModule(file), name);
  if (!hit) return null;
  if (!provesDeny(hit.fn.node, hit.mod, new Set(), 0)) return null;
  return {
    effects: [],
    returnShapes: [],
    calls: [],
    async: Boolean(hit.fn.node.async),
    validatesInput: false,
    guardSignals: { deniesWithStatus: true },
  };
}

// A directly-called imported function whose NAME reads as an auth verifier. Tight on
// purpose (E-029): the double gate — this name AND a proven 401/403 deny — is what keeps
// in-body recognition from suppressing a genuine hole on an incidental error-path 401.
const AUTH_VERIFIER = /^(verify|authenticate|authorize|require|assert|ensure)/i;

// Does the handler gate ITSELF by directly calling an imported auth verifier that
// provably denies? Returns the verifier's name (→ a synthetic verified guard) or null.
function bodyGuardScan(fnNode, mod) {
  let hitName = null;
  walkCalls(fnNode, (node) => {
    if (hitName) return;
    const callee = node.callee;
    if (callee.type !== 'Identifier' || !AUTH_VERIFIER.test(callee.name)) return;
    const file = mod.imports.get(callee.name);
    if (!file) return;
    const hit = resolveExportedFunction(parseModule(file), callee.name);
    if (hit && provesDeny(hit.fn.node, hit.mod, new Set(), 0)) hitName = callee.name;
  });
  return hitName;
}

const MAX_DENY_DEPTH = 6;

// Can this function PROVABLY deny? A guard-only walk (never the app graph), so it may
// follow calls the effect engine deliberately doesn't: a HOC delegates its rejection to
// a bare helper — `withCron` → `verifyVercelSignature(req)` → `throw new DubApiError({
// code: "unauthorized" })` — and the effect engine only follows member calls. Here we
// follow BOTH bare and `mod.method()` imported calls, collecting only the deny signal.
// Bounded by depth + a per-walk `seen` set; nested functions are covered because
// scanFunction and walkCalls both descend the whole subtree.
function provesDeny(fnNode, mod, seen, depth) {
  if (depth >= MAX_DENY_DEPTH || !fnNode || mod.error) return false;
  if (scanFunction(fnNode).guardSignals.deniesWithStatus) return true;
  let found = false;
  walkCalls(fnNode, (node) => {
    if (found) return;
    const callee = node.callee;
    const name =
      callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier' &&
            callee.property.type === 'Identifier'
          ? callee.property.name
          : null;
    const holder =
      callee.type === 'MemberExpression' && callee.object.type === 'Identifier'
        ? callee.object.name
        : name;
    const file = name ? mod.imports.get(holder) : null;
    if (!file) return;
    const key = `${file}#${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const hit = resolveExportedFunction(parseModule(file), name);
    if (hit && provesDeny(hit.fn.node, hit.mod, seen, depth + 1)) found = true;
  });
  return found;
}
