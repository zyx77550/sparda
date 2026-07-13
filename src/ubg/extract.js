// ubg/extract.js — the shared AST microscope.
// One module = one parse. parseModule() caches per-file facts (top-level
// functions, import map); scanFunction() walks a single function body and
// reports what it DOES: database reads/writes, external HTTP, filesystem
// touches, response shapes, auth signals, local calls. Framework extractors
// (express.js, nextjs.js) decide what is a route; this file only observes
// behavior. Everything is bounded and deterministic — source order in,
// source order out.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const MAX_EFFECTS = 40;
const MAX_RETURN_SHAPES = 10;
const MAX_CALLS = 30;

const SQL_VERBS = {
  select: { effectType: 'db_read', op: 'select' },
  insert: { effectType: 'db_write', op: 'insert' },
  update: { effectType: 'db_write', op: 'update' },
  delete: { effectType: 'db_write', op: 'delete' },
  upsert: { effectType: 'db_write', op: 'upsert' },
};
const SUPABASE_OPS = new Set(['select', 'insert', 'update', 'upsert', 'delete']);
// Kysely: the op names its own table (db.insertInto('t')), one op = one verb.
const KYSELY_OPS = {
  insertinto: 'insert',
  updatetable: 'update',
  deletefrom: 'delete',
  selectfrom: 'select',
  replaceinto: 'upsert',
  mergeinto: 'upsert',
};
// Active-record ORM ops, keyed by method name. Covers Mongoose (`User.create()`),
// TypeORM (`User.save()`/`repo.save()`), and Sequelize (`User.findAll()`/`destroy()`) —
// they share the `Model.op()` / `repository.op()` shape, so one table serves all three.
const MODEL_OPS = {
  // writes — inserts
  create: 'insert',
  insertmany: 'insert',
  bulkcreate: 'insert', // sequelize
  save: 'insert', // mongoose / typeorm
  insert: 'insert', // typeorm repository
  // writes — updates
  updateone: 'update',
  updatemany: 'update',
  replaceone: 'update',
  findbyidandupdate: 'update',
  findoneandupdate: 'update',
  findoneandreplace: 'update',
  increment: 'update', // sequelize / typeorm
  decrement: 'update',
  upsert: 'upsert',
  // writes — deletes
  deleteone: 'delete',
  deletemany: 'delete',
  findbyidanddelete: 'delete',
  findoneanddelete: 'delete',
  findbyidandremove: 'delete',
  remove: 'delete', // mongoose / typeorm
  destroy: 'delete', // sequelize
  softdelete: 'delete', // typeorm
  softremove: 'delete',
  // reads
  find: 'select',
  findall: 'select', // sequelize
  findone: 'select',
  findbyid: 'select',
  findbypk: 'select', // sequelize
  findby: 'select', // typeorm
  findoneby: 'select', // typeorm
  countdocuments: 'select',
  estimateddocumentcount: 'select',
  count: 'select',
  distinct: 'select',
  exists: 'select',
  paginate: 'select',
};
// Drizzle: `db.insert(users).values(...)` / `db.update(users).set(...)` / `db.delete(users)`
// — the table is an IDENTIFIER (the schema object), not a string. Distinct from Kysely
// (which names the table in the method: insertInto) and supabase (.from('t')).
const DRIZZLE_OPS = { insert: 'insert', update: 'update', delete: 'delete' };
const PRISMA_OPS = {
  findmany: 'select',
  findunique: 'select',
  findfirst: 'select',
  count: 'select',
  aggregate: 'select',
  create: 'insert',
  createmany: 'insert',
  update: 'update',
  updatemany: 'update',
  upsert: 'upsert',
  delete: 'delete',
  deletemany: 'delete',
};
const FS_WRITE = new Set([
  'writefile',
  'writefilesync',
  'appendfile',
  'appendfilesync',
  'unlink',
  'unlinksync',
  'mkdir',
  'mkdirsync',
  'rm',
  'rmsync',
  'rename',
  'renamesync',
]);
const FS_READ = new Set([
  'readfile',
  'readfilesync',
  'readdir',
  'readdirsync',
  'stat',
  'statsync',
  'existssync',
]);
const HTTP_CLIENTS = new Set(['axios', 'got', 'ky', 'superagent', 'undici']);
const GUARD_NAME = /auth|guard|acl|permission|verif|session|admin|protect|role|token/i;

const moduleCache = new Map(); // absFile -> module facts (parse once per compile run)

export function clearModuleCache() {
  moduleCache.clear();
  tsconfigCache.clear();
}

// absFile → { ast, functions: Map<name,{node,line,exported}>, imports: Map<local,abs>, error }
export function parseModule(absFile) {
  if (moduleCache.has(absFile)) return moduleCache.get(absFile);
  const facts = {
    ast: null,
    functions: new Map(),
    imports: new Map(),
    reexports: new Map(), // barrel: `module.exports.x = require('./x')` → x -> file
    error: null,
    _file: absFile, // the module's own path — DI resolution reports source locations
  };
  moduleCache.set(absFile, facts);

  let src;
  try {
    src = fs.readFileSync(absFile, 'utf8');
  } catch (err) {
    facts.error = `unreadable: ${err.message}`;
    return facts;
  }
  try {
    facts.ast = parse(src, {
      sourceType: 'unambiguous',
      // decorators-legacy = TypeScript's `experimentalDecorators`, which is what
      // NestJS/Medusa/TypeORM actually compile with. Unlike the modern `decorators`
      // plugin it allows PARAMETER decorators (`@Body()`, `@Param()`) — without this
      // every Nest controller is a parse error and the app reads as 0 routes.
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      attachComment: true,
    });
  } catch (err) {
    facts.error = `parse error: ${err.message.slice(0, 80)}`;
    return facts;
  }

  for (const node of facts.ast.program.body) collectTopLevel(node, facts, absFile, false);
  return facts;
}

function collectTopLevel(node, facts, absFile, exported) {
  if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    collectTopLevel(node.declaration, facts, absFile, true);
    return;
  }
  if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
    const d = node.declaration;
    if (d.type === 'FunctionDeclaration' || d.type === 'ArrowFunctionExpression') {
      facts.functions.set(d.id?.name ?? 'default', {
        node: d,
        line: d.loc?.start.line ?? 0,
        exported: true,
      });
    }
    return;
  }
  if (node.type === 'FunctionDeclaration' && node.id) {
    facts.functions.set(node.id.name, {
      node,
      line: node.loc?.start.line ?? 0,
      exported,
    });
    return;
  }
  if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) {
      const init = d.init;
      if (d.id?.type !== 'Identifier' || !init) continue;
      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
        facts.functions.set(d.id.name, {
          node: init,
          line: d.loc?.start.line ?? 0,
          exported,
        });
      } else if (
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        init.arguments[0]?.type === 'StringLiteral'
      ) {
        const resolved = resolveRelImport(absFile, init.arguments[0].value);
        if (resolved) {
          if (d.id.type === 'Identifier') facts.imports.set(d.id.name, resolved);
        }
      } else if (init.type === 'CallExpression') {
        // wrapper idiom: const register = catchAsync(async (req, res) => …)
        // — the wrapped function IS the behavior; the wrapper is plumbing
        const fnArg = init.arguments.find(
          (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
        );
        if (fnArg) {
          facts.functions.set(d.id.name, {
            node: fnArg,
            line: d.loc?.start.line ?? 0,
            exported,
          });
        }
      }
    }
    // destructured require: const { a, b } = require('./x')
    for (const d of node.declarations) {
      if (
        d.id?.type === 'ObjectPattern' &&
        d.init?.type === 'CallExpression' &&
        d.init.callee.type === 'Identifier' &&
        d.init.callee.name === 'require' &&
        d.init.arguments[0]?.type === 'StringLiteral'
      ) {
        const resolved = resolveRelImport(absFile, d.init.arguments[0].value);
        if (!resolved) continue;
        // if the required module is a barrel, resolve each destructured member to the
        // sub-module it re-exports (`{ userService }` → user.service.js, not index.js).
        const barrel = resolved === absFile ? null : parseModule(resolved);
        for (const prop of d.id.properties) {
          if (
            prop.type === 'ObjectProperty' &&
            prop.value.type === 'Identifier' &&
            prop.key.type === 'Identifier'
          ) {
            const viaBarrel = barrel?.reexports.get(prop.key.name);
            facts.imports.set(prop.value.name, viaBarrel ?? resolved);
          }
        }
      }
    }
    return;
  }
  if (node.type === 'ImportDeclaration') {
    const resolved = resolveRelImport(absFile, node.source.value);
    if (!resolved) return;
    for (const spec of node.specifiers) facts.imports.set(spec.local.name, resolved);
    return;
  }
  // barrel re-export: `module.exports.userService = require('./user.service')` or
  // `exports.userService = require('./user.service')`. Records member → file so a
  // `const { userService } = require('./services')` resolves to the real module.
  if (
    node.type === 'ExpressionStatement' &&
    node.expression.type === 'AssignmentExpression' &&
    node.expression.left.type === 'MemberExpression' &&
    node.expression.left.property.type === 'Identifier'
  ) {
    const left = node.expression.left;
    const isExports =
      (left.object.type === 'Identifier' && left.object.name === 'exports') ||
      (left.object.type === 'MemberExpression' &&
        left.object.object.type === 'Identifier' &&
        left.object.object.name === 'module' &&
        left.object.property.type === 'Identifier' &&
        left.object.property.name === 'exports');
    const rhs = node.expression.right;
    if (
      isExports &&
      rhs.type === 'CallExpression' &&
      rhs.callee.type === 'Identifier' &&
      rhs.callee.name === 'require' &&
      rhs.arguments[0]?.type === 'StringLiteral'
    ) {
      const resolved = resolveRelImport(absFile, rhs.arguments[0].value);
      if (resolved) facts.reexports.set(left.property.name, resolved);
    }
  }
}

export function resolveRelImport(fromFile, spec) {
  const clean = (s) => s.replace(/\.(m?[jt]s|cjs)$/, '');
  if (spec.startsWith('.')) {
    return firstModuleFile(path.resolve(path.dirname(fromFile), clean(spec)));
  }
  // Non-relative: a TS baseUrl/paths alias (`src/services/x`, `@app/x`) — the shape
  // real monorepos (immich, Nest apps) use instead of `../../`. Without this the
  // cross-module hop (controller → service → repository) dead-ends and effects behind
  // DI are invisible. A bare npm package (`kysely`, `@nestjs/common`) simply resolves
  // to nothing here (no matching file under the project), which is correct.
  return resolveAliasedImport(fromFile, clean(spec));
}

// probe the standard TS/JS extensions + index files for a resolved base path.
function firstModuleFile(base) {
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ]) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    } catch {
      // race between existsSync and statSync — treat as unresolvable
    }
  }
  return null;
}

// tsconfig baseUrl + paths, resolved from the nearest ancestor project. Cached per
// directory so the walk-up + read happens once. `null` = no project found.
const tsconfigCache = new Map();
function projectConfig(fromFile) {
  const chain = [];
  let dir = path.dirname(fromFile);
  for (let i = 0; i < 40; i++) {
    if (tsconfigCache.has(dir)) {
      const v = tsconfigCache.get(dir);
      for (const d of chain) tsconfigCache.set(d, v);
      return v;
    }
    chain.push(dir);
    const tsc = path.join(dir, 'tsconfig.json');
    let v;
    if (fs.existsSync(tsc)) v = readTsconfig(tsc, dir);
    else if (fs.existsSync(path.join(dir, 'package.json')))
      v = { baseDir: dir, paths: {} };
    if (v) {
      for (const d of chain) tsconfigCache.set(d, v);
      return v;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of chain) tsconfigCache.set(d, null);
  return null;
}

function readTsconfig(file, dir) {
  try {
    const raw = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/(^|[^:"])\/\/.*$/gm, '$1'); // line comments (not URLs/keys)
    const co = JSON.parse(raw).compilerOptions ?? {};
    return {
      baseDir: co.baseUrl ? path.resolve(dir, co.baseUrl) : dir,
      paths: co.paths ?? {},
    };
  } catch {
    return { baseDir: dir, paths: {} };
  }
}

function resolveAliasedImport(fromFile, spec) {
  const cfg = projectConfig(fromFile);
  if (!cfg) return null;
  const candidates = [];
  // explicit tsconfig `paths` (e.g. "@app/*": ["src/app/*"])
  for (const [pattern, targets] of Object.entries(cfg.paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (pattern === spec) for (const t of targets) candidates.push(t);
      continue;
    }
    const pre = pattern.slice(0, star);
    const post = pattern.slice(star + 1);
    if (
      spec.startsWith(pre) &&
      spec.endsWith(post) &&
      spec.length >= pre.length + post.length
    ) {
      const mid = spec.slice(pre.length, spec.length - post.length);
      for (const t of targets) candidates.push(t.replace('*', mid));
    }
  }
  // implicit baseUrl resolution + the near-universal `src/` root fallback, so the
  // common `baseUrl:"."` + `"src/*":["src/*"]` config works even if paths is absent.
  const bases = candidates
    .map((c) => path.resolve(cfg.baseDir, c))
    .concat([path.resolve(cfg.baseDir, spec), path.resolve(cfg.baseDir, 'src', spec)]);
  for (const b of bases) {
    const hit = firstModuleFile(b);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Class resolution — shared by the Nest DI follower (this.<dep>.<m>()) and the
// Express instantiated-service follower (new Service().<m>()). A method lookup
// climbs the `extends` chain because real services inherit their behavior
// (directus: ActivityService extends ItemsService, where the DB calls live).
// ---------------------------------------------------------------------------

const MAX_CLASS_DEPTH = 6;

// find a class declaration named `typeName` at a module's top level (plain,
// export-named, or export-default with a matching name).
export function classInModule(mod, typeName) {
  for (const node of mod.ast?.program.body ?? []) {
    const cls =
      node.type === 'ClassDeclaration'
        ? node
        : (node.type === 'ExportNamedDeclaration' ||
              node.type === 'ExportDefaultDeclaration') &&
            node.declaration?.type === 'ClassDeclaration'
          ? node.declaration
          : null;
    if (cls && cls.id?.name === typeName) return cls;
  }
  return null;
}

// resolve `class X extends Base` → the Base class node + its module, via the import.
export function baseClassOf(cls, mod) {
  if (cls.superClass?.type !== 'Identifier') return null;
  const file = mod.imports.get(cls.superClass.name);
  if (!file || !fs.existsSync(file)) return null;
  const baseMod = parseModule(file);
  if (baseMod.error) return null;
  const baseCls = classInModule(baseMod, cls.superClass.name);
  return baseCls ? { cls: baseCls, mod: baseMod } : null;
}

// locate `methodName` on the class or up its `extends` chain →
// { fn, mod, cls } where `cls`/`mod` are the DECLARING class and its module
// (base-class methods live in the base module — the caller needs both for
// source locations and for resolving `super.<m>()` from the right link).
export function methodInClassChain(cls, mod, methodName, depth = 0) {
  for (const m of cls.body.body) {
    if (
      m.type === 'ClassMethod' &&
      m.key.type === 'Identifier' &&
      m.key.name === methodName
    )
      return { fn: m, mod, cls };
  }
  if (depth >= MAX_CLASS_DEPTH) return null;
  const base = baseClassOf(cls, mod);
  return base ? methodInClassChain(base.cls, base.mod, methodName, depth + 1) : null;
}

// ---------------------------------------------------------------------------
// scanFunction — what does this function DO?
// Plain recursive walk (no scope analysis: deterministic, dependency-free),
// bounded, source order preserved. Nested function declarations are NOT
// descended into as effects of the outer function only when they are
// immediately invoked — a defined-but-uncalled closure is that closure's
// business (kept simple: we DO descend; static over-approximation beats
// silent blindness, and passes can refine later).
// ---------------------------------------------------------------------------

export function scanFunction(fnNode) {
  const result = {
    effects: [],
    returnShapes: [],
    calls: [],
    guardSignals: { deniesWithStatus: false },
    validatesInput: false,
    async: Boolean(fnNode?.async),
  };
  if (!fnNode) return result;
  visit(fnNode.body, result, {
    tx: null,
    isolation: 'default',
    tryId: null,
    catchOf: null,
    reqDerived: collectReqDerived(fnNode),
  });
  return result;
}

// The request objects a handler names its input through. A table/target sourced from
// one of these is not a literal, but it is not unknown either: it is precisely "the
// value the caller supplies here" — a SYMBOLIC target, expressed as a rule.
const REQ_ROOTS = new Set(['req', 'request', 'ctx', 'context', 'event', 'request_']);

// `req.params.collection` / `req.query.table` / `req.body.type` / `req.collection`
// → the leaf name, prefixed ':' to mark it symbolic. Null if not request-derived.
function reqParamName(node, reqDerived) {
  if (node?.type === 'Identifier') return reqDerived?.get(node.name) ?? null;
  if (node?.type !== 'MemberExpression' || node.computed) return null;
  if (node.property.type !== 'Identifier') return null;
  const root = rootIdentifier(node);
  if (!root || !REQ_ROOTS.has(root.toLowerCase())) return null;
  return `:${node.property.name}`;
}

// map local vars assigned straight from a request member: `const c = req.params.collection`
// → { c: ':collection' }. One shallow pass; deterministic; bounded by the function body.
function collectReqDerived(fnNode) {
  const map = new Map();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (
      n.type === 'VariableDeclarator' &&
      n.id?.type === 'Identifier' &&
      n.init?.type === 'MemberExpression'
    ) {
      const name = reqParamName(n.init, null);
      if (name) map.set(n.id.name, name);
    }
    for (const k of Object.keys(n)) {
      if (
        k === 'loc' ||
        k === 'range' ||
        k === 'leadingComments' ||
        k === 'trailingComments'
      )
        continue;
      const v = n[k];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(fnNode.body);
  return map;
}

// SBIR §2.2 — transaction wrappers whose function arguments open a scope
const TX_WRAPPERS = new Set(['transaction', '$transaction', 'withTransaction']);

function visit(node, out, ctx) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) visit(n, out, ctx);
    return;
  }

  // try/catch — try-effects are compensable by catch-effects (SBIR §2.2)
  if (node.type === 'TryStatement') {
    const tryLine = node.loc?.start.line ?? 0;
    visit(node.block, out, { ...ctx, tryId: tryLine, catchOf: null });
    if (node.handler) visit(node.handler, out, { ...ctx, tryId: null, catchOf: tryLine });
    if (node.finalizer) visit(node.finalizer, out, ctx);
    return;
  }

  // `new Date()` — wall-clock read: an entropy effect the flight recorder
  // must tap for deterministic replay (SBIR v1.2 / Timeless)
  if (
    node.type === 'NewExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'Date' &&
    node.arguments.length === 0
  ) {
    pushEffect(out, ctx, {
      effectType: 'entropy',
      target: 'time',
      line: node.loc?.start.line ?? 0,
    });
  }

  if (node.type === 'CallExpression') {
    // transaction scope: db.transaction(cb) / prisma.$transaction(...) — the
    // innermost scope wins; isolation only from a string literal, never guessed
    const callee = node.callee;
    if (
      callee?.type === 'MemberExpression' &&
      callee.property?.type === 'Identifier' &&
      TX_WRAPPERS.has(callee.property.name)
    ) {
      const txCtx = {
        ...ctx,
        tx: node.loc?.start.line ?? 0,
        isolation: isolationLiteralOf(node) ?? 'default',
      };
      for (const arg of node.arguments) visit(arg, out, txCtx);
      return;
    }
    inspectCall(node, out, ctx);
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
    if (v && typeof v === 'object') visit(v, out, ctx);
  }
}

// Prisma `isolationLevel: 'Serializable'` & friends — literal or nothing
function isolationLiteralOf(callNode) {
  for (const arg of callNode.arguments) {
    if (arg.type !== 'ObjectExpression') continue;
    for (const prop of arg.properties) {
      if (
        prop.type === 'ObjectProperty' &&
        ((prop.key.type === 'Identifier' && /^isolation(Level)?$/.test(prop.key.name)) ||
          (prop.key.type === 'StringLiteral' &&
            /^isolation(Level)?$/.test(prop.key.value))) &&
        prop.value.type === 'StringLiteral'
      )
        return prop.value.value.toLowerCase();
    }
  }
  return null;
}

function inspectCall(node, out, ctx) {
  const line = node.loc?.start.line ?? 0;
  const callee = node.callee;

  // ---- response shapes: res.json(x) / res.status(n).json(x) / Response.json(x)
  const jsonShape = responseJsonShape(node);
  if (jsonShape !== undefined) {
    if (out.returnShapes.length < MAX_RETURN_SHAPES && jsonShape !== null)
      out.returnShapes.push({ line, shape: jsonShape });
    if (deniedStatusOf(node)) out.guardSignals.deniesWithStatus = true;
    return;
  }
  if (deniedStatusOf(node)) out.guardSignals.deniesWithStatus = true;

  // ---- local calls: bare identifier calls → call-graph edges later
  if (callee.type === 'Identifier') {
    if (callee.name === 'fetch') {
      const httpMethod = optionsMethodOf(node);
      pushEffect(out, ctx, {
        effectType: 'http_call',
        target: literalArg(node.arguments[0]) ?? 'dynamic',
        ...(httpMethod ? { httpMethod } : {}),
        line,
      });
      return;
    }
    if (/^(uuid|uuidv4|nanoid|randomuuid|ulid)$/i.test(callee.name)) {
      pushEffect(out, ctx, { effectType: 'entropy', target: 'uuid', line });
      return;
    }
    if (out.calls.length < MAX_CALLS) out.calls.push({ name: callee.name, line });
    return;
  }

  if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
  const method = callee.property.name;
  const methodLower = method.toLowerCase();
  const rootName = rootIdentifier(callee);

  // ---- entropy: nondeterminism points the replayer must virtualize
  if (rootName === 'Date' && methodLower === 'now') {
    pushEffect(out, ctx, { effectType: 'entropy', target: 'time', line });
    return;
  }
  if (rootName === 'Math' && methodLower === 'random') {
    pushEffect(out, ctx, { effectType: 'entropy', target: 'random', line });
    return;
  }
  if (/^crypto$/i.test(rootName ?? '') && methodLower === 'randomuuid') {
    pushEffect(out, ctx, { effectType: 'entropy', target: 'uuid', line });
    return;
  }

  // ---- input validation signal (SBIR §2.1): zod-style .safeParse / Schema.parse
  if (
    methodLower === 'safeparse' ||
    (methodLower === 'parse' &&
      callee.object.type === 'Identifier' &&
      /schema$/i.test(callee.object.name))
  ) {
    out.validatesInput = true;
    return;
  }

  // ---- raw SQL: X.query('INSERT ...') / X.execute(`SELECT ...`)
  if ((methodLower === 'query' || methodLower === 'execute') && node.arguments.length) {
    const sql = literalArg(node.arguments[0]);
    if (sql) {
      const parsed = parseSqlCall(sql);
      if (parsed) {
        pushEffect(out, ctx, { ...parsed, line, driver: rootName ?? 'unknown' });
        return;
      }
    }
    pushEffect(out, ctx, {
      effectType: 'db_read',
      op: 'unknown',
      table: null,
      line,
      driver: rootName ?? 'unknown',
    });
    return;
  }

  // ---- kysely builder: db.insertInto('t').values(...) / .updateTable('t').set(...)
  // / .deleteFrom('t') / .selectFrom('t'). The table is the op's OWN string arg
  // (not a chained .from()), so read it straight off arguments[0].
  if (KYSELY_OPS[methodLower] !== undefined && callee.type === 'MemberExpression') {
    const arg0 = node.arguments[0];
    const literal = arg0?.type === 'StringLiteral' ? arg0.value.toLowerCase() : null;
    const symbolic = literal ? null : reqParamName(arg0, ctx.reqDerived);
    const table = literal ?? symbolic;
    if (table) {
      const op = KYSELY_OPS[methodLower];
      pushEffect(out, ctx, {
        effectType: op === 'select' ? 'db_read' : 'db_write',
        op,
        table,
        ...(symbolic ? { symbolic: true } : {}),
        line,
      });
      return;
    }
  }

  // ---- supabase/knex builder: X.from('t').insert(...) or knex('t').update(...)
  if (SUPABASE_OPS.has(methodLower)) {
    const resolved = builderTableOf(callee.object, ctx.reqDerived);
    if (resolved) {
      pushEffect(out, ctx, {
        effectType: methodLower === 'select' ? 'db_read' : 'db_write',
        op: methodLower,
        table: resolved.symbolic ? resolved.table : resolved.table.toLowerCase(),
        ...(resolved.symbolic ? { symbolic: true } : {}),
        line,
      });
      return;
    }
  }

  // ---- prisma: prisma.user.findMany() → table "user". Literal values in
  // `data:`/`where:` are harvested like SQL SET/WHERE literals — they are the
  // raw material StateMachineInference reads (lowercased, same trade-off)
  if (PRISMA_OPS[methodLower] !== undefined) {
    const obj = callee.object;
    // `prisma.user.create(...)` OR the class-based `this.prisma.user.create(...)`
    // that NestJS services / Express controller classes use — `clientBaseName`
    // reads the client name off a bare Identifier or a `this.<field>`.
    const client = obj.type === 'MemberExpression' ? clientBaseName(obj.object) : null;
    if (
      obj.type === 'MemberExpression' &&
      !obj.computed &&
      obj.property.type === 'Identifier' &&
      client &&
      /prisma|client|db/i.test(client)
    ) {
      const op = PRISMA_OPS[methodLower];
      const data = prismaLiteralsOf(node.arguments[0], 'data');
      const where = prismaLiteralsOf(node.arguments[0], 'where');
      pushEffect(out, ctx, {
        effectType: op === 'select' ? 'db_read' : 'db_write',
        op,
        table: obj.property.name.toLowerCase(),
        ...(data && op === 'insert' ? { inserts: data } : {}),
        ...(data && op !== 'insert' && op !== 'select' ? { sets: data } : {}),
        ...(where ? { where } : {}),
        line,
      });
      return;
    }
  }

  // ---- drizzle: db.insert(users).values(...) / db.update(users) / db.delete(users).
  // The table is the schema-object IDENTIFIER passed to the op (not a string). Only a
  // db-like receiver qualifies, so it never fires on an arbitrary `.insert()`.
  if (DRIZZLE_OPS[methodLower] !== undefined && callee.type === 'MemberExpression') {
    const recv =
      callee.object.type === 'Identifier'
        ? callee.object.name
        : clientBaseName(callee.object);
    const arg0 = node.arguments[0];
    if (
      recv &&
      /^(db|database|drizzle|tx|trx|conn|client)$/i.test(recv) &&
      arg0?.type === 'Identifier'
    ) {
      pushEffect(out, ctx, {
        effectType: 'db_write',
        op: DRIZZLE_OPS[methodLower],
        table: arg0.name.toLowerCase(),
        line,
      });
      return;
    }
  }

  // ---- active-record ORM: User.create(...) / User.findAll(...) / User.save(...) — a
  // Capitalized model receiver with a known op (Mongoose / TypeORM active-record /
  // Sequelize). Capitalization is the shared convention and keeps this from firing on
  // `Math.random()`-style utility calls. Repository-pattern (`userRepository.save()`) is
  // deliberately NOT matched here — in Nest it is reached through DI into the repo
  // method's real query, so matching it too would double-count.
  if (
    MODEL_OPS[methodLower] !== undefined &&
    callee.object.type === 'Identifier' &&
    /^[A-Z]/.test(callee.object.name)
  ) {
    const op = MODEL_OPS[methodLower];
    pushEffect(out, ctx, {
      effectType: op === 'select' ? 'db_read' : 'db_write',
      op,
      table: callee.object.name.toLowerCase(),
      line,
    });
    return;
  }

  // ---- HTTP clients: axios.get(...), got.post(...) — the member IS the method
  if (rootName && HTTP_CLIENTS.has(rootName.toLowerCase())) {
    const httpMethod = /^(get|post|put|patch|delete|head)$/.test(methodLower)
      ? methodLower.toUpperCase()
      : optionsMethodOf(node);
    pushEffect(out, ctx, {
      effectType: 'http_call',
      target: literalArg(node.arguments[0]) ?? 'dynamic',
      ...(httpMethod ? { httpMethod } : {}),
      line,
    });
    return;
  }

  // ---- filesystem: fs.writeFileSync(...), fs.promises.readFile(...)
  if (rootName === 'fs' || rootName === 'fsp' || rootName === 'fsPromises') {
    if (FS_WRITE.has(methodLower)) {
      pushEffect(out, ctx, {
        effectType: 'fs_write',
        target: literalArg(node.arguments[0]) ?? 'dynamic',
        line,
      });
    } else if (FS_READ.has(methodLower)) {
      pushEffect(out, ctx, {
        effectType: 'fs_read',
        target: literalArg(node.arguments[0]) ?? 'dynamic',
        line,
      });
    }
  }
}

function pushEffect(out, ctx, effect) {
  if (out.effects.length >= MAX_EFFECTS) return;
  if (ctx?.tx != null) {
    effect.txLine = ctx.tx;
    effect.txIsolation = ctx.isolation;
  }
  if (ctx?.tryId != null) effect.tryId = ctx.tryId;
  if (ctx?.catchOf != null) effect.catchOf = ctx.catchOf;
  out.effects.push(effect);
}

// prisma.order.update({ where: { status: 'PENDING' }, data: { status: 'PAID' } })
// → string-literal pairs of the named option, lowercased, bounded like SQL
function prismaLiteralsOf(arg, optionName) {
  if (arg?.type !== 'ObjectExpression') return null;
  for (const prop of arg.properties) {
    if (
      prop.type !== 'ObjectProperty' ||
      prop.key.type !== 'Identifier' ||
      prop.key.name !== optionName ||
      prop.value.type !== 'ObjectExpression'
    )
      continue;
    const pairs = {};
    for (const field of prop.value.properties) {
      if (Object.keys(pairs).length >= 8) break;
      if (
        field.type === 'ObjectProperty' &&
        field.key.type === 'Identifier' &&
        field.value.type === 'StringLiteral'
      )
        pairs[field.key.name.toLowerCase()] = field.value.value.toLowerCase();
    }
    return Object.keys(pairs).length ? pairs : null;
  }
  return null;
}

// fetch(url, { method: 'POST' }) — literal method option or nothing (SBIR §2.4)
function optionsMethodOf(callNode) {
  for (const arg of callNode.arguments) {
    if (arg.type !== 'ObjectExpression') continue;
    for (const prop of arg.properties) {
      if (
        prop.type === 'ObjectProperty' &&
        ((prop.key.type === 'Identifier' && prop.key.name === 'method') ||
          (prop.key.type === 'StringLiteral' && prop.key.value === 'method')) &&
        prop.value.type === 'StringLiteral'
      )
        return prop.value.value.toUpperCase();
    }
  }
  return null;
}

// res.json(x), res.status(201).json(x), Response.json(x), NextResponse.json(x),
// res.send(objectLiteral) — returns the extracted shape (object → keys+types,
// non-object → null meaning "responds, shape unknown"), or undefined if the
// call is not a response at all.
function responseJsonShape(node) {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier')
    return undefined;
  const m = callee.property.name;
  if (m !== 'json' && m !== 'send') return undefined;

  const obj = callee.object;
  const isResponseClass =
    obj.type === 'Identifier' && /^(Response|NextResponse)$/.test(obj.name);
  const isResLike =
    (obj.type === 'Identifier' && /^(res|response|reply)$/i.test(obj.name)) ||
    (obj.type === 'CallExpression' && // res.status(n).json(x)
      obj.callee?.type === 'MemberExpression' &&
      obj.callee.property?.name === 'status');
  if (!isResponseClass && !isResLike) return undefined;
  if (m === 'send' && node.arguments[0]?.type !== 'ObjectExpression') return null;
  return objectShapeOf(node.arguments[0]);
}

// res.status(401|403) anywhere in the chain → guard denial signal
function deniedStatusOf(node) {
  const isDeny = (v) => v === 401 || v === 403;
  // res.sendStatus(401) / res.status(401)... — a direct deny status
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.property?.name === 'sendStatus' &&
    node.arguments[0]?.type === 'NumericLiteral' &&
    isDeny(node.arguments[0].value)
  )
    return true;
  let cur = node;
  while (cur) {
    if (
      cur.type === 'CallExpression' &&
      cur.callee?.type === 'MemberExpression' &&
      cur.callee.property?.name === 'status' &&
      cur.arguments[0]?.type === 'NumericLiteral' &&
      isDeny(cur.arguments[0].value)
    )
      return true;
    cur =
      cur.callee?.type === 'MemberExpression' &&
      cur.callee.object?.type === 'CallExpression'
        ? cur.callee.object
        : null;
  }
  return false;
}

// A visible middleware that is a pure unconditional pass-through — `(req,res,next) =>
// next()` or `function(req,res,next){ next() }` — cannot deny anything: it is a NO-OP
// guard (a disabled/stubbed auth). Narrow by design: any conditional, throw, deny, or
// other work means it is NOT a no-op (a real guard, or a delegating one, stays a guard).
export function isNoOpGuard(fnNode) {
  if (!fnNode) return false;
  const body = fnNode.body;
  // arrow with expression body: `(...)=> next()`
  if (body && body.type !== 'BlockStatement') return isBareNextCall(body);
  const stmts = (body?.body ?? []).filter((s) => s.type !== 'EmptyStatement');
  if (stmts.length !== 1) return false;
  const s = stmts[0];
  const expr =
    s.type === 'ExpressionStatement'
      ? s.expression
      : s.type === 'ReturnStatement'
        ? s.argument
        : null;
  return isBareNextCall(expr);
}
function isBareNextCall(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'next' &&
    node.arguments.length === 0
  );
}

// { a: 1, b: x, c: 'y' } → { a: 'number', b: 'unknown:x', c: 'string' }
// Identifiers keep their name behind 'unknown:' so TypePropagation can later
// resolve them against input params and state columns.
export function objectShapeOf(node) {
  if (!node) return null;
  if (node.type !== 'ObjectExpression') return null;
  const shape = {};
  for (const prop of node.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    const key =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'StringLiteral'
          ? prop.key.value
          : null;
    if (!key) continue;
    shape[key] = valueTypeOf(prop.value);
  }
  return shape;
}

function valueTypeOf(v) {
  switch (v.type) {
    case 'StringLiteral':
    case 'TemplateLiteral':
      return 'string';
    case 'NumericLiteral':
      return 'number';
    case 'BooleanLiteral':
      return 'boolean';
    case 'NullLiteral':
      return 'null';
    case 'ArrayExpression':
      return 'array';
    case 'ObjectExpression':
      return 'object';
    case 'Identifier':
      return `unknown:${v.name}`;
    case 'MemberExpression':
      return v.property?.type === 'Identifier' ? `unknown:${v.property.name}` : 'unknown';
    default:
      return 'unknown';
  }
}

function literalArg(arg) {
  if (!arg) return null;
  if (arg.type === 'StringLiteral') return arg.value;
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0)
    return arg.quasis[0]?.value.cooked ?? null;
  if (arg.type === 'TemplateLiteral')
    return arg.quasis.map((q) => q.value.cooked).join('*');
  return null;
}

function rootIdentifier(memberExpr) {
  let cur = memberExpr;
  while (cur.type === 'MemberExpression') {
    // `this.foo.bar()` — the effective root is the class field `foo`, so
    // class-based access (NestJS services, controller classes) is read like a
    // bare `foo.bar()`. Without this, everything rooted at `this` is invisible.
    if (cur.object.type === 'ThisExpression')
      return cur.property.type === 'Identifier' ? cur.property.name : null;
    cur = cur.object;
  }
  return cur.type === 'Identifier' ? cur.name : null;
}

// the name a member/identifier refers to, unwrapping `this.<field>` → `<field>`.
function clientBaseName(node) {
  if (node.type === 'Identifier') return node.name;
  if (
    node.type === 'MemberExpression' &&
    node.object.type === 'ThisExpression' &&
    node.property.type === 'Identifier'
  )
    return node.property.name;
  return null;
}

// knex('users') → users ; supabase.from('users') → users ;
// supabase.from('users').select() chains: walk member/call chain to a
// .from('t') or a base call with a string literal argument.
// → { table, symbolic } or null. A request-derived arg (`knex(req.params.table)`,
// `.from(collection)` where `const collection = req.params.collection`) resolves to a
// SYMBOLIC table (`:table`) — a precise rule, not an unknown — so generic CRUD
// endpoints stop reading as blind.
function builderTableOf(node, reqDerived) {
  let cur = node;
  const lit = (t) => ({ table: t, symbolic: false });
  for (let hops = 0; hops < 8 && cur; hops++) {
    if (cur.type === 'CallExpression') {
      const c = cur.callee;
      const arg0 = cur.arguments[0];
      const isFrom =
        c.type === 'MemberExpression' &&
        c.property.type === 'Identifier' &&
        c.property.name === 'from';
      const isBaseCall = c.type === 'Identifier'; // knex('users')
      const isThisCall =
        c.type === 'MemberExpression' && c.object.type === 'ThisExpression';
      if (isFrom || isBaseCall || isThisCall) {
        if (arg0?.type === 'StringLiteral') return lit(arg0.value);
        const sym = reqParamName(arg0, reqDerived);
        if (sym) return { table: sym, symbolic: true };
      }
      cur = c.type === 'MemberExpression' ? c.object : null;
    } else if (cur.type === 'MemberExpression') {
      cur = cur.object;
    } else return null;
  }
  return null;
}

// 'INSERT INTO users (a) VALUES (1)' → { effectType, op, table, … }
// Literal column values are also harvested (SET x = 'v', WHERE x = 'v',
// INSERT (…) VALUES (…)) — the raw material StateMachineInference reads.
// Everything is lowercased: deterministic, and SQL identifiers are
// case-insensitive anyway (literal VALUES lose case — documented trade-off).
export function parseSqlCall(sql) {
  const s = sql.trim().toLowerCase();
  const verb = s.split(/\s+/)[0];
  const known = SQL_VERBS[verb];
  if (!known) return null;
  let table = null;
  let m;
  if (verb === 'insert') m = s.match(/insert\s+into\s+"?([\w.]+)"?/);
  else if (verb === 'update') m = s.match(/update\s+"?([\w.]+)"?/);
  else if (verb === 'delete') m = s.match(/delete\s+from\s+"?([\w.]+)"?/);
  else m = s.match(/\bfrom\s+"?([\w.]+)"?/);
  if (m) table = m[1].includes('.') ? m[1].split('.').pop() : m[1];

  const details = {};
  if (verb === 'update') {
    const setM = s.match(/\bset\s+([\s\S]*?)(?:\s+where\s|$)/);
    if (setM) {
      const sets = literalPairsOf(setM[1]);
      if (Object.keys(sets).length) details.sets = sets;
    }
  }
  if (verb === 'update' || verb === 'delete' || verb === 'select') {
    const whereM = s.match(/\bwhere\s+([\s\S]*)$/);
    if (whereM) {
      const where = literalPairsOf(whereM[1]);
      if (Object.keys(where).length) details.where = where;
    }
  }
  if (verb === 'insert') {
    const im = s.match(/\(([^)]*)\)\s*values\s*\(([^)]*)\)/);
    if (im) {
      const cols = im[1].split(',').map((c) => c.trim().replace(/"/g, ''));
      const vals = im[2].split(',').map((v) => v.trim());
      const inserts = {};
      cols.forEach((c, i) => {
        const q = vals[i]?.match(/^'([^']*)'$/);
        if (q) inserts[c] = q[1];
      });
      if (Object.keys(inserts).length) details.inserts = inserts;
    }
  }
  return { ...known, table, ...details };
}

// "status = 'paid', total = 3" → { status: 'paid' } — string literals only,
// bounded; placeholders and expressions are invisible on purpose
function literalPairsOf(clause) {
  const pairs = {};
  for (const m of clause.matchAll(/([\w"]+)\s*=\s*'([^']*)'/g)) {
    if (Object.keys(pairs).length >= 8) break;
    pairs[m[1].replace(/"/g, '')] = m[2];
  }
  return pairs;
}

// middleware classifier: name smell OR observed 401/403 denial → guard
export function isGuardLike(name, scan) {
  return GUARD_NAME.test(name ?? '') || Boolean(scan?.guardSignals.deniesWithStatus);
}
