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

// A principal-injection param decorator (@AuthUser, @GetUser, @CurrentUser) has no
// resolvable body — it consumes request.user, it does not deny. This marks its chain step
// as an ASSERTED guard (assertedGuard, never deniesWithStatus) so isGuardLike honors it as
// a name-only gate even when the bare decorator name (@GetUser, @Principal) carries no
// GUARD_NAME token. It can NEVER read `verified` on its own — only a PROVEN global guard
// (GLOBAL_GUARD_SCAN) upgrades it — so it downgrades a false UNGUARDED_MUTATION on a
// genuinely-authenticated route but never buys a PROVEN or hides a hole (ADR-063).
const ASSERTED_PRINCIPAL_SCAN = {
  effects: [],
  returnShapes: [],
  calls: [],
  async: false,
  validatesInput: false,
  guardSignals: {},
  assertedGuard: true,
};

const traverse = traverseModule.default ?? traverseModule;
const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.sparda']);

// ADR-055 — recognize the PROTOCOL, not the framework brand. HTTP verbs are a closed,
// universal vocabulary: every decorator framework embeds one in its route decorator
// (@Get, @HttpGet, @GetMapping). Matching the verb — not `@Controller` by name — reads
// a bespoke @RestController/@Endpoint framework (n8n, routing-controllers, home-made)
// exactly like Nest, with zero per-framework config. The next app that invents its own
// decorator name is still HTTP underneath, so it is still seen.
// `@All('wipe')` is a real @nestjs/common decorator answering EVERY verb. Modelling it
// as one pseudo-route (or, as before, not at all) hid an entire unguarded endpoint while
// the app read PROVEN — the Nest twin of E-067. Expanded like Express's `app.all`, into
// the verbs a request can actually arrive on.
const NEST_ALL_EXPANSION = ['get', 'post', 'put', 'patch', 'delete'];
const VERB_DECORATOR =
  /^(?:http)?(get|post|put|patch|delete|options|head|all)(?:mapping)?$/i;
// cheap file pre-filter: a route decorator or a controller/resolver brand must appear
// textually before we pay for a full parse (keeps the twenty-scale monorepo fast).
const CANDIDATE_RE =
  /@(?:Controller|RestController|JsonController|Resolver|(?:Http)?(?:Get|Post|Put|Patch|Delete|Options|Head|All)(?:Mapping)?)\b/;

// → { routes, globalMiddlewares, helpers, skipped, unknownHandlers, scannedFiles }
export function extractNest(cwd, entryDir) {
  const routes = [];
  const helpers = [];
  const skipped = [];
  // The registration invariant (ADR-079), ported from Express: a route SPARDA sees
  // but cannot bind is DECLARED, never dropped or — worse — guessed.
  const unknownHandlers = [];
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
  // one resolution per decorator DEFINITION, not per use — novu applies the same four
  // composites across 451 routes
  const compositeCache = new Map();
  const declaredComposites = new Set();

  // A composite decorator (ADR-084) stands for the guards it applies. Replace it with
  // them, drop it when it turns out to be metadata, and declare any branch left unread.
  function expandComposites(names, mod, rel) {
    const out = [];
    const push = (name, srcMod) => {
      if (!out.some((g) => g.name === name)) out.push({ name, mod: srcMod });
    };
    for (const name of names) {
      const c = resolveCompositeDecorator(name, mod, compositeCache);
      if (!c) {
        push(name, mod); // a guard class, or opaque — unchanged behaviour
        continue;
      }
      // A constituent is imported by the module that DECLARED the composite, never by the
      // controller that used it: `CommunityUserAuthGuard` is in auth.decorator.ts's import
      // map, and resolving it against the controller's finds nothing. Carrying the origin
      // module is what turns the expansion from a rename into a proof.
      for (const g of c.guards) push(g, c.mod ?? mod);
      const where = c.file ? relOf(cwd, c.file) : rel;
      if (c.unread.length && !declaredComposites.has(`u:${name}`)) {
        declaredComposites.add(`u:${name}`);
        // Crediting the branch we READ is a true statement about that configuration; the
        // sibling we could not read is a configuration we are not entitled to claim. High
        // risk, so no app reaches PROVEN on the strength of a branch nobody opened.
        skipped.push({
          reason: `@${name}() applies decorators through a branch SPARDA could not read (${c.unread.join(', ')}) — the guards credited here are the ones its readable branch applies, and another configuration may apply different ones`,
          file: where,
          risk: 'high',
        });
      }
      // A metadata-only decorator gates nothing BY ITSELF — but that is only half the
      // question, and getting the other half wrong is how this change nearly deleted
      // immich's entire auth model. `@Authenticated = () => applyDecorators(SetMetadata(…))`
      // is the dominant Nest idiom: the tag is the route's OPT-IN to an app-wide guard that
      // reads it. Where that global guard exists and provably denies, the tag is real
      // protection and dropping it would invent 253 unguarded routes out of nothing.
      // So the drop is conditional on there being no such guard to read the key.
      if (c.metadataOnly && !globalGuardDenies) {
        if (!declaredComposites.has(`m:${name}`)) {
          declaredComposites.add(`m:${name}`);
          // NOT a blind spot — a resolved fact. Recorded at low risk so the ledger shows
          // WHY a name that reads like a gate stopped counting as one.
          skipped.push({
            reason: `@${name}() only calls SetMetadata and this app registers no global guard proven to deny — it is a metadata tag, not protection, so it no longer counts as a guard`,
            file: where,
            risk: 'low',
          });
        }
      } else if (c.metadataOnly) {
        push(name, mod); // the tag opts the route into a PROVEN global guard — real protection
      } else if (!c.guards.length) {
        // Resolved, but it yielded no guard and is not provably metadata — an unusual
        // shape. Keeping the original name preserves today's asserted reading; letting it
        // fall through would DELETE a gate on the strength of a resolution that concluded
        // nothing, which is the one direction this module may never move.
        push(name, mod);
      }
    }
    return out;
  }

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
          const guards = expandComposites(
            [...classGuards, ...useGuards(m.decorators)],
            mod,
            rel,
          );
          // Principal-injection param decorators (@AuthWorkspace/@AuthUser on twenty's
          // resolvers) are the auth idiom that lives on the METHOD PARAMETERS, invisible
          // to useGuards — deduped against the named guards so one route never counts the
          // same auth twice.
          const principalGuards = paramAuthGuards(m, mod).filter(
            (n) => !guards.some((g) => g.name === n),
          );

          // Prove a guard, don't just trust its name: resolve @UseGuards(X)'s canActivate
          // and check it can DENY (401/403 or an auth exception). A resolved deny → the
          // guard node reads VERIFIED, not asserted. Only the deny SIGNAL is kept — the
          // guard's own reads never enter the app's graph. Fallbacks: an auth-named guard
          // on an app with a PROVEN global auth guard is gated by it; a principal-injection
          // decorator with no global proof stays an ASSERTED guard (name-only, never
          // verified). `allowAssert` is on only for the param decorators.
          const guardStepScan = (name, srcMod, allowAssert) =>
            guardScan(name, srcMod, engine) ??
            (nestPassportGuard(name, srcMod)
              ? GLOBAL_GUARD_SCAN // catalog-verified: @nestjs/passport AuthGuard provably 401s
              : globalGuardDenies &&
                  (GUARD_DECORATOR.test(name) || nameLooksLikePrincipal(name))
                ? GLOBAL_GUARD_SCAN
                : allowAssert
                  ? ASSERTED_PRINCIPAL_SCAN
                  : null);

          // the handler's effects = the controller method body + every service
          // method it delegates to through DI (this.<prop>.<call>())
          const scan = engine.handlerScan(m, di, mod, cls);

          const chain = [
            ...guards.map(({ name, mod: srcMod }) => {
              const scan = guardStepScan(name, srcMod, false);
              return {
                name,
                sourceFile: rel,
                sourceLine: m.loc?.start.line ?? 0,
                fn: null,
                ...(scan ? { scan } : {}),
                role: 'middleware',
              };
            }),
            ...principalGuards.map((name) => ({
              name,
              sourceFile: rel,
              sourceLine: m.loc?.start.line ?? 0,
              fn: null,
              scan: guardStepScan(name, mod, true),
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

          // `@All()` is not a verb, it is every verb — one route each, exactly like
          // Express's `app.all`, so the guard obligation fires once per verb the path
          // actually exposes instead of not at all.
          // A decorator path that is not a string literal — `@Get(ROUTES.detail)` —
          // used to silently become '', mounting the route at the controller prefix.
          // That is worse than losing it: the route lands at a path the app does not
          // serve, so any guard/prefix reasoning about it is about the wrong URL. The
          // route stays (its behaviour is real) and the misplacement is declared.
          if (http.pathDynamic) {
            unknownHandlers.push({
              kind: 'UnknownHandler',
              via: `dynamic-decorator-path:${http.method}`,
              target: `${cls.id?.name ?? 'controller'}.${m.key.name}`,
              file: rel,
              line: m.loc?.start.line,
            });
            skipped.push({
              reason: `dynamic path on @${http.method.toUpperCase()}() in ${cls.id?.name ?? 'a controller'} — the route is real but its URL cannot be bound, so it is placed at the controller prefix`,
              file: rel,
              line: m.loc?.start.line,
              risk: 'high',
            });
          }
          const verbs = http.method === 'all' ? NEST_ALL_EXPANSION : [http.method];
          for (const verb of verbs) {
            routes.push({
              method: verb,
              path: fullPath,
              sourceFile: rel,
              sourceLine: m.loc?.start.line ?? 0,
              params: pathParamsOf(fullPath),
              chain,
              description: '',
              authOptOut: http.optOut === true, // temp — consumed by the posture pass
            });
          }
        }
      },
    });

    if (sawController && !scannedFiles.includes(rel)) scannedFiles.push(rel);
  }

  applyAuthPosture(routes);

  routes.sort((a, b) => cmp(a.path, b.path) || cmp(a.method, b.method));
  return {
    routes,
    globalMiddlewares: [],
    helpers,
    skipped,
    unknownHandlers,
    scannedFiles,
  };
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
    const pathArg = args[0];
    // a first argument that exists but is not a literal is a path we cannot read —
    // distinct from no argument at all, which legitimately means "the prefix"
    const pathDynamic = Boolean(pathArg) && pathArg.type !== 'StringLiteral';
    return {
      method: m[1].toLowerCase(),
      path: pathArg?.type === 'StringLiteral' ? pathArg.value : '',
      ...(pathDynamic ? { pathDynamic: true } : {}),
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

// The NestJS half of the auth-library catalog (ADR-069): a `@UseGuards(...)` guard built on
// `@nestjs/passport`'s `AuthGuard`. Two forms, both of which provably 401 via passport:
//   • inline `@UseGuards(AuthGuard('jwt'))` — the guard name is imported from @nestjs/passport;
//   • `@UseGuards(JwtAuthGuard)` where `class JwtAuthGuard extends AuthGuard('jwt') {}`.
// Deny-FORM precision: if the subclass OVERRIDES `canActivate`/`handleRequest`, its deny is custom
// (it may swallow the 401) → abstain (return false, stays asserted — the safe direction), never
// falsely verify. Provenance-based (the import package), never a name test.
function nestPassportGuard(name, mod) {
  const pkgOf = mod.authGuards?.pkgOf;
  if (!pkgOf) return false;
  // inline AuthGuard('jwt') — the name itself is imported straight from @nestjs/passport
  if (pkgOf.get(name) === '@nestjs/passport') return true;
  // a subclass of AuthGuard(...) — resolve the class (same file, else through its import)
  let gmod = mod;
  let cls = classInModule(mod, name);
  if (!cls) {
    const file = mod.imports.get(name);
    if (!file) return false;
    gmod = parseModule(file);
    if (gmod.error) return false;
    cls = classInModule(gmod, name);
  }
  if (!cls || cls.superClass?.type !== 'CallExpression') return false;
  const superName =
    cls.superClass.callee?.type === 'Identifier' ? cls.superClass.callee.name : null;
  if (!superName || gmod.authGuards?.pkgOf?.get(superName) !== '@nestjs/passport')
    return false;
  const overridesDeny = cls.body.body.some(
    (mm) =>
      mm.type === 'ClassMethod' &&
      mm.key?.type === 'Identifier' &&
      (mm.key.name === 'canActivate' || mm.key.name === 'handleRequest'),
  );
  return !overridesDeny;
}

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

// --- composite decorators: `applyDecorators(UseGuards(X), …)` (ADR-084) ---------------
//
// NestJS's OFFICIAL composition API. A house decorator is declared once and used
// everywhere:
//
//   export function RequireAuthentication() {
//     if (isEEAuthEnabled()) return EERequireAuthentication();          // ← branch A
//     return applyDecorators(UseGuards(CommunityUserAuthGuard), …);     // ← branch B
//   }
//
// SPARDA saw `@RequireAuthentication()`, matched it on NAME alone, and stopped: the
// symbol resolves to a FUNCTION, and `guardScan` only knows how to resolve a CLASS. So
// the guard read `asserted` — trusted because it is called Auth-something — and the real
// `canActivate` two hops away was never opened. Measured on novu: 340 routes, every one
// gated by a guard that provably 401s, none of them proven.
//
// Reading the definition also settles the OPPOSITE error. `RequirePermissions` is
// `SetMetadata(PERMISSIONS_KEY, …)` — a metadata TAG some guard reads elsewhere, gating
// nothing on its own. Its name matched the same regex, so 221 more novu routes carried a
// "guard" that is not one. Dropping it is Direction 2 in the safe direction: removing
// invented protection can only ADD findings, never hide one.
//
// The two failures are the same defect — judging a decorator by its name instead of its
// definition (E-060) — and one resolution fixes both.
const COMPOSITE_MAX_DEPTH = 3;

// Every `return` that belongs to `fn` itself (a nested arrow's return is not fn's).
function ownReturns(fn) {
  const out = [];
  const body = fn.body;
  // `const X = () => applyDecorators(…)` — an expression-bodied arrow has no return node
  if (body && body.type !== 'BlockStatement') return [body];
  walkAst(body, (n) => {
    if (n.type === 'ReturnStatement' && n.argument) out.push(n.argument);
  });
  return out;
}

// The declaration of `name` in `mod`, as a function-ish node — or null.
function decoratorFactory(name, mod) {
  let found = null;
  walkAst(mod.ast?.program, (n) => {
    if (found) return;
    if (n.type === 'FunctionDeclaration' && n.id?.name === name) found = n;
    if (
      n.type === 'VariableDeclarator' &&
      n.id?.type === 'Identifier' &&
      n.id.name === name &&
      (n.init?.type === 'ArrowFunctionExpression' ||
        n.init?.type === 'FunctionExpression')
    )
      found = n.init;
  });
  return found;
}

/**
 * Resolve a decorator NAME to what it actually applies.
 *
 * @returns null when `name` is not a readable decorator factory (a guard class, an opaque
 *   import, a symbol with no local declaration) — the caller then keeps today's behaviour,
 *   so this can only ever ADD understanding.
 *   Otherwise `{ guards, metadataOnly, unread }`:
 *     guards       constituent guard classes, UNION over every branch — a guard applied on
 *                  only one branch is still a guard the app can apply.
 *     metadataOnly every readable branch was `SetMetadata` and nothing else: not a guard.
 *     unread       branches whose returned decorator could not be read. Crediting the
 *                  proven branch while a sibling branch is unread is a claim about the
 *                  configuration SPARDA READ, so the unread one is DECLARED at high risk
 *                  and the app can no longer reach PROVEN on its strength alone.
 */
function resolveCompositeDecorator(name, mod, cache, depth = 0) {
  if (depth > COMPOSITE_MAX_DEPTH) return null;
  const file = mod.imports.get(name);
  const key = `${file ?? mod.file ?? '?'}::${name}`;
  if (cache?.has(key)) return cache.get(key);

  const dmod = file ? parseModule(file) : mod;
  const result = (() => {
    if (dmod.error || !dmod.ast) return null;
    const fn = decoratorFactory(name, dmod);
    if (!fn) {
      // A monorepo import lands on a BARREL (`libs/x/src/index.ts`, whose whole body is
      // `export * from './decorators'`) — it declares nothing itself and records no named
      // import, so the search stops one file short of every decorator in the package. On
      // novu that is the entire `@novu/application-generic` surface. Follow the named
      // re-export first, then the star ones, bounded by depth.
      const named = dmod.imports.get(name);
      if (named && named !== file)
        return resolveCompositeDecorator(name, dmod, cache, depth + 1);
      for (const star of dmod.starReexports ?? []) {
        const smod = parseModule(star);
        if (smod.error || !smod.ast) continue;
        const hit = resolveCompositeDecorator(
          name,
          { ...smod, imports: smod.imports, file: star },
          cache,
          depth + 1,
        );
        if (hit) return hit;
      }
      return null; // a class guard, or a symbol we cannot see — not our business
    }

    const guards = [];
    const unread = [];
    let sawReadable = false;
    let sawGuardSource = false;
    for (const ret of ownReturns(fn)) {
      if (ret.type !== 'CallExpression') {
        unread.push(shortSrc(ret));
        continue;
      }
      const callee = idName(ret.callee);
      if (callee === 'applyDecorators') {
        sawReadable = true;
        for (const arg of ret.arguments) {
          if (arg.type !== 'CallExpression' || idName(arg.callee) !== 'UseGuards')
            continue;
          // `sawGuardSource` means a branch APPLIED A GUARD, not that it called
          // applyDecorators. Setting it on the call itself made every composite look
          // guard-bearing, so `@Authenticated = () => applyDecorators(SetMetadata(…))`
          // — immich's whole auth model — resolved to no guards AND not-metadata, and
          // vanished from the chain entirely.
          sawGuardSource = true;
          for (const g of arg.arguments) {
            const n = idName(g);
            if (n && !guards.includes(n)) guards.push(n);
          }
        }
        continue;
      }
      if (callee === 'UseGuards') {
        sawReadable = true;
        sawGuardSource = true;
        for (const g of ret.arguments) {
          const n = idName(g);
          if (n && !guards.includes(n)) guards.push(n);
        }
        continue;
      }
      if (callee === 'SetMetadata') {
        sawReadable = true; // read, and it gates nothing
        continue;
      }
      // another factory in the same module — follow it once, bounded
      const nested = resolveCompositeDecorator(callee, dmod, cache, depth + 1);
      if (nested) {
        sawReadable = true;
        if (nested.guards.length) sawGuardSource = true;
        for (const n of nested.guards) if (!guards.includes(n)) guards.push(n);
        unread.push(...nested.unread);
        continue;
      }
      unread.push(shortSrc(ret));
    }
    if (!sawReadable && !unread.length) return null;
    return {
      guards,
      // `metadataOnly` is a POSITIVE finding — we read every branch and none applied a
      // guard — so an unread branch disqualifies it: silence there is not evidence.
      metadataOnly:
        sawReadable && !sawGuardSource && guards.length === 0 && !unread.length,
      unread,
      file: file ?? null,
      mod: dmod,
    };
  })();

  cache?.set(key, result);
  return result;
}

const shortSrc = (node) => {
  const callee = node.type === 'CallExpression' ? idName(node.callee) : null;
  return callee ? `${callee}()` : node.type;
};

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

// Custom PARAMETER decorators that inject the authenticated principal into a handler —
// `@AuthWorkspace()`, `@AuthUser()`, `@CurrentUser()`, `@GetUser()` (twenty & every DI/GraphQL
// Nest app's auth idiom). They live on the method's PARAMETERS, so useGuards() never sees them,
// yet their presence means the framework resolved `request.user`/`.workspace` from an
// AUTHENTICATED request. An asserted guard DOWNGRADES an UNGUARDED_MUTATION, so a false match
// would HIDE a real hole (SOUNDNESS Direction 2) — the bar is strict: does this decorator
// actually inject the principal?
//
// SPARDA's own thesis is "behaviour, not names" (E-060: the old name-regex read `@Author` as
// auth). So we PROVE it: resolve the decorator's `createParamDecorator(...)` body and read what
// request field it returns. `@AuthWorkspace` → `getRequest().workspace` (a principal field) →
// guard; `@Author` → `getRequest().body.author` (user input) → NOT a guard. When the body is
// visible, the BODY is final — the name is irrelevant. Only when the definition is opaque
// (imported from a library, no body) do we fall back to the name, and even then on whole TOKENS
// (`@Author` → [author], never matches `auth`), not substrings. Either way it stays an ASSERTED
// guard (ADR-063) — reading the principal proves the route CONSUMES auth, never that it DENIES.

// request-context fields that hold the authenticated principal (not user input).
const PRINCIPAL_FIELD = new Set([
  'user',
  'auth',
  'workspace',
  'account',
  'session',
  'principal',
  'currentuser',
  'tenant',
  'identity',
  'viewer',
  'actor',
  'loggeduser',
  'authuser',
  'me',
]);
// request fields that carry USER INPUT — a principal-named field UNDER one of these
// (`req.body.user`) is caller-controlled, NOT the authenticated principal.
const INPUT_FIELD = new Set([
  'body',
  'params',
  'param',
  'query',
  'headers',
  'header',
  'cookies',
  'ip',
]);
// whole-token principal vocabulary for the NAME FALLBACK (opaque/imported decorators).
const PRINCIPAL_TOKEN = new Set([
  'auth',
  'user',
  'users',
  'workspace',
  'account',
  'session',
  'principal',
  'tenant',
  'identity',
  'viewer',
  'actor',
  'jwt',
  'login',
  'loggedin',
]);

// split an identifier into lowercased word tokens: `AuthWorkspace` → [auth, workspace],
// `get_user` → [get, user], `JWTUser` → [jwt, user]. Whole-token matching kills the
// substring false-positives a name regex makes (`Author` → [author], never `auth`).
function splitIdent(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

const nameLooksLikePrincipal = (name) =>
  splitIdent(name).some((t) => PRINCIPAL_TOKEN.has(t));

// the `createParamDecorator(fn)` factory function for a decorator `name`, resolved same-file
// or through its import — or null if the definition is opaque (library import, no body).
function paramDecoratorFactory(name, mod) {
  const search = (m) => {
    let fn = null;
    walkAst(m.ast.program, (n) => {
      if (
        !fn &&
        n.type === 'VariableDeclarator' &&
        n.id?.type === 'Identifier' &&
        n.id.name === name &&
        n.init?.type === 'CallExpression' &&
        idName(n.init.callee) === 'createParamDecorator'
      ) {
        const arg = n.init.arguments.find(
          (a) =>
            a?.type === 'ArrowFunctionExpression' || a?.type === 'FunctionExpression',
        );
        if (arg) fn = arg;
      }
    });
    return fn;
  };
  const here = search(mod);
  if (here) return here;
  const file = mod.imports.get(name);
  if (!file) return null;
  const dmod = parseModule(file);
  return dmod.error ? null : search(dmod);
}

// Does the decorator's body read the authenticated principal? True iff it accesses a
// PRINCIPAL_FIELD (`.user`/`.workspace`/…) whose object chain does NOT pass through a
// user-input field (`req.body.user` is caller-controlled, not the principal).
function decoratorReadsPrincipal(fnNode) {
  let reads = false;
  walkAst(fnNode.body ?? fnNode, (n) => {
    if (
      !reads &&
      n.type === 'MemberExpression' &&
      n.property?.type === 'Identifier' &&
      PRINCIPAL_FIELD.has(n.property.name.toLowerCase()) &&
      !objectChainHasInput(n.object)
    )
      reads = true;
  });
  return reads;
}

// walk down a member/call receiver chain — true if any property is a user-input field.
function objectChainHasInput(node) {
  let cur = node;
  while (cur) {
    if (cur.type === 'MemberExpression') {
      if (
        cur.property?.type === 'Identifier' &&
        INPUT_FIELD.has(cur.property.name.toLowerCase())
      )
        return true;
      cur = cur.object;
    } else if (cur.type === 'CallExpression') {
      cur = cur.callee;
    } else {
      return false;
    }
  }
  return false;
}

// Does this decorator inject the authenticated principal? Body visible → BEHAVIOUR is final
// (proven read of the principal); body opaque → tokenized-name fallback (an honest guess).
function injectsPrincipal(name, mod) {
  const fn = paramDecoratorFactory(name, mod);
  if (fn) return decoratorReadsPrincipal(fn);
  return nameLooksLikePrincipal(name);
}

// The authenticated-principal param decorators on a route method's parameters, deduped by
// name. Reads both a plain parameter's decorators and a TSParameterProperty's (defensive —
// handler params are rarely parameter-properties, but constructor-style methods exist).
function paramAuthGuards(method, mod) {
  const out = new Set();
  for (const param of method.params ?? []) {
    const decs =
      param.decorators ??
      (param.type === 'TSParameterProperty' ? param.parameter?.decorators : null) ??
      [];
    for (const d of decs) {
      const call = d.expression;
      const name = call?.type === 'CallExpression' ? idName(call.callee) : idName(call);
      if (name && injectsPrincipal(name, mod)) out.add(name);
    }
  }
  return [...out];
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
