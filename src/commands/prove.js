// commands/prove.js — THE one gesture. The whole trust picture in a single command:
// the verdict (apocalypse), what SPARDA could NOT see (blindspots coverage), the
// portable safety seal (immunity capsule), and the behavior fingerprint — assembled,
// not scattered across six commands. Every piece is an existing organ; prove only
// composes and presents them, so there is exactly one source of truth per fact.
import crypto from 'node:crypto';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph, verdictOf, verdictState, badgeFor } from '../ubg/apocalypse.js';
import { surveyBlindspots, coveragePct } from '../ubg/blindspots.js';
import { premiseFor, withPremiseGaps, basisFrom } from '../ubg/premise.js';
import { buildCapsule } from '../ubg/immunity.js';
import { fingerprintGraph } from '../ubg/fingerprint.js';
import { suggestAppDirs } from '../detect.js';
import { readEnforceManifest } from './enforce.js';

export async function runProve(opts) {
  const { graph, report } = compileUBG(opts.cwd, { write: false, openapi: opts.openapi });
  const canonical = canonicalizeGraph(graph);

  const { findings, obligations } = checkGraph(canonical);

  // THE PREMISE CHECK. Before asking whether the proof holds, ask whether the proof was
  // about the whole app. One shared call (`premiseFor`) so this command, the CI gate and
  // the public artifacts can never disagree about whether the app was fully seen; it
  // keeps the opt-in boundary — the runtime oracle executes the target's code and needs
  // `--probe`, the boot-free convention oracle only reads directories and always runs.
  const premise = await premiseFor(canonical, report, {
    cwd: opts.cwd,
    probe: opts.probe,
  });

  // A gap is a route the running app serves and the compiler never saw. It belongs in
  // the blind-spot ledger at critical risk, so it lands in the coverage denominator and
  // the ranked map like every other unseen surface — one channel, no special case.
  const blind = surveyBlindspots(canonical, withPremiseGaps(report, premise));
  const verdict = verdictOf(findings, canonical, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
    premiseGaps: premise.available ? premise.gaps.length : 0,
    premiseBasis: basisFrom(premise),
  });
  // The capsule is graded on the SAME basis as the verdict. It shipped without one (E-106):
  // `prove` computed the premise two lines above, used it for the verdict word, and then
  // built a portable capsule that re-asserted `proven: true` with no licence at all.
  const capsule = buildCapsule(canonical, { premiseBasis: basisFrom(premise) });
  const prints = fingerprintGraph(canonical);
  // one app-level seal: a content address over every route's behavior hash — the same
  // behavior, in any repo, yields the same seal (the genome's join key, made visible).
  const seal =
    'seal_' +
    crypto
      .createHash('sha256')
      .update(prints.map((p) => p.behaviorHash ?? '·').join('\n'))
      .digest('hex')
      .slice(0, 16);

  const state = verdictState(verdict);
  // The ENFORCED disclosure (ADR-076): when part of the proof rests on checks `sparda enforce`
  // synthesized, say so — an enforced proof is auditable and must never read as a silent bare
  // PROVEN. Disclosure only: the manifest can QUALIFY a PROVEN (strictly more information), it
  // can never upgrade a verdict — soundness never depends on it (strip the injected check and
  // the type-lock drops the app back to PARTIAL on its own).
  const enforced = state === 'PROVEN' ? readEnforceManifest(opts.cwd) : null;

  const summary = {
    app: path.basename(path.resolve(opts.cwd)) || 'app',
    verdict: state,
    routes: report.routes,
    guards: verdict.guards,
    guardsVerified: verdict.guardsVerified,
    obligations,
    coverage: blind.coverage.ratio,
    blindSpots: blind.surface,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
    premise: premise.available
      ? {
          verified: true,
          oracle: premise.oracle,
          probed: premise.probed,
          gaps: premise.gaps.length,
        }
      : {
          verified: false,
          // 'unmeasured' (no oracle ran) vs 'declared' (OpenAPI — the document analysed IS
          // the route table). A machine consumer that cannot tell those apart is in exactly
          // the position E-104 put the verdict in.
          basis: premise.basis ?? 'unmeasured',
          reason: premise.reason,
        },
    findings: findings.map((f) => ({
      rule: f.rule,
      severity: f.severity,
      entrypoint: f.entrypoint,
    })),
    counts: verdict.counts,
    capsuleBytes: capsule.bytes,
    behaviors: new Set(prints.map((p) => p.behaviorHash).filter(Boolean)).size,
    seal,
    ...(enforced ? { enforced: true, enforcedRoutes: enforced.routes } : {}),
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return gate(verdict);
  }

  // --markdown: a sticky-PR-comment body (used by the GitHub Action's `prove` mode). The
  // badge renders inline via shields.io — the ONE place a hosted URL is right, because a
  // GitHub comment can't embed a repo-local SVG. Same verdict word/colour as `badge` and the
  // CLI (badgeFor), so the PR comment can never over-claim.
  if (opts.markdown) {
    console.log(
      proveMarkdown({ verdict, report, findings, coverage: blind.coverage.ratio, seal }),
    );
    return gate(verdict);
  }

  const ICON = {
    PROVEN: '✓',
    PARTIAL: '◑',
    NOT_PROVEN: '✗',
    RISKY: '⚠',
    SURFACE: '◐',
    NO_PROOF: '✗',
    PREMISE_GAP: '✗',
  };
  const HEAD = {
    PROVEN: 'PROVEN',
    PARTIAL: 'PROVEN (PARTIAL)',
    NOT_PROVEN: 'NOT PROVEN',
    RISKY: 'RISKY',
    SURFACE: 'SURFACE ONLY',
    NO_PROOF: 'NO PROOF',
    PREMISE_GAP: 'PREMISE NOT VERIFIED',
  };

  const cov = coveragePct(blind.coverage.ratio);
  console.log(`\nSPARDA · ${summary.app}`);
  console.log('─'.repeat(46));
  console.log(`${ICON[state]} ${enforced ? 'PROVEN (ENFORCED)' : HEAD[state]}`);

  if (state === 'PROVEN') {
    console.log(`  ${obligations} obligations discharged · 0 violations`);
    if (enforced)
      console.log(
        `  ⚙ ${enforced.routes.length} route(s) proven via a SPARDA-synthesized boundary check — \`sparda enforce --revert\` to undo`,
      );
  } else if (state === 'PARTIAL') {
    // PARTIAL has three possible reasons (ADR-070): a mutation rests on an asserted-only guard
    // (deny not proven), high-risk blind spots, or incomplete coverage. Name the real one(s) —
    // "only X% resolved" is misleading when coverage is high but a guard is merely trusted.
    const reasons = [];
    if (verdict.assertedMutations > 0)
      reasons.push(
        `${verdict.assertedMutations} guarded mutation(s) rest on a guard SPARDA could not verify (trusted by name — the deny is not proven)`,
      );
    if (summary.blindHigh > 0)
      reasons.push(`${summary.blindHigh} high-risk blind spot(s)`);
    // FIRST, because it is the only rung that is about the SUBJECT rather than the proof.
    // A reader told "PARTIAL: 100% of the surface resolved" and nothing else concludes the
    // analysis was thorough and the word merely cautious. The truth was that no oracle ever
    // checked whether the surface analysed was the app's — and that is a different sentence,
    // with a different remedy (E-104).
    if (verdict.premiseUnmeasured)
      reasons.unshift(
        `the route table was never checked by an oracle — no boot-free oracle for this framework, and --probe was not used, so Direction 3 is UNVERIFIED (not a finding: an unmeasured premise, which PROVEN would assert)`,
      );
    if (verdict.coverageUnknown)
      reasons.push(
        `coverage is UNKNOWN (0 behaviors resolved out of 0 seen — no measurement, not a pass)`,
      );
    else reasons.push(`${cov} of the surface resolved`);
    console.log(
      `  ${obligations} obligations discharged · 0 violations — PARTIAL: ${reasons.join('; ')}. The unproven part is not asserted safe.`,
    );
    if (verdict.assertedMutations > 0)
      console.log(
        `  ⚙ \`sparda enforce\` can synthesize the missing proof — a boundary check SPARDA verifies, reversible (PARTIAL → PROVEN (ENFORCED))`,
      );
  } else if (state === 'PREMISE_GAP') {
    // The strongest negative SPARDA can state, and the only one backed by an oracle
    // outside itself: the running app serves routes the analysis never saw, so no
    // claim about the app — not even a qualified one — is available.
    const witness =
      premise.oracle === 'convention'
        ? "the framework's file conventions serve"
        : 'the running app serves';
    const found =
      premise.oracle === 'convention'
        ? 'declared by the project layout, absent from the graph'
        : 'found by the runtime probe only';
    console.log(
      `  ${premise.gaps.length} route(s) ${witness} were NEVER seen by the compiler — the proof's subject is incomplete, so no verdict is claimed`,
    );
    for (const g of premise.gaps.slice(0, 8))
      console.log(`    ✗ ${g.method} ${g.path}   (${found})`);
    if (premise.gaps.length > 8) console.log(`    … and ${premise.gaps.length - 8} more`);
  } else if (state === 'NO_PROOF') {
    console.log(
      `  0 routes resolved — nothing to prove (a parser-coverage gap, not a pass)`,
    );
    const dirs = suggestAppDirs(opts.cwd);
    if (dirs.length) {
      console.log(`  ◐ this looks like a monorepo — the app is in a sub-directory. Try:`);
      for (const d of dirs.slice(0, 4))
        console.log(`      cd ${d.dir} && sparda prove   # looks like ${d.framework}`);
    }
  } else if (state === 'SURFACE') {
    console.log(
      `  ${report.routes} routes seen · coverage ${cov} — not enough state-changing behavior resolved to prove`,
    );
  } else {
    const c = verdict.counts;
    console.log(
      `  ${c.critical} critical · ${c.high} high · ${c.medium} medium · ${c.info} info`,
    );
    for (const f of findings.slice(0, 5)) {
      const ep = f.entrypoint.replace(/^entrypoint:/, '');
      console.log(`    ${sev(f.severity)} ${ep.padEnd(34)} ${labelOf(f.rule)}`);
    }
    if (findings.length > 5) console.log(`    … and ${findings.length - 5} more`);
  }

  console.log(
    `  ${report.routes} routes · ${verdict.guards} guards (${verdict.guardsVerified} verified) · coverage ${cov}`,
  );
  if (premise.available)
    console.log(
      premise.oracle === 'convention'
        ? `  ⚖ premise verified against the framework's file conventions: ${premise.probed} route(s) implied, ${premise.gaps.length} gap(s)`
        : `  ⚖ premise verified against the running app: ${premise.probed} route(s) probed, ${premise.gaps.length} gap(s)`,
    );
  if (blind.surface > 0)
    console.log(
      `  ◐ ${blind.surface} blind spots (${summary.blindHigh} high+) — run \`sparda blindspots\``,
    );
  console.log(
    `  ⬡ seal ${seal} · capsule ${capsule.bytes} B · ${summary.behaviors} distinct behaviors`,
  );
  console.log('');

  return gate(verdict);
}

function gate(verdict) {
  // exit 1 whenever this is not a positive, riskless proof — the CI contract.
  if (!verdict.safe) process.exitCode = 1;
}

// The sticky-PR-comment body: the badge (rendered inline via shields.io), the verdict line,
// the coverage/guards facts, and the top findings. This is the discovery surface — every PR
// shows the whole team the SPARDA verdict, for free. The badge word/colour comes from
// badgeFor, so it can never disagree with the CLI or the committed SVG.
function proveMarkdown({ verdict, report, findings, coverage, seal }) {
  const { message, color } = badgeFor(verdict, { coverage });
  const cov = coveragePct(coverage);
  const badge = `https://img.shields.io/badge/SPARDA-${encodeURIComponent(message)}-${color.slice(1)}`;
  const hard = findings.filter((f) => !f.advisory);
  const lines = [
    `### ![SPARDA](${badge}) &nbsp; behavior proof`,
    '',
    `\`${report.routes} routes · ${verdict.guards} guards (${verdict.guardsVerified} verified) · coverage ${cov}\``,
  ];
  if (hard.length) {
    lines.push('', '| severity | route | finding |', '|---|---|---|');
    for (const f of hard.slice(0, 8))
      lines.push(
        `| ${f.severity} | \`${(f.entrypoint ?? '').replace(/^entrypoint:/, '')}\` | ${labelOf(f.rule)} |`,
      );
    if (hard.length > 8) lines.push(`| … | | and ${hard.length - 8} more |`);
  } else {
    lines.push('', '✅ 0 violations on the resolved surface.');
  }
  lines.push(
    '',
    `<sub>Proven locally by [SPARDA](https://github.com/zyx77550/sparda) — deterministic, no keys · seal \`${seal}\`</sub>`,
  );
  return lines.join('\n');
}

const sev = (s) => ({ critical: '✗', high: '✗', medium: '⚠', info: '·' })[s] ?? '·';

// human labels for the rule ids, so the seal reads without a decoder ring
function labelOf(rule) {
  return (
    {
      UNGUARDED_MUTATION: 'unguarded mutation',
      UNBOUNDED_WRITE_TARGET: 'writes to a request-named table',
      UNVALIDATED_CONSTRAINED_WRITE: 'unvalidated write to a constrained table',
      NON_ATOMIC_AGGREGATE_WRITE: 'non-atomic aggregate write',
      IRREVERSIBLE_OBSERVABLE: 'irreversible external call + state change',
      AGGREGATE_MEMBER_BYPASS: 'aggregate member touched without its root',
    }[rule] ?? rule.toLowerCase().replace(/_/g, ' ')
  );
}
