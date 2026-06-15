// parser/express.js — AST route extraction (spec: blueprint 03-PARSING §B)
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default ?? traverseModule;

const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete']);
const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.sparda']);

export function parseExpressProject(cwd, entryFile) {
  const routes = [];
  const skipped = [];
  const visited = new Set();
  const entryAbs = path.resolve(cwd, entryFile);

  // routerName -> { file, prefix } discovered via app.use(prefix, ident)
  const mounts = [];

  parseFile(entryAbs, '', 0);
  // second pass: parse mounted router files with their prefixes
  for (const m of mounts) {
    if (m.file && fs.existsSync(m.file)) parseFile(m.file, m.prefix, 1);
  }

  return { routes: dedupe(routes), skipped };

  function parseFile(absFile, prefix, depth) {
    if (depth > 2 || visited.has(absFile + '::' + prefix)) return;
    visited.add(absFile + '::' + prefix);
    let src;
    try { src = fs.readFileSync(absFile, 'utf8'); } catch { return; }
    let ast;
    try {
      ast = parse(src, {
        sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx', ['decorators', { decoratorsBeforeExport: true }]],
        attachComment: true,
      });
    } catch (e) {
      skipped.push({ reason: `parse error in ${rel(absFile)}: ${e.message.slice(0, 80)}`, file: rel(absFile) });
      return;
    }

    const appVars = new Set();    // vars = express()
    const routerVars = new Set(); // vars = express.Router() / Router()
    const importMap = new Map();  // localName -> absolute file path (relative imports only)
    const exprStarts = new Set(); // line numbers where express() assigned (for injector)

    traverse(ast, {
      VariableDeclarator(p) {
        const init = p.node.init;
        if (!init) return;
        if (init.type === 'CallExpression') {
          const callee = init.callee;
          if (callee.type === 'Identifier' && callee.name === 'require' && init.arguments[0]?.type === 'StringLiteral') {
            const resolved = resolveRel(absFile, init.arguments[0].value);
            if (resolved) {
              const id = p.node.id;
              if (id.type === 'Identifier') {
                importMap.set(id.name, resolved);
              } else if (id.type === 'ObjectPattern') {
                for (const prop of id.properties) {
                  if (prop.type === 'ObjectProperty' && prop.value.type === 'Identifier') {
                    importMap.set(prop.value.name, resolved);
                  }
                }
              }
            }
          }
          const name = p.node.id?.name;
          if (name) {
            if (callee.type === 'Identifier' && callee.name === 'express') { appVars.add(name); exprStarts.add(p.node.loc.end.line); }
            if (callee.type === 'Identifier' && callee.name === 'Router') routerVars.add(name);
            if (callee.type === 'MemberExpression' && callee.property?.name === 'Router') routerVars.add(name);
          }
        }
      },
      ImportDeclaration(p) {
        const resolved = resolveRel(absFile, p.node.source.value);
        if (!resolved) return;
        for (const spec of p.node.specifiers) importMap.set(spec.local.name, resolved);
      },
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        const objName = callee.object.type === 'Identifier' ? callee.object.name : null;
        const method = callee.property.name;
        const args = p.node.arguments;

        // app.use(prefix, routerIdent) -> mount
        if (method === 'use' && objName && appVars.has(objName) && args.length >= 2) {
          const [a0, a1] = args;
          if (a0.type === 'StringLiteral' && a1.type === 'Identifier') {
            mounts.push({ prefix: joinPath(prefix, a0.value), file: importMap.get(a1.name) ?? null, ident: a1.name });
            if (!importMap.get(a1.name)) skipped.push({ reason: `router "${a1.name}" mounted at ${a0.value} — source file not resolved`, file: rel(absFile), line: p.node.loc.start.line });
          }
          return;
        }

        if (!HTTP.has(method)) return;
        const isApp = objName && appVars.has(objName);
        const isRouter = objName && routerVars.has(objName);
        if (!isApp && !isRouter) return;

        const pathArg = args[0];
        if (!pathArg || pathArg.type !== 'StringLiteral') {
          skipped.push({ reason: `dynamic path on ${method.toUpperCase()} (non-literal first arg)`, file: rel(absFile), line: p.node.loc?.start.line });
          return;
        }

        const fullPath = joinPath(prefix, pathArg.value);
        if (fullPath === '/mcp' || fullPath.startsWith('/mcp/')) {
          skipped.push({ reason: `self-referential path ${fullPath} blocked`, file: rel(absFile), line: p.node.loc?.start.line });
          return;
        }

        const handler = args[args.length - 1];
        const handlerName = handler?.type === 'Identifier' ? handler.name
          : handler?.id?.name ?? `anonymous_${routes.length + 1}`;

        const leading = (p.parentPath.node.leadingComments ?? p.node.leadingComments ?? [])
          .map((c) => c.value.replace(/^\*+/gm, '').replace(/^\s*\*\s?/gm, '').trim())
          .filter(Boolean).join(' ');

        const pathParams = [...fullPath.matchAll(/:(\w+)/g)].map((mm) => ({
          name: mm[1], in: 'path', type: 'string', required: true, description: 'path parameter',
        }));

        const mutating = method !== 'get';
        const params = [...pathParams];
        // query params: handlers reveal them as req.query.X / destructured req.query —
        // without this the AI cannot discover ?limit=… filters at all (E2E P2 finding)
        const taken = new Set(params.map((x) => x.name));
        for (const q of queryParamsOf(p)) {
          if (taken.has(q)) continue;
          taken.add(q);
          params.push({ name: q, in: 'query', type: 'string', required: false, description: 'query parameter' });
        }
        let confidence = 'high';
        if (mutating) {
          params.push({ name: 'body', in: 'body', type: 'object', required: false, description: 'JSON body — schema not statically detected' });
          confidence = 'low';
        }

        routes.push({
          method, path: fullPath, handlerName,
          sourceFile: rel(absFile), sourceLine: p.node.loc?.start.line ?? 0,
          params, description: leading.slice(0, 400), mutating, confidence,
        });
      },
    });

    // depth-1 import follow for files that themselves declare app routes (rare but covered)
    if (depth === 0) {
      for (const [, file] of importMap) {
        if (!visited.has(file + '::' + prefix) && fs.existsSync(file)) {
          // only follow if the file references Router or app routes — cheap pre-check
          const s = fs.readFileSync(file, 'utf8');
          if (/\bRouter\s*\(/.test(s)) continue; // handled by mounts pass with proper prefix
        }
      }
    }
  }

  function rel(abs) { return path.relative(cwd, abs).split(path.sep).join('/'); }

  function resolveRel(fromFile, spec) {
    if (!spec.startsWith('.')) return null;
    const cleanSpec = spec.replace(/\.(m?[jt]s|cjs)$/, '');
    const base = path.resolve(path.dirname(fromFile), cleanSpec);
    for (const cand of [base, `${base}.ts`, `${base}.js`, `${base}.mjs`, `${base}.cjs`,
      path.join(base, 'index.ts'), path.join(base, 'index.js')]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        if ([...EXCLUDE].some((x) => cand.includes(`${path.sep}${x}${path.sep}`))) return null;
        return cand;
      }
    }
    return null;
  }
}

// Query params are invisible in a route's signature; only the handler body
// reveals them. Covers the two canonical shapes — req.query.x / req.query['x']
// and `const { x } = req.query` — on inline handlers only (an Identifier
// handler lives elsewhere; guessing is worse than staying silent). Bounded.
function queryParamsOf(callPath) {
  const reqNames = new Set();
  for (const a of callPath.node.arguments) {
    if ((a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression') && a.params[0]?.type === 'Identifier') {
      reqNames.add(a.params[0].name);
    }
  }
  const found = [];
  if (!reqNames.size) return found;
  const isReqQuery = (n) => n?.type === 'MemberExpression' && !n.computed &&
    n.object?.type === 'Identifier' && reqNames.has(n.object.name) &&
    n.property?.type === 'Identifier' && n.property.name === 'query';
  callPath.traverse({
    MemberExpression(q) {
      const n = q.node;
      if (!isReqQuery(n.object) || found.length >= 15) return;
      if (!n.computed && n.property.type === 'Identifier') found.push(n.property.name);
      else if (n.computed && n.property.type === 'StringLiteral') found.push(n.property.value);
    },
    VariableDeclarator(q) {
      if (q.node.id.type !== 'ObjectPattern' || !isReqQuery(q.node.init)) return;
      for (const prop of q.node.id.properties) {
        if (found.length >= 15) break;
        if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier') found.push(prop.key.name);
      }
    },
  });
  return [...new Set(found)];
}

function joinPath(prefix, p) {
  const joined = `${prefix ?? ''}${p === '/' && prefix ? '' : p}`.replace(/\/{2,}/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function dedupe(routes) {
  const seen = new Set();
  return routes.filter((r) => {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function toolNameFor(route, taken) {
  let name = `${route.method}_${route.path}`
    .toLowerCase()
    .replace(/:(\w+)/g, 'by_$1')
    .replace(/\{(\w+)\}/g, 'by_$1')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'tool';
  let final = name; let i = 2;
  while (taken.has(final)) final = `${name}_${i++}`;
  taken.add(final);
  return final;
}
