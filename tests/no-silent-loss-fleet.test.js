// no-silent-loss-fleet.test.js — THE SEALING CERTIFICATE, extended to the whole fleet.
//
// `no-silent-loss.test.js` proves the registration invariant (ADR-079) on Express:
//
//   A registration is either MODELLED or DECLARED. No silent third option.
//
// That invariant is not about Express. It is about SPARDA. A route the framework will
// serve and SPARDA never mentions is a false PROVEN whatever the framework — and until
// this file existed, six of the seven lowerings had no machine-checkable seal at all.
//
// Same method as the Express certificate, six more times: an INDEPENDENT second
// implementation enumerates the declared surface (its own file walk, its own AST or
// spec read, deliberately NOT the extractor's), then demands the extractor account for
// every item — as a modelled route, a modelled middleware, or a declared UnknownHandler.
// When the two implementations disagree, something was lost, and the diff names it.
//
// The independence matters more here than on Express: the non-Express lowerings decide
// WHICH FILES TO PARSE with their own filters (a candidate regex, a filename convention,
// a directory layout). A file the extractor never opens produces no skipped entry and no
// unknown handler — it produces nothing at all, which is exactly the shape of failure a
// self-reported coverage number cannot see. This sweep opens every file itself.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { detectStack } from '../src/detect.js';
import { extractNest } from '../src/ubg/nestjs.js';
import { extractNext } from '../src/ubg/nextjs.js';
import { extractMedusa } from '../src/ubg/medusa.js';
import { extractStrapi } from '../src/ubg/strapi.js';
import { extractOpenAPI } from '../src/ubg/openapi.js';
import { extractFastAPI } from '../src/ubg/fastapi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');

// --- generic scaffolding ----------------------------------------------------

function walkFiles(root, accept, out = []) {
  let items;
  try {
    items = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (it.name === 'node_modules' || it.name.startsWith('.')) continue;
    const abs = path.join(root, it.name);
    if (it.isDirectory()) walkFiles(abs, accept, out);
    else if (accept(it.name)) out.push(abs);
  }
  return out;
}

const relOf = (dir, abs) => path.relative(dir, abs).split(path.sep).join('/');

function parseFile(abs) {
  try {
    return parse(fs.readFileSync(abs, 'utf8'), {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties'],
    });
  } catch {
    return null; // unparseable — the extractor declares that through its own channel
  }
}

function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => walkAst(n, visit));
  if (typeof node.type === 'string') visit(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc') continue;
    const v = node[k];
    if (v && typeof v === 'object') walkAst(v, visit);
  }
}

const calleeName = (n) =>
  n?.type === 'Identifier'
    ? n.name
    : n?.type === 'MemberExpression'
      ? (n.property?.name ?? null)
      : null;

// Everything the extractor is allowed to have accounted for: a route it modelled, a
// middleware it modelled, or a hole it declared. Declarations are indexed loosely (by
// key AND by file) because a lowering that loses a whole FILE can only name the file.
function accountKeys(out, keyOfRoute) {
  const keys = new Set();
  for (const r of out.routes) for (const k of keyOfRoute(r)) keys.add(k);
  for (const m of out.globalMiddlewares ?? []) if (m.sourceFile) keys.add(m.sourceFile);
  for (const u of out.unknownHandlers ?? []) {
    keys.add(u.file);
    if (u.target) keys.add(`${u.file}::${u.target}`);
  }
  return keys;
}

// A sweep is: fixtures of one framework × (independent surface − what the extractor
// accounted for) must be empty.
function certify({
  framework,
  minFixtures,
  minSurface,
  fixtures,
  extract,
  surfaceOf,
  accountOf,
}) {
  describe(`SEALING CERTIFICATE — ${framework}`, () => {
    it('the sweep actually covers the corpus', () => {
      // Two guards on the guard, because a certificate that sweeps nothing passes
      // vacuously — the precise failure mode it exists to prevent. Fixture count alone
      // is not enough: an enumerator that silently stopped matching would still see the
      // fixtures and find zero surface in them, so the surface total is pinned too.
      // It is a corpus total, not a per-fixture floor, because some fixtures legitimately
      // declare their surface some other way (Flask class-based views, server actions).
      expect(fixtures.length).toBeGreaterThanOrEqual(minFixtures);
      const total = fixtures.reduce((n, fx) => n + surfaceOf(fx).length, 0);
      expect({ [framework]: total >= minSurface, total }).toEqual({
        [framework]: true,
        total,
      });
    });

    for (const fx of fixtures) {
      it(`${fx.name}: every declared surface is modelled or declared`, () => {
        const surface = surfaceOf(fx);
        const accounted = accountOf(extract(fx));
        const lost = surface.filter((s) => !s.keys.some((k) => accounted.has(k)));
        expect(lost.map((l) => l.label)).toEqual([]);
      });
    }
  });
}

// Fixtures whose detected framework matches, entry included.
function detected(framework) {
  const out = [];
  for (const name of fs.readdirSync(FIXTURES).sort()) {
    const dir = path.join(FIXTURES, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    let stack;
    try {
      stack = detectStack(dir);
    } catch {
      continue;
    }
    if (stack.framework !== framework || !stack.entryFile) continue;
    out.push({ name, dir, entryFile: stack.entryFile, pythonCmd: stack.pythonCmd });
  }
  return out;
}

// --- NestJS: decorator-declared surface -------------------------------------
// The independent walk opens EVERY .ts/.js under the source root, so a controller the
// extractor's candidate pre-filter never selected shows up here as a lost route.

const NEST_VERB = /^(?:http)?(get|post|put|patch|delete|options|head|all)(?:mapping)?$/i;
// GraphQL operations are routes in the UBG too (`POST /graphql/<field>`), so the sweep
// covers resolvers as well as HTTP controllers.
const NEST_GQL = /^(query|mutation|subscription)$/i;
// `@Controller` and its lookalikes: a house framework's `@RestController` registers
// exactly the same way, and the extractor models it — so the certificate must see it.
const CLASS_DECORATOR = /(^|[a-z])Controller$|^Resolver$/;
const decoratorNames = (node) =>
  (node.decorators ?? [])
    .map((d) =>
      calleeName(
        d.expression?.type === 'CallExpression' ? d.expression.callee : d.expression,
      ),
    )
    .filter(Boolean);
const isRegistrar = (cls) => decoratorNames(cls).some((n) => CLASS_DECORATOR.test(n));

function nestSurface({ dir, entryFile }) {
  const root = path.resolve(dir, entryFile);
  const surface = [];
  for (const abs of walkFiles(
    root,
    (n) =>
      /\.(ts|js)$/.test(n) &&
      !/\.(spec|test|e2e-spec)\.(ts|js)$/.test(n) &&
      !n.endsWith('.d.ts'),
  )) {
    const ast = parseFile(abs);
    if (!ast) continue;
    const rel = relOf(dir, abs);
    walkAst(ast, (node) => {
      if (node.type !== 'ClassDeclaration' && node.type !== 'ClassExpression') return;
      if (!isRegistrar(node)) return; // a verb decorator off a registrar is not a route
      for (const m of node.body?.body ?? []) {
        if (m.type !== 'ClassMethod' || !m.key?.name) continue;
        for (const name of decoratorNames(m)) {
          if (!NEST_VERB.test(name) && !NEST_GQL.test(name)) continue;
          surface.push({
            keys: [`${rel}::${m.key.name}`, rel],
            label: `@${name}() on ${node.id?.name ?? '?'}.${m.key.name} (${rel})`,
          });
        }
      }
    });
  }
  return surface;
}

const nestAccount = (out) =>
  accountKeys(out, (r) =>
    (r.chain ?? [])
      .filter((c) => c.role === 'handler')
      .map((c) => `${r.sourceFile}::${c.name}`),
  );

// --- Next.js / Medusa: file-routed verb exports ------------------------------
// Both lower a `route.{js,ts}` file whose EXPORTED verb names are the registrations.
// The independent walk is a filesystem enumeration plus an export read — the extractor
// resolves handlers, this one only asks "does this name leave the module?".

const HTTP_EXPORT = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

function exportedVerbs(abs) {
  const ast = parseFile(abs);
  if (!ast) return null; // unparseable: the extractor must declare it, checked by file key
  const names = new Set();
  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    const decl = node.declaration;
    if (decl?.type === 'FunctionDeclaration' && decl.id?.name) names.add(decl.id.name);
    if (decl?.type === 'VariableDeclaration')
      for (const d of decl.declarations)
        if (d.id?.type === 'Identifier') names.add(d.id.name);
    for (const s of node.specifiers ?? [])
      if (s.exported?.name) names.add(s.exported.name);
  }
  return [...names].filter((n) => HTTP_EXPORT.has(n));
}

function fileRoutedSurface(dir, root, fileRe) {
  const surface = [];
  for (const abs of walkFiles(root, (n) => fileRe.test(n))) {
    const rel = relOf(dir, abs);
    const verbs = exportedVerbs(abs);
    if (verbs === null) {
      surface.push({ keys: [rel], label: `unparseable route module ${rel}` });
      continue;
    }
    for (const v of verbs)
      surface.push({ keys: [`${rel}::${v}`, rel], label: `export ${v} in ${rel}` });
  }
  return surface;
}

const fileRoutedAccount = (out) =>
  accountKeys(out, (r) => [`${r.sourceFile}::${r.method.toUpperCase()}`]);

// --- Strapi: the route table --------------------------------------------------
// Two shapes, both independently readable: `createCoreRouter(...)` (the file contributes
// the CRUD five) and a literal `routes: [{ method, path, handler }]` array.

function strapiSurface({ dir, entryFile }) {
  const root = path.resolve(dir, entryFile);
  const surface = [];
  for (const abs of walkFiles(root, (n) => /\.(js|ts)$/.test(n)).filter((p) =>
    /[\\/]routes[\\/]/.test(p),
  )) {
    const ast = parseFile(abs);
    const rel = relOf(dir, abs);
    if (!ast) {
      surface.push({ keys: [rel], label: `unparseable route table ${rel}` });
      continue;
    }
    let core = false;
    walkAst(ast, (node) => {
      if (
        node.type === 'CallExpression' &&
        calleeName(node.callee) === 'createCoreRouter'
      )
        core = true;
      if (node.type !== 'ObjectExpression') return;
      const props = Object.fromEntries(
        node.properties
          .filter((p) => p.type === 'ObjectProperty' && p.key?.name)
          .map((p) => [p.key.name, p.value]),
      );
      if (!props.method || !props.path) return;
      if (props.method.type !== 'StringLiteral' || props.path.type !== 'StringLiteral')
        return; // a computed entry is its own problem, not this certificate's
      surface.push({
        keys: [`${rel}::${props.method.value.toUpperCase()} ${props.path.value}`, rel],
        label: `${props.method.value} ${props.path.value} in ${rel}`,
      });
    });
    if (core) surface.push({ keys: [rel], label: `createCoreRouter in ${rel}` });
  }
  return surface;
}

const strapiAccount = (out) =>
  accountKeys(out, (r) => [
    r.sourceFile,
    `${r.sourceFile}::${r.method.toUpperCase()} ${r.path}`,
  ]);

// --- OpenAPI: the spec IS the declaration -------------------------------------
// JSON.parse is a genuinely independent read of the same bytes the lowering consumes;
// every path-item member that is not documentation is an operation somebody published.

const NON_OPERATION = new Set([
  'summary',
  'description',
  'servers',
  'parameters',
  '$ref',
]);

function openapiFixtures() {
  const out = [];
  for (const name of fs.readdirSync(FIXTURES).sort()) {
    const dir = path.join(FIXTURES, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const spec of ['openapi.json', 'openapi.yaml', 'openapi.yml'])
      if (fs.existsSync(path.join(dir, spec))) out.push({ name, dir, entryFile: spec });
  }
  return out;
}

function openapiSurface({ dir, entryFile }) {
  if (!entryFile.endsWith('.json')) return []; // YAML needs its own reader; none in corpus
  const spec = JSON.parse(fs.readFileSync(path.join(dir, entryFile), 'utf8'));
  const surface = [];
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (typeof item !== 'object' || item === null) continue;
    for (const key of Object.keys(item)) {
      if (NON_OPERATION.has(key) || key.startsWith('x-')) continue;
      surface.push({
        keys: [`${p}::${key}`, entryFile, `${entryFile}::${p}`],
        label: `${key.toUpperCase()} ${p} in ${entryFile}`,
      });
    }
  }
  return surface;
}

const openapiAccount = (out) => accountKeys(out, (r) => [`${r.path}::${r.method}`]);

// --- Python (FastAPI / Flask): decorated registrations -------------------------
// A regex over the source text is a deliberately DIFFERENT implementation from the
// stdlib-ast walk the extractor shells out to: if the Python side stops parsing a file,
// or a decorator shape falls through its match, the text still shows the decorator.

const PY_DECORATOR =
  /^\s*@\s*([A-Za-z_][\w.]*)\s*\.\s*(get|post|put|patch|delete|options|head|trace|route|websocket)\s*\(/;

const PY_DEF = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;

function pythonSurface({ dir }) {
  const surface = [];
  for (const abs of walkFiles(dir, (n) => n.endsWith('.py'))) {
    const rel = relOf(dir, abs);
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((text, i) => {
      const m = PY_DECORATOR.exec(text);
      if (!m) return;
      // websockets are out of the HTTP graph by design and declared as such upstream
      if (m[2] === 'websocket') return;
      // The registration's identity is the function it decorates, not the decorator's
      // own line: decorators stack, and the extractor anchors a route at the `def`.
      let fn = null;
      for (let j = i + 1; j < lines.length && j < i + 12; j++) {
        const d = PY_DEF.exec(lines[j]);
        if (d) {
          fn = d[1];
          break;
        }
      }
      if (!fn) return; // a decorator on something that is not a function is not a route
      surface.push({
        keys: [`${rel}::${fn}`, rel],
        label: `@${m[1]}.${m[2]}() on ${fn}() at ${rel}:${i + 1}`,
      });
    });
  }
  return surface;
}

const pythonAccount = (out) =>
  accountKeys(out, (r) =>
    (r.chain ?? [])
      .filter((c) => c.role === 'handler')
      .map((c) => `${r.sourceFile}::${c.name}`),
  );

// --- the sweeps ----------------------------------------------------------------

certify({
  framework: 'nestjs',
  minSurface: 30,
  minFixtures: 10,
  fixtures: detected('nestjs'),
  extract: (fx) => extractNest(fx.dir, fx.entryFile),
  surfaceOf: nestSurface,
  accountOf: nestAccount,
});

certify({
  framework: 'nextjs',
  minSurface: 6,
  minFixtures: 4,
  fixtures: detected('nextjs'),
  extract: (fx) => extractNext(fx.dir, fx.entryFile),
  surfaceOf: (fx) =>
    fileRoutedSurface(
      fx.dir,
      path.resolve(fx.dir, fx.entryFile),
      /^route\.(js|ts|jsx|tsx)$/,
    ),
  accountOf: fileRoutedAccount,
});

certify({
  framework: 'medusa',
  minSurface: 2,
  minFixtures: 2,
  fixtures: detected('medusa'),
  extract: (fx) => extractMedusa(fx.dir, fx.entryFile),
  surfaceOf: (fx) =>
    fileRoutedSurface(fx.dir, path.resolve(fx.dir, fx.entryFile), /^route\.(js|ts)$/),
  accountOf: fileRoutedAccount,
});

certify({
  framework: 'strapi',
  minSurface: 3,
  minFixtures: 1,
  fixtures: detected('strapi'),
  extract: (fx) => extractStrapi(fx.dir, fx.entryFile),
  surfaceOf: strapiSurface,
  accountOf: strapiAccount,
});

certify({
  framework: 'openapi',
  minSurface: 3,
  minFixtures: 1,
  fixtures: openapiFixtures(),
  extract: (fx) => extractOpenAPI(fx.dir, fx.entryFile),
  surfaceOf: openapiSurface,
  accountOf: openapiAccount,
});

certify({
  framework: 'python (fastapi / flask)',
  minSurface: 10,
  minFixtures: 5,
  fixtures: [...detected('fastapi'), ...detected('flask')],
  extract: (fx) => extractFastAPI(fx.dir, fx.entryFile, fx.pythonCmd),
  surfaceOf: pythonSurface,
  accountOf: pythonAccount,
});

// The other half of the seal, fleet-wide. "Declare everything" satisfies the invariant
// trivially and destroys the product: a blind-spot channel that fires on clean code
// drowns the real holes and makes every verdict PARTIAL. So the canonical clean fixture
// of each lowering must stay silent.
describe('SEALING CERTIFICATE — and no noise where the fleet is understood', () => {
  const clean = [
    ['nestjs', () => extractNest(path.join(FIXTURES, 'ubg-nestjs'), 'src')],
    // NOT `nextjs-basic`: that fixture deliberately carries a catch-all and a parallel
    // slot, whose handlers SPARDA cannot bind and now declares. `ubg-guard-dominance`
    // is the ordinary-shaped app.
    ['nextjs', () => extractNext(path.join(FIXTURES, 'ubg-guard-dominance'), 'app')],
    ['medusa', () => extractMedusa(path.join(FIXTURES, 'ubg-medusa'), 'src/api')],
    ['strapi', () => extractStrapi(path.join(FIXTURES, 'ubg-strapi'), 'src/api')],
    ['openapi', () => extractOpenAPI(path.join(FIXTURES, 'ubg-openapi'), 'openapi.json')],
  ];
  for (const [name, run] of clean) {
    it(`${name}: the clean fixture declares zero unknowns`, () => {
      expect({ [name]: run().unknownHandlers ?? [] }).toEqual({ [name]: [] });
    });
  }
});
