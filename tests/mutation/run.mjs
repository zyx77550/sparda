// tests/mutation/run.mjs — home-grown mutation testing (zero new dependency, fits the 4-dep
// ethos). The biological technique reproduced: DNA polymerase's coupled proofreading + natural
// selection. A test suite is only as good as its ability to KILL mutants — introduce a mutation
// into a critical invariant, run the test that should catch it, and require the test to FAIL. A
// mutant that SURVIVES (test still passes) is a hole in the suite: behavior with no guardian.
//
//   npm run mutation
//
// Each mutant targets a soundness- or correctness-critical line shipped recently. Add a mutant
// whenever you add such a line — that is the rule (verification COUPLED to the change).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => path.join(repo, p);

const MUTANTS = [
  {
    desc: 'llm-resolve: drop the structural verification (admit any hint)',
    file: 'src/ubg/llm-resolve.js',
    find: 'const denies = proveDeny(hint) === true;',
    repl: 'const denies = true;',
    test: 'tests/llm-resolve.test.js',
  },
  {
    desc: 'prisma: stop collecting .prisma files from the schema folder (E-046)',
    file: 'src/ubg/prisma.js',
    find: "else if (e.name.endsWith('.prisma')) files.push(p);",
    repl: 'else if (false) files.push(p);',
    test: 'tests/prisma-folder.test.js',
  },
  {
    desc: 'apocalypse: never infer the direct-owner ownership model (BolaRay)',
    file: 'src/ubg/apocalypse.js',
    find: "if (direct) return { model: 'direct-owner', key: direct };",
    repl: "if (false) return { model: 'direct-owner', key: direct };",
    test: 'tests/prisma-folder.test.js',
  },
  {
    desc: 'apocalypse: a collapsed flood silently becomes advisory (would hide a danger)',
    file: 'src/ubg/apocalypse.js',
    find: 'const anyHard = list.some((f) => !f.advisory);',
    repl: 'const anyHard = false;',
    test: 'tests/flood-collapse.test.js',
  },
  {
    desc: 'stitch: stop excluding a service from stitching to itself (phantom self-calls)',
    file: 'src/ubg/stitch.js',
    find: 'if (c.service === svc.name) continue; // never stitch a service to itself',
    repl: 'if (false) continue; // never stitch a service to itself',
    test: 'tests/stitch.test.js',
  },
  {
    desc: 'apocalypse: drop the E-047 blind-spot rung (bare PROVEN over high blind spots)',
    file: 'src/ubg/apocalypse.js',
    find: 'blindHigh > 0 ||',
    repl: 'false ||',
    test: 'tests/verdict-partial.test.js',
  },
  {
    desc: 'extract: disable workspace-package resolution (E-048 cross-package writes blind)',
    file: 'src/ubg/extract.js',
    find: 'const map = workspacePackages(fromFile);',
    repl: 'const map = null;',
    test: 'tests/workspace-resolve.test.js',
  },
  {
    desc: 'prisma: stop resolving a shared workspace schema (P4 state layer blind)',
    file: 'src/ubg/prisma.js',
    find: ': workspaceSchemaFiles(cwd, candidates, SCHEMA_DIR_CANDIDATES);',
    repl: ': [];',
    test: 'tests/workspace-resolve.test.js',
  },
  {
    desc: 'extract: stop recognizing a call-site ownership assertion (G1 false BOLA returns)',
    file: 'src/ubg/extract.js',
    find: 'if (callAssertsOwnership(node)) out.ownerAsserted = true;',
    repl: 'if (false) out.ownerAsserted = true;',
    test: 'tests/g1-ownership-assert.test.js',
  },
  {
    desc: 'apocalypse: treat any credential family as gated even with no refusal shape (G2)',
    file: 'src/ubg/apocalypse.js',
    find: 'family !== null && (credGates || (callbackish && credRedirects));',
    repl: 'family !== null && true;',
    test: 'tests/g2-credential-gate.test.js',
  },
  {
    desc: 'apocalypse: proof object claims a guardless mutation as discharged (fake proof)',
    file: 'src/ubg/apocalypse.js',
    find: 'if (!writes.length || !guards.length) continue;',
    repl: 'if (!writes.length) continue;',
    test: 'tests/proof-objects.test.js',
  },
  {
    desc: 'extract: stop seeing a named-refusal helper (API-key/first-run refusal goes blind)',
    file: 'src/ubg/extract.js',
    find: '    out.credentialSignals.denies4xxOrThrows = true;\n\n  // ---- local calls',
    repl: '    void 0;\n\n  // ---- local calls',
    test: 'tests/g2-credential-gate.test.js',
  },
  {
    desc: 'state-min: drop the advisory body signals when a delegator is merged (false critical returns)',
    file: 'src/ubg/passes/state-minimization.js',
    find: '    if (b.meta[k]) a.meta[k] = true;',
    repl: '    if (false) a.meta[k] = true;',
    // Direct unit test of the merge propagation — bites the line regardless of resolution path.
    // (The g2 end-to-end fixture now carries the same signal by a second path once inline handlers
    // are deep-scanned, so it no longer uniquely depends on this line — ADR-061.)
    test: 'tests/state-min-signals.test.js',
  },
  {
    desc: 'apocalypse: re-label a NON-public route as public-by-design (Class 1 blanket, hides holes)',
    file: 'src/ubg/apocalypse.js',
    find: 'const softened = credentialGated || expectedPublic;',
    repl: 'const softened = credentialGated || true;',
    test: 'tests/g2-credential-gate.test.js',
  },
  {
    desc: 'apocalypse: stop flagging a mutation that runs before its guard (C2 false PROVEN returns)',
    file: 'src/ubg/apocalypse.js',
    find: 'guards.length > 0 ? writes.filter((w) => w.effect.meta.bypassesGuard) : [];',
    repl: '[];',
    test: 'tests/guard-dominance.test.js',
  },
  {
    desc: 'extract: never mark a mutation as running before its guard (guard-dominance goes blind)',
    file: 'src/ubg/extract.js',
    find: 'if (result.hasInBodyGuard && e._unguardedPath) e.bypassesGuard = true;',
    repl: 'if (false) e.bypassesGuard = true;',
    test: 'tests/guard-dominance.test.js',
  },
  {
    desc: 'nextjs: stop extracting server actions (C3 blind spot — unguarded actions go invisible)',
    file: 'src/ubg/nextjs.js',
    find: 'parseServerActions(abs);',
    repl: 'void abs;',
    test: 'tests/server-actions.test.js',
  },
  {
    desc: 'fastapi_extract: stop recognizing Flask @app.route (Flask routes disappear)',
    file: 'src/ubg/fastapi_extract.py',
    find: 'if attr == "route":',
    repl: 'if False:',
    test: 'tests/flask.test.js',
  },
  {
    desc: 'fastapi_extract: stop extracting Flask class-based views (CBV mutations go invisible)',
    file: 'src/ubg/fastapi_extract.py',
    find: 'self.collect_cbv(node.value, abs_file, prefix, modctx, rel_file,',
    repl: 'None and self.collect_cbv(node.value, abs_file, prefix, modctx, rel_file,',
    test: 'tests/flask-cbv.test.js',
  },
  {
    desc: 'translate: credit a scoped Next middleware on paths its matcher excludes (false PROVEN on /api)',
    file: 'src/ubg/translate.js',
    find: 'globalMiddlewares.filter((mw) => middlewareAppliesTo(mw, route))',
    repl: 'globalMiddlewares',
    test: 'tests/nextjs-matcher.test.js',
  },
  {
    desc: 'nestjs: stop reading principal-injection param decorators (twenty auth goes invisible again, ADR-063)',
    file: 'src/ubg/nestjs.js',
    find: 'const principalGuards = paramAuthGuards(m, mod).filter(',
    repl: 'const principalGuards = [].filter(',
    test: 'tests/param-auth-decorator.test.js',
  },
  {
    desc: 'extract: stop following request taint through destructuring (proof-grade O2 goes blind, ADR-064)',
    file: 'src/ubg/extract.js',
    find: 'if (key && local) map.set(local, `:${key}`);',
    repl: 'if (key && local) void 0;',
    test: 'tests/taint-flow.test.js',
  },
  {
    desc: 'strapi: stop unrolling createCoreRouter (the dominant CRUD idiom goes invisible, ADR-065)',
    file: 'src/ubg/strapi.js',
    find: 'const coreUid = coreRouterUid(exported);',
    repl: 'const coreUid = null;',
    test: 'tests/strapi.test.js',
  },
  {
    desc: 'strapi: give an auth:false public route the default-auth guard (hides an unguarded public mutation, ADR-065)',
    file: 'src/ubg/strapi.js',
    find: '      !r.authOptOut &&',
    repl: '      true &&',
    test: 'tests/strapi.test.js',
  },
  {
    desc: 'resolve: stop seeding taint across a helper-call boundary (interprocedural taint goes blind, ADR-066)',
    file: 'src/ubg/resolve.js',
    find: 'const calleeSeed = seedTaint(fn, node.arguments, callerReq);',
    repl: 'const calleeSeed = null;',
    test: 'tests/taint-flow.test.js',
  },
  {
    desc: 'extract: stop treating an unknown method on a proven DB handle as a write (opaque write goes invisible, ADR-068)',
    file: 'src/ubg/extract.js',
    find: '    handleReceiver &&',
    repl: '    false &&',
    test: 'tests/opaque-write.test.js',
  },
  {
    desc: 'apocalypse: stop counting an opaque persistence write toward the guard obligation (hidden hole, ADR-068)',
    file: 'src/ubg/apocalypse.js',
    find: "if (n.meta.opaque && n.meta.effectType === 'db_write' && outs.length === 0)",
    repl: 'if (false)',
    test: 'tests/opaque-write.test.js',
  },
  {
    desc: 'extract: verify express-jwt even with credentialsRequired:false (over-verifies a guard that passes anyone → false PROVEN, ADR-069)',
    file: 'src/ubg/extract.js',
    find: "return !objectOptionIsFalse(node.arguments[0], 'credentialsRequired');",
    repl: 'return true;',
    test: 'tests/auth-catalog.test.js',
  },
  {
    desc: 'apocalypse: let an asserted-only-guarded mutation still read PROVEN (the type-lock goes cosmetic → false PROVEN, ADR-070)',
    file: 'src/ubg/apocalypse.js',
    find: 'if (!guards.some((n) => n.meta.verified === true))',
    repl: 'if (false)',
    test: 'tests/type-lock.test.js',
  },
  {
    desc: 'nestjs: verify a passport subclass even when it overrides handleRequest (may swallow the 401 → false PROVEN, ADR-071)',
    file: 'src/ubg/nestjs.js',
    find: 'return !overridesDeny;',
    repl: 'return true;',
    test: 'tests/nest-passport.test.js',
  },
  {
    desc: 'apocalypse: hard-flag every observable incl. a generic fetch (autoimmunity → the O4 wolf-cry returns, ADR-072)',
    file: 'src/ubg/apocalypse.js',
    find: "const knownDangerous = String(obs.meta.target ?? '').startsWith('sdk:');",
    repl: 'const knownDangerous = true;',
    test: 'tests/immune-observable.test.js',
  },
  {
    desc: 'extract: stop reading the named status constant FORBIDDEN/UNAUTHORIZED as a deny (ADR-073)',
    file: 'src/ubg/extract.js',
    find: "(a.property.name === 'FORBIDDEN' || a.property.name === 'UNAUTHORIZED'));",
    repl: 'false);',
    test: 'tests/nest-status-const.test.js',
  },
  {
    desc: 'extract: drop the identity gate on the ownership-witness verifier — a req.body spoof-compare would clear a real BOLA (false discharge, ADR-074)',
    file: 'src/ubg/extract.js',
    find: "if (valueIsIdentity(b.right) && b.left?.type === 'MemberExpression') owns = true;",
    repl: "if (true && b.left?.type === 'MemberExpression') owns = true;",
    test: 'tests/bola-witness.test.js',
  },
  {
    desc: 'extract: drop the call-site identity gate on the INTERPROCEDURAL witness — every arg reads as identity, so a req.body spoof handed to a helper would clear a real BOLA (ADR-074 V2)',
    file: 'src/ubg/extract.js',
    find: 'if (valueIsIdentity(arg)) identityParams.add(name);',
    repl: 'if (true) identityParams.add(name);',
    test: 'tests/bola-witness-helper.test.js',
  },
  {
    desc: 'extract: drop the deny requirement on the interprocedural witness helper body — a helper that only LOGS the mismatch would clear a real BOLA (ADR-074 V2)',
    file: 'src/ubg/extract.js',
    find: "if (node.type !== 'IfStatement' || !branchDenies(node.consequent)) return;",
    repl: "if (node.type !== 'IfStatement') return;",
    test: 'tests/bola-witness-helper.test.js',
  },
  {
    desc: 'witness: admit every generator hint without re-proving it (trust the LLM → a fabricated location clears a real BOLA, ADR-074 generator)',
    file: 'src/ubg/witness.js',
    find: 'const check = verifyWitnessAt(appDir, hint.file, hint.line);',
    repl: "const check = { verified: true, via: 'inline-compare' };",
    test: 'tests/witness.test.js',
  },
  {
    desc: 'witness: drop the attribution tether — a real check the route never reaches clears its advisory (ADR-074 generator)',
    file: 'src/ubg/witness.js',
    find: 'if (hintAbs === epAbs) return true;',
    repl: 'if (true) return true;',
    test: 'tests/witness.test.js',
  },
  {
    desc: 'enforce: dissolve the court — an edit that cannot prove itself persists anyway (a counterfeit check buys green, ADR-076)',
    file: 'src/commands/enforce.js',
    find: "if (after.state !== 'PROVEN' || stillAsserted > 0 || grewFindings) {",
    repl: 'if (false) {',
    test: 'tests/enforce.test.js',
  },
  {
    desc: 'enforce: the synthesized shim stops denying — the court must refuse it, so PARTIAL never turns PROVEN (ADR-076)',
    file: 'src/commands/enforce.js',
    find: "body ??\n      `  if (!${principal}) return res.status(401).json({ error: 'unauthorized' });`,",
    repl: 'body ?? `  void ${principal};`,',
    test: 'tests/enforce.test.js',
  },
  {
    desc: 'enforce: disclosure stops following the bytes — a hand-stripped shim still reads as ENFORCED (ADR-076)',
    file: 'src/commands/enforce.js',
    find: 'if (sha(cur) !== rec.enforcedSha256 || !cur.includes(MARK_START)) return null;',
    repl: 'if (false) return null;',
    test: 'tests/enforce.test.js',
  },
  {
    desc: 'falsify: ablate by DELETION instead of contraction — the handler goes unreachable and "clean" masquerades as flipped-check passing (ADR-077)',
    file: 'src/ubg/falsify.js',
    find: "bridged.push({ from: p.from, to: s.to, kind: 'control_flow', meta: p.meta });",
    repl: 'void s;',
    test: 'tests/falsify.test.js',
  },
  {
    desc: 'falsify: report every control as flipped without consulting the verifier — a blind checker would pass its own audit (ADR-077)',
    file: 'src/ubg/falsify.js',
    find: 'flipped: after.has(t.id) && !before.has(t.id),',
    repl: 'flipped: true,',
    test: 'tests/falsify.test.js',
  },
  {
    desc: 'falsify: stop unfolding the flood-collapsed row — every real-world flip goes invisible and healthy apps read as full of holes (ADR-077)',
    file: 'src/ubg/falsify.js',
    find: 'for (const ep of f.evidence ?? []) set.add(ep);',
    repl: ';',
    test: 'tests/falsify.test.js',
  },
  {
    desc: 'translate: ignore declaration order — a use(auth) declared AFTER a route guards it again (E-061 false PROVEN)',
    file: 'src/ubg/translate.js',
    find: 'if (mw.order > route.order) return false;',
    repl: '',
    test: 'tests/sequential-order.test.js',
  },
  {
    desc: 'express: flatten if-branches as unconditional again — a conditional surface reads 100% active (E-062)',
    file: 'src/ubg/express.js',
    find: "case 'IfStatement':\n        push(blockOf(s.consequent), depth, true);\n        push(blockOf(s.alternate), depth, true);",
    repl: "case 'IfStatement':\n        push(blockOf(s.consequent), depth, conditional);\n        push(blockOf(s.alternate), depth, conditional);",
    test: 'tests/conditional-surface.test.js',
  },
  {
    desc: 'blindspots: 0/0 coverage reads 100% again — the absence of a measurement becomes a perfect score (E-064)',
    file: 'src/ubg/blindspots.js',
    find: 'ratio: denom === 0 ? null : Math.round((resolved / denom) * 1000) / 1000,',
    repl: 'ratio: denom === 0 ? 1 : Math.round((resolved / denom) * 1000) / 1000,',
    test: 'tests/coverage-unknown.test.js',
  },
  {
    desc: 'express: silence dynamic registrations again — app[v](…) vanishes without an UnknownHandler (E-063)',
    file: 'src/ubg/express.js',
    find: "unknownRegistration('computed-method', callee.object.name, expr);",
    repl: ';',
    test: 'tests/dynamic-registration.test.js',
  },
  {
    desc: 'express: forget app.all — an unguarded all-verb endpoint goes invisible again (Z1 false PROVEN)',
    file: 'src/ubg/express.js',
    find: "        if (method === 'all') {",
    repl: "        if (false && method === 'all') {",
    test: 'tests/zero-day-verbs.test.js',
  },
  {
    desc: 'express: forget the chainable Route API — app.route().post() vanishes again (Z1)',
    file: 'src/ubg/express.js',
    find: 'const routeChain = routeChainOf(expr, appVars, routerVars);',
    repl: 'const routeChain = null;',
    test: 'tests/zero-day-verbs.test.js',
  },
  {
    desc: 'express: drop an unmodelled member silently instead of declaring it (kills the structural invariant)',
    file: 'src/ubg/express.js',
    find: 'unknownRegistration(`unmodelled-member:${method}`, objName, expr);',
    repl: ';',
    test: 'tests/registration-invariant.test.js',
  },
  {
    desc: 'express: stop following app/router aliases — const api = app hides its routes again (Z2)',
    file: 'src/ubg/express.js',
    find: "    if (d.init.type === 'Identifier') {",
    repl: "    if (false && d.init.type === 'Identifier') {",
    test: 'tests/zero-day-alias.test.js',
  },
  {
    desc: 'blindspots: score a lost file medium again — a parse error stops barring PROVEN (Z3)',
    file: 'src/ubg/blindspots.js',
    find: "isFatalSkip(reason) ? 'high' : MUTATING_VERB.test(reason) ? 'high' : 'medium'",
    repl: "MUTATING_VERB.test(reason) ? 'high' : 'medium'",
    test: 'tests/zero-day-effects.test.js',
  },
  {
    desc: 'extract: bail out on a computed member again — prisma.note[OP]() stops being a write (Z4)',
    file: 'src/ubg/extract.js',
    find: '  if (dynamicMember) {\n    opaqueDynamicWrite(node, out, ctx, callee, line);',
    repl: '  if (false) {\n    opaqueDynamicWrite(node, out, ctx, callee, line);',
    test: 'tests/zero-day-effects.test.js',
  },
  {
    desc: 'translate: credit a path-scoped middleware everywhere — the Express matcher sin returns (Z6)',
    file: 'src/ubg/translate.js',
    find: 'if (mw.pathPrefix && !pathCoveredBy(mw.pathPrefix, route.path)) return false;',
    repl: '',
    test: 'tests/zero-day-effects.test.js',
  },
  {
    desc: 'express: treat a pathed callable as middleware only — a terminal handler at a path vanishes again (C3)',
    file: 'src/ubg/express.js',
    find: "        if (role === 'handler') {",
    repl: '        if (false) {',
    test: 'tests/zero-day-pathed-handler.test.js',
  },
  {
    desc: 'express: call next() detection always true — every pathed handler is misread as middleware (C3)',
    file: 'src/ubg/express.js',
    find: '  if (!nextParam) return false;',
    repl: '  if (!nextParam) return true;',
    test: 'tests/zero-day-pathed-handler.test.js',
  },
  {
    desc: 'express: read a local function as an unresolved router mount again (loses the callable entirely)',
    file: 'src/ubg/express.js',
    find: '    if (mod.functions?.has(arg.name)) return undefined;',
    repl: '    if (false) return undefined;',
    test: 'tests/zero-day-pathed-handler.test.js',
  },
  {
    desc: 'extract: drop optional-chained calls again — prisma?.note?.deleteMany() goes invisible',
    file: 'src/ubg/extract.js',
    find: "  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {",
    repl: "  if (node.type === 'CallExpression') {",
    test: 'tests/dynamic-effects.test.js',
  },
  {
    desc: 'extract: stop reading tagged-template SQL — prisma.$executeRaw`DELETE …` goes invisible',
    file: 'src/ubg/extract.js',
    find: '    taggedTemplateEffect(node, out, ctx);',
    repl: '    void node;',
    test: 'tests/dynamic-effects.test.js',
  },
  {
    desc: 'extract: ignore a proven handle hiding in an unnameable receiver ((a?b:c).wipe() goes invisible)',
    file: 'src/ubg/extract.js',
    find: '  const root = rootIdentifier(callee) ?? handleInSubtree(callee, ctx.dbHandles);',
    repl: '  const root = rootIdentifier(callee);',
    test: 'tests/dynamic-effects.test.js',
  },
  {
    desc: 'translate: ignore intra-file order — a router.use(auth) at the bottom guards the routes above it',
    file: 'src/ubg/translate.js',
    find: '      mw.orderIn > route.orderIn',
    repl: '      false',
    test: 'tests/router-use-order.test.js',
  },
  {
    desc: 'nestjs: forget @All again — an unguarded all-verb Nest endpoint goes invisible (the Nest twin of E-067)',
    file: 'src/ubg/nestjs.js',
    find: "const verbs = http.method === 'all' ? NEST_ALL_EXPANSION : [http.method];",
    repl: 'const verbs = [http.method];',
    test: 'tests/cross-framework-verbs.test.js',
  },
  {
    desc: 'translate: read every non-GET verb as a mutation — CORS pre-flight handlers become false criticals',
    file: 'src/ubg/translate.js',
    find: 'mutating: !SAFE_METHOD.has(route.method.toLowerCase()),',
    repl: "mutating: route.method !== 'get',",
    test: 'tests/cross-framework-verbs.test.js',
  },
  {
    desc: 'nestjs: silently mount a dynamic decorator path at the prefix instead of declaring it',
    file: 'src/ubg/nestjs.js',
    find: '          if (http.pathDynamic) {',
    repl: '          if (false) {',
    test: 'tests/cross-framework-verbs.test.js',
  },
  {
    desc: 'apocalypse: let a measured premise gap keep the PROVEN word (the oracle stops gating)',
    file: 'src/ubg/apocalypse.js',
    find: '  const premiseUnverified = premiseGaps > 0;',
    repl: '  const premiseUnverified = false;',
    test: 'tests/premise-gate.test.js',
  },
  {
    desc: 'premise: treat an empty probe as a clean bill of health (a broken oracle would confirm every proof)',
    file: 'src/ubg/premise.js',
    find: '  if (!Array.isArray(probed) || probed.length === 0)',
    repl: '  if (false)',
    test: 'tests/premise-gate.test.js',
  },
  {
    desc: 'nextjs: stop declaring the handlers under an inexpressible segment (the subtree vanishes again)',
    file: 'src/ubg/nextjs.js',
    find: '          declareUnrouted(abs, `under catch-all segment ${name}`);',
    repl: '          if (false) declareUnrouted(abs, `under catch-all segment ${name}`);',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'nextjs: swallow an unparseable global middleware (every route below reads ungated, silently)',
    file: 'src/ubg/nextjs.js',
    find: '    if (mod.error) {\n      // The middleware file IS',
    repl: '    if (false) {\n      // The middleware file IS',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'medusa: drop a verb export whose handler did not resolve (a served route leaves no trace)',
    file: 'src/ubg/medusa.js',
    find: '      if (!fn) {',
    repl: '      if (!fn) {\n        continue;',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'strapi: stop declaring a route whose controller never resolved (an unread mutation reads resolved)',
    file: 'src/ubg/strapi.js',
    find: '        if (!controllerFn && def.handler && !def.defaultVerb) {',
    repl: '        if (false) {',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'openapi: skip a path-item member the lowering does not model (published surface disappears)',
    file: 'src/ubg/openapi.js',
    find: "      if (VERBS.has(key) || NON_OPERATION.has(key) || key.startsWith('x-')) continue;",
    repl: '      if (true) continue;',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    desc: 'fastapi: drop a decorator whose path is not a literal (a live endpoint leaves no trace)',
    file: 'src/ubg/fastapi_extract.py',
    find: '            if not isinstance(raw_path, str):',
    repl: '            if not isinstance(raw_path, str) and False:',
    test: 'tests/registration-invariant-fleet.test.js',
  },
  {
    // anti-vacuity: an enumerator that quietly stops matching turns the whole fleet
    // certificate green by finding nothing to check. The corpus-total guard must bite.
    desc: 'the fleet certificate: blind one of its independent enumerators (a sweep that finds nothing passes)',
    file: 'tests/no-silent-loss-fleet.test.js',
    find: 'const CLASS_DECORATOR = /(^|[a-z])Controller$|^Resolver$/;',
    repl: 'const CLASS_DECORATOR = /^__never__$/;',
    test: 'tests/no-silent-loss-fleet.test.js',
  },
  {
    desc: 'oracle-static: stop enumerating the Pages Router (a whole second routing system goes unclaimed)',
    file: 'src/ubg/oracle-static.js',
    find: '  const pagesRoutes = pagesApiRoutes(cwd);',
    repl: '  const pagesRoutes = [];',
    test: 'tests/premise-convention.test.js',
  },
  {
    desc: 'premise: read an empty convention enumeration as verified (a silent oracle confirms every proof)',
    file: 'src/ubg/premise.js',
    find: '  if (candidate.length === 0)',
    repl: '  if (false)',
    test: 'tests/premise-convention.test.js',
  },
  {
    desc: 'premise: stop suppressing already-declared surface (every unknown handler double-counts as a gap)',
    file: 'src/ubg/premise.js',
    find: '  const candidate = oracle.routes.filter(\n    (r) => !declared.has(`${r.file}::${r.method.toUpperCase()}`),\n  );',
    repl: '  const candidate = oracle.routes;',
    test: 'tests/premise-convention.test.js',
  },
  {
    desc: 'nextjs: filter `app/dist` as build output again — a served URL segment goes invisible on all three channels',
    file: 'src/ubg/nextjs.js',
    find: "const EXCLUDE = new Set(['node_modules', '.git', '.next', '.sparda']);",
    repl: "const EXCLUDE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.sparda']);",
    test: 'tests/premise-convention.test.js',
  },
  {
    desc: 'apocalypse: unplug the premise from the CI gate (a tree with unseen routes ships again)',
    file: 'src/commands/apocalypse.js',
    find: '    premiseGaps: premise.available ? premise.gaps.length : 0,',
    repl: '    premiseGaps: 0,',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'badge: render a premise gap as a finding count again ("0 findings" on the public artifact)',
    file: 'src/ubg/apocalypse.js',
    find: "          ? 'premise not verified'",
    repl: '          ? `${c.critical + c.high} findings`',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'review: grade the graph and ignore the candidate report (declared surface vanishes from the PR gate)',
    file: 'src/commands/review.js',
    find: '    candidateReport ? withPremiseGaps(candidateReport, premise) : undefined,',
    repl: '    undefined,',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'premise: let the shared helper skip the convention oracle (every gate silently stops asking)',
    file: 'src/ubg/premise.js',
    find: '    FREE_ORACLE.has(report.framework) || (probe && PROBEABLE.has(report.framework));',
    repl: '    probe && PROBEABLE.has(report.framework);',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'stdio: the MCP tool grades without the premise again (the agent gets a word the CLI would refuse)',
    file: 'src/server/stdio.js',
    find: '    premiseGaps: premise.available ? premise.gaps.length : 0,\n  });\n  return {\n    verdict: verdictState(verdict),',
    repl: '  });\n  return {\n    verdict: verdictState(verdict),',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'corpus-oracle: grade the giants with no premise check (the pre-ADR-083 state that let a PROVEN stand on unseen surface)',
    file: 'scripts/corpus-oracle.mjs',
    find: '  const premise = await premiseFor(g, report, { cwd: appDir });',
    repl: '  const premise = { available: false, gaps: [], probed: 0 };',
    test: 'tests/premise-wired-everywhere.test.js',
  },
  {
    desc: 'nestjs: stop resolving composite decorators (340 novu guards go back to name-only trust, ADR-084)',
    file: 'src/ubg/nestjs.js',
    find: '      const c = resolveCompositeDecorator(name, mod, compositeCache);',
    repl: '      const c = null;',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: resolve a composite against the CONTROLLER instead of its declaring module (renames, proves nothing)',
    file: 'src/ubg/nestjs.js',
    find: '      for (const g of c.guards) push(g, c.mod ?? mod);',
    repl: '      for (const g of c.guards) push(g, mod);',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: drop a SetMetadata tag even when a PROVEN global guard reads it (deletes immich auth)',
    file: 'src/ubg/nestjs.js',
    find: '      if (c.metadataOnly && !globalGuardDenies) {',
    repl: '      if (c.metadataOnly) {',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: swallow the unread branch of a conditional composite (a claim about a config nobody opened)',
    file: 'src/ubg/nestjs.js',
    find: '      unread.push(shortSrc(ret));\n    }\n    if (!sawReadable',
    repl: '      void shortSrc(ret);\n    }\n    if (!sawReadable',
    test: 'tests/nest-composite-decorators.test.js',
  },
  {
    desc: 'nestjs: stop following a barrel re-export (a whole workspace package of decorators goes unread)',
    file: 'src/ubg/nestjs.js',
    find: '      for (const star of dmod.starReexports ?? []) {',
    repl: '      for (const star of []) {',
    test: 'tests/nest-composite-decorators.test.js',
  },
];

const survived = [];
for (const m of MUTANTS) {
  const abs = f(m.file);
  const orig = fs.readFileSync(abs, 'utf8');
  if (!orig.includes(m.find)) {
    console.log(`⚠ target moved — ${m.desc}`);
    survived.push(`${m.desc} (mutation target not found — update the harness)`);
    continue;
  }
  fs.writeFileSync(abs, orig.replace(m.find, m.repl));
  let killed = false;
  try {
    execFileSync('npx', ['vitest', 'run', m.test], { cwd: repo, stdio: 'ignore' });
  } catch {
    killed = true; // the test FAILED under mutation → mutant killed (good)
  } finally {
    fs.writeFileSync(abs, orig); // ALWAYS restore, even on crash
  }
  console.log(killed ? `✓ killed   — ${m.desc}` : `✗ SURVIVED — ${m.desc}`);
  if (!killed) survived.push(m.desc);
}

if (survived.length) {
  console.error(
    `\n✗ ${survived.length}/${MUTANTS.length} mutant(s) SURVIVED — a guarded line has no test that bites:`,
  );
  for (const s of survived) console.error(`    - ${s}`);
  process.exit(1);
}
console.log(`\n✓ all ${MUTANTS.length} mutants killed — the guardian tests bite.`);
