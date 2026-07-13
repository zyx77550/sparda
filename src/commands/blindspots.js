// commands/blindspots.js — hand the reader the map of SPARDA's own blindness.
// Compiles the tree, surveys the Unknown Behavior Surface, and prints every place
// SPARDA could not fully see, ranked by what it could be hiding. This is the honest
// complement to `apocalypse`: that command tells you what's proven, this one tells
// you exactly where the proof stops — so a green verdict is never mistaken for
// omniscience. Exit code 1 if any HIGH-or-worse blind spot sits on the surface
// (a state-changing route or write whose behavior went unseen is not something CI
// should wave through silently).
//   sparda blindspots            ranked ledger, human-readable
//   sparda blindspots --json     the raw survey for tooling
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { surveyBlindspots } from '../ubg/blindspots.js';

const ICON = { critical: '✗', high: '✗', medium: '⚠', low: '·' };

export async function runBlindspots(opts) {
  const { graph, report } = compileUBG(opts.cwd, { write: false, openapi: opts.openapi });
  const canonical = canonicalizeGraph(graph);
  const survey = surveyBlindspots(canonical, report);

  if (opts.json) {
    console.log(JSON.stringify({ survey }, null, 2));
  } else {
    const { surface, byRisk, coverage } = survey;
    console.log(
      `BLINDSPOTS — SPARDA's Unknown Behavior Surface over ${report.routes} route(s)`,
    );
    console.log(
      `  ${surface} blind spot(s): ${byRisk.high + byRisk.critical} high+, ${byRisk.medium} medium, ${byRisk.low} low`,
    );
    console.log(
      `  coverage ${(coverage.ratio * 100).toFixed(1)}% — ${coverage.resolved} behaviors resolved, ${coverage.blind} left unseen`,
    );
    if (surface === 0) {
      console.log(
        `  ✓ nothing hidden — every route, effect target and guard SPARDA saw was fully resolved.`,
      );
    } else {
      const shown = opts.verbose ? survey.spots : survey.spots.slice(0, 20);
      for (const s of shown) {
        console.log(
          `  ${ICON[s.risk]} [${s.risk}] ${s.kind} — ${s.label}${s.location ? ` (${s.location})` : ''}`,
        );
        if (opts.verbose) console.log(`      ${s.why}`);
      }
      if (!opts.verbose && survey.spots.length > shown.length)
        console.log(`  … ${survey.spots.length - shown.length} more (run --verbose)`);
    }
  }

  if (survey.byRisk.critical > 0 || survey.byRisk.high > 0) process.exitCode = 1;
  return { survey };
}
