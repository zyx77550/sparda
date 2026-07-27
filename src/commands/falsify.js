// commands/falsify.js — run the Popperian audit (ADR-077) on an app: ablate every guard in
// memory and demand the verifier re-derive a violation on each route whose green depended on
// protection. Read-only (graph surgery, no recompile, no disk write). Exit 1 on any hole —
// a hole means "this route's verdict does not depend on its guards; the checker cannot see
// it; do not trust the green there".
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { falsifyGraph } from '../ubg/falsify.js';

export async function runFalsify(opts) {
  const canonical = canonicalizeGraph(compileUBG(opts.cwd, { write: false }).graph);
  const t0 = Date.now();
  const r = falsifyGraph(canonical);
  const ms = Date.now() - t0;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          obligations: r.controls.length,
          flipped: r.flipped,
          holes: r.holes,
          score: r.score,
          ms,
          ...(r.note ? { note: r.note } : {}),
        },
        null,
        2,
      ),
    );
    if (r.holes.length) process.exitCode = 1;
    return;
  }

  console.log(`\nSPARDA · falsify — the proof, challenged`);
  console.log('─'.repeat(46));
  if (r.note) {
    console.log(`· ${r.note}`);
    return;
  }
  console.log(
    `⚔ ${r.controls.length} counterfactual obligation(s): every guard ablated in memory, O1 must re-fire`,
  );
  for (const c of r.controls.filter((x) => !x.flipped))
    console.log(`  ✗ ${c.route} — did NOT flip: its green does not depend on its guards`);
  if (r.holes.length === 0) {
    console.log(
      `✓ falsifiable ${r.flipped}/${r.controls.length} — every protected mutation route flips when its protection vanishes (${ms} ms)`,
    );
  } else {
    console.log(
      `✗ ${r.holes.length} hole(s) — the verdict is not falsifiable there; treat those routes as UNPROVEN (${ms} ms)`,
    );
    process.exitCode = 1;
  }
}
