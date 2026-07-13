// commands/speculate.js — speculative verification (ADR-038).
// Re-verify the working tree against a FROZEN capsule (.sparda/immunity.json) by
// hash lookup instead of a full re-proof. Routes whose behavioral shape is already
// in the capsule are settled for free (accepted if safe, rejected if a known-
// dangerous shape); only NOVEL shapes need the full prover. This is what makes the
// agent inner loop fast on a monster repo — most edits touch already-proven shapes.
//   sparda speculate          triage vs .sparda/immunity.json (run `immunize` first)
//   sparda speculate --json   raw { acceptanceRate, accepted, rejected, novel }
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { speculativeVerify } from '../ubg/speculative.js';

export async function runSpeculate(opts) {
  const capsulePath = path.join(opts.cwd, '.sparda', 'immunity.json');
  if (!fs.existsSync(capsulePath)) {
    throw Object.assign(new Error('No frozen capsule to speculate against.'), {
      code: 'USER',
      hint: 'Run `sparda immunize` first to freeze a baseline.',
    });
  }
  let capsule;
  try {
    capsule = JSON.parse(fs.readFileSync(capsulePath, 'utf8'));
  } catch (err) {
    throw Object.assign(new Error(`Capsule unreadable: ${err.message}`), {
      code: 'USER',
      hint: 'Re-run `sparda immunize` to regenerate .sparda/immunity.json.',
    });
  }

  const candidate = canonicalizeGraph(
    compileUBG(opts.cwd, { write: false, openapi: opts.openapi }).graph,
  );
  const result = speculativeVerify(capsule, candidate);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return { result };
  }

  const pct = (result.acceptanceRate * 100).toFixed(1);
  console.log(
    `SPECULATIVE VERIFY — ${result.settled}/${result.total} route(s) settled by lookup, ` +
      `${result.novel.length} novel (${pct}% verified with zero prover work)`,
  );
  for (const r of result.rejected)
    console.log(
      `  ✗ known-exposed shape: ${short(r.entrypoint)} [${r.exposed.join(',')}]`,
    );
  for (const r of result.novel)
    console.log(`  ? novel shape (needs full proof): ${short(r.entrypoint)}`);
  if (!result.novel.length && !result.rejected.length)
    console.log(
      '  ✓ every route matched a proven-safe shape — re-verification cost nothing.',
    );

  // Verdict mirrors apocalypse, computed by lookup: a known-exposed route means the
  // tree is not proven. Novel shapes aren't a failure — they're work the full prover
  // still owes; surface them, don't gate on them.
  console.log(
    result.rejected.length
      ? `✗ NOT PROVEN (by lookup) — ${result.rejected.length} known-exposed route(s)` +
          (result.novel.length ? ` · ${result.novel.length} novel need full proof` : '')
      : result.novel.length
        ? `· ${result.novel.length} novel shape(s) need the full prover — run \`sparda apocalypse\``
        : `✓ PROVEN (by lookup) — every route settled from the frozen capsule, zero prover work`,
  );
  if (result.rejected.length) process.exitCode = 1;
  return { result };
}

const short = (id) => id.replace(/^entrypoint:/, '');
