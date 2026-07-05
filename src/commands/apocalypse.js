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
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph, diffGraphs, verdictOf } from '../ubg/apocalypse.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

const ICONS = { critical: '✗', high: '✗', medium: '⚠', info: '·' };

export async function runApocalypse(opts) {
  const { graph } = compileUBG(opts.cwd, { write: false });
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
  const verdict = verdictOf(findings);

  if (opts.sarif) {
    const sarifPath = path.join(opts.cwd, '.sparda', 'apocalypse.sarif');
    fs.mkdirSync(path.dirname(sarifPath), { recursive: true });
    atomicWrite(sarifPath, JSON.stringify(toSarif(findings, canonical), null, 2) + '\n');
    console.log(
      `✓ SARIF written: .sparda/apocalypse.sarif (${findings.length} result(s))`,
    );
  }

  if (opts.json) {
    console.log(JSON.stringify({ verdict, obligations, findings }, null, 2));
  } else {
    console.log(
      `APOCALYPSE — deployment proof over ${canonical.nodes.length} nodes, ${canonical.edges.length} edges` +
        (hasBaseline ? ' (baseline diff included)' : ''),
    );
    for (const f of findings) {
      console.log(`  ${ICONS[f.severity]} [${f.severity}] ${f.rule} — ${f.message}`);
      if (opts.verbose) for (const ev of f.evidence) console.log(`      evidence: ${ev}`);
    }
    if (verdict.clean) {
      console.log(
        `✓ PROVEN — ${obligations} obligation(s) discharged, zero violations. No declared guard, invariant, transaction or aggregate boundary can be broken by this tree.`,
      );
    } else {
      const c = verdict.counts;
      console.log(
        `${verdict.safe ? '⚠ RISKY' : '✗ NOT PROVEN'} — ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.info} info`,
      );
    }
  }

  if (!verdict.safe) process.exitCode = 1; // CI gates on this
  return { verdict, findings, obligations };
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
