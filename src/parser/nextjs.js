// parser/nextjs.js — App Router route-handler extraction.
// The filesystem IS the router: a route.{js,ts} file's directory chain is the
// URL. We walk app/ (groups stripped, dynamic segments mapped to :params) and
// AST-parse each route file for its exported HTTP-verb handlers. Catch-all,
// optional catch-all, parallel slots and interception segments are skipped
// with a reason (scan-report), never guessed.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ROUTE_FILES = new Set([
  'route.js',
  'route.ts',
  'route.mjs',
  'route.jsx',
  'route.tsx',
]);
const EXCLUDE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.sparda']);

export function parseNextProject(cwd, appDir) {
  const routes = [];
  const skipped = [];
  const seen = new Set(); // `${METHOD} ${path}` — group collapse can collide: (a)/x + (b)/x → /x

  walk(path.resolve(cwd, appDir), []);
  return { routes, skipped };

  function walk(dir, segments) {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        const name = item.name;
        if (EXCLUDE.has(name)) continue;
        if (name.startsWith('_')) continue; // private folder — excluded from routing by Next itself
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
            reason: `catch-all segment ${name} — variable-arity paths not supported in v1`,
            file: rel(abs),
          });
          continue;
        }
        if (/^\(.+\)$/.test(name)) {
          walk(abs, segments); // route group — organizational only, stripped from the URL
          continue;
        }
        const m = name.match(/^\[(.+)\]$/);
        walk(abs, [...segments, m ? `:${m[1]}` : name]);
      } else if (item.isFile() && ROUTE_FILES.has(item.name)) {
        const urlPath = '/' + segments.join('/');
        if (urlPath === '/mcp' || urlPath.startsWith('/mcp/')) {
          skipped.push({
            reason: `self-referential path ${urlPath} blocked`,
            file: rel(abs),
          });
          continue;
        }
        parseRouteFile(abs, urlPath || '/');
      }
    }
  }

  function parseRouteFile(absFile, urlPath) {
    let src;
    try {
      src = fs.readFileSync(absFile, 'utf8');
    } catch {
      return;
    }
    let ast;
    try {
      ast = parse(src, {
        sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx', ['decorators', { decoratorsBeforeExport: true }]],
        attachComment: true,
      });
    } catch (e) {
      skipped.push({
        reason: `parse error in ${rel(absFile)}: ${e.message.slice(0, 80)}`,
        file: rel(absFile),
      });
      return;
    }

    for (const node of ast.program.body) {
      if (node.type !== 'ExportNamedDeclaration') continue;
      const found = []; // [{ verb, fnNode|null }]

      const decl = node.declaration;
      if (decl?.type === 'FunctionDeclaration' && VERBS.has(decl.id?.name)) {
        found.push({ verb: decl.id.name, fnNode: decl });
      } else if (decl?.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (d.id?.type !== 'Identifier' || !VERBS.has(d.id.name)) continue;
          const isFn =
            d.init?.type === 'ArrowFunctionExpression' ||
            d.init?.type === 'FunctionExpression';
          found.push({ verb: d.id.name, fnNode: isFn ? d.init : null });
        }
      } else if (!decl && node.specifiers?.length) {
        // export { GET } [from './impl'] — verb confirmed, body out of reach
        for (const spec of node.specifiers) {
          const name = spec.exported?.name ?? spec.exported?.value;
          if (VERBS.has(name)) found.push({ verb: name, fnNode: null });
        }
      }

      for (const { verb, fnNode } of found) {
        const method = verb.toLowerCase();
        const key = `${verb} ${urlPath}`;
        if (seen.has(key)) {
          skipped.push({
            reason: `route group collision: ${key} already extracted from another group`,
            file: rel(absFile),
            line: node.loc?.start.line,
          });
          continue;
        }
        seen.add(key);

        const description = (node.leadingComments ?? [])
          .map((c) =>
            c.value
              .replace(/^\*+/gm, '')
              .replace(/^\s*\*\s?/gm, '')
              .trim(),
          )
          .filter(Boolean)
          .join(' ')
          .slice(0, 400);

        const params = [...urlPath.matchAll(/:(\w+)/g)].map((mm) => ({
          name: mm[1],
          in: 'path',
          type: 'string',
          required: true,
          description: 'path parameter',
        }));
        const taken = new Set(params.map((x) => x.name));
        for (const q of queryParamsOf(fnNode)) {
          if (taken.has(q)) continue;
          taken.add(q);
          params.push({
            name: q,
            in: 'query',
            type: 'string',
            required: false,
            description: 'query parameter',
          });
        }

        const mutating = method !== 'get';
        let confidence = fnNode ? 'high' : 'low'; // re-exported handler body is unreadable here
        if (mutating) {
          params.push({
            name: 'body',
            in: 'body',
            type: 'object',
            required: false,
            description: 'JSON body — schema not statically detected',
          });
          confidence = 'low';
        }

        routes.push({
          method,
          path: urlPath,
          handlerName: verb,
          sourceFile: rel(absFile),
          sourceLine: node.loc?.start.line ?? 0,
          params,
          description,
          mutating,
          confidence,
        });
      }
    }
  }

  function rel(abs) {
    return path.relative(cwd, abs).split(path.sep).join('/');
  }
}

// Query params only surface in the handler body — the canonical App Router
// shapes are `searchParams.get('x')` / `.getAll('x')`, whether searchParams
// came from `new URL(request.url)` or `request.nextUrl`. Plain recursive AST
// walk (no scope needed), bounded to 15 like the Express scanner.
function queryParamsOf(fnNode) {
  const found = [];
  if (!fnNode) return found;
  visit(fnNode.body);
  return [...new Set(found)];

  function visit(node) {
    if (!node || typeof node !== 'object' || found.length >= 15) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      !node.callee.computed &&
      (node.callee.property?.name === 'get' || node.callee.property?.name === 'getAll') &&
      node.arguments[0]?.type === 'StringLiteral'
    ) {
      const obj = node.callee.object;
      const isSearchParams =
        (obj.type === 'Identifier' && obj.name === 'searchParams') ||
        (obj.type === 'MemberExpression' &&
          !obj.computed &&
          obj.property?.name === 'searchParams');
      if (isSearchParams) found.push(node.arguments[0].value);
    }
    for (const k of Object.keys(node)) {
      if (
        k === 'loc' ||
        k === 'range' ||
        k === 'leadingComments' ||
        k === 'trailingComments'
      )
        continue;
      const v = node[k];
      if (v && typeof v === 'object') visit(v);
    }
  }
}
