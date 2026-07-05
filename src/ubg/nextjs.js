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

    for (const verb of [...VERBS].sort()) {
      const f = mod.functions.get(verb);
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
            fn: f.node,
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
