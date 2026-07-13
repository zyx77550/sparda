// ubg/nextjs.js — Next.js App Router → route facts for the UBG translator.
// Same filesystem-is-the-router walk as parser/nextjs.js, but each verb export
// carries its function body so the microscope can scan effects and response
// shapes. Middleware.ts (root) is surfaced as a global guard candidate —
// Next's convention puts auth there more often than anywhere else.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule } from './extract.js';

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
  const set = (name, fn, line) => {
    if (VERBS.has(name) && !out.has(name))
      out.set(name, { fn: fn ?? null, line: line ?? 0 });
  };
  for (const node of mod.ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    const d = node.declaration;
    if (d?.type === 'FunctionDeclaration' && d.id) {
      set(d.id.name, d, d.loc?.start.line);
    } else if (d?.type === 'VariableDeclaration') {
      for (const decl of d.declarations) {
        if (decl.id?.type === 'Identifier')
          set(decl.id.name, resolveHandlerExpr(decl.init, mod), decl.loc?.start.line);
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

// resolve an `export const VERB = <init>` right-hand side to a scannable function node,
// or null (route still registered, body blind). Handles inline fns, local aliases, and
// wrapper calls whose handler is an inline fn or a local-function identifier argument.
function resolveHandlerExpr(init, mod) {
  if (!init) return null;
  if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
    return init;
  if (init.type === 'Identifier') return mod.functions.get(init.name)?.node ?? null;
  if (init.type === 'CallExpression') {
    for (const a of init.arguments)
      if (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')
        return a;
    for (const a of init.arguments)
      if (a.type === 'Identifier' && mod.functions.get(a.name))
        return mod.functions.get(a.name).node;
  }
  return null;
}
