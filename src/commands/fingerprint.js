// commands/fingerprint.js — print the portable behavior fingerprint of each
// entrypoint (ADR-035, Brick 1). The hash is coordinate-free: the SAME behavioral
// shape in any other repo produces the SAME hash. This is the address a shared
// diagnosis (an antibody) is filed under — the seam where a local proof becomes
// collective memory. Read-only, offline, deterministic.
//   sparda fingerprint          human table
//   sparda fingerprint --json   raw [{ entrypoint, behaviorHash, descriptor }]
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { fingerprintGraph } from '../ubg/fingerprint.js';

export async function runFingerprint(opts) {
  const canonical = canonicalizeGraph(
    compileUBG(opts.cwd, { write: false, openapi: opts.openapi }).graph,
  );
  const prints = fingerprintGraph(canonical);

  if (opts.json) {
    console.log(JSON.stringify(prints, null, 2));
    return { prints };
  }

  if (!prints.length) {
    // Same honesty rule as apocalypse: nothing to address is not a success.
    console.log(
      '✗ NO FINGERPRINT — 0 routes reached. SPARDA could not see this app’s surface (a parser-coverage gap); there is nothing to address.',
    );
    process.exitCode = 1;
    return { prints };
  }

  console.log(`BEHAVIOR FINGERPRINTS — ${prints.length} entrypoint(s), coordinate-free`);
  for (const p of prints) {
    const d = p.descriptor;
    const parts = [
      `${d.guards} guard${d.guards === 1 ? '' : 's'}`,
      d.validated ? 'validated' : 'unvalidated',
      d.effects.length ? d.effects.join(',') : 'no effects',
    ];
    if (d.observable) parts.push('observable');
    console.log(`  ${p.behaviorHash}  ${short(p.entrypoint)}`);
    console.log(`      ${parts.join(' · ')}`);
  }
  return { prints };
}

const short = (id) => id.replace(/^entrypoint:/, '');
