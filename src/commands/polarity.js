// commands/polarity.js — show the ternary behavior matrix (ADR-036).
// Each route becomes a row of {−, ·, +} over the five safety obligations; the
// verdict is a sign check and the app posture is a column sum. This is proof as
// arithmetic — the representation that lets the collective genome compose behavior
// by adding ternary columns instead of re-running proofs. Read-only, deterministic.
//   sparda polarity          the matrix + posture + arithmetic verdict
//   sparda polarity --json   raw { polarity, posture, proven }
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph } from '../ubg/apocalypse.js';
import {
  AXES,
  posture,
  provenByPolarity,
  polaritySignature,
  exposedAxes,
} from '../ubg/polarity.js';

export async function runPolarity(opts) {
  const canonical = canonicalizeGraph(
    compileUBG(opts.cwd, { write: false, openapi: opts.openapi }).graph,
  );
  const { polarity } = checkGraph(canonical);
  const proven = provenByPolarity(polarity);
  const cols = posture(polarity);

  if (opts.json) {
    console.log(JSON.stringify({ proven, polarity, posture: cols }, null, 2));
    return { polarity, posture: cols, proven };
  }

  if (!polarity.length) {
    console.log(
      '✗ NO POLARITY — 0 routes reached; nothing to score (a parser-coverage gap, not a pass).',
    );
    process.exitCode = 1;
    return { polarity, posture: cols, proven };
  }

  console.log(`BEHAVIOR POLARITY — ${polarity.length} route(s) · ${AXES.join(' ')}`);
  for (const p of polarity) {
    const flag = exposedAxes(p.vector).length ? ' ✗' : '';
    console.log(`  ${short(p.entrypoint)}${flag}`);
    console.log(`      ${polaritySignature(p.vector)}`);
  }
  const exposed = AXES.filter((a) => cols[a].exposed > 0)
    .map((a) => `${a}×${cols[a].exposed}`)
    .join(', ');
  console.log(
    `\n${proven ? '✓ PROVEN' : '✗ NOT PROVEN'} (arithmetic: no gating −1)` +
      (exposed ? ` — exposed: ${exposed}` : ''),
  );
  if (!proven) process.exitCode = 1;
  return { polarity, posture: cols, proven };
}

const short = (id) => id.replace(/^entrypoint:/, '');
