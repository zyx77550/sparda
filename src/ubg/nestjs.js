// ubg/nestjs.js — NestJS (and DI-framework) route extraction. THE wall-breaker.
//
// Nest/Medusa/Inversify apps defeated the old detector: routes aren't `app.get()`
// calls, they're `@Get()` decorators on controller *methods*, and the real effect
// (the DB write) lives in a *service* wired by dependency injection, not in the
// controller. The old parser saw 0 routes → NO PROOF → useless.
//
// The insight that makes this tractable statically: in TypeScript, DI is expressed
// as CONSTRUCTOR PARAMETER TYPES — `constructor(private svc: CatsService)` — which
// are right there in the AST. So we read the decorators for the route table, read
// the constructor for the DI wiring, and follow `this.svc.method()` to the service
// method to scan its real effects. No runtime container, no execution. Same UBG out,
// so everything downstream (apocalypse/polarity/immunize/speculate) just works.
import fs from 'node:fs';
import path from 'node:path';
import traverseModule from '@babel/traverse';
import {
  parseModule,
  scanFunction,
  classInModule,
  baseClassOf,
  methodInClassChain,
} from './extract.js';

const traverse = traverseModule.default ?? traverseModule;
const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete']);
const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.sparda']);

// → { routes, globalMiddlewares, helpers, skipped, scannedFiles } (extractExpress shape)
export function extractNest(cwd, entryDir) {
  bundleCache = new Map(); // memo of resolved service methods — per compile
  const routes = [];
  const helpers = [];
  const skipped = [];
  const scannedFiles = [];
  const root = path.resolve(cwd, entryDir || '.');

  for (const file of walk(root)) {
    // Fast reject: only files that mention `@Controller` can define a route. A big
    // Nest monorepo (twenty) is mostly DTOs/entities/services — skipping their full
    // babel parse here is the difference between ~20s and a few seconds. Services
    // reached through DI are still parsed on demand by resolveMethod.
    let head;
    try {
      head = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!head.includes('@Controller')) continue;
    const mod = parseModule(file);
    const rel = relOf(cwd, file);
    if (mod.error) {
      skipped.push({ reason: `${mod.error} in ${rel}`, file: rel });
      continue;
    }
    let sawController = false;

    traverse(mod.ast, {
      ClassDeclaration(p) {
        const cls = p.node;
        const controller = decoratorArg(cls.decorators, 'Controller');
        if (controller === undefined) return; // not a controller
        sawController = true;
        const prefix = controller.value ?? '';
        const di = diMapWithMod(cls, mod); // prop -> { type, mod that declared it }
        const classGuards = useGuards(cls.decorators);

        for (const m of cls.body.body) {
          if (m.type !== 'ClassMethod' || !m.key || m.key.type !== 'Identifier') continue;
          const http = httpDecorator(m.decorators);
          if (!http) continue;
          const fullPath = joinPath(prefix, http.path);
          const guards = [...classGuards, ...useGuards(m.decorators)];

          // the handler's effects = the controller method body + every service
          // method it delegates to through DI (this.<prop>.<call>())
          const scan = resolveHandlerScan(m, di, mod, cwd, scannedFiles, helpers);

          const chain = [
            ...guards.map((name) => ({
              name,
              sourceFile: rel,
              sourceLine: m.loc?.start.line ?? 0,
              fn: null,
              role: 'middleware',
            })),
            {
              name: m.key.name,
              sourceFile: rel,
              sourceLine: m.loc?.start.line ?? 0,
              fn: null,
              scan, // precomputed merged scan — translate uses it as-is
              role: 'handler',
            },
          ];

          routes.push({
            method: http.method,
            path: fullPath,
            sourceFile: rel,
            sourceLine: m.loc?.start.line ?? 0,
            params: pathParamsOf(fullPath),
            chain,
            description: '',
          });
        }
      },
    });

    if (sawController && !scannedFiles.includes(rel)) scannedFiles.push(rel);
  }

  routes.sort((a, b) => cmp(a.path, b.path) || cmp(a.method, b.method));
  return { routes, globalMiddlewares: [], helpers, skipped, scannedFiles };
}

// --- decorator readers ------------------------------------------------------

// the first string-literal arg of decorator `@Name(...)`, or undefined if the
// decorator is absent. Returns { value } (value may be '' for a bare `@Name()`).
function decoratorArg(decorators, name) {
  for (const d of decorators ?? []) {
    const call = d.expression;
    if (call.type === 'CallExpression' && idName(call.callee) === name) {
      const a0 = call.arguments[0];
      return { value: a0?.type === 'StringLiteral' ? a0.value : '' };
    }
    if (call.type === 'Identifier' && call.name === name) return { value: '' };
  }
  return undefined;
}

function httpDecorator(decorators) {
  for (const d of decorators ?? []) {
    const call = d.expression;
    const name = call.type === 'CallExpression' ? idName(call.callee) : idName(call);
    if (!name) continue;
    const verb = name.toLowerCase();
    if (!HTTP.has(verb)) continue;
    const a0 = call.type === 'CallExpression' ? call.arguments[0] : null;
    return { method: verb, path: a0?.type === 'StringLiteral' ? a0.value : '' };
  }
  return null;
}

// A decorator whose OWN name reads as authorization — the app-specific guard idiom
// (`@Authenticated()`, `@Auth()`, `@RequirePermission()`) that Nest apps use instead of
// `@UseGuards()`. Without this, resolving effects behind DI would flag every guarded
// mutation as UNGUARDED (immich guards with `@Authenticated`, not `@UseGuards`).
const GUARD_DECORATOR =
  /^(auth|authenticated|guard|acl|permission|role|protect|secured|require|jwt|loggedin|signedin)/i;

// guards on a class or method: the classes named in `@UseGuards(A, B)` PLUS any
// decorator that is itself named like an auth/permission gate.
function useGuards(decorators) {
  const out = [];
  for (const d of decorators ?? []) {
    const call = d.expression;
    const name = call.type === 'CallExpression' ? idName(call.callee) : idName(call);
    if (name === 'UseGuards' && call.type === 'CallExpression') {
      for (const arg of call.arguments) {
        const n = idName(arg);
        if (n) out.push(n);
      }
      continue;
    }
    if (name && GUARD_DECORATOR.test(name)) out.push(name);
  }
  return out;
}

// constructor(private catsService: CatsService) → { catsService: 'CatsService' }
function constructorDI(cls) {
  const di = {};
  const ctor = cls.body.body.find(
    (m) => m.type === 'ClassMethod' && m.kind === 'constructor',
  );
  for (const param of ctor?.params ?? []) {
    // `private x: T` is a TSParameterProperty wrapping an Identifier with a type
    const id = param.type === 'TSParameterProperty' ? param.parameter : param;
    if (id?.type !== 'Identifier') continue;
    const typeName = typeRefName(id.typeAnnotation?.typeAnnotation);
    if (typeName) di[id.name] = typeName;
  }
  return di;
}

// --- DI resolution: follow this.<prop>.<method>() through the DI graph ---------
//
// Real Nest apps are DEEP: a controller delegates to a service, the service to a
// repository, and the actual DB call is two hops down (immich: controller → service
// → repository → kysely). And the wiring is often INHERITED — the service `extends
// BaseService`, whose constructor injects every repository. So resolution is
// recursive (bounded) and climbs the `extends` chain to build each class's full DI map.

const MAX_DI_DEPTH = 6;

// A service method reached by N routes must be resolved ONCE, not N times — twenty
// (a large Nest app with heavily-shared core services) took 34s re-resolving the same
// method per route. `bundleCache` memoizes each method's full downstream scan (its own
// body + everything reachable through its DI) across the whole compile, keyed by method
// identity. Cleared per compile in extractNest.
let bundleCache = new Map();

function resolveHandlerScan(method, di, ownerMod, cwd, scannedFiles, helpers) {
  const base = scanFunction(method); // the controller body itself
  const merged = {
    ...base,
    effects: [...base.effects],
    returnShapes: [...(base.returnShapes ?? [])],
    calls: [...(base.calls ?? [])],
  };
  forEachThisCall(method, di, (dep, methodName) => {
    mergeScan(
      merged,
      methodBundle(dep.type, methodName, dep.mod, cwd, scannedFiles, helpers, new Set()),
    );
  });
  return merged;
}

// the fully-resolved scan of `type.methodName` (its body + its DI subtree), memoized.
// `stack` breaks reference cycles: a method currently being computed contributes an
// empty bundle (and is not cached until complete, so the memo never stores a partial).
function methodBundle(type, methodName, ownerMod, cwd, scannedFiles, helpers, stack) {
  const hit = resolveMethod(type, methodName, ownerMod, cwd, scannedFiles, helpers);
  if (!hit) return EMPTY_BUNDLE;
  const key = `${hit.rel}#${type}.${methodName}`;
  const cached = bundleCache.get(key);
  if (cached) return cached;
  if (stack.has(key) || stack.size >= MAX_DI_DEPTH) return EMPTY_BUNDLE;
  stack.add(key);
  const base = scanFunction(hit.fn);
  const bundle = {
    ...base,
    effects: [...base.effects],
    returnShapes: [...(base.returnShapes ?? [])],
    calls: [...(base.calls ?? [])],
  };
  forEachThisCall(hit.fn, hit.di, (dep, m) => {
    mergeScan(
      bundle,
      methodBundle(dep.type, m, dep.mod, cwd, scannedFiles, helpers, stack),
    );
  });
  stack.delete(key);
  bundleCache.set(key, bundle);
  return bundle;
}

const EMPTY_BUNDLE = Object.freeze({
  effects: [],
  returnShapes: [],
  calls: [],
  validatesInput: false,
  async: false,
  guardSignals: { deniesWithStatus: false },
});

// invoke cb(dep, methodName) for every `this.<prop>.<m>()` whose <prop> is a DI'd
// dependency in `di` (a { prop: { type, mod } } map).
function forEachThisCall(fnNode, di, cb) {
  traverse(
    { type: 'File', program: { type: 'Program', body: [fnNode], directives: [] } },
    {
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier')
          return;
        const recv = callee.object; // this.<prop>
        if (
          recv.type !== 'MemberExpression' ||
          recv.object.type !== 'ThisExpression' ||
          recv.property.type !== 'Identifier'
        )
          return;
        const dep = di[recv.property.name];
        if (dep) cb(dep, callee.property.name);
      },
    },
    undefined, // minimal scope stand-in; traverse needs one for a File root
  );
}

// import <typeName> from `mod`, find the class (following `extends`), locate the
// method → { fn, mod, di, rel }. `di` is the class's FULL dependency map (its own
// constructor params + every ancestor's), so the next hop can be followed.
function resolveMethod(typeName, methodName, ownerMod, cwd, scannedFiles, helpers) {
  const file = ownerMod.imports.get(typeName);
  if (!file || !fs.existsSync(file)) return null;
  const mod = parseModule(file);
  if (mod.error) return null;
  const cls = classInModule(mod, typeName);
  if (!cls) return null;
  const rel = relOf(cwd, file);
  if (!scannedFiles.includes(rel)) scannedFiles.push(rel);

  const m = methodInClassChain(cls, mod, methodName);
  if (!m) return null;
  helpers.push({
    name: `${typeName}.${methodName}`,
    sourceFile: relOf(cwd, moduleFileOf(m.mod)) || rel,
    sourceLine: m.fn.loc?.start.line ?? 0,
    fn: m.fn,
  });
  // di for the NEXT hop is the resolved class's full dependency map, each entry
  // tagged with the module that declared it (so an inherited repo type resolves
  // against the BASE class's imports, not the subclass's).
  return { fn: m.fn, mod: m.mod, di: diMapWithMod(cls, mod), rel };
}

// a class's full DI map as { prop: { type, mod } }, merged UP the `extends` chain
// (base first so a subclass's own param wins). Each entry carries the module that
// declared it, because that is where its TYPE is imported.
function diMapWithMod(cls, clsMod) {
  const chain = [];
  let curCls = cls;
  let curMod = clsMod;
  for (let depth = 0; curCls && depth < MAX_DI_DEPTH; depth++) {
    chain.push({ cls: curCls, mod: curMod });
    const base = baseClassOf(curCls, curMod);
    curCls = base?.cls ?? null;
    curMod = base?.mod ?? null;
  }
  const out = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const { cls: c, mod: m } = chain[i];
    for (const [prop, type] of Object.entries(constructorDI(c)))
      out[prop] = { type, mod: m };
  }
  return out;
}

// classInModule / methodInClassChain / baseClassOf live in extract.js — shared
// with the Express instantiated-service follower (`new Service().method()`).

const moduleFileOf = (mod) => mod.ast?.loc?.filename ?? mod._file ?? '';

function mergeScan(into, add) {
  into.effects.push(...add.effects);
  into.returnShapes = [...(into.returnShapes ?? []), ...(add.returnShapes ?? [])];
  into.calls = [...(into.calls ?? []), ...(add.calls ?? [])];
  into.validatesInput = into.validatesInput || add.validatesInput;
  into.async = into.async || add.async;
  if (add.guardSignals?.deniesWithStatus) into.guardSignals.deniesWithStatus = true;
}

// --- small AST + path helpers ----------------------------------------------

const idName = (node) =>
  node?.type === 'Identifier'
    ? node.name
    : node?.type === 'CallExpression'
      ? idName(node.callee)
      : null;

function typeRefName(t) {
  if (!t) return null;
  if (t.type === 'TSTypeReference' && t.typeName?.type === 'Identifier')
    return t.typeName.name;
  return null;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function joinPath(prefix, p) {
  const norm = (s) => `/${String(s ?? '').replace(/^\/+|\/+$/g, '')}`;
  const a = prefix ? norm(prefix) : '';
  const b = p ? norm(p) : '';
  const joined = `${a}${b}`.replace(/\/{2,}/g, '/');
  return joined === '' ? '/' : joined;
}

function pathParamsOf(fullPath) {
  return [...fullPath.matchAll(/:(\w+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    type: 'string',
    required: true,
  }));
}

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
