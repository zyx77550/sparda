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
import { surveyBlindspots } from '../ubg/blindspots.js';
import { buildCapsule } from '../ubg/immunity.js';
import { fingerprintGraph } from '../ubg/fingerprint.js';
import { suggestAppDirs } from '../detect.js';

export async function runProve(opts) {
  const { graph, report } = compileUBG(opts.cwd, { write: false, openapi: opts.openapi });
  const canonical = canonicalizeGraph(graph);

  const { findings, obligations } = checkGraph(canonical);
  const blind = surveyBlindspots(canonical, report);
  const verdict = verdictOf(findings, canonical, { coverage: blind.coverage.ratio });
  const capsule = buildCapsule(canonical);
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
    findings: findings.map((f) => ({
      rule: f.rule,
      severity: f.severity,
      entrypoint: f.entrypoint,
    })),
    counts: verdict.counts,
    capsuleBytes: capsule.bytes,
    behaviors: new Set(prints.map((p) => p.behaviorHash).filter(Boolean)).size,
    seal,
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
  };
  const HEAD = {
    PROVEN: 'PROVEN',
    PARTIAL: 'PROVEN (PARTIAL)',
    NOT_PROVEN: 'NOT PROVEN',
    RISKY: 'RISKY',
    SURFACE: 'SURFACE ONLY',
    NO_PROOF: 'NO PROOF',
  };

  const cov = `${(blind.coverage.ratio * 100).toFixed(0)}%`;
  console.log(`\nSPARDA · ${summary.app}`);
  console.log('─'.repeat(46));
  console.log(`${ICON[state]} ${HEAD[state]}`);

  if (state === 'PROVEN') {
    console.log(`  ${obligations} obligations discharged · 0 violations`);
  } else if (state === 'PARTIAL') {
    console.log(
      `  ${obligations} obligations discharged · 0 violations — but only ${cov} of the surface resolved; the rest is UNPROVEN, not safe`,
    );
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
  const cov = Math.round(coverage * 100);
  const badge = `https://img.shields.io/badge/SPARDA-${encodeURIComponent(message)}-${color.slice(1)}`;
  const hard = findings.filter((f) => !f.advisory);
  const lines = [
    `### ![SPARDA](${badge}) &nbsp; behavior proof`,
    '',
    `\`${report.routes} routes · ${verdict.guards} guards (${verdict.guardsVerified} verified) · coverage ${cov}%\``,
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
