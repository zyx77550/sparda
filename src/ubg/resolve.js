// ubg/resolve.js — THE interprocedural resolution engine (ADR-054).
//
// Before this module, every framework paid for call-following separately: the
// Nest extractor had its DI follower (`methodBundle`), the Express extractor its
// module/instance follower (`deepScan`), and Next/Python had nothing — three
// implementations of the same machine (bounded depth, cycle guard, memoization,
// scan merging), guaranteed to diverge. This module owns that machine once;
// framework extractors are CONFIGURATIONS of it, not re-implementations.
//
// Phase 1 shipped the extraction at byte-identity (ADR-054). Phase 2 (this
// state) CONVERGED the strategies: there is ONE walk (`followCalls`) and one
// memoized bundle builder (`classMethodBundle`); constructor-type DI is a
// RECEIVER KIND inside that walk (`this.<prop>.<m>()` where <prop> is a DI'd
// dependency), not a separate machine. Convergence is what enriches every
// framework at once: a Nest handler now also resolves instantiated services,
// imported module calls, and `this.<m>()` sibling dispatch — capabilities that
// used to belong to the Express path only. Gate: every fixture + corpus
// verdict and finding set identical to the pre-convergence baseline (effect
// counts may rise — that is the win).
import path from 'node:path';
import {
  parseModule,
  scanFunction,
  classInModule,
  baseClassOf,
  methodInClassChain,
  computeThisSymbols,
  resolveExportedFunction,
} from './extract.js';

export const MAX_RESOLVE_DEPTH = 6;

// merge one scan's findings into another — the single copy of the contract
// every follower shares.
export function mergeScan(into, add) {
  into.effects.push(...add.effects);
  into.returnShapes = [...(into.returnShapes ?? []), ...(add.returnShapes ?? [])];
  into.calls = [...(into.calls ?? []), ...(add.calls ?? [])];
  into.validatesInput = into.validatesInput || add.validatesInput;
  into.async = into.async || add.async;
  if (add.guardSignals?.deniesWithStatus) into.guardSignals.deniesWithStatus = true;
  // G1/G2 (advisory-only): a delegated service method that asserts caller-ownership, or refuses on
  // a credential check (throw/4xx/verify/redirect), carries that signal UP to the handler it is
  // reached from. Without this a Nest/DI refusal that lives one class away (`this.service.x()`) is
  // dropped at the merge and its route reads as a false critical — the first-run / admin-setup and
  // API-key families. These signals can only DOWNGRADE a critical to advisory, never prove.
  if (add.ownerAsserted) into.ownerAsserted = true;
  if (add.credentialSignals) {
    into.credentialSignals ??= {
      verifyCall: false,
      denies4xxOrThrows: false,
      redirects: false,
    };
    if (add.credentialSignals.verifyCall) into.credentialSignals.verifyCall = true;
    if (add.credentialSignals.denies4xxOrThrows)
      into.credentialSignals.denies4xxOrThrows = true;
    if (add.credentialSignals.redirects) into.credentialSignals.redirects = true;
  }
}

export const relOf = (cwd, abs) => path.relative(cwd, abs).split(path.sep).join('/');

// depth-first walk over an AST subtree, invoking fn on every node.
export function walkAst(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkAst(n, fn);
    return;
  }
  if (typeof node.type === 'string') fn(node);
  for (const k of Object.keys(node)) {
    if (
      k === 'loc' ||
      k === 'range' ||
      k === 'leadingComments' ||
      k === 'trailingComments'
    )
      continue;
    const v = node[k];
    if (v && typeof v === 'object') walkAst(v, fn);
  }
}

export function walkCalls(node, fn) {
  walkAst(node, (n) => {
    if (n.type === 'CallExpression') fn(n);
  });
}

// varName → { className, args } for every `const svc = new X(…)` (or `svc = new X(…)`)
// in the subtree — the raw material of instantiated-service resolution. `args` feeds
// the cross-class symbolic dataflow (a request-derived constructor arg → this.<field>).
function collectInstances(fnNode) {
  const map = new Map();
  walkAst(fnNode, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init?.type === 'NewExpression' &&
      node.init.callee.type === 'Identifier'
    )
      map.set(node.id.name, {
        className: node.init.callee.name,
        args: node.init.arguments,
      });
    else if (
      node.type === 'AssignmentExpression' &&
      node.left.type === 'Identifier' &&
      node.right?.type === 'NewExpression' &&
      node.right.callee.type === 'Identifier'
    )
      map.set(node.left.name, {
        className: node.right.callee.name,
        args: node.right.arguments,
      });
  });
  return map;
}

// One engine instance per extract run. `scannedFiles` and `helpers` are the
// extractor's own arrays — the engine appends to them as it discovers files and
// dead-path candidates, exactly like the code it replaced. Both memo caches
// live here, scoped to the run.
export function createResolver({ cwd, scannedFiles, helpers }) {
  const classBundles = new Map(); // memo: per (class file, class.method[, symbols])
  const rel = (abs) => relOf(cwd, abs);

  // ---- member-call following (imports, instantiated services, this/super) ----
  //
  // A handler's real effects = its own body PLUS every module-member call it makes,
  // followed recursively: `authController.register` → `userService.createUser` →
  // `User.create()`. This is the CommonJS analogue of the Nest DI hop — the effect is
  // usually two or three modules below the route, behind `service.method()` calls the
  // flat scanner can't see. Precomputed so translate uses it as-is.
  //
  // The same walk also resolves INSTANTIATED services — `const svc = new XService(…);
  // svc.readMany(…)` (directus and every class-service Express app) — through the
  // class's `extends` chain, including `this.<m>()` / `super.<m>()` hops inside the
  // resolved methods. `this.<m>()` dispatches from the INSTANTIATED class, so an
  // override (ActivityService.readByQuery) wins over the base method it shadows.
  function deepScan(fnNode, owningMod) {
    const base = scanFunction(fnNode);
    const merged = {
      ...base,
      effects: [...base.effects],
      returnShapes: [...(base.returnShapes ?? [])],
      calls: [...(base.calls ?? [])],
    };
    followCalls(fnNode, owningMod, merged, new Set(), 0, null, new Set());
    return merged;
  }

  // `seen` dedups sub-scans merged into THIS target; `stack` is the class-method
  // cycle guard and spans the whole recursion; `clsCtx` (top + declaring class) is
  // set while walking a class-method body so `this.` / `super.` calls resolve.
  function followCalls(fnNode, mod, merged, seen, depth, clsCtx, stack) {
    if (depth >= MAX_RESOLVE_DEPTH) return;
    const instances = collectInstances(fnNode);
    walkCalls(fnNode, (node) => {
      const callee = node.callee;
      // bare imported/local function call: `helper(args)`. The resolver historically only
      // followed `x.method()`, so an effect — or an ownership scope — inside a bare helper
      // (`getCustomerOrThrow({ workspaceId })`) was invisible: it capped taint, BOLA, and
      // coverage. Follow it too — resolve to a local function (`mod.functions`) or an
      // imported one (through barrel re-exports), scan + recurse, memoized via `seen`,
      // depth-bounded. Safe since E-042: a called helper's NAME can no longer fabricate a
      // guard, so following a helper named `mapUserAdmin` can't hide a real finding.
      if (callee.type === 'Identifier') {
        const name = callee.name;
        let fn = null;
        let fnMod = mod;
        const local = mod.functions.get(name);
        if (local) {
          fn = local.node;
        } else {
          const file = mod.imports.get(name);
          if (file) {
            const hit = resolveExportedFunction(parseModule(file), name);
            if (hit) {
              fn = hit.fn.node;
              fnMod = hit.mod;
            }
          }
        }
        if (fn) {
          const key = `bare:${fnMod._file ?? ''}#${name}`;
          if (!seen.has(key)) {
            seen.add(key);
            const fromRel = rel(fnMod._file ?? '');
            if (!scannedFiles.includes(fromRel)) scannedFiles.push(fromRel);
            // A bare helper contributes its EFFECTS (coverage, object-scope) but NEVER a
            // guard: it is NOT registered as a helper node, and its deny signal is stripped
            // before merge. A `throw 403` reached TRANSITIVELY through a bare call does not
            // gate the caller's route — attributing it would fabricate a guard (novu's
            // `assertIntegrationEnvironmentScope` gating a public register → a false PROVEN).
            // A route's real gate is a chain step or a DIRECTLY-resolved verifier, not any
            // denying function somewhere in its transitive closure. Effects merge; guards do not.
            const bare = scanFunction(fn);
            bare.guardSignals = { deniesWithStatus: false };
            mergeScan(merged, bare);
            followCalls(fn, fnMod, merged, seen, depth + 1, null, stack);
          }
        }
        return;
      }
      if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier')
        return;
      const method = callee.property.name;
      const obj = callee.object;

      // instantiated service: `svc.method()` where `const svc = new X(…)`,
      // or the direct `new X(…).method()` chain
      const inst =
        obj.type === 'Identifier' && instances.has(obj.name)
          ? instances.get(obj.name)
          : obj.type === 'NewExpression' && obj.callee.type === 'Identifier'
            ? { className: obj.callee.name, args: obj.arguments }
            : null;
      if (inst) {
        // cross-class symbolic dataflow: a request-derived constructor arg
        // (`new ItemsService(req.params.collection, …)`) binds `this.collection`
        // for every method of the instance.
        const thisSymbols = classThisSymbols(inst, mod, fnNode, clsCtx);
        const bundle = classBundle(
          inst.className,
          method,
          mod,
          depth,
          stack,
          thisSymbols,
        );
        if (bundle && !seen.has(bundle.key)) {
          seen.add(bundle.key);
          mergeScan(merged, bundle);
        }
        return;
      }

      // constructor-type DI: `this.<prop>.<m>()` where <prop> is a dependency in
      // the class's DI map (its own constructor params + every ancestor's, each
      // tagged with the module that declared it). The Nest hop, now one receiver
      // kind of the same walk — the dependency's class resolves like any other.
      if (
        clsCtx?.di &&
        obj.type === 'MemberExpression' &&
        obj.object.type === 'ThisExpression' &&
        obj.property.type === 'Identifier'
      ) {
        const dep = clsCtx.di[obj.property.name];
        if (!dep) return;
        const bundle = classBundle(dep.type, method, dep.mod, depth, stack, null);
        if (bundle && !seen.has(bundle.key)) {
          seen.add(bundle.key);
          mergeScan(merged, bundle);
        }
        return;
      }

      // inside a resolved class method: this.<m>() re-dispatches from the top
      // (instantiated) class; super.<m>() from the declaring class's base — both keep
      // the instance's symbolic bindings so this.<field> stays resolved across hops
      if (clsCtx && obj.type === 'ThisExpression') {
        const bundle = classMethodBundle(
          clsCtx.topCls,
          clsCtx.topMod,
          method,
          depth,
          stack,
          clsCtx.thisSymbols,
        );
        if (bundle && !seen.has(bundle.key)) {
          seen.add(bundle.key);
          mergeScan(merged, bundle);
        }
        return;
      }
      if (clsCtx && obj.type === 'Super') {
        const base = baseClassOf(clsCtx.declCls, clsCtx.declMod);
        const bundle = base
          ? classMethodBundle(
              base.cls,
              base.mod,
              method,
              depth,
              stack,
              clsCtx.thisSymbols,
            )
          : null;
        if (bundle && !seen.has(bundle.key)) {
          seen.add(bundle.key);
          mergeScan(merged, bundle);
        }
        return;
      }

      if (obj.type !== 'Identifier') return;
      const targetFile = mod.imports.get(obj.name);
      if (!targetFile) return;
      const targetMod = parseModule(targetFile);
      if (targetMod.error) return;
      const fn = targetMod.functions.get(method);
      if (!fn) return;
      const key = `${targetFile}#${method}`;
      if (seen.has(key)) return;
      seen.add(key);
      const fromRel = rel(targetFile);
      if (!scannedFiles.includes(fromRel)) scannedFiles.push(fromRel);
      helpers.push({
        name: `${obj.name}.${method}`,
        sourceFile: fromRel,
        sourceLine: fn.line,
        fn: fn.node,
      });
      mergeScan(merged, scanFunction(fn.node));
      followCalls(fn.node, targetMod, merged, seen, depth + 1, null, stack);
    });
  }

  // resolve `new X(args)` → X's `this.<field>` symbol bindings (or null if none of the
  // constructor args are request-derived). `clsCtx.thisSymbols` lets a nested
  // `new Y(this.collection)` inherit the outer instance's symbols.
  function classThisSymbols(inst, mod, callerFn, clsCtx) {
    const file = mod.imports.get(inst.className);
    const clsMod = file ? parseModule(file) : mod;
    if (clsMod.error) return null;
    const cls = classInModule(clsMod, inst.className);
    if (!cls) return null;
    const syms = computeThisSymbols(
      cls,
      clsMod,
      inst.args ?? [],
      callerFn,
      clsCtx?.thisSymbols,
    );
    return syms.size ? syms : null;
  }

  // `new X(…)` → class X (imported, or declared in the same module) → the
  // memoized bundle of X.<methodName>, carrying any symbolic this-bindings.
  function classBundle(className, methodName, mod, depth, stack, thisSymbols) {
    const file = mod.imports.get(className);
    const clsMod = file ? parseModule(file) : mod;
    if (clsMod.error) return null;
    const cls = classInModule(clsMod, className);
    if (!cls) return null;
    return classMethodBundle(cls, clsMod, methodName, depth, stack, thisSymbols);
  }

  // The fully-resolved scan of `<topCls>.<methodName>` — its body plus everything
  // reachable below it — memoized per (instantiated class, method) across the whole
  // extract, so a service method reached by N routes is resolved once (same
  // rationale as the DI-path bundleCache; twenty took 34s without it). A bundle is
  // computed with its OWN dedup set, so the memo never stores a partial.
  function classMethodBundle(topCls, topMod, methodName, depth, stack, thisSymbols) {
    if (depth >= MAX_RESOLVE_DEPTH) return null;
    const hit = methodInClassChain(topCls, topMod, methodName);
    if (!hit) return null;
    // the memo key includes the symbol binding, so a `:collection`-bound scan and a
    // plain scan of the same method never collide; an empty binding keeps the old key.
    const key = `${topMod._file ?? ''}#${topCls.id?.name ?? 'anonymous'}.${methodName}${symSig(thisSymbols)}`;
    const cached = classBundles.get(key);
    if (cached) return cached;
    if (stack.has(key)) return null; // reference cycle — contribute nothing, don't cache
    stack.add(key);
    const base = scanFunction(hit.fn, { thisSymbols });
    const bundle = {
      ...base,
      key,
      effects: [...base.effects],
      returnShapes: [...(base.returnShapes ?? [])],
      calls: [...(base.calls ?? [])],
    };
    const declRel = rel(hit.mod._file ?? '');
    if (!scannedFiles.includes(declRel)) scannedFiles.push(declRel);
    helpers.push({
      name: `${topCls.id?.name ?? 'anonymous'}.${methodName}`,
      sourceFile: declRel,
      sourceLine: hit.fn.loc?.start.line ?? 0,
      fn: hit.fn,
    });
    followCalls(
      hit.fn,
      hit.mod,
      bundle,
      new Set(),
      depth + 1,
      {
        topCls,
        topMod,
        declCls: hit.cls,
        declMod: hit.mod,
        thisSymbols,
        // di for the NEXT hop is the class's full dependency map (its own
        // constructor params + every ancestor's), each entry tagged with the
        // module that DECLARED it — an inherited repo type resolves against the
        // BASE class's imports, not the subclass's (the immich pattern).
        di: diMapWithMod(topCls, topMod),
      },
      stack,
    );
    stack.delete(key);
    classBundles.set(key, bundle);
    return bundle;
  }

  // A DI-framework handler (a @Controller/@Resolver class method) is just a class
  // method whose class we already know: its effects = its own body + everything the
  // one walk resolves below it — DI hops, instantiated services, imported module
  // calls, this.<m>() sibling dispatch. Real DI apps are DEEP (immich: controller →
  // service → repository → kysely, wiring often inherited), which is why the walk
  // is recursive, bounded, and memoized (E-027: twenty took 34s without the memo).
  function handlerScan(method, di, mod, cls) {
    const base = scanFunction(method); // the handler body itself
    const merged = {
      ...base,
      effects: [...base.effects],
      returnShapes: [...(base.returnShapes ?? [])],
      calls: [...(base.calls ?? [])],
    };
    followCalls(
      method,
      mod,
      merged,
      new Set(),
      0,
      { topCls: cls, topMod: mod, declCls: cls, declMod: mod, thisSymbols: null, di },
      new Set(),
    );
    return merged;
  }

  return { deepScan, handlerScan };
}

// a class's full DI map as { prop: { type, mod } }, merged UP the `extends` chain
// (base first so a subclass's own param wins). Each entry carries the module that
// declared it, because that is where its TYPE is imported.
export function diMapWithMod(cls, clsMod) {
  const chain = [];
  let curCls = cls;
  let curMod = clsMod;
  for (let depth = 0; curCls && depth < MAX_RESOLVE_DEPTH; depth++) {
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

function typeRefName(t) {
  if (!t) return null;
  if (t.type === 'TSTypeReference' && t.typeName?.type === 'Identifier')
    return t.typeName.name;
  return null;
}

// stable signature of a this-symbol binding for the bundle memo key. Empty string
// when there are no symbols, so symbol-free scans keep their original cache key.
function symSig(thisSymbols) {
  if (!thisSymbols || thisSymbols.size === 0) return '';
  return (
    '|' +
    [...thisSymbols.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join(',')
  );
}
