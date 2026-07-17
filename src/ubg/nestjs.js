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
import { parseModule, classInModule, methodInClassChain } from './extract.js';
import { createResolver, diMapWithMod, walkAst } from './resolve.js';

// A synthetic scan carrying ONLY the deny signal — attached to an auth-named guard step
// when a global guard (APP_GUARD / useGlobalGuards) is PROVEN to deny app-wide. The route
// already had this guard (by name); this upgrades it asserted → verified, never invents a
// guard on an unguarded route. So it can only sharpen credibility, never hide a hole.
const GLOBAL_GUARD_SCAN = {
  effects: [],
  returnShapes: [],
  calls: [],
  async: true,
  validatesInput: false,
  guardSignals: { deniesWithStatus: true },
};

const traverse = traverseModule.default ?? traverseModule;
const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.sparda']);

// ADR-055 — recognize the PROTOCOL, not the framework brand. HTTP verbs are a closed,
// universal vocabulary: every decorator framework embeds one in its route decorator
// (@Get, @HttpGet, @GetMapping). Matching the verb — not `@Controller` by name — reads
// a bespoke @RestController/@Endpoint framework (n8n, routing-controllers, home-made)
// exactly like Nest, with zero per-framework config. The next app that invents its own
// decorator name is still HTTP underneath, so it is still seen.
const VERB_DECORATOR = /^(?:http)?(get|post|put|patch|delete)(?:mapping)?$/i;
// cheap file pre-filter: a route decorator or a controller/resolver brand must appear
// textually before we pay for a full parse (keeps the twenty-scale monorepo fast).
const CANDIDATE_RE =
  /@(?:Controller|RestController|JsonController|Resolver|(?:Http)?(?:Get|Post|Put|Patch|Delete)(?:Mapping)?)\b/;

// → { routes, globalMiddlewares, helpers, skipped, scannedFiles } (extractExpress shape)
export function extractNest(cwd, entryDir) {
  const routes = [];
  const helpers = [];
  const skipped = [];
  const scannedFiles = [];
  // the interprocedural engine (ADR-054): follows this.<prop>.<m>() through the
  // constructor-type DI graph — bounded, cycle-guarded, memoized per compile.
  const engine = createResolver({ cwd, scannedFiles, helpers });
  const root = path.resolve(cwd, entryDir || '.');
  // App-wide auth (immich, nocodb, most real Nest apps): a global guard registered via
  // `{ provide: APP_GUARD, useClass: AuthGuard }` or `useGlobalGuards(...)`. It gates every
  // route but is invisible to a per-method decorator scan, so its guards read asserted, not
  // verified (immich: 253 guards, 0 verified). Prove it ONCE here — resolve its canActivate
  // through DI to a real deny — and every auth-named guard on the app earns `verified`.
  const globalGuardDenies = detectGlobalDenyGuard(root, engine);

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
    // A route lives on a REST controller (any brand) OR a @Resolver (GraphQL) — both
    // wire their methods and DI identically, so the same machinery serves both. The
    // pre-filter still skips the DTO/entity/service bulk that carries no route decorator.
    if (!CANDIDATE_RE.test(head)) continue;
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
        const resolver = decoratorArg(cls.decorators, 'Resolver');
        // Structural admission (ADR-055): a class is a route source if it is a REST
        // controller by decorator (any brand), a GraphQL @Resolver, OR simply carries a
        // method with an HTTP-verb decorator — the last case catches a framework whose
        // class decorator we don't recognize but whose methods still speak HTTP.
        const ctrlPrefix = controllerPrefixOf(cls); // string prefix, or null
        const hasVerbMethod = cls.body.body.some(
          (m) => m.type === 'ClassMethod' && httpDecorator(m.decorators),
        );
        if (resolver === undefined && ctrlPrefix === null && !hasVerbMethod) return;
        sawController = true;
        // REST controllers carry a path prefix; GraphQL resolvers do not (operations
        // are named, not pathed) — their entrypoints live under a `graphql/` namespace.
        const prefix = resolver !== undefined ? '' : (ctrlPrefix ?? '');
        const di = diMapWithMod(cls, mod); // prop -> { type, mod that declared it }
        const classGuards = useGuards(cls.decorators);

        for (const m of cls.body.body) {
          if (m.type !== 'ClassMethod' || !m.key || m.key.type !== 'Identifier') continue;
          const http = httpDecorator(m.decorators) ?? graphqlOp(m.decorators, m.key.name);
          if (!http) continue;
          const fullPath = joinPath(prefix, http.path);
          const guards = [...classGuards, ...useGuards(m.decorators)];

          // the handler's effects = the controller method body + every service
          // method it delegates to through DI (this.<prop>.<call>())
          const scan = engine.handlerScan(m, di, mod, cls);

          const chain = [
            ...guards.map((name) => {
              // Prove the guard, don't just trust its name: resolve @UseGuards(X)'s
              // canActivate and check it can DENY (401/403 or an auth exception). A
              // resolved deny → the guard node reads VERIFIED, not asserted. Only the
              // deny SIGNAL is kept — the guard's own reads never enter the app's graph.
              // Fallback: an auth-named guard on an app with a PROVEN global auth guard is
              // gated by it (the decorator's metadata triggers the app-wide guard's deny).
              const scan =
                guardScan(name, mod, engine) ??
                (globalGuardDenies && GUARD_DECORATOR.test(name)
                  ? GLOBAL_GUARD_SCAN
                  : null);
              return {
                name,
                sourceFile: rel,
                sourceLine: m.loc?.start.line ?? 0,
                fn: null,
                ...(scan ? { scan } : {}),
                role: 'middleware',
              };
            }),
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
            authOptOut: http.optOut === true, // temp — consumed by the posture pass
          });
        }
      },
    });

    if (sawController && !scannedFiles.includes(rel)) scannedFiles.push(rel);
  }

  applyAuthPosture(routes);

  routes.sort((a, b) => cmp(a.path, b.path) || cmp(a.method, b.method));
  return { routes, globalMiddlewares: [], helpers, skipped, scannedFiles };
}

// Guarded-by-default posture (ADR-055). If ANY route in the app declared an auth
// opt-out flag, the app authenticates in its registry/bootstrap by default — a posture
// invisible to a per-decorator scan. So every route WITHOUT an opt-out gets a synthetic
// ASSERTED guard (`framework-default-auth`, unverified — surfaced by the blindspot
// ledger), and a route WITH the opt-out is left genuinely public (its mutations flag,
// exactly like a Medusa `AUTHENTICATE = false` route). If no opt-out flag appears
// anywhere, the posture is NOT inferred and nothing is injected — so a plain Nest app
// (twenty, immich) is byte-for-byte unaffected. This is the ONLY honest way to avoid
// crying wolf on a framework whose base auth is not in its decorators.
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
    delete r.authOptOut; // temp field never reaches the graph
  }
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

// An auth-opt-OUT flag in a route decorator's options object: `@Get('/x', { skipAuth:
// true })` (n8n), `{ authenticate: false }`, `{ public: true }`. Its very EXISTENCE in
// an app is the signal that the app is guarded-BY-DEFAULT (why carry an opt-out unless
// auth is on by default?) — the inference that lets SPARDA read a framework whose base
// auth lives in its registry/bootstrap, not its decorators (ADR-055, the Medusa
// inverted-auth pattern generalized).
const AUTH_OPTOUT_TRUE =
  /^(skipAuth|authless|noAuth|public|allowUnauthenticated|unauthenticated)$/i;

function httpDecorator(decorators) {
  for (const d of decorators ?? []) {
    const call = d.expression;
    const name = call.type === 'CallExpression' ? idName(call.callee) : idName(call);
    if (!name) continue;
    const m = VERB_DECORATOR.exec(name); // @Get / @HttpGet / @GetMapping → get
    if (!m) continue;
    const args = call.type === 'CallExpression' ? call.arguments : [];
    let optOut = false;
    for (const a of args) {
      if (a.type !== 'ObjectExpression') continue;
      for (const p of a.properties) {
        if (p.type !== 'ObjectProperty' || p.key.type !== 'Identifier') continue;
        const isTrue = p.value.type === 'BooleanLiteral' && p.value.value === true;
        const isFalse = p.value.type === 'BooleanLiteral' && p.value.value === false;
        if (AUTH_OPTOUT_TRUE.test(p.key.name) && isTrue) optOut = true;
        if (/^authenticate$/i.test(p.key.name) && isFalse) optOut = true;
      }
    }
    return {
      method: m[1].toLowerCase(),
      path: args[0]?.type === 'StringLiteral' ? args[0].value : '',
      optOut,
    };
  }
  return null;
}

// The class's route prefix, brand-agnostically (ADR-055). Preference order:
//   1. a class decorator whose NAME ends in "Controller" (@Controller, @RestController,
//      @JsonController, …) → its string-literal arg is the prefix ('' for a bare call);
//   2. else a class decorator carrying a path-shaped ('/…') string literal
//      (@Endpoint('/api')) — the leading slash keeps @ApiTags('users') & friends out.
// null = no REST-controller decorator (the caller still admits the class if a method
// carries a verb decorator, with an empty prefix).
function controllerPrefixOf(cls) {
  for (const d of cls.decorators ?? []) {
    const call = d.expression;
    const name = call.type === 'CallExpression' ? idName(call.callee) : idName(call);
    if (name && /controller$/i.test(name)) {
      const a0 = call.type === 'CallExpression' ? call.arguments[0] : null;
      return a0?.type === 'StringLiteral' ? a0.value : '';
    }
  }
  for (const d of cls.decorators ?? []) {
    const call = d.expression;
    if (
      call.type === 'CallExpression' &&
      call.arguments[0]?.type === 'StringLiteral' &&
      call.arguments[0].value.startsWith('/')
    )
      return call.arguments[0].value;
  }
  return null;
}

// A GraphQL operation is the same behavior spine as an HTTP route: @Query/@Subscription
// READ, @Mutation CHANGES STATE. We map them onto the graph's verbs (get = read,
// post = mutating) so every downstream pass — guard proof, blast radius, polarity —
// works unchanged. The operation NAME is the GraphQL field: a string/name-option arg if
// given, else the method name (the framework default). Namespaced under `graphql/` so a
// GraphQL op and a REST route with the same word never collide.
function graphqlOp(decorators, methodName) {
  for (const d of decorators ?? []) {
    const call = d.expression;
    const name = call.type === 'CallExpression' ? idName(call.callee) : idName(call);
    if (name !== 'Query' && name !== 'Mutation' && name !== 'Subscription') continue;
    const method = name === 'Mutation' ? 'post' : 'get';
    return { method, path: `graphql/${gqlName(call, methodName)}` };
  }
  return null;
}

// @Query('foo') → foo ; @Query(() => X, { name: 'foo' }) → foo ; else the method name.
function gqlName(call, methodName) {
  if (call.type !== 'CallExpression') return methodName;
  for (const arg of call.arguments) {
    if (arg.type === 'StringLiteral') return arg.value;
    if (arg.type === 'ObjectExpression') {
      for (const prop of arg.properties) {
        if (
          prop.type === 'ObjectProperty' &&
          prop.key.type === 'Identifier' &&
          prop.key.name === 'name' &&
          prop.value.type === 'StringLiteral'
        )
          return prop.value.value;
      }
    }
  }
  return methodName;
}

// A decorator whose OWN name reads as authorization — the app-specific guard idiom
// (`@Authenticated()`, `@Auth()`, `@RequirePermission()`) that Nest apps use instead of
// `@UseGuards()`. Without this, resolving effects behind DI would flag every guarded
// mutation as UNGUARDED (immich guards with `@Authenticated`, not `@UseGuards`).
const GUARD_DECORATOR =
  /^(auth|authenticated|guard|acl|permission|role|protect|secured|require|jwt|loggedin|signedin)/i;

// Resolve @UseGuards(X) → X's canActivate → keep ONLY whether it can deny (401/403 or
// an auth exception). Returns a minimal scan carrying just the deny signal, so the guard
// node earns `verified` without importing the canActivate's own effects (a user-lookup
// read) into the app's behavior graph. null when X is not a resolvable local class (an
// opaque/decorator guard stays honestly asserted). `mkGuardScan` is bound to the engine.
function guardScan(name, mod, engine) {
  const file = mod.imports.get(name);
  if (!file) return null;
  const gmod = parseModule(file);
  if (gmod.error) return null;
  const cls = classInModule(gmod, name);
  if (!cls) return null;
  const hit = methodInClassChain(cls, gmod, 'canActivate');
  if (!hit) return null;
  const full = engine.deepScan(hit.fn, hit.mod);
  // In a canActivate specifically, `return false` IS the deny (the canonical Nest guard
  // rejection) — safe to read as a denial here because this walk only ever runs on a
  // resolved guard method, never on arbitrary code (where `return false` is ambiguous).
  const deniesByFalse = returnsFalse(hit.fn);
  return {
    effects: [],
    returnShapes: [],
    calls: [],
    async: full.async,
    validatesInput: false,
    guardSignals: {
      deniesWithStatus: full.guardSignals.deniesWithStatus || deniesByFalse,
    },
  };
}

// Does the app register a global guard that PROVABLY denies? Scans module files for
// `{ provide: APP_GUARD, useClass: X }` / `useGlobalGuards(new X())`, resolves X's
// canActivate THROUGH its DI (the deny often lives one hop deep — immich's AuthGuard
// delegates to `this.authService.authenticate()` which throws), and returns true on the
// first proven denier. Bounded: module files are few and the pre-filter is textual.
function detectGlobalDenyGuard(root, engine) {
  for (const file of walk(root)) {
    let head;
    try {
      head = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!/APP_GUARD|useGlobalGuards/.test(head)) continue;
    const mod = parseModule(file);
    if (mod.error) continue;
    for (const name of globalGuardClassNames(mod))
      if (guardClassDenies(name, mod, engine)) return true;
  }
  return false;
}

// the guard class names registered app-wide in a module: `provide: APP_GUARD, useClass: X`
// and `useGlobalGuards(new X(), y)`.
function globalGuardClassNames(mod) {
  const names = new Set();
  walkAst(mod.ast.program, (n) => {
    if (n.type === 'ObjectExpression') {
      let isAppGuard = false;
      let useClass = null;
      for (const p of n.properties) {
        if (p.type !== 'ObjectProperty' || p.key?.type !== 'Identifier') continue;
        if (p.key.name === 'provide' && idName(p.value) === 'APP_GUARD')
          isAppGuard = true;
        if (p.key.name === 'useClass' && p.value?.type === 'Identifier')
          useClass = p.value.name;
      }
      if (isAppGuard && useClass) names.add(useClass);
    }
    if (
      n.type === 'CallExpression' &&
      n.callee?.type === 'MemberExpression' &&
      n.callee.property?.name === 'useGlobalGuards'
    )
      for (const a of n.arguments) {
        if (a.type === 'NewExpression' && a.callee?.type === 'Identifier')
          names.add(a.callee.name);
        else if (a.type === 'Identifier') names.add(a.name);
      }
  });
  return names;
}

// resolve a guard class (imported or same-file) → its canActivate → prove it can deny,
// following DI so a delegated deny (`this.authService.authenticate()` → throw) is seen.
function guardClassDenies(name, mod, engine) {
  const file = mod.imports.get(name);
  const gmod = file ? parseModule(file) : mod;
  if (gmod.error) return false;
  const cls = classInModule(gmod, name);
  if (!cls) return false;
  const hit = methodInClassChain(cls, gmod, 'canActivate');
  if (!hit) return false;
  const di = diMapWithMod(cls, hit.mod);
  const scan = engine.handlerScan(hit.fn, di, hit.mod, cls);
  return Boolean(scan.guardSignals.deniesWithStatus) || returnsFalse(hit.fn);
}

// does this canActivate body contain a `return false`? (a nested function's return
// doesn't count — only the guard method's own returns), bounded, deterministic.
function returnsFalse(fnNode) {
  let found = false;
  walkAst(fnNode.body, (n) => {
    if (
      n.type === 'ReturnStatement' &&
      n.argument?.type === 'BooleanLiteral' &&
      n.argument.value === false
    )
      found = true;
  });
  return found;
}

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

// DI resolution — following this.<prop>.<method>() through the constructor-type
// DI graph, up the `extends` chain, bounded and memoized — lives in resolve.js
// (the shared interprocedural engine), as does diMapWithMod.

// --- small AST + path helpers ----------------------------------------------

const idName = (node) =>
  node?.type === 'Identifier'
    ? node.name
    : node?.type === 'CallExpression'
      ? idName(node.callee)
      : null;

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
