// ubg/strapi.js — Strapi (declarative route-table) extraction. The FOURTH pattern.
//
// Strapi defeated every prior detector: its routes are neither `app.get()` (Express), nor
// `@Get()` decorators (Nest), nor a `route.ts` file convention (Medusa). They are a DATA
// STRUCTURE — a config array the framework reads at boot:
//
//   module.exports = { routes: [ { method:'POST', path:'/x', handler:'a.create' } ] };
//   module.exports = createCoreRouter('api::article.article');   // ← implies 5 CRUD routes
//
// So an AST scan for route CALLS sees nothing → 0 routes → the whole app read as SURFACE
// (the genome's "no-routes" gap on Strapi/directus). The fix is PARTIAL EVALUATION of the
// registry: read the route array as data, unroll `createCoreRouter` to the CRUD table it
// stands for, resolve each `handler:'controller.action'` string to the controller method,
// and scan its effects. Same UBG out, so apocalypse/polarity/coverage all just work.
//
// Three conventions turn the config into a UBG:
//   1. ROUTE  — a `{ method, path, handler, config }` object is one entrypoint; a
//      `createCoreRouter(uid)` is the 5-row CRUD table (find/findOne/create/update/delete),
//      pathed from the content-type's pluralName.
//   2. AUTH   — a route's `config.auth === false` is a PUBLIC opt-out; `config.policies` /
//      `config.middlewares` are asserted guards. Any opt-out in the app ⇒ guarded-by-default
//      (ADR-055): every non-opt-out route earns an asserted `framework-default-auth` guard,
//      honest about Strapi's permission layer living in admin config, not code.
//   3. EFFECT — the real mutation is `strapi.entityService.create(uid,…)` /
//      `strapi.db.query(uid).delete(…)` / `strapi.documents(uid).update(…)`; a core-default
//      action (absent from the controller) has its write synthesized from verb + uid.
import fs from 'node:fs';
import path from 'node:path';
import { parseModule, scanFunction } from './extract.js';

const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.sparda']);

// Strapi ORM verbs → op. entityService / db.query(uid) / documents(uid) share this vocabulary.
const STRAPI_WRITE = {
  create: 'insert',
  createMany: 'insert',
  update: 'update',
  updateMany: 'update',
  upsert: 'upsert',
  delete: 'delete',
  deleteMany: 'delete',
  publish: 'update',
  unpublish: 'update',
};
const STRAPI_READ = new Set(['find', 'findOne', 'findMany', 'findPage', 'count']);

// The default CRUD table a `createCoreRouter(uid)` stands for: [action, method, pathSuffix].
// `:plural` is filled from the content-type; `/:id` targets one row.
const CORE_CRUD = [
  ['find', 'get', ''],
  ['findOne', 'get', '/:id'],
  ['create', 'post', ''],
  ['update', 'put', '/:id'],
  ['delete', 'delete', '/:id'],
];

// → { routes, globalMiddlewares, helpers, skipped, scannedFiles } (extractExpress shape)
export function extractStrapi(cwd, entryDir) {
  const routes = [];
  const skipped = [];
  // the registration invariant (ADR-079): a surface seen but unbindable is DECLARED
  const unknownHandlers = [];
  const scannedFiles = [];
  const apiRoot = path.resolve(cwd, entryDir || 'src/api');

  for (const apiName of apiChildren(apiRoot)) {
    const apiDir = path.join(apiRoot, apiName);
    const routesDir = path.join(apiDir, 'routes');
    for (const file of filesIn(routesDir)) {
      const mod = parseModule(file);
      const rel = relOf(cwd, file);
      if (mod.error) {
        skipped.push({ reason: `${mod.error} in ${rel}`, file: rel });
        continue;
      }
      const exported = moduleExportValue(mod.ast);
      if (!exported) continue;

      const defs = routeDefsOf(exported, apiName, apiDir);
      if (!defs.length) continue;

      for (const def of defs) {
        const controllerFn = resolveHandler(apiDir, def.handler);
        // The route table DECLARES this endpoint, so Strapi will serve it; only its
        // controller body escaped us. The route stays (a synthesized scan still models
        // the core CRUD verb) but a hand-written handler we could not read is a real
        // hole — declared rather than left to look like a resolved route.
        if (!controllerFn && def.handler && !def.defaultVerb) {
          unknownHandlers.push({
            kind: 'UnknownHandler',
            via: 'unresolved-controller',
            target: def.handler,
            file: rel,
            line: def.line,
          });
          skipped.push({
            reason: `Strapi route ${def.method ?? ''} ${def.path ?? ''} declares handler "${def.handler}" which did not resolve — its behaviour is unseen`,
            file: rel,
            line: def.line,
            risk: 'high',
          });
        }
        const scan = scanHandler(controllerFn, def.defaultVerb, def.defaultTable);
        const chain = [];
        for (const guard of def.guards) {
          chain.push({
            name: guard,
            sourceFile: rel,
            sourceLine: def.line,
            fn: null,
            role: 'middleware',
          });
        }
        chain.push({
          name: def.handler || `${apiName}.${def.action}`,
          sourceFile: rel,
          sourceLine: def.line,
          fn: null,
          scan,
          role: 'handler',
        });
        routes.push({
          method: def.method,
          path: def.path,
          sourceFile: rel,
          sourceLine: def.line,
          params: pathParamsOf(def.path),
          chain,
          description: '',
          authOptOut: def.authOptOut,
        });
      }
      if (!scannedFiles.includes(rel)) scannedFiles.push(rel);
    }
  }

  applyAuthPosture(routes);
  routes.sort((a, b) => cmp(a.path, b.path) || cmp(a.method, b.method));
  return {
    routes,
    globalMiddlewares: [],
    helpers: [],
    skipped,
    unknownHandlers,
    scannedFiles,
  };
}

// --- route-table reading ----------------------------------------------------

// Every route this export declares → a normalized def. Handles both the custom `{ routes: [...] }`
// table and a `createCoreRouter(uid)` call (unrolled to its CRUD table).
function routeDefsOf(exported, apiName, apiDir) {
  // createCoreRouter('api::a.b') → the 5-row CRUD table
  const coreUid = coreRouterUid(exported);
  if (coreUid) {
    const plural = pluralNameOf(apiDir) ?? `${apiName}s`;
    const table = tableOfUid(coreUid);
    return CORE_CRUD.map(([action, method, suffix]) => ({
      method,
      path: `/${plural}${suffix}`,
      handler: `${apiName}.${action}`,
      action,
      defaultVerb: action, // core action body is a framework default — synthesize its write
      defaultTable: table, // the uid's table, so the synthesized effect targets it
      guards: [],
      authOptOut: false,
      line: exported.loc?.start.line ?? 0,
    }));
  }
  // custom table: { routes: [ { method, path, handler, config } ] }
  const arr = objectProp(exported, 'routes');
  if (arr?.type !== 'ArrayExpression') return [];
  const defs = [];
  for (const el of arr.elements) {
    if (el?.type !== 'ObjectExpression') continue;
    const method = strLit(objectProp(el, 'method'))?.toLowerCase();
    const routePath = strLit(objectProp(el, 'path'));
    const handler = strLit(objectProp(el, 'handler'));
    if (!method || !routePath) continue;
    const config = objectProp(el, 'config');
    defs.push({
      method,
      path: routePath,
      handler,
      action: handler ? handler.split('.').pop() : null,
      defaultVerb: null, // a custom handler has a real body — never synthesize
      guards: guardsOfConfig(config),
      authOptOut: authOptOutOfConfig(config),
      line: el.loc?.start.line ?? 0,
    });
  }
  return defs;
}

// `createCoreRouter('api::article.article')` (bare or `factories.createCoreRouter`) → the uid.
function coreRouterUid(node) {
  if (node?.type !== 'CallExpression') return null;
  const callee = node.callee;
  const name =
    callee.type === 'Identifier'
      ? callee.name
      : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
        ? callee.property.name
        : null;
  if (name !== 'createCoreRouter') return null;
  return strLit(node.arguments[0]);
}

// config.auth === false → the route is a PUBLIC opt-out (auth may also be an object
// `{ scope }`, which is still authenticated — only the literal `false` opts out).
function authOptOutOfConfig(config) {
  if (config?.type !== 'ObjectExpression') return false;
  const auth = objectProp(config, 'auth');
  return auth?.type === 'BooleanLiteral' && auth.value === false;
}

// config.policies / config.middlewares with entries → asserted guards (named by the first entry).
function guardsOfConfig(config) {
  if (config?.type !== 'ObjectExpression') return [];
  const out = [];
  for (const key of ['policies', 'middlewares']) {
    const arr = objectProp(config, key);
    if (arr?.type === 'ArrayExpression' && arr.elements.length) {
      const first = strLit(arr.elements[0]);
      out.push(first ? `policy:${first}` : key);
    }
  }
  return out;
}

// --- handler → controller method --------------------------------------------

// `handler:'article.publish'` (or `api::article.article.publish`) → the controller action's
// function node, or null if it's a core default / unresolved. Controller lives at
// apiDir/controllers/<controller>.{js,ts,…}; the controller name is the handler's 2nd-to-last
// dot segment. The action is the last segment.
function resolveHandler(apiDir, handler) {
  if (!handler) return null;
  const segs = handler.split('.');
  const action = segs[segs.length - 1];
  const controller = segs.length >= 2 ? segs[segs.length - 2] : null;
  if (!controller) return null;
  const file = firstFile(path.join(apiDir, 'controllers'), controller);
  if (!file) return null;
  const mod = parseModule(file);
  if (mod.error) return null;
  const exported = moduleExportValue(mod.ast);
  const obj = controllerObject(exported);
  if (!obj) return null;
  return methodFn(obj, action);
}

// A controller export is either a plain object `{ async create(ctx){} }` or the factory
// `createCoreController(uid, ({strapi}) => ({ async create(){} }))` — unwrap to the object.
function controllerObject(node) {
  if (!node) return null;
  if (node.type === 'ObjectExpression') return node;
  if (node.type === 'CallExpression') {
    // createCoreController(uid, fn) — the override object is the fn's returned object
    const fn = node.arguments.find(
      (a) => a?.type === 'ArrowFunctionExpression' || a?.type === 'FunctionExpression',
    );
    if (fn) return returnedObject(fn);
  }
  return null;
}

// the object a `({strapi}) => ({ ... })` / `() => { return { ... } }` returns.
function returnedObject(fn) {
  if (fn.body?.type === 'ObjectExpression') return fn.body; // concise arrow
  if (fn.body?.type === 'BlockStatement') {
    for (const st of fn.body.body)
      if (st.type === 'ReturnStatement' && st.argument?.type === 'ObjectExpression')
        return st.argument;
  }
  return null;
}

// the function node for method `name` on an object literal (ObjectMethod or a
// property whose value is a function).
function methodFn(obj, name) {
  for (const p of obj.properties) {
    const key = p.key?.type === 'Identifier' ? p.key.name : strLitNode(p.key);
    if (key !== name) continue;
    if (p.type === 'ObjectMethod') return p;
    if (p.type === 'ObjectProperty' && isFn(p.value)) return p.value;
  }
  return null;
}

// --- handler scan: real body effects + synthesized Strapi effects -----------

// scanFunction sees res/ctx shapes, validation, guards. It does NOT see the Strapi effect
// (an entityService/db.query call), so we walk the body and synthesize a db_write/db_read per
// call, merged and re-sorted. A core-default action (no fn) synthesizes its write from the
// route verb alone. Mirrors medusa.js scanHandler.
function scanHandler(fn, defaultVerb, defaultTable = null) {
  if (!fn) {
    // core CRUD default — the body lives in the framework. Synthesize from the verb + uid.
    const op = STRAPI_WRITE[defaultVerb];
    const effects = op
      ? [{ effectType: 'db_write', op, table: defaultTable, line: 0 }]
      : STRAPI_READ.has(defaultVerb)
        ? [{ effectType: 'db_read', op: 'select', table: defaultTable, line: 0 }]
        : [];
    return {
      effects,
      returnShapes: [],
      calls: [],
      async: true,
      validatesInput: false,
      writesState: effects.some((e) => e.effectType === 'db_write'),
    };
  }
  const scan = scanFunction(fn);
  const synth = [];
  walkNode(fn.body, (node) => {
    if (node.type !== 'CallExpression') return;
    const eff = strapiEffect(node);
    if (eff) synth.push(eff);
  });
  if (synth.length) {
    scan.effects = [...scan.effects, ...synth].sort((a, b) => a.line - b.line);
    if (synth.some((e) => e.effectType === 'db_write')) scan.writesState = true;
  }
  return scan;
}

// A Strapi ORM call → an effect, else null. Recognizes:
//   strapi.entityService.<verb>(uid, …)     — uid is arg0
//   strapi.db.query(uid).<verb>(…)          — uid is the inner call's arg0
//   strapi.documents(uid).<verb>(…)         — uid is the inner call's arg0 (v5)
function strapiEffect(node) {
  const callee = node.callee;
  if (callee?.type !== 'MemberExpression' || callee.property.type !== 'Identifier')
    return null;
  const verb = callee.property.name;
  if (STRAPI_WRITE[verb] === undefined && !STRAPI_READ.has(verb)) return null;
  const recv = callee.object;
  const line = node.loc?.start.line ?? 0;

  let uid = null;
  // entityService.<verb>(uid, …)
  if (
    recv.type === 'MemberExpression' &&
    recv.property.type === 'Identifier' &&
    recv.property.name === 'entityService' &&
    rootIs(recv.object, 'strapi')
  ) {
    uid = strLit(node.arguments[0]);
  } else if (recv.type === 'CallExpression') {
    // db.query(uid).<verb> / documents(uid).<verb>
    const rc = recv.callee;
    if (rc?.type === 'MemberExpression' && rc.property.type === 'Identifier') {
      if (rc.property.name === 'query' || rc.property.name === 'documents')
        uid = strLit(recv.arguments[0]);
    }
    if (uid == null && recv.arguments?.length) uid = strLit(recv.arguments[0]);
  } else {
    return null;
  }

  const op = STRAPI_WRITE[verb];
  return op
    ? { effectType: 'db_write', op, table: tableOfUid(uid), line }
    : { effectType: 'db_read', op: 'select', table: tableOfUid(uid), line };
}

// 'api::article.article' → 'article'; 'plugin::users-permissions.user' → 'user'. Null uid
// (a variable, `this.uid`) → null table (still a real db_write, just an unknown target).
function tableOfUid(uid) {
  if (!uid || typeof uid !== 'string') return null;
  const last = uid.split('.').pop();
  return last ? last.toLowerCase() : null;
}

// --- auth posture (ADR-055, same rule as nestjs) ----------------------------

function applyAuthPosture(routes) {
  const guardedByDefault = routes.some((r) => r.authOptOut);
  for (const r of routes) {
    if (
      guardedByDefault &&
      !r.authOptOut &&
      !r.chain.some((s) => s.role === 'middleware')
    ) {
      r.chain.unshift({
        name: 'framework-default-auth',
        sourceFile: r.sourceFile,
        sourceLine: r.sourceLine,
        fn: null,
        role: 'middleware',
      });
    }
    delete r.authOptOut;
  }
}

// --- content-type pluralName ------------------------------------------------

// the content-type's pluralName (the route path segment) from
// apiDir/content-types/<any>/schema.json → info.pluralName. Null if absent.
function pluralNameOf(apiDir) {
  const ctRoot = path.join(apiDir, 'content-types');
  let children;
  try {
    children = fs.readdirSync(ctRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const c of children.sort((a, b) => cmp(a.name, b.name))) {
    if (!c.isDirectory()) continue;
    const schema = path.join(ctRoot, c.name, 'schema.json');
    try {
      const json = JSON.parse(fs.readFileSync(schema, 'utf8'));
      const plural = json?.info?.pluralName;
      if (typeof plural === 'string' && plural) return plural;
    } catch {
      // no/invalid schema — try the next content-type
    }
  }
  return null;
}

// --- AST helpers ------------------------------------------------------------

// the value assigned to `module.exports = X` (CJS) or `export default X` (ESM).
function moduleExportValue(ast) {
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') return node.declaration;
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'AssignmentExpression'
    ) {
      const left = node.expression.left;
      if (
        left.type === 'MemberExpression' &&
        rootIs(left.object, 'module') &&
        left.property.type === 'Identifier' &&
        left.property.name === 'exports'
      )
        return node.expression.right;
    }
  }
  return null;
}

// the value of property `name` on an object literal (else null).
function objectProp(node, name) {
  if (node?.type !== 'ObjectExpression') return null;
  for (const p of node.properties) {
    if (p.type !== 'ObjectProperty') continue;
    const key = p.key?.type === 'Identifier' ? p.key.name : strLitNode(p.key);
    if (key === name) return p.value;
  }
  return null;
}

const strLit = (n) => (n?.type === 'StringLiteral' ? n.value : null);
const strLitNode = (n) => (n?.type === 'StringLiteral' ? n.value : null);
const isFn = (n) =>
  n?.type === 'ArrowFunctionExpression' || n?.type === 'FunctionExpression';
const rootIs = (n, name) => n?.type === 'Identifier' && n.name === name;

function pathParamsOf(fullPath) {
  return [...fullPath.matchAll(/:(\w+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    type: 'string',
    required: true,
  }));
}

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

// immediate sub-directories of src/api (each is one API/content-type).
function apiChildren(apiRoot) {
  try {
    return fs
      .readdirSync(apiRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !EXCLUDE.has(e.name))
      .map((e) => e.name)
      .sort(cmp);
  } catch {
    return [];
  }
}

// source files directly in a dir (non-recursive — Strapi routes/controllers are flat).
function filesIn(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isFile() && /\.(m?ts|m?js|cts|cjs)$/.test(e.name) && !/\.d\.ts$/.test(e.name),
    )
    .map((e) => path.join(dir, e.name))
    .sort(cmp);
}

// the first source file named `<base>.<ext>` in dir (controllers/<name>.js|ts).
function firstFile(dir, base) {
  for (const ext of ['js', 'ts', 'mjs', 'cjs', 'cts', 'mts']) {
    const abs = path.join(dir, `${base}.${ext}`);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}
