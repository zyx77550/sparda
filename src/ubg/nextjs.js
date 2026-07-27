// ubg/nextjs.js — Next.js App Router → route facts for the UBG translator.
// Same filesystem-is-the-router walk as parser/nextjs.js, but each verb export
// carries its function body so the microscope can scan effects and response
// shapes. Middleware.ts (root) is surfaced as a global guard candidate —
// Next's convention puts auth there more often than anywhere else.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule, resolveExportedFunction, scanFunction } from './extract.js';
import { walkCalls } from './resolve.js';

// Every method the App Router lets a route file export. OPTIONS and HEAD were
// missing, so a route file whose ONLY export was one of them read as no route at
// all — the Next twin of the ghost-verb class (E-067).
const VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

// Read `export const config = { matcher: "…" | ["…", …] }` from a middleware module.
// Returns { patterns: string[]|null, unresolved: boolean }. patterns=null means no
// matcher (Next runs the middleware on every path). unresolved=true means a matcher
// exists but isn't a static string/array we can evaluate — the SOUND response is to
// NOT credit the guard (never a false PROVEN), handled in middlewareCovers().
export function readMatcher(mod) {
  if (!mod?.ast) return { patterns: null, unresolved: false };
  for (const node of mod.ast.program.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id?.name !== 'config' || d.init?.type !== 'ObjectExpression') continue;
      const m = d.init.properties.find(
        (p) => (p.key?.name ?? p.key?.value) === 'matcher',
      );
      if (!m) return { patterns: null, unresolved: false }; // config without matcher = all paths
      const lit = (n) => (n?.type === 'StringLiteral' ? n.value : null);
      if (lit(m.value) !== null) return { patterns: [lit(m.value)], unresolved: false };
      if (m.value?.type === 'ArrayExpression') {
        const out = m.value.elements.map(lit);
        return out.every((s) => s !== null)
          ? { patterns: out, unresolved: false }
          : { patterns: null, unresolved: true };
      }
      return { patterns: null, unresolved: true }; // computed matcher — can't decide
    }
  }
  return { patterns: null, unresolved: false };
}

// Does a middleware with these matcher patterns run on `routePath`? Returns
// true | false | null(=unknown). Handles the two dominant vibe-coded forms:
// positive path globs (`/dashboard/:path*`) and the negative-lookahead exclude
// (`/((?!api/|_next/).*)`). Anything else → null, and the caller treats unknown
// as "do not attribute the guard" so an unresolved matcher never fabricates a proof.
export function matcherCovers(patterns, routePath) {
  let anyUnknown = false;
  for (const p of patterns) {
    const r = onePattern(p, routePath);
    if (r === true) return true;
    if (r === null) anyUnknown = true;
  }
  return anyUnknown ? null : false;
}

function onePattern(pattern, routePath) {
  if (typeof pattern !== 'string' || pattern[0] !== '/') return null;
  // negative lookahead: "/((?!api/|_next/|favicon.ico).*)" → covers everything but the excludes
  const neg = pattern.match(/^\/\(\(\?!(.+?)\)\.\*\)\/?$/);
  if (neg) {
    const excludes = neg[1].split('|').map((s) => '/' + s.replace(/\/$/, ''));
    return !excludes.some((ex) => routePath === ex || routePath.startsWith(ex + '/'));
  }
  // any other regex-ish pattern → not statically decidable here
  if (/[()?!+^$|\\]/.test(pattern)) return null;
  // positive path glob: `:seg` and `*` are wildcards, everything else literal.
  // `/:path*` (slash + star modifier) matches zero-or-more trailing segments, so
  // `/dashboard/:path*` covers `/dashboard` itself as well as `/dashboard/x`.
  const rx = new RegExp(
    '^' +
      pattern
        .replace(/[.]/g, '\\$&')
        .replace(/\/:[A-Za-z0-9_]+\*/g, '(?:/.*)?')
        .replace(/:[A-Za-z0-9_]+\*/g, '.*')
        .replace(/:[A-Za-z0-9_]+/g, '[^/]+')
        .replace(/\*/g, '.*') +
      '$',
  );
  return rx.test(routePath);
}
const ROUTE_FILES = new Set([
  'route.js',
  'route.ts',
  'route.mjs',
  'route.jsx',
  'route.tsx',
]);
// Inside `app/`, a directory name is a URL SEGMENT — nothing else. `dist` and `build`
// used to sit in this set, so `app/dist/route.ts` (which Next serves at `/dist`, the
// name meaning nothing to it) was skipped without a route, a skip or an unknown handler:
// invisible on all three channels. Only build artefacts that could never be a segment
// anyone routes on stay excluded.
const EXCLUDE = new Set(['node_modules', '.git', '.next', '.sparda']);

export function extractNext(cwd, appDir) {
  const routes = [];
  const globalMiddlewares = [];
  const helpers = [];
  const skipped = [];
  // the registration invariant (ADR-079): a surface seen but unbindable is DECLARED
  const unknownHandlers = [];
  const scannedFiles = [];
  const seen = new Set();

  // root middleware.ts — global gate over matched paths
  for (const mwName of ['middleware.ts', 'middleware.js', 'src/middleware.ts']) {
    const abs = path.resolve(cwd, mwName);
    if (!fs.existsSync(abs)) continue;
    const mod = parseModule(abs);
    if (mod.error) {
      // The middleware file IS the app's global guard. Losing it silently is the worst
      // direction of all: every route then reads as unguarded (noise) or, if another
      // guard covers them, the app reads clean over a protection SPARDA never verified.
      skipped.push({
        reason: `${mod.error} in ${rel(abs)} — this file is the app's global middleware, so its protection is entirely unread`,
        file: rel(abs),
        risk: 'high',
      });
      unknownHandlers.push({
        kind: 'UnknownHandler',
        via: 'unparseable-middleware',
        target: rel(abs),
        file: rel(abs),
      });
      continue;
    }
    const fn = mod.functions.get('middleware') ?? mod.functions.get('default');
    if (fn) {
      // `export const config = { matcher: [...] }` scopes which paths the middleware
      // runs on. Ignoring it is a FALSE-PROVEN generator: a middleware that denies
      // for /dashboard would otherwise be credited as a guard on /api too. Carry the
      // matcher so the translator only attributes the guard to paths it truly covers.
      const { patterns, unresolved } = readMatcher(mod);
      globalMiddlewares.push({
        name: 'middleware',
        role: 'middleware',
        sourceFile: rel(abs),
        sourceLine: fn.line,
        fn: fn.node,
        matcherPatterns: patterns, // null = no matcher = runs on every path (Next default)
        matcherUnresolved: unresolved, // matcher present but not statically decidable
      });
      scannedFiles.push(rel(abs));
    }
    break;
  }

  walk(path.resolve(cwd, appDir), []);
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { routes, globalMiddlewares, helpers, skipped, unknownHandlers, scannedFiles };

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
          declareUnrouted(abs, `inside parallel route slot ${name}`);
          continue;
        }
        if (/^\(\.{1,3}\)/.test(name)) {
          skipped.push({
            reason: `intercepting route ${name} — UI-layer routing, skipped`,
            file: rel(abs),
          });
          declareUnrouted(abs, `inside intercepting route ${name}`);
          continue;
        }
        if (/^\[\[\.\.\..+\]\]$/.test(name) || /^\[\.\.\..+\]$/.test(name)) {
          skipped.push({
            reason: `catch-all segment ${name} — variable-arity paths not supported`,
            file: rel(abs),
          });
          declareUnrouted(abs, `under catch-all segment ${name}`);
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
      } else if (item.isFile() && /\.(t|j)sx?$/.test(item.name)) {
        // C3: a Next server action (`'use server'`) is a remotely-invocable entrypoint just like a
        // route — a client form can call it with any args. An unguarded mutating action is a real
        // hole, but SPARDA saw only `route.ts` files, so it was INVISIBLE and coverage read a false
        // 100%. Extract exported server actions so they get the same O1 guard analysis as routes.
        parseServerActions(abs);
      }
    }
  }

  // A directory shape the URL builder cannot express (a catch-all segment, a parallel
  // slot, an intercepting route) stops the walk — but the `route.ts` files UNDER it are
  // still modules that export HTTP verbs, and for the catch-all at least Next really
  // does serve them. Stopping silently made the whole subtree vanish: no route, no
  // unknown handler, and a directory-level skip with no risk, i.e. below `blindHigh` and
  // therefore unable to stop a PROVEN. Measured on the `nextjs-basic` fixture, where
  // `app/api/docs/[...slug]/route.js` served GET and appeared nowhere.
  //
  // The registration invariant (ADR-079) does not care that the PATH is inexpressible:
  // the registration exists, so it is declared, once per exported verb, at a risk that
  // bars PROVEN. The route is deliberately NOT synthesized — SPARDA does not know the
  // URL, and inventing one would misplace every guard judgement about it.
  function declareUnrouted(dirAbs, why) {
    for (const absFile of walkRouteFiles(dirAbs)) {
      const relFile = rel(absFile);
      const mod = parseModule(absFile);
      const verbs = mod.error ? [] : [...verbHandlers(mod).keys()].sort();
      const items = verbs.length ? verbs : ['<unreadable>'];
      for (const verb of items) {
        unknownHandlers.push({
          kind: 'UnknownHandler',
          via: `unrouted-segment:${verb}`,
          target: verb,
          file: relFile,
        });
        skipped.push({
          reason: `${verb.toUpperCase()} exported by ${relFile} ${why} — the handler exists and SPARDA cannot bind its URL, so its behaviour is unseen`,
          file: relFile,
          risk: 'high',
        });
      }
    }
  }

  function walkRouteFiles(dirAbs, out = []) {
    let items;
    try {
      items = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dirAbs, item.name);
      if (item.isDirectory()) {
        if (EXCLUDE.has(item.name)) continue;
        walkRouteFiles(abs, out);
      } else if (ROUTE_FILES.has(item.name)) out.push(abs);
    }
    return out;
  }

  // A server action = an exported async function in a `'use server'` MODULE, or any async function
  // with a function-level `'use server'` directive. Registered as a POST entrypoint (actions mutate
  // via a POST-like RPC); its body scan gets the normal in-body guard + guard-dominance treatment.
  function parseServerActions(absFile) {
    let src;
    try {
      src = fs.readFileSync(absFile, 'utf8');
    } catch {
      return;
    }
    if (!src.includes('use server')) return; // cheap pre-filter — never parse an ordinary component
    const mod = parseModule(absFile);
    if (mod.error || !mod.ast) return;
    const relFile = rel(absFile);
    const relNoExt = relFile.replace(/\.(t|j)sx?$/, '');
    const moduleLevel = (mod.ast.program.directives ?? []).some(
      (d) => d.value?.value === 'use server',
    );
    let found = false;
    for (const { name, fn, line } of exportedAsyncFns(mod.ast)) {
      if (!moduleLevel && !fnDeclaresUseServer(fn)) continue;
      found = true;
      // in-body auth verifier → a guard step, exactly as a plain route handler gets (nextjs.js's
      // bodyGuardScan is tight: a verifier-shaped NAME that PROVABLY denies). No wrapper on actions.
      const guardSteps = [];
      const bg = bodyGuardScan(fn, mod);
      if (bg)
        guardSteps.push({
          name: bg,
          role: 'middleware',
          sourceFile: relFile,
          sourceLine: line,
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
      routes.push({
        method: 'post',
        path: `(action) ${relNoExt}#${name}`,
        sourceFile: relFile,
        sourceLine: line,
        params: [],
        chain: [
          ...guardSteps,
          { name, role: 'handler', sourceFile: relFile, sourceLine: line, fn },
        ],
        description: 'server action',
      });
    }
    if (found && !scannedFiles.includes(relFile)) scannedFiles.push(relFile);
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

// Exported async functions of a module — `export async function f(){}`,
// `export const f = async () => {}`, `export default async function(){}`. Server actions are
// always async; a non-async export in a `'use server'` file is a re-exported constant, not an action.
function exportedAsyncFns(ast) {
  const out = [];
  const consider = (name, fn, line) => {
    if (fn && fn.async) out.push({ name, fn, line: line ?? fn.loc?.start.line ?? 0 });
  };
  for (const node of ast.program.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const d = node.declaration;
      if (d.type === 'FunctionDeclaration' && d.id)
        consider(d.id.name, d, d.loc?.start.line);
      else if (d.type === 'VariableDeclaration')
        for (const decl of d.declarations)
          if (
            decl.id?.type === 'Identifier' &&
            (decl.init?.type === 'ArrowFunctionExpression' ||
              decl.init?.type === 'FunctionExpression')
          )
            consider(decl.id.name, decl.init, decl.loc?.start.line);
    } else if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration;
      if (
        d?.type === 'FunctionDeclaration' ||
        d?.type === 'ArrowFunctionExpression' ||
        d?.type === 'FunctionExpression'
      )
        consider(d.id?.name ?? 'default', d, d.loc?.start.line);
    }
  }
  return out;
}

// A function-level `'use server'` directive — `async function f(){ 'use server'; … }`.
function fnDeclaresUseServer(fn) {
  const b = fn?.body;
  if (b?.type !== 'BlockStatement') return false;
  if ((b.directives ?? []).some((d) => d.value?.value === 'use server')) return true;
  const first = b.body?.[0];
  return (
    first?.type === 'ExpressionStatement' &&
    first.expression?.type === 'StringLiteral' &&
    first.expression.value === 'use server'
  );
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
