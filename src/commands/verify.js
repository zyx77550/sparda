// commands/verify.js — prove the compiler's own laws on THIS project.
// Runs the SBIR compiler-law audit and reports each check. Exit code 1 if any
// law fails: run it in CI to guarantee the graph your tools trust was built
// under determinism and soundness — not just asserted to be.
//   sparda verify                 audit the detected app
//   sparda verify --openapi s.json   audit an OpenAPI-lowered backend
import { verifyProject } from '../ubg/verify.js';

export async function runVerify(opts) {
  const { checks, passed, total, ok } = verifyProject(opts.cwd, {
    openapi: opts.openapi ?? null,
  });

  console.log(`VERIFY — SBIR compiler laws on this project (${passed}/${total} checks)`);
  let lastLaw = null;
  for (const c of checks) {
    if (c.law !== lastLaw) {
      console.log(`  ${c.law}`);
      lastLaw = c.law;
    }
    console.log(
      `    ${c.pass ? '✓' : '✗'} ${c.name}${c.pass || !c.detail ? '' : ` — ${c.detail}`}`,
    );
  }
  if (ok) {
    console.log(
      '✓ PROVEN — every compiler law holds on this input. The graph is trustworthy.',
    );
  } else {
    console.log(
      '✗ LAW VIOLATED — the compiler broke its own contract on this input. This is a bug; please open an issue.',
    );
    process.exitCode = 1;
  }
  return { ok, checks };
}
