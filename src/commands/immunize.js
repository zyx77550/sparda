// commands/immunize.js — freeze the app's proven safety into a tiny capsule (ADR-037).
// The expensive reasoning (compile → obligations → polarity → behaviorHash) runs
// ONCE here; the output is a self-contained artifact of a few bytes per route that
// any consumer — CI, an agent, the runtime, another SPARDA install — reads by pure
// lookup, no recompile, no LLM, no network. BitNet's move applied to trust.
//   sparda immunize          write .sparda/immunity.json + a summary
//   sparda immunize --json   print the capsule to stdout
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { buildCapsule } from '../ubg/immunity.js';
import { AXES } from '../ubg/polarity.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

export async function runImmunize(opts) {
  const canonical = canonicalizeGraph(
    compileUBG(opts.cwd, { write: false, openapi: opts.openapi }).graph,
  );
  const capsule = buildCapsule(canonical);

  if (opts.json) {
    console.log(JSON.stringify(capsule, null, 2));
    return { capsule };
  }

  if (!capsule.routes.length) {
    console.log(
      '✗ NO CAPSULE — 0 routes reached; nothing to immunize (a parser-coverage gap, not a pass).',
    );
    process.exitCode = 1;
    return { capsule };
  }

  const outPath = path.join(opts.cwd, '.sparda', 'immunity.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true }); // .sparda/ may not exist yet
  atomicWrite(outPath, JSON.stringify(capsule) + '\n');
  const wire = JSON.stringify(capsule).length;

  console.log(
    `IMMUNITY CAPSULE — ${capsule.routes.length} route(s) frozen into ${capsule.bytes} byte(s) of safety` +
      ` (5 axes = 5 trits = 1 byte/route)`,
  );
  const exposed = AXES.filter((a) => capsule.posture[a].exposed > 0)
    .map((a) => `${a}×${capsule.posture[a].exposed}`)
    .join(', ');
  const verdictText = capsule.surfaceOnly
    ? '● SURFACE ONLY — routes seen, no behavior resolved (nothing to prove)'
    : capsule.proven
      ? '✓ PROVEN'
      : '✗ NOT PROVEN';
  console.log(`  verdict: ${verdictText}` + (exposed ? ` — exposed: ${exposed}` : ''));
  console.log(
    `  coverage: ${(capsule.coverage * 100).toFixed(0)}% of observed behavior resolved` +
      (capsule.blindHigh ? ` · ${capsule.blindHigh} high-risk blind spot(s)` : '') +
      ` — the proof's confidence, frozen with it`,
  );
  console.log(
    `  written: .sparda/immunity.json (${wire} bytes on the wire) — portable, offline, lookup by behaviorHash`,
  );
  // surface-only is not a risk (nothing to fault) → don't fail CI; only a real
  // unproven capsule (an exposed axis) gates.
  if (!capsule.proven && !capsule.surfaceOnly) process.exitCode = 1;
  return { capsule, outPath };
}
