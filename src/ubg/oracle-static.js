// ubg/oracle-static.js — the BOOT-FREE oracle, for frameworks whose routing table is
// not written in code but in the shape of the project.
//
// `premise.js` verifies the premise ("these are the app's entrypoints") against an
// oracle that is not the analyser. Its first oracle was the running app, which is the
// strongest one there is — and unavailable for four of the seven lowerings: Next,
// Medusa, Strapi and Nest cannot be booted from a static checkout without their whole
// toolchain. Those four reported `available:false`, i.e. their premise was never
// checked at all.
//
// For three of them the framework's route table is a FUNCTION OF THE FILESYSTEM. That
// is not a heuristic, it is the framework's contract: Next serves `app/x/route.ts` at
// `/x`, Medusa serves `src/api/x/route.ts` at `/x`. So the directory tree is a genuine
// second source of truth — no boot, no dependencies, no execution of the target's code.
// Nest is different (routing is in decorators), so its oracle re-derives the table from
// decorators with its own walk over EVERY file, which is what makes it independent: the
// extractor's own candidate pre-filter cannot hide a controller from it.
//
// THE INDEPENDENCE RULE. This file may not import an extractor. It shares `@babel/parser`
// with them and nothing else. The moment it reuses `nextjs.js`'s walk, it stops being an
// oracle and becomes a mirror: a bug in the extractor would be reproduced faithfully on
// both sides of the diff, and the comparison would confirm the bug instead of finding it.
//
// CONSERVATISM IS THE CONTRACT. A false gap costs a healthy app its verdict, so every
// rule here answers "would the framework definitely serve this?" — never "probably".
// Shapes with any ambiguity (Strapi's core routers and their pluralisation, Next's
// parallel slots, a non-literal decorator path) are LEFT OUT of the oracle rather than
// guessed at. They are already carried by the blind-spot ledger; the oracle's job is
// only to find surface nobody carried at all.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

// Frameworks with a boot-free oracle. Membership is a claim that the enumeration below
// reproduces the framework's own routing rules — verify against a real app before adding.
export const CONVENTION_ROUTED = new Set(['nextjs', 'medusa', 'strapi', 'nestjs']);

const VERB_EXPORTS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.next', '.git', '.sparda']);

function walk(root, out = []) {
  let items;
  try {
    items = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIR.has(it.name)) continue;
    const abs = path.join(root, it.name);
    if (it.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const rel = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/');

function ast(abs) {
  try {
    return parse(fs.readFileSync(abs, 'utf8'), {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });
  } catch {
    return null; // unreadable to the oracle too — it claims nothing about this file
  }
}

// The HTTP verbs a module exports, however they are spelled. Deliberately shallow: the
// oracle asks "does this name leave the module?", never "what does it do?".
function verbExports(tree) {
  const names = new Set();
  for (const node of tree.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    const d = node.declaration;
    if (d?.type === 'FunctionDeclaration' && d.id?.name) names.add(d.id.name);
    if (d?.type === 'VariableDeclaration')
      for (const v of d.declarations)
        if (v.id?.type === 'Identifier') names.add(v.id.name);
    for (const s of node.specifiers ?? [])
      if (s.exported?.name) names.add(s.exported.name);
  }
  return [...names].filter((n) => VERB_EXPORTS.has(n)).sort();
}

const joinUrl = (segments) => '/' + segments.filter(Boolean).join('/');

/**
 * The route table the framework's own conventions imply, derived without running
 * anything.
 *
 * @returns {{available:boolean, routes:Array<{method,path,file,source:'convention'}>, reason?:string}}
 */
export function staticOracle(cwd, { framework, entryFile }) {
  const readers = {
    nextjs: nextOracle,
    medusa: medusaOracle,
    strapi: strapiOracle,
    nestjs: nestOracle,
  };
  const read = readers[framework];
  if (!read)
    return {
      available: false,
      routes: [],
      reason: `no boot-free oracle for ${framework}`,
    };
  return read(cwd, entryFile);
}

// --- Next.js: app-router file conventions ------------------------------------
// `app/<segments>/route.ts` serves `/<segments>`. `(group)` is stripped from the URL,
// `[id]` is a parameter. Parallel slots (`@slot`), intercepting routes (`(..)x`) and
// private folders (`_x`) are NOT plain URL routes and are left to the ledger.
function nextOracle(cwd, entryFile) {
  const appDir = path.resolve(cwd, entryFile || 'app');
  const pagesRoutes = pagesApiRoutes(cwd);
  if (!fs.existsSync(appDir))
    return pagesRoutes.length
      ? { available: true, routes: pagesRoutes }
      : { available: false, routes: [], reason: 'no app directory to enumerate' };
  const routes = [...pagesRoutes];
  const visit = (dir, segments) => {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, it.name);
      if (it.isDirectory()) {
        const n = it.name;
        // Under `app/`, a directory name is a URL segment and nothing else — `dist` and
        // `build` are ordinary segments here, not build output, so the oracle refuses to
        // filter on them. Only what could never be routed at all is skipped.
        if (n === 'node_modules' || n.startsWith('.')) continue;
        if (n.startsWith('_') || n.startsWith('@')) continue;
        if (/^\(\.{1,3}\)/.test(n)) continue; // intercepting — UI-layer, not a URL
        if (/^\[\[?\.\.\..+\]\]?$/.test(n)) continue; // catch-all — arity the oracle will not guess
        if (/^\(.+\)$/.test(n))
          visit(abs, segments); // route group — no URL segment
        else {
          const p = n.match(/^\[(.+)\]$/);
          visit(abs, [...segments, p ? `:${p[1]}` : n]);
        }
      } else if (/^route\.(js|ts|mjs|jsx|tsx)$/.test(it.name)) {
        const tree = ast(abs);
        if (!tree) continue;
        for (const verb of verbExports(tree))
          routes.push({
            method: verb,
            path: joinUrl(segments),
            file: rel(cwd, abs),
            source: 'convention',
          });
      }
    }
  };
  visit(appDir, []);
  return { available: true, routes };
}

// The Pages Router — `pages/api/**` — is still fully supported by Next and still serves
// live API endpoints, and SPARDA has no lowering for it: an app that mixes the two
// routers gets a graph covering half of itself, with nothing anywhere saying so. This is
// the oracle's whole reason for existing: not a bug inside the analysis, but a piece of
// the app the analysis never claimed.
//
// A Pages API route is a DEFAULT export that receives every method and switches on
// `req.method` internally, so the verb is not knowable from the file. The oracle claims
// the one thing that is certainly true — the URL is served, and GET reaches it — rather
// than inventing five routes per file.
function pagesApiRoutes(cwd) {
  const routes = [];
  for (const base of ['pages/api', 'src/pages/api']) {
    const root = path.resolve(cwd, base);
    if (!fs.existsSync(root)) continue;
    for (const abs of walk(root)) {
      if (!/\.(js|jsx|ts|tsx)$/.test(abs)) continue;
      const parts = path
        .relative(root, abs)
        .split(path.sep)
        .map((s) => s.replace(/\.(js|jsx|ts|tsx)$/, ''));
      const last = parts[parts.length - 1];
      if (last === 'index') parts.pop(); // pages/api/users/index.ts → /api/users
      const segments = parts.map((s) => {
        const p = s.match(/^\[\[?\.{0,3}(.+?)\]?\]$/);
        return p ? `:${p[1]}` : s;
      });
      routes.push({
        method: 'GET',
        path: joinUrl(['api', ...segments]),
        file: rel(cwd, abs),
        source: 'convention',
      });
    }
  }
  return routes;
}

// --- Medusa: the same idea, one directory root down --------------------------
function medusaOracle(cwd, entryFile) {
  const apiRoot = path.resolve(cwd, entryFile || 'src/api');
  if (!fs.existsSync(apiRoot))
    return { available: false, routes: [], reason: 'no api directory to enumerate' };
  const routes = [];
  for (const abs of walk(apiRoot)) {
    if (!/[\\/]route\.(js|ts)$/.test(abs)) continue;
    const tree = ast(abs);
    if (!tree) continue;
    const segments = path
      .relative(apiRoot, path.dirname(abs))
      .split(path.sep)
      .filter(Boolean)
      .map((s) => {
        const p = s.match(/^\[(.+)\]$/);
        return p ? `:${p[1]}` : s;
      });
    for (const verb of verbExports(tree))
      routes.push({
        method: verb,
        path: joinUrl(segments),
        file: rel(cwd, abs),
        source: 'convention',
      });
  }
  return { available: true, routes };
}

// --- Strapi: the literal route tables only -----------------------------------
// `createCoreRouter('api::article.article')` implies five routes at a PLURALISED path.
// Reproducing Strapi's pluraliser here would be a guess, and a wrong guess invents
// premise gaps on a healthy app — so core routers are deliberately out of the oracle.
// What is left is exact: a `{ method, path }` pair written in the source. The class this
// catches is a route table the extractor's directory walk never opened.
function strapiOracle(cwd, entryFile) {
  const apiRoot = path.resolve(cwd, entryFile || 'src/api');
  if (!fs.existsSync(apiRoot))
    return { available: false, routes: [], reason: 'no api directory to enumerate' };
  const routes = [];
  for (const abs of walk(apiRoot)) {
    if (!/[\\/]routes[\\/][^\\/]+\.(js|ts)$/.test(abs)) continue;
    const tree = ast(abs);
    if (!tree) continue;
    for (const obj of objectLiterals(tree)) {
      const props = literalProps(obj);
      if (typeof props.method !== 'string' || typeof props.path !== 'string') continue;
      routes.push({
        method: props.method.toUpperCase(),
        path: props.path,
        file: rel(cwd, abs),
        source: 'convention',
      });
    }
  }
  return { available: true, routes };
}

// --- NestJS: the decorators, read by a walk that skips nothing ----------------
// Nest's table is in code, so this oracle re-derives it — but over EVERY file in the
// tree. The extractor selects candidate files with a regex pre-filter; a controller that
// filter misses produces no route, no skip and no unknown handler. Only a walk that
// refuses to pre-filter can see that.
const NEST_VERB = /^(?:Http)?(Get|Post|Put|Patch|Delete|Options|Head|All)(?:Mapping)?$/;
const NEST_ALL = ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'];

function nestOracle(cwd, entryFile) {
  const root = path.resolve(cwd, entryFile || 'src');
  if (!fs.existsSync(root))
    return { available: false, routes: [], reason: 'no source directory to enumerate' };
  const routes = [];
  for (const abs of walk(root)) {
    if (!/\.(ts|js)$/.test(abs)) continue;
    if (/\.(spec|test|e2e-spec)\.(ts|js)$/.test(abs) || abs.endsWith('.d.ts')) continue;
    const tree = ast(abs);
    if (!tree) continue;
    for (const cls of classes(tree)) {
      const ctrl = decoratorCall(cls, (n) => /(^|[a-z])Controller$/.test(n));
      if (!ctrl) continue; // resolvers are GraphQL, not a URL table — out of the oracle
      const prefix = literalArg(ctrl);
      if (prefix === undefined) continue; // a computed prefix moves every route below it
      for (const m of cls.body?.body ?? []) {
        if (m.type !== 'ClassMethod') continue;
        const verb = decoratorCall(m, (n) => NEST_VERB.test(n));
        if (!verb) continue;
        const sub = literalArg(verb);
        if (sub === undefined) continue; // declared by the extractor as an unknown handler
        const name = NEST_VERB.exec(verb.name)[1].toUpperCase();
        const url = joinUrl([...split(prefix), ...split(sub)]);
        for (const method of name === 'ALL' ? NEST_ALL : [name])
          routes.push({ method, path: url, file: rel(cwd, abs), source: 'convention' });
      }
    }
  }
  return { available: true, routes };
}

const split = (s) =>
  String(s ?? '')
    .split('/')
    .filter(Boolean);

// --- tiny shared AST readers --------------------------------------------------

function* classes(tree) {
  const stack = [tree.program];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') yield node;
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
}

// The decorator call on `node` whose callee name matches, e.g. `@Controller('users')`.
function decoratorCall(node, matches) {
  for (const d of node.decorators ?? []) {
    const ex = d.expression;
    const callee = ex?.type === 'CallExpression' ? ex.callee : ex;
    const name =
      callee?.type === 'Identifier'
        ? callee.name
        : callee?.type === 'MemberExpression'
          ? callee.property?.name
          : null;
    if (name && matches(name))
      return { name, args: ex?.type === 'CallExpression' ? ex.arguments : [] };
  }
  return null;
}

// '' for a decorator called with no argument (`@Get()` = the controller's own path);
// undefined when the argument exists but is not a string literal — the oracle then
// declines to place the route rather than placing it wrongly.
function literalArg(call) {
  if (!call.args.length) return '';
  const a = call.args[0];
  if (a.type === 'StringLiteral') return a.value;
  if (a.type === 'TemplateLiteral' && a.expressions.length === 0)
    return a.quasis.map((q) => q.value.cooked).join('');
  return undefined;
}

function* objectLiterals(tree) {
  const stack = [tree.program];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (node.type === 'ObjectExpression') yield node;
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
}

function literalProps(obj) {
  const out = {};
  for (const p of obj.properties ?? []) {
    if (p.type !== 'ObjectProperty') continue;
    const key = p.key?.name ?? p.key?.value;
    if (key && p.value?.type === 'StringLiteral') out[key] = p.value.value;
  }
  return out;
}
