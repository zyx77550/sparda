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
