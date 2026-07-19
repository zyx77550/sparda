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
    find: '((coverage != null && coverage < COVERAGE_COMPLETE) || blindHigh > 0)',
    repl: '(coverage != null && coverage < COVERAGE_COMPLETE)',
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
    test: 'tests/g2-credential-gate.test.js',
  },
  {
    desc: 'apocalypse: re-label a NON-public route as public-by-design (Class 1 blanket, hides holes)',
    file: 'src/ubg/apocalypse.js',
    find: 'const softened = credentialGated || expectedPublic;',
    repl: 'const softened = credentialGated || true;',
    test: 'tests/g2-credential-gate.test.js',
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
