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
    find: 'globalMiddlewares.filter((mw) =>\n    middlewareAppliesTo(mw, route.path),\n  )',
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
    find: '    ctx.dbHandles.has(callee.object.name) &&',
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
    find: 'if (!guards.some((n) => n.meta.verified === true)) count++; // guarded, but by trust only',
    repl: 'if (false) count++; // guarded, but by trust only',
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
