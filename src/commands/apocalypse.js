// commands/apocalypse.js — prove a deployment can't break the declared rules.
// Compiles the tree to SBIR, discharges the static proof obligations, and —
// when a baseline exists — proves the deploy removed no protection the
// baseline had. Exit code 1 on any critical/high finding: this command is
// built to sit in CI between "tests pass" and "deploy".
//   sparda apocalypse                   check current tree (+ diff vs baseline if saved)
//   sparda apocalypse --save-baseline   record the current graph as the reference
//   sparda apocalypse --json            raw findings for tooling
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import {
  checkGraph,
  diffGraphs,
  verdictOf,
  verdictState,
  buildProofObjects,
} from '../ubg/apocalypse.js';
import { surveyBlindspots } from '../ubg/blindspots.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

// version travels with the proof so an audit knows which prover produced it
const SPARDA_VERSION = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ).version;
  } catch {
    return '0.0.0';
  }
})();

// a deterministic fingerprint of the canonical graph: same source → same graph → same hash.
// The proof object binds to it, so a third party proves it audited the SAME artifact.
function graphHash(canonical) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({ nodes: canonical.nodes, edges: canonical.edges }));
  return 'bh1_' + h.digest('hex').slice(0, 16);
}

const ICONS = { critical: '✗', high: '✗', medium: '⚠', info: '·' };

export async function runApocalypse(opts) {
  const { graph, report } = compileUBG(opts.cwd, { write: false });
  const canonical = canonicalizeGraph(graph);
  const baselinePath = path.join(opts.cwd, '.sparda', 'ubg.baseline.json');

  if (opts.saveBaseline) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    atomicWrite(baselinePath, JSON.stringify(canonical, null, 2) + '\n');
    console.log(
      `✓ Baseline saved: .sparda/ubg.baseline.json — future deploys are proven against it`,
    );
  }

  const { findings: staticFindings, obligations } = checkGraph(canonical);
  let diffFindings = [];
  let hasBaseline = false;
  if (!opts.saveBaseline && fs.existsSync(baselinePath)) {
    hasBaseline = true;
    try {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      diffFindings = diffGraphs(baseline, canonical).findings;
    } catch (err) {
      console.error(`⚠ baseline unreadable (${err.message}) — static checks only`);
    }
  }

  const findings = [...staticFindings, ...diffFindings];
  // the honesty companion: where does the proof stop? (see `sparda blindspots`)
  const blind = surveyBlindspots(canonical, report);
  // coverage feeds the verdict: a clean app that resolved almost nothing is SURFACE, not PROVEN;
  // and any high-risk blind spot pulls a bare PROVEN down to PARTIAL (E-047, the giant-test rung)
  const verdict = verdictOf(findings, canonical, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
  });

  if (opts.sarif) {
    const sarifPath = path.join(opts.cwd, '.sparda', 'apocalypse.sarif');
    fs.mkdirSync(path.dirname(sarifPath), { recursive: true });
    atomicWrite(sarifPath, JSON.stringify(toSarif(findings, canonical), null, 2) + '\n');
    console.log(
      `✓ SARIF written: .sparda/apocalypse.sarif (${findings.length} result(s))`,
    );
  }

  if (opts.proof) {
    const proofPath = path.join(opts.cwd, '.sparda', 'apocalypse.proof.json');
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    const proof = {
      sparda_version: SPARDA_VERSION,
      graph_hash: graphHash(canonical),
      verdict: verdictState(verdict),
      discharged: buildProofObjects(canonical),
    };
    atomicWrite(proofPath, JSON.stringify(proof, null, 2) + '\n');
    console.log(
      `✓ Proof written: .sparda/apocalypse.proof.json (${proof.discharged.length} discharged obligation(s), re-verifiable against ${proof.graph_hash})`,
    );
  }

  if (opts.json) {
    console.log(
      JSON.stringify({ verdict, obligations, findings, blindspots: blind }, null, 2),
    );
  } else {
    console.log(
      `APOCALYPSE — deployment proof over ${canonical.nodes.length} nodes, ${canonical.edges.length} edges` +
        (hasBaseline ? ' (baseline diff included)' : ''),
    );
    for (const f of findings) {
      console.log(`  ${ICONS[f.severity]} [${f.severity}] ${f.rule} — ${f.message}`);
      if (opts.verbose) for (const ev of f.evidence) console.log(`      evidence: ${ev}`);
    }
    if (!verdict.provable) {
      console.log(
        `✗ NO PROOF — 0 routes reached. SPARDA could not see this app's surface (a parser-coverage gap, not a clean bill of health); an empty graph proves nothing. This is NOT a pass — run with --verbose to see what was skipped.`,
      );
      if (opts.verbose) {
        console.log(`      detected: ${report.framework} · entry ${report.entry}`);
        if (report.skipped?.length)
          for (const s of report.skipped)
            console.log(`      skipped: ${s.reason}${s.file ? ` (${s.file})` : ''}`);
        else
          console.log(
            `      no route call sites reached — routes are likely registered indirectly (a loader / DI pattern the static walk can't follow).`,
          );
      }
    } else if (verdict.surfaceOnly) {
      console.log(
        `● SURFACE ONLY — ${verdict.entrypoints} route(s) seen, but ZERO behavior resolved (no state, no db/http/fs effects). There was nothing to prove, so this is NOT a clean bill of health — SPARDA saw the surface but not what the code does (a spec, or an effect-resolution gap: DI services, external controllers). Run with --verbose.`,
      );
      if (opts.verbose && report.skipped?.length)
        for (const s of report.skipped)
          console.log(`      skipped: ${s.reason}${s.file ? ` (${s.file})` : ''}`);
    } else if (verdict.clean) {
      console.log(
        `✓ PROVEN — ${obligations} obligation(s) discharged, zero violations. No declared guard, invariant, transaction or aggregate boundary can be broken by this tree.`,
      );
    } else {
      const c = verdict.counts;
      console.log(
        `${verdict.safe ? '⚠ RISKY' : '✗ NOT PROVEN'} — ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.info} info`,
      );
    }
    // Honesty companion: where the proof stops. A green verdict over a graph riddled
    // with blind spots is not omniscience — say so, on the same screen as the verdict.
    if (blind.surface > 0) {
      const hi = blind.byRisk.critical + blind.byRisk.high;
      console.log(
        `  ◐ blind spots: ${blind.surface} (${hi} high+, ${blind.byRisk.medium} medium, ${blind.byRisk.low} low) · coverage ${(blind.coverage.ratio * 100).toFixed(0)}% — run \`sparda blindspots\` for the map`,
      );
    }
  }

  if (!verdict.safe) process.exitCode = 1; // CI gates on this
  return { verdict, findings, obligations, blindspots: blind };
}

// SARIF 2.1.0 — GitHub code scanning eats this directly
const SARIF_LEVEL = { critical: 'error', high: 'error', medium: 'warning', info: 'note' };

function toSarif(findings, canonical) {
  const nodeById = new Map(canonical.nodes.map((n) => [n.id, n]));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'sparda-apocalypse',
            informationUri: 'https://github.com/zyx77550/sparda',
            rules: [...new Set(findings.map((f) => f.rule))].sort().map((id) => ({ id })),
          },
        },
        results: findings.map((f) => {
          const loc = nodeById.get(f.entrypoint)?.loc;
          return {
            ruleId: f.rule,
            level: SARIF_LEVEL[f.severity] ?? 'warning',
            message: { text: f.message },
            ...(loc
              ? {
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: loc.file },
                        region: { startLine: loc.line || 1 },
                      },
                    },
                  ],
                }
              : {}),
          };
        }),
      },
    ],
  };
}
