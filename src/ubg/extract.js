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
}

// absFile → { ast, functions: Map<name,{node,line,exported}>, imports: Map<local,abs>, error }
export function parseModule(absFile) {
  if (moduleCache.has(absFile)) return moduleCache.get(absFile);
  const facts = {
    ast: null,
    functions: new Map(),
    imports: new Map(),
    error: null,
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
      plugins: ['typescript', 'jsx', ['decorators', { decoratorsBeforeExport: true }]],
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
        for (const prop of d.id.properties) {
          if (prop.type === 'ObjectProperty' && prop.value.type === 'Identifier')
            facts.imports.set(prop.value.name, resolved);
        }
      }
    }
    return;
  }
  if (node.type === 'ImportDeclaration') {
    const resolved = resolveRelImport(absFile, node.source.value);
    if (!resolved) return;
    for (const spec of node.specifiers) facts.imports.set(spec.local.name, resolved);
  }
}

export function resolveRelImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const cleanSpec = spec.replace(/\.(m?[jt]s|cjs)$/, '');
  const base = path.resolve(path.dirname(fromFile), cleanSpec);
  for (const cand of [
    base,
    `${base}.ts`,
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
  });
  return result;
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

  // ---- supabase/knex builder: X.from('t').insert(...) or knex('t').update(...)
  if (SUPABASE_OPS.has(methodLower)) {
    const table = builderTableOf(callee.object);
    if (table) {
      pushEffect(out, ctx, {
        effectType: methodLower === 'select' ? 'db_read' : 'db_write',
        op: methodLower,
        table: table.toLowerCase(),
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
    if (
      obj.type === 'MemberExpression' &&
      !obj.computed &&
      obj.property.type === 'Identifier' &&
      obj.object.type === 'Identifier' &&
      /prisma|client|db/i.test(obj.object.name)
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
  let cur = node;
  while (cur) {
    if (
      cur.type === 'CallExpression' &&
      cur.callee?.type === 'MemberExpression' &&
      cur.callee.property?.name === 'status' &&
      cur.arguments[0]?.type === 'NumericLiteral' &&
      (cur.arguments[0].value === 401 || cur.arguments[0].value === 403)
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
  while (cur.type === 'MemberExpression') cur = cur.object;
  return cur.type === 'Identifier' ? cur.name : null;
}

// knex('users') → users ; supabase.from('users') → users ;
// supabase.from('users').select() chains: walk member/call chain to a
// .from('t') or a base call with a string literal argument.
function builderTableOf(node) {
  let cur = node;
  for (let hops = 0; hops < 8 && cur; hops++) {
    if (cur.type === 'CallExpression') {
      const c = cur.callee;
      if (
        c.type === 'MemberExpression' &&
        c.property.type === 'Identifier' &&
        c.property.name === 'from' &&
        cur.arguments[0]?.type === 'StringLiteral'
      )
        return cur.arguments[0].value;
      if (c.type === 'Identifier' && cur.arguments[0]?.type === 'StringLiteral')
        return cur.arguments[0].value; // knex('users')
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
