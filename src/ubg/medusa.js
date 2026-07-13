// ubg/medusa.js — Medusa (file-based routing) extraction. The THIRD pattern.
//
// Medusa defeated both the Express detector (no `app.get()`) and the NestJS one
// (no `@Controller`/`@Get` decorators). Its routes are a *filesystem convention*:
// a file `src/api/<segments>/route.ts` IS a route whose path is its directory,
// and it exports one const/function per HTTP verb — `export const POST = ...`.
// The old parser saw 0 routes → NO PROOF → useless on the biggest JS commerce app.
//
// Three conventions turn that filesystem into a UBG:
//   1. PATH  — the directory under the api root is the route path; `[id]` → `:id`,
//      `[...rest]` → `:rest` (catch-all). `route.ts` itself contributes nothing.
//   2. AUTH  — INVERTED: Medusa authenticates by default; a file opts OUT with
//      `export const AUTHENTICATE = false`. So a route is guarded UNLESS it says so.
//   3. EFFECT — the real mutation lives in a *workflow*, not an ORM call:
//      `createProductWorkflow(req.scope).run({ input })`. We read the workflow
//      name's verb (create/update/delete/…) to synthesize the db_write the prover
//      needs. Same UBG shape out, so apocalypse/polarity/immunize just work.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule, scanFunction } from './extract.js';

const HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.sparda']);
// a workflow/step call is the effect. Verb prefix → op; absence of a write verb
// (list/get/retrieve/…) → a read. Matched on the leading word of the identifier.
const WRITE_VERB =
  /^(create|add|insert|update|edit|set|upsert|delete|remove|destroy|cancel|complete|confirm|capture|refund|transfer|batch|import|link|unlink|move|apply|adjust|reserve|release)/i;
const READ_VERB = /^(list|get|retrieve|fetch|find|read|search|count|validate|export)/i;
const OP_BY_VERB = [
  [/^(create|add|insert|import)/i, 'insert'],
  [/^(delete|remove|destroy)/i, 'delete'],
  [/^upsert/i, 'upsert'],
];

// → { routes, globalMiddlewares, helpers, skipped, scannedFiles } (extractExpress shape)
export function extractMedusa(cwd, entryDir) {
  const routes = [];
  const skipped = [];
  const scannedFiles = [];
  const apiRoot = path.resolve(cwd, entryDir || 'src/api');

  for (const file of walk(apiRoot)) {
    if (!isRouteFile(file)) continue;
    const mod = parseModule(file);
    const rel = relOf(cwd, file);
    if (mod.error) {
      skipped.push({ reason: `${mod.error} in ${rel}`, file: rel });
      continue;
    }

    const routePath = pathOf(apiRoot, file);
    const exportsByName = topLevelExports(mod.ast);
    // convention 2: authenticated unless `export const AUTHENTICATE = false`
    const authenticated = !(
      exportsByName.AUTHENTICATE?.init &&
      exportsByName.AUTHENTICATE.init.type === 'BooleanLiteral' &&
      exportsByName.AUTHENTICATE.init.value === false
    );

    let contributed = false;
    for (const name of Object.keys(exportsByName)) {
      if (!HTTP.has(name)) continue;
      const fn = exportsByName[name].fn;
      if (!fn) continue;
      contributed = true;
      const method = name.toLowerCase();
      const line = exportsByName[name].line;

      const scan = scanHandler(fn);
      const chain = [];
      if (authenticated) {
        // convention 1: a synthetic guard named `authenticate` — GUARD_NAME
        // recognises it, so translate lowers it to a guard node that gates the
        // handler, exactly like an Express auth middleware.
        chain.push({
          name: 'authenticate',
          sourceFile: rel,
          sourceLine: line,
          fn: null,
          role: 'middleware',
        });
      }
      chain.push({
        name,
        sourceFile: rel,
        sourceLine: line,
        fn: null,
        scan, // precomputed (handler body + synthesized workflow effects)
        role: 'handler',
      });

      routes.push({
        method,
        path: routePath,
        sourceFile: rel,
        sourceLine: line,
        params: pathParamsOf(routePath),
        chain,
        description: '',
      });
    }
    if (contributed && !scannedFiles.includes(rel)) scannedFiles.push(rel);
  }

  routes.sort((a, b) => cmp(a.path, b.path) || cmp(a.method, b.method));
  return { routes, globalMiddlewares: [], helpers: [], skipped, scannedFiles };
}

// --- handler scan: real body effects + synthesized workflow effects ---------

// scanFunction sees res.json shapes, validation, guards. It does NOT see the
// Medusa effect, which is a workflow call — so we walk the body for workflow/step
// identifiers and push a db_write/db_read per call, in source order, merged with
// the scanFunction effects and re-sorted by line so the graph stays deterministic.
function scanHandler(fn) {
  const scan = scanFunction(fn);
  const synth = [];
  walkNode(fn.body, (node) => {
    if (node.type !== 'CallExpression') return;
    const name = calleeIdentifier(node.callee);
    if (!name) return;
    const eff = effectForWorkflow(name, node.loc?.start.line ?? 0);
    if (eff) synth.push(eff);
  });
  if (synth.length) {
    scan.effects = [...scan.effects, ...synth].sort((a, b) => a.line - b.line);
    // a mutating workflow means the request body reaches state — signal it so
    // input-validation obligations (O2) apply just like an ORM write.
    if (synth.some((e) => e.effectType === 'db_write')) scan.writesState = true;
  }
  return scan;
}

function effectForWorkflow(name, line) {
  if (!/(workflow|step)$/i.test(name)) return null;
  if (READ_VERB.test(name) && !WRITE_VERB.test(name)) {
    return { effectType: 'db_read', op: 'select', table: tableOf(name), line };
  }
  if (!WRITE_VERB.test(name)) return null;
  const op = OP_BY_VERB.find(([re]) => re.test(name))?.[1] ?? 'update';
  return { effectType: 'db_write', op, table: tableOf(name), line };
}

// createProductWorkflow → "product"; updateLineItemStep → "lineitem". Strip the
// leading verb and the trailing workflow/step suffix; lowercased, singular-ish.
function tableOf(name) {
  let base = name
    .replace(/(workflow|step)s?$/i, '')
    .replace(WRITE_VERB, '')
    .replace(READ_VERB, '');
  base = base.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return base.replace(/s$/, '') || 'unknown';
}

// --- filesystem → route path ------------------------------------------------

function isRouteFile(file) {
  return /(^|[\\/])route\.(m?ts|m?js|cts|cjs)$/.test(file) && !/\.d\.ts$/.test(file);
}

// directory of route.ts, relative to the api root → "/admin/products/:id".
// `[id]` → `:id`, `[...rest]` → `:rest` (Medusa/Next catch-all).
function pathOf(apiRoot, file) {
  const dir = path.dirname(file);
  const rel = path.relative(apiRoot, dir).split(path.sep).filter(Boolean);
  const segs = rel.map((seg) =>
    seg.replace(/^\[\.\.\.(.+)\]$/, ':$1').replace(/^\[(.+)\]$/, ':$1'),
  );
  return '/' + segs.join('/');
}

function pathParamsOf(fullPath) {
  return [...fullPath.matchAll(/:(\w+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    type: 'string',
    required: true,
  }));
}

// --- AST helpers ------------------------------------------------------------

// top-level `export const NAME = <fn|value>` and `export [async] function NAME`,
// keyed by NAME → { init, fn, line }. Only the exports Medusa's router reads.
function topLevelExports(ast) {
  const out = {};
  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue;
    const decl = node.declaration;
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id?.type !== 'Identifier') continue;
        out[d.id.name] = {
          init: d.init,
          fn: isFn(d.init) ? d.init : null,
          line: d.loc?.start.line ?? node.loc?.start.line ?? 0,
        };
      }
    } else if (decl.type === 'FunctionDeclaration' && decl.id?.type === 'Identifier') {
      out[decl.id.name] = { init: null, fn: decl, line: decl.loc?.start.line ?? 0 };
    }
  }
  return out;
}

const isFn = (n) =>
  n?.type === 'ArrowFunctionExpression' || n?.type === 'FunctionExpression';

// the identifier being *called*: `createFooWorkflow(scope)` → "createFooWorkflow",
// and `createFooWorkflow(scope).run(x)` → still "createFooWorkflow" (the workflow
// is the callee of the inner call, which is the object of the `.run` member).
function calleeIdentifier(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') return calleeIdentifier(callee.object);
  if (callee.type === 'CallExpression') return calleeIdentifier(callee.callee);
  return null;
}

// depth-first walk over an AST subtree (skips position/comment keys)
function walkNode(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkNode(n, fn);
    return;
  }
  if (node.type) fn(node);
  for (const k of Object.keys(node)) {
    if (
      k === 'loc' ||
      k === 'range' ||
      k === 'leadingComments' ||
      k === 'trailingComments'
    )
      continue;
    const v = node[k];
    if (v && typeof v === 'object') walkNode(v, fn);
  }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function relOf(cwd, abs) {
  return path.relative(cwd, abs).split(path.sep).join('/');
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => cmp(a.name, b.name))) {
    if (EXCLUDE.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(abs);
    else if (/\.(m?ts|m?js|cts|cjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) yield abs;
  }
}
