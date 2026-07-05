// ubg/express.js — Express codebase → route facts for the UBG translator.
// Richer than parser/express.js (which only needs tool signatures): here the
// FULL handler chain matters — every middleware between path and handler
// becomes a graph node, and identifier handlers are resolved to their function
// bodies (same file, then relative imports) so the microscope can scan them.
// Depth stays bounded like the v0 parser: entry file + mounted routers.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule, resolveRelImport } from './extract.js';

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

    const appVars = new Set();
    const routerVars = new Set();
    for (const node of mod.ast.program.body) collectAppVars(node, appVars, routerVars);

    walkStatements(mod.ast.program.body);

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
      // app.use('/prefix', router) → mount for second pass
      if (args[0].type === 'StringLiteral' && args[1]?.type === 'Identifier') {
        mounts.push({
          prefix: joinPath(prefix, args[0].value),
          file: mod.imports.get(args[1].name) ?? null,
          ident: args[1].name,
          fromFile: relFile,
          depth: depth + 1, // nested mounts keep sinking, scanFile bounds them
        });
        return;
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
    if (arg.type !== 'Identifier') return null;

    const local = mod.functions.get(arg.name);
    if (local) {
      return {
        name: arg.name,
        sourceFile: relFile,
        sourceLine: local.line,
        fn: local.node,
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
        return { name: arg.name, sourceFile: fromRel, sourceLine: fn.line, fn: fn.node };
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
    return path.relative(cwd, abs).split(path.sep).join('/');
  }
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
