// ubg/express.js — Express codebase → route facts for the UBG translator.
// Richer than parser/express.js (which only needs tool signatures): here the
// FULL handler chain matters — every middleware between path and handler
// becomes a graph node, and identifier handlers are resolved to their function
// bodies (same file, then relative imports) so the microscope can scan them.
// Depth stays bounded like the v0 parser: entry file + mounted routers.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule, resolveRelImport } from './extract.js';
import { createResolver, relOf } from './resolve.js';

const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete']);

// → { routes, globalMiddlewares, helpers, skipped, scannedFiles }
export function extractExpress(cwd, entryFile) {
  const routes = [];
  const globalMiddlewares = []; // app.use(fn) — applies to every route
  const helpers = []; // top-level functions of scanned files (dead-path candidates)
  const skipped = [];
  const scannedFiles = [];
  const visited = new Set();
  const mounts = [];
  // the interprocedural engine (ADR-054): follows service/model calls below each
  // handler — module members, instantiated classes, this./super. hops — bounded,
  // memoized per extract, appending discoveries into scannedFiles/helpers.
  const resolver = createResolver({ cwd, scannedFiles, helpers });

  scanFile(path.resolve(cwd, entryFile), '', 0);
  // growing queue, NOT a snapshot: a mounted router file can itself mount
  // sub-routers (app.use('/v1', routes) → router.use('/auth', authRoute)) —
  // the real-world boilerplate pattern. Depth still bounded by scanFile.
  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i];
    if (m.file && fs.existsSync(m.file)) scanFile(m.file, m.prefix, m.depth ?? 1);
    else if (!m.file)
      skipped.push({
        reason: `router "${m.ident}" mounted at ${m.prefix} — source file not resolved`,
        file: m.fromFile,
      });
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { routes, globalMiddlewares, helpers, skipped, scannedFiles };

  function scanFile(absFile, prefix, depth) {
    const key = `${absFile}::${prefix}`;
    if (depth > 2 || visited.has(key)) return;
    visited.add(key);

    const mod = parseModule(absFile);
    const relFile = rel(absFile);
    if (mod.error) {
      skipped.push({ reason: `${mod.error} in ${relFile}`, file: relFile });
      return;
    }
    scannedFiles.push(relFile);

    // every top-level function is a potential dead-path candidate
    for (const [name, f] of mod.functions) {
      helpers.push({ name, sourceFile: relFile, sourceLine: f.line, fn: f.node });
    }

    // Flatten setup-function bodies into the statement stream. The overwhelmingly
    // common production pattern builds the whole app inside a function —
    // `export default async function createApp() { const app = express(); …;
    // app.use('/x', xRouter); return app; }` (directus, and most real apps) — so the
    // `express()` var and every mount live one level down, invisible to a top-level-only
    // walk. We descend into function declarations, default-exported functions, top-level
    // `const f = () => {…}`, and their control-flow blocks — but NOT into function
    // *arguments* (route handlers), so handler bodies are never mistaken for setup.
    const statements = flattenSetup(mod.ast.program.body);

    const appVars = new Set();
    const routerVars = new Set();
    for (const node of statements) collectAppVars(node, appVars, routerVars);
    const routeArrays = collectRouteArrays(statements);

    walkStatements(statements);

    function walkStatements(body) {
      for (const stmt of body) {
        const expr =
          stmt.type === 'ExpressionStatement' && stmt.expression.type === 'CallExpression'
            ? stmt.expression
            : null;
        if (!expr) continue;
        const callee = expr.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier')
          continue;
        const objName = callee.object.type === 'Identifier' ? callee.object.name : null;

        // declarative mount loop: defaultRoutes.forEach((r) => router.use(r.path, r.route))
        // — the array of { path: '<literal>', route: <Identifier> } IS the router table
        if (callee.property.name === 'forEach' && objName && routeArrays.has(objName)) {
          for (const entry of routeArrays.get(objName)) {
            mounts.push({
              prefix: joinPath(prefix, entry.path),
              file: mod.imports.get(entry.ident) ?? null,
              ident: entry.ident,
              fromFile: relFile,
              depth: depth + 1,
            });
          }
          continue;
        }

        if (!objName || (!appVars.has(objName) && !routerVars.has(objName))) continue;
        const method = callee.property.name;
        const args = expr.arguments;

        if (method === 'use') {
          handleUse(args, stmt);
          continue;
        }
        if (!HTTP.has(method)) continue;

        const pathArg = args[0];
        if (!pathArg || pathArg.type !== 'StringLiteral') {
          skipped.push({
            reason: `dynamic path on ${method.toUpperCase()} (non-literal first arg)`,
            file: relFile,
            line: expr.loc?.start.line,
          });
          continue;
        }
        const fullPath = joinPath(prefix, pathArg.value);

        const chain = [];
        for (let i = 1; i < args.length; i++) {
          const resolved = resolveCallable(args[i], mod, absFile, relFile);
          if (!resolved) {
            skipped.push({
              reason: `unresolvable handler arg #${i} on ${method.toUpperCase()} ${fullPath}`,
              file: relFile,
              line: args[i].loc?.start.line,
            });
            continue;
          }
          resolved.role = i === args.length - 1 ? 'handler' : 'middleware';
          chain.push(resolved);
        }

        const description = (stmt.leadingComments ?? expr.leadingComments ?? [])
          .map((c) =>
            c.value
              .replace(/^\*+/gm, '')
              .replace(/^\s*\*\s?/gm, '')
              .trim(),
          )
          .filter(Boolean)
          .join(' ')
          .slice(0, 400);

        routes.push({
          method,
          path: fullPath,
          sourceFile: relFile,
          sourceLine: expr.loc?.start.line ?? 0,
          params: pathParamsOf(fullPath),
          chain,
          description,
        });
      }
    }

    function handleUse(args, stmt) {
      if (!args.length) return;
      // app.use('/prefix', router) → mount for second pass. The router arg is
      // usually an imported Identifier, but the inline-require idiom
      // `app.use('/x', require('./x.controller'))` (rootpath-style apps) is just
      // as common — resolve it directly. `undefined` = not a router mount at all
      // (fall through to global-middleware handling below).
      if (args[0].type === 'StringLiteral') {
        const target = mountTargetFile(args[1], mod, absFile);
        if (target !== undefined) {
          mounts.push({
            prefix: joinPath(prefix, args[0].value),
            file: target, // null = named/required but unresolved → reported in the mounts loop
            ident: mountIdentName(args[1]),
            fromFile: relFile,
            depth: depth + 1, // nested mounts keep sinking, scanFile bounds them
          });
          return;
        }
      }
      // app.use(fn) / app.use(ident) at depth 0 → global middleware
      if (depth === 0) {
        for (const a of args) {
          if (a.type === 'StringLiteral') continue;
          // express.json() & friends: framework plumbing, not app behavior
          if (
            a.type === 'CallExpression' &&
            ((a.callee.type === 'MemberExpression' &&
              a.callee.object.type === 'Identifier' &&
              a.callee.object.name === 'express') ||
              (a.callee.type === 'Identifier' &&
                /^(cors|helmet|morgan|compression|cookieparser|bodyparser)$/i.test(
                  a.callee.name,
                )))
          )
            continue;
          const resolved = resolveCallable(a, mod, absFile, relFile);
          if (resolved) {
            resolved.role = 'middleware';
            globalMiddlewares.push(resolved);
          } else if (a.type !== 'CallExpression') {
            skipped.push({
              reason: `unresolvable app.use() argument`,
              file: relFile,
              line: stmt.loc?.start.line,
            });
          }
        }
      }
    }
  }

  // Identifier → function body in this module, else in the module it was
  // imported from. Inline functions pass through as-is.
  function resolveCallable(arg, mod, absFile, relFile) {
    if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
      return {
        name: arg.id?.name ?? 'anonymous',
        sourceFile: relFile,
        sourceLine: arg.loc?.start.line ?? 0,
        fn: arg,
      };
    }
    if (arg.type === 'CallExpression') {
      const name =
        arg.callee.type === 'Identifier'
          ? arg.callee.name
          : (arg.callee.property?.name ?? 'anonymous');
      // wrapped INLINE handler: asyncHandler(async (req, res) => {…}) — the
      // wrapped function IS the behavior (the route-position analogue of the
      // top-level `const h = catchAsync(…)` idiom). Without this, every
      // directus-style route reads as a blind node.
      const fnArg = arg.arguments.find(
        (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
      );
      if (fnArg) {
        return {
          name,
          sourceFile: relFile,
          sourceLine: fnArg.loc?.start.line ?? 0,
          fn: fnArg,
          scan: resolver.deepScan(fnArg, mod),
        };
      }
      // factory middleware: validate(schema), rateLimit({…}) — the factory
      // name is known, the produced closure is out of static reach (blind node)
      return {
        name,
        sourceFile: relFile,
        sourceLine: arg.loc?.start.line ?? 0,
        fn: null,
      };
    }

    // controller.method — resolve through the import to the exported function
    // (including the catchAsync-wrapped const idiom)
    if (
      arg.type === 'MemberExpression' &&
      arg.object.type === 'Identifier' &&
      arg.property.type === 'Identifier'
    ) {
      const importedFrom = mod.imports.get(arg.object.name);
      if (importedFrom) {
        const target = parseModule(importedFrom);
        const fn = target.functions.get(arg.property.name);
        if (fn) {
          const fromRel = rel(importedFrom);
          if (!scannedFiles.includes(fromRel)) {
            scannedFiles.push(fromRel);
            for (const [name, f] of target.functions)
              helpers.push({ name, sourceFile: fromRel, sourceLine: f.line, fn: f.node });
          }
          return {
            name: `${arg.object.name}.${arg.property.name}`,
            sourceFile: fromRel,
            sourceLine: fn.line,
            fn: fn.node,
            scan: resolver.deepScan(fn.node, target), // follow service/model calls below it
          };
        }
      }
      return {
        name: `${arg.object.name}.${arg.property.name}`,
        sourceFile: relFile,
        sourceLine: arg.loc?.start.line ?? 0,
        fn: null,
      };
    }

    if (arg.type !== 'Identifier') return null;

    const local = mod.functions.get(arg.name);
    if (local) {
      return {
        name: arg.name,
        sourceFile: relFile,
        sourceLine: local.line,
        fn: local.node,
        scan: resolver.deepScan(local.node, mod),
      };
    }
    const importedFrom = mod.imports.get(arg.name);
    if (importedFrom) {
      const target = parseModule(importedFrom);
      const fn = target.functions.get(arg.name) ?? target.functions.get('default');
      if (fn) {
        const fromRel = rel(importedFrom);
        if (!scannedFiles.includes(fromRel)) {
          scannedFiles.push(fromRel);
          for (const [name, f] of target.functions)
            helpers.push({
              name,
              sourceFile: fromRel,
              sourceLine: f.line,
              fn: f.node,
            });
        }
        return {
          name: arg.name,
          sourceFile: fromRel,
          sourceLine: fn.line,
          fn: fn.node,
          scan: resolver.deepScan(fn.node, target),
        };
      }
    }
    // known but bodyless — node exists, microscope stays blind
    return {
      name: arg.name,
      sourceFile: relFile,
      sourceLine: arg.loc?.start.line ?? 0,
      fn: null,
    };
  }

  function rel(abs) {
    return relOf(cwd, abs);
  }
}

// Statements the route walk should see = the module top level PLUS the bodies of
// setup functions and the control-flow blocks inside them, in source order. Bounded
// (depth + count) and cycle-free by construction. It descends into function *bodies*
// (declarations, default exports, `const f = () => {}`) and if/for/try/while/block —
// never into a function passed as a call ARGUMENT, so route handlers stay opaque.
function flattenSetup(programBody) {
  const out = [];
  const blockOf = (n) => (!n ? [] : n.type === 'BlockStatement' ? n.body : [n]);
  const push = (stmts, depth) => {
    if (!Array.isArray(stmts) || depth > 6 || out.length > 8000) return;
    for (const s of stmts) {
      if (!s || typeof s !== 'object') continue;
      out.push(s);
      descend(s, depth);
    }
  };
  const descend = (s, depth) => {
    switch (s.type) {
      case 'FunctionDeclaration':
        push(s.body?.body, depth + 1);
        break;
      case 'ExportDefaultDeclaration':
      case 'ExportNamedDeclaration':
        if (s.declaration?.body?.body) push(s.declaration.body.body, depth + 1);
        else if (s.declaration) push([s.declaration], depth);
        break;
      case 'VariableDeclaration':
        for (const d of s.declarations) {
          const init = d.init;
          if (
            (init?.type === 'ArrowFunctionExpression' ||
              init?.type === 'FunctionExpression') &&
            init.body?.body
          )
            push(init.body.body, depth + 1);
        }
        break;
      case 'IfStatement':
        push(blockOf(s.consequent), depth);
        push(blockOf(s.alternate), depth);
        break;
      case 'TryStatement':
        push(s.block?.body, depth);
        if (s.handler?.body?.body) push(s.handler.body.body, depth);
        push(s.finalizer?.body, depth);
        break;
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
        push(blockOf(s.body), depth);
        break;
      case 'BlockStatement':
        push(s.body, depth);
        break;
    }
  };
  push(programBody, 0);
  return out;
}

// const defaultRoutes = [{ path: '/auth', route: authRoute }, …] — collected
// per file so a later .forEach mount loop can be unrolled statically
function collectRouteArrays(body) {
  const arrays = new Map();
  for (const node of body) {
    const decl = node.type === 'VariableDeclaration' ? node : null;
    if (!decl) continue;
    for (const d of decl.declarations) {
      if (d.id?.type !== 'Identifier' || d.init?.type !== 'ArrayExpression') continue;
      const entries = [];
      for (const el of d.init.elements) {
        if (el?.type !== 'ObjectExpression') continue;
        let entryPath = null;
        let ident = null;
        for (const prop of el.properties) {
          if (prop.type !== 'ObjectProperty' || prop.key.type !== 'Identifier') continue;
          if (prop.key.name === 'path' && prop.value.type === 'StringLiteral')
            entryPath = prop.value.value;
          if (prop.key.name === 'route' && prop.value.type === 'Identifier')
            ident = prop.value.name;
        }
        if (entryPath && ident) entries.push({ path: entryPath, ident });
      }
      if (entries.length) arrays.set(d.id.name, entries);
    }
  }
  return arrays;
}

// The second arg of app.use('/p', X): where does the mounted router live?
//   Identifier            → the import it resolves to (null if unresolved)
//   require('./x')        → the relative file it resolves to (null if non-relative)
//   anything else         → undefined (not a router mount; e.g. a middleware call)
function mountTargetFile(arg, mod, absFile) {
  if (!arg) return undefined;
  if (arg.type === 'Identifier') return mod.imports.get(arg.name) ?? null;
  if (
    arg.type === 'CallExpression' &&
    arg.callee.type === 'Identifier' &&
    arg.callee.name === 'require' &&
    arg.arguments[0]?.type === 'StringLiteral'
  ) {
    return resolveRelImport(absFile, arg.arguments[0].value);
  }
  return undefined;
}

// a readable identifier for the mount's skipped-report when it can't resolve
function mountIdentName(arg) {
  if (arg?.type === 'Identifier') return arg.name;
  if (
    arg?.type === 'CallExpression' &&
    arg.callee.type === 'Identifier' &&
    arg.callee.name === 'require' &&
    arg.arguments[0]?.type === 'StringLiteral'
  )
    return `require('${arg.arguments[0].value}')`;
  return 'router';
}

function collectAppVars(node, appVars, routerVars) {
  if (node.type === 'ExportNamedDeclaration' && node.declaration)
    return collectAppVars(node.declaration, appVars, routerVars);
  if (node.type !== 'VariableDeclaration') return;
  for (const d of node.declarations) {
    if (d.id?.type !== 'Identifier' || d.init?.type !== 'CallExpression') continue;
    const callee = d.init.callee;
    if (callee.type === 'Identifier' && callee.name === 'express') appVars.add(d.id.name);
    if (callee.type === 'Identifier' && callee.name === 'Router')
      routerVars.add(d.id.name);
    if (callee.type === 'MemberExpression' && callee.property?.name === 'Router')
      routerVars.add(d.id.name);
  }
}

function pathParamsOf(fullPath) {
  return [...fullPath.matchAll(/:(\w+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    type: 'string',
    required: true,
  }));
}

function joinPath(prefix, p) {
  const joined = `${prefix ?? ''}${p === '/' && prefix ? '' : p}`.replace(/\/{2,}/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

export { resolveRelImport };
