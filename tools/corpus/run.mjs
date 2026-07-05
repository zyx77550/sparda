// tools/corpus/run.mjs — the credibility engine.
// Fixtures prove the compiler works; the corpus proves it works on code we
// did not write. Shallow-clones real open-source backends, compiles each to
// its behavior graph (no npm install needed — the compiler reads sources,
// never executes them), and writes an HONEST scoreboard to docs/CORPUS.md:
// what compiled, what was skipped and why, what apocalypse found. Failures
// are rows, not embarrassments — they are the parser backlog, ranked by
// reality.
//
//   node tools/corpus/run.mjs                     # repos from repos.txt
//   node tools/corpus/run.mjs <git-url> [...]     # ad-hoc repos
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../../src/ubg/compile.js';
import { checkGraph, verdictOf } from '../../src/ubg/apocalypse.js';
import { canonicalizeGraph } from '../../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const TMP = path.join(here, '.tmp');

const repos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.existsSync(path.join(here, 'repos.txt'))
    ? fs
        .readFileSync(path.join(here, 'repos.txt'), 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : [];

if (!repos.length) {
  console.error('no repos: pass git urls or fill tools/corpus/repos.txt');
  process.exit(1);
}

fs.mkdirSync(TMP, { recursive: true });
const rows = [];

for (const url of repos) {
  const name = url
    .replace(/\.git$/, '')
    .split('/')
    .slice(-2)
    .join('/');
  const dir = path.join(TMP, name.replace(/[^\w.-]/g, '_'));
  process.stdout.write(`▸ ${name} … `);

  if (!fs.existsSync(dir)) {
    const clone = spawnSync('git', ['clone', '--depth', '1', '--quiet', url, dir], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (clone.status !== 0) {
      rows.push({
        name,
        status: 'clone failed',
        detail: (clone.stderr ?? '').slice(0, 80),
      });
      console.log('clone failed');
      continue;
    }
  }

  // monorepos park the backend in a subdir — probe the usual suspects
  const cwdCandidates = ['.', 'backend', 'api', 'server', 'apps/api', 'apps/server'];
  const started = Date.now();
  try {
    let compiled = null;
    let usedSubdir = '.';
    let lastErr = null;
    for (const sub of cwdCandidates) {
      const candidate = path.join(dir, sub);
      if (!fs.existsSync(candidate)) continue;
      try {
        compiled = compileUBG(candidate, { write: false });
        usedSubdir = sub;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!compiled) throw lastErr ?? new Error('no compilable dir found');
    const { graph, report } = compiled;
    if (usedSubdir !== '.') report.entry = `${usedSubdir}/${report.entry}`;
    const ms = Date.now() - started;
    const { findings } = checkGraph(canonicalizeGraph(graph));
    const verdict = verdictOf(findings);
    rows.push({
      name,
      status: 'compiled',
      framework: report.framework,
      ms,
      routes: report.routes,
      tables: report.tables,
      nodes: report.counts.totalNodes,
      edges: report.counts.totalEdges,
      skipped: report.skipped.length,
      findings: findings.length,
      critical: verdict.counts.critical,
      topSkips: [...new Set(report.skipped.map((s) => s.reason.split(' (')[0]))].slice(
        0,
        3,
      ),
    });
    console.log(
      `${report.framework} · ${report.routes} routes · ${report.counts.totalNodes} nodes · ${ms}ms · ${findings.length} finding(s)`,
    );
  } catch (err) {
    rows.push({
      name,
      status: 'compile failed',
      detail: String(err.message).slice(0, 100),
    });
    console.log(`compile failed — ${String(err.message).slice(0, 60)}`);
  }
}

// ---- the scoreboard --------------------------------------------------------
const ok = rows.filter((r) => r.status === 'compiled');
const lines = [
  '# SPARDA Corpus Run',
  '',
  '> Real open-source backends, compiled as-is (shallow clone, **no npm install**).',
  '> Failures are listed, not hidden — they are the parser backlog ranked by reality.',
  '',
  `Compiled **${ok.length}/${rows.length}** repos.`,
  '',
  '| repo | status | framework | routes | tables | nodes | edges | compile | skipped | apocalypse findings |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) =>
    r.status === 'compiled'
      ? `| ${r.name} | ✓ | ${r.framework} | ${r.routes} | ${r.tables} | ${r.nodes} | ${r.edges} | ${r.ms}ms | ${r.skipped} | ${r.findings} (${r.critical} critical) |`
      : `| ${r.name} | ✗ ${r.status} | — | — | — | — | — | — | — | ${r.detail} |`,
  ),
  '',
  '## Top skip reasons (what static eyes could not see)',
  '',
  ...ok.flatMap((r) =>
    r.topSkips.length ? [`- **${r.name}**: ${r.topSkips.join(' · ')}`] : [],
  ),
  '',
];
const outFile = path.join(ROOT, 'docs', 'CORPUS.md');
fs.writeFileSync(outFile, lines.join('\n'));
console.log(
  `\n✓ scoreboard written: docs/CORPUS.md (${ok.length}/${rows.length} compiled)`,
);
