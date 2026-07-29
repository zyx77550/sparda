// ubg/premise.js — the PREMISE verifier.
//
// Every other honesty organ in SPARDA checks the PROOF: guard dominance, the type
// lock, falsify. They all reason over the graph, and they are all blind to the same
// thing — a route that is not IN the graph. `falsify` cannot ablate the guard of a
// route that does not exist; the blind-spot ledger cannot rank a surface nobody
// declared. Five false PROVEN verdicts (E-067…E-071) were exactly that: absences.
//
// The premise is the claim SPARDA makes before any proof: "these are the app's
// entrypoints". Nothing checked it. This module does, and it does it the only way an
// absence can be checked — against an oracle that is not the analyser. There are two:
//
//   RUNTIME     the app itself, booted, reporting the route table the framework really
//               built. `src/probe/` already held it (it captured `app.all` long before
//               the extractor modelled it — the runtime knew what the static eye did
//               not); it fed route GENERATION and never the verdict. Here it gates.
//   CONVENTION  the route table the framework's own file layout implies, derived without
//               running anything (`oracle-static.js`). It exists because the runtime
//               oracle covers three lowerings out of seven — the other four cannot be
//               booted from a static checkout, so their premise was never checked at all.
//
// Contract, and its limits, stated plainly:
//   - Both oracles are OPTIONAL, for different reasons, so they are asked for
//     differently. The runtime one EXECUTES the target's code, so it is opt-in
//     (`--probe`) — the user's call, never a silent side effect. The convention one only
//     reads directories, so it runs unasked: a free honesty check behind a flag is a
//     check nobody runs.
//   - When one does not run, `available:false` and the verdict is unchanged — SPARDA
//     never demands what it could not measure, and never rewards a failure to measure.
//   - When one DOES run, a gap is a route the framework serves and the compiler never
//     saw. That is not a blind spot inside the analysis; it is proof the analysis was
//     incomplete. The claim of completeness dies, by measurement, not by opinion.
//   - The direction is one-way: gaps can only WITHHOLD a verdict, never grant one. An
//     oracle that finds nothing new proves nothing positive either — it only removes
//     one specific way of being wrong.
import { probeRoutes } from '../probe/probe.js';
import { reconcile } from '../probe/reconcile.js';
import { staticOracle, CONVENTION_ROUTED } from './oracle-static.js';

// Frameworks the runtime oracle can boot today. Everything else falls through to the
// boot-free oracle, or reports `available:false` rather than pretending the premise was
// checked.
export const PROBEABLE = new Set(['express', 'fastapi', 'flask']);

// Every framework whose premise can be checked at all, by either oracle. OpenAPI is
// deliberately absent and always will be: there, the spec IS the premise, so there is
// no second source of truth to check it against — only the app it claims to describe,
// which SPARDA does not have.
export const VERIFIABLE = new Set([...PROBEABLE, ...CONVENTION_ROUTED]);

// Frameworks whose premise check costs nothing and runs unasked. The runtime oracle is
// opt-in because it EXECUTES the target's code; the convention oracle only reads the
// directory tree, so withholding it would be withholding a free honesty check.
export const FREE_ORACLE = CONVENTION_ROUTED;

// The graph's entrypoints, in the minimal shape `reconcile` compares on.
export function entrypointsAsRoutes(graph) {
  const nodes = graph.nodes.values ? [...graph.nodes.values()] : graph.nodes;
  return nodes
    .filter((n) => n.kind === 'entrypoint')
    .map((n) => ({
      method: String(n.meta?.method ?? 'get').toUpperCase(),
      path: n.meta?.path ?? '/',
      source: 'static',
    }));
}

/**
 * Boot the app, diff its real route table against the compiled graph.
 *
 * @returns {Promise<{available:boolean, gaps:Array, probed:number, reason?:string}>}
 *   available:false — the oracle did not run; the verdict must not change.
 *   gaps            — routes the framework built that the compiler never saw.
 */
export async function verifyPremise(
  graph,
  { framework, entryFile, cwd, timeoutMs, unknownHandlers = [] },
) {
  if (CONVENTION_ROUTED.has(framework))
    return verifyAgainstConvention(graph, { framework, entryFile, cwd, unknownHandlers });
  if (!PROBEABLE.has(framework))
    return {
      available: false,
      gaps: [],
      probed: 0,
      reason: `no oracle for ${framework}`,
    };

  let probed;
  try {
    probed = await probeRoutes({
      // the Python probe serves both FastAPI and Flask
      framework: framework === 'flask' ? 'fastapi' : framework,
      entryFile,
      projectRoot: cwd,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  } catch (err) {
    return {
      available: false,
      gaps: [],
      probed: 0,
      reason: `probe failed: ${String(err.message).slice(0, 120)}`,
    };
  }

  // probeRoutes returns [] on any internal failure, which is indistinguishable from
  // "an app with no routes". Treating that as a clean bill of health would be the
  // worst possible reading — a broken oracle would silently CONFIRM every proof. So
  // an empty probe is "unavailable", never "verified".
  if (!Array.isArray(probed) || probed.length === 0)
    return {
      available: false,
      gaps: [],
      probed: 0,
      reason: 'probe returned no routes — the app did not boot, or exposes none',
    };

  const { gaps } = reconcile(entrypointsAsRoutes(graph), probed);
  return { available: true, gaps, probed: probed.length, oracle: 'runtime' };
}

// The boot-free half. Same shape, same one-way direction, a different oracle: the route
// table the framework's own conventions imply (`oracle-static.js`).
//
// A registration the extractor already DECLARED (`unknownHandlers`) is not a gap — it is
// carried, at high risk, by the blind-spot ledger. Reporting it twice under two names
// would inflate the count and teach a reader to discount both. The suppression is keyed
// on file AND verb, never on file alone: a module with one unreadable export must still
// have its other, perfectly readable exports checked.
function verifyAgainstConvention(graph, { framework, entryFile, cwd, unknownHandlers }) {
  const oracle = staticOracle(cwd, { framework, entryFile });
  if (!oracle.available)
    return { available: false, gaps: [], probed: 0, reason: oracle.reason };

  const declared = new Set(
    (unknownHandlers ?? [])
      .filter((u) => u.file && u.target)
      .map((u) => `${u.file}::${String(u.target).toUpperCase()}`),
  );
  const candidate = oracle.routes.filter(
    (r) => !declared.has(`${r.file}::${r.method.toUpperCase()}`),
  );

  // An empty enumeration means the conventions found nothing — an app that routes some
  // other way, or a directory layout this oracle does not recognise. Exactly as with an
  // empty probe, that is "unavailable", never "verified": a silent oracle must never be
  // read as a clean bill of health.
  if (candidate.length === 0)
    return {
      available: false,
      gaps: [],
      probed: 0,
      reason: 'the framework conventions enumerated no routes here',
    };

  const { gaps } = reconcile(entrypointsAsRoutes(graph), candidate);
  return { available: true, gaps, probed: candidate.length, oracle: 'convention' };
}

/**
 * The premise check as every verdict-emitting command should ask for it — ONE code path,
 * so `apocalypse` (the CI gate), `badge` (the public artifact), `dossier`, `review` and
 * `prove` can never disagree about whether the app was fully seen.
 *
 * The organ shipped wired into `prove` alone, which meant the deploy gate could still
 * exit 0, and a shareable badge could still read green, over an app whose route table
 * nobody had checked. That is the exact failure the verifier exists to remove, so having
 * it on one consumer out of seven was worse than not having it: it made the guarantee
 * sound universal while it covered a single command.
 *
 * The opt-in boundary is preserved: the RUNTIME oracle executes the target's code and
 * runs only under `--probe`; the CONVENTION oracle reads directories and always runs.
 *
 * @returns the same shape as `verifyPremise` — `available:false` means the verdict is
 *   untouched, exactly as before this call existed.
 */
export async function premiseFor(graph, report, { cwd, probe = false } = {}) {
  const wanted =
    FREE_ORACLE.has(report.framework) || (probe && PROBEABLE.has(report.framework));
  if (!wanted)
    return {
      available: false,
      basis: basisOf(report.framework),
      gaps: [],
      probed: 0,
      reason: PROBEABLE.has(report.framework)
        ? 'runtime oracle not requested (--probe)'
        : `no oracle for ${report.framework}`,
    };
  const verified = await verifyPremise(graph, {
    framework: report.framework,
    entryFile: report.entry,
    cwd,
    unknownHandlers: report.unknownHandlers,
  });
  return {
    ...verified,
    basis: verified.available ? 'measured' : basisOf(report.framework),
  };
}

// On what BASIS do we hold the premise — that the route set analysed is the route set the
// app serves? Three answers, and collapsing the last two is E-104:
//
//   'measured'   — an oracle that is not the analyser enumerated the surface and agreed.
//   'declared'   — there is nothing to cross-check against because the artefact analysed IS
//                  the route table. An OpenAPI document does not have a premise behind it;
//                  it is the premise. Demanding a second witness for it would be demanding
//                  that a map be verified against itself.
//   'unmeasured' — no oracle ran. NOT the same as "an oracle ran and found nothing", and the
//                  whole point of naming this state is that the verdict must be able to tell
//                  the difference (E-104: `PROVEN` was reachable on 7 of our 8 proving
//                  fixtures with no oracle ever having run).
export function basisOf(framework) {
  if (framework === 'openapi') return 'declared';
  return 'unmeasured';
}

// The basis of a premise RESULT, as every consumer needs it. `premiseFor` already computes
// it; NINE call sites re-derived it by hand anyway — the same ternary, copied, which is nine
// chances to get it subtly wrong and one more shape to keep in sync.
//
// The default is the load-bearing part: a caller that has NO premise object at all — because
// it never asked — gets 'unmeasured', not 'measured' and not `null`. Forgetting to measure
// must fail toward the weaker word, never toward silence. That is the whole of E-106 in one
// default value.
export function basisFrom(premise) {
  if (premise?.available) return 'measured';
  return premise?.basis ?? 'unmeasured';
}

// Fold the gaps into the report the blind-spot ledger reads. Every caller did these two
// lines by hand; one of them getting it subtly wrong is how a channel silently stops
// counting, so it lives here instead. Returns the report UNCHANGED when there is nothing
// to add, which keeps the no-oracle path byte-identical to the pre-premise behaviour.
export function withPremiseGaps(report, premise) {
  if (!premise?.gaps?.length) return report;
  return {
    ...report,
    skipped: [...(report.skipped ?? []), ...gapsAsSkipped(premise.gaps, premise.oracle)],
  };
}

// Gaps → skipped-surface entries, at CRITICAL risk. A gap is the most severe blindness
// there is: not "a construct inside a route we could not read", but a whole route,
// confirmed to exist, that the analysis never touched. Feeding them through the normal
// ledger means they enter the coverage denominator and the blind-spot ranking for free.
export function gapsAsSkipped(gaps, oracle = 'runtime') {
  const witness =
    oracle === 'convention'
      ? "the framework's own file conventions serve"
      : 'the running app serves';
  return (gaps ?? []).map((g) => ({
    reason: `premise gap: ${witness} ${g.method} ${g.path}, which the compiler never saw — the analysis is measurably incomplete`,
    file: null,
    risk: 'critical',
  }));
}
