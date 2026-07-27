// bench/repro.mjs — the reproducible route-compilation proof (URGENT-ADOPTION J1 #3).
//
// The README's headline number must be reproducible by a skeptic in one command, or it reads
// as vaporware. This clones the exact repos the README names, compiles each to its UBG, and
// prints the routes / time / verdict / crash count — the numbers the README claims, live.
//
//   node bench/repro.mjs                 # clones the named repos into a cache dir, measures
//   node bench/repro.mjs --corpus <dir>  # reuse a dir that already holds the clones
//   node bench/repro.mjs --update        # rewrite bench/route-proof.json with today's run
//
// HONESTY: we report routes COMPILED and the per-repo verdict SEPARATELY. "Compiled N routes"
// is a parser claim (reproducible here); "PROVEN" is a per-repo verdict (most real apps are
// NOT_PROVEN — that is the honest state, not a failure). The script never conflates the two.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, verdictState } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';
import { premiseFor, withPremiseGaps } from '../src/ubg/premise.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// the repos the README names, with the sub-dir that holds the analyzable app and a route floor
// (a regression tripwire — the count must not silently collapse). Floors are set BELOW the
// measured value with headroom, so a normal parser improvement never trips them.
const REPOS = [
  { name: 'dub', url: 'https://github.com/dubinc/dub', dir: 'apps/web', floor: 400 },
  {
    name: 'immich',
    url: 'https://github.com/immich-app/immich',
    dir: 'server',
    floor: 200,
  },
  {
    name: 'medusa',
    url: 'https://github.com/medusajs/medusa',
    dir: 'packages/medusa',
    floor: 400,
  },
];

const args = process.argv.slice(2);
const getFlag = (n) => args.includes(`--${n}`);
const getOpt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : null;
};

const corpus = getOpt('corpus') || path.join(os.tmpdir(), 'sparda-bench-corpus');

function ensureClone(repo) {
  const dest = path.join(corpus, repo.name);
  if (fs.existsSync(path.join(dest, repo.dir))) return dest; // already present
  fs.mkdirSync(corpus, { recursive: true });
  process.stderr.write(`  cloning ${repo.name} (shallow)…\n`);
  execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', repo.url, dest], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return dest;
}

async function measure(appDir) {
  const t0 = performance.now();
  const { graph, report } = compileUBG(appDir, { write: false });
  const c = canonicalizeGraph(graph);
  const { findings } = checkGraph(c);
  // The premise, before the verdict (ADR-083). This bench prints a verdict word into a
  // committed evidence file the README points at, so it is bound by the same rule as the
  // badge: no word over an app whose route table nobody checked. Boot-free oracle only —
  // a reproducibility bench must never execute the repos it clones.
  const premise = await premiseFor(c, report, { cwd: appDir });
  const blind = surveyBlindspots(c, withPremiseGaps(report, premise));
  const verdict = verdictOf(findings, c, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
    premiseGaps: premise.available ? premise.gaps.length : 0,
  });
  const ms = Math.round(performance.now() - t0);
  return {
    routes: report.routes,
    verdict: verdictState(verdict),
    coverage: Math.round(blind.coverage.ratio * 100),
    ms,
  };
}

const rows = [];
let crashes = 0;
for (const repo of REPOS) {
  let base;
  try {
    base = ensureClone(repo);
  } catch (e) {
    process.stderr.write(
      `  ✗ clone failed for ${repo.name}: ${e.message.slice(0, 80)}\n`,
    );
    rows.push({ ...repo, error: 'clone-failed' });
    continue;
  }
  try {
    const m = await measure(path.join(base, repo.dir));
    rows.push({ ...repo, ...m, pass: m.routes >= repo.floor });
  } catch (e) {
    crashes++;
    rows.push({ ...repo, error: e.message.slice(0, 60) });
  }
}

const ok = rows.filter((r) => r.routes != null);
const totalRoutes = ok.reduce((a, r) => a + r.routes, 0);
const totalMs = ok.reduce((a, r) => a + r.ms, 0);
const maxMs = ok.reduce((a, r) => Math.max(a, r.ms), 0);

const pad = (s, n) => String(s).padEnd(n);
console.log('\nSPARDA — route-compilation proof (README headline, reproduced)\n');
console.log(
  pad('repo', 10) +
    pad('routes', 8) +
    pad('verdict', 12) +
    pad('cov%', 6) +
    pad('ms', 7) +
    'floor',
);
console.log('-'.repeat(52));
for (const r of rows) {
  if (r.error) console.log(pad(r.name, 10) + `ERROR — ${r.error}`);
  else
    console.log(
      pad(r.name, 10) +
        pad(r.routes, 8) +
        pad(r.verdict, 12) +
        pad(r.coverage, 6) +
        pad(r.ms, 7) +
        `${r.floor}${r.pass ? ' ✓' : ' ✗ REGRESSED'}`,
    );
}
console.log('-'.repeat(52));
console.log(
  `${ok.length}/${REPOS.length} repos · ${totalRoutes} routes compiled · ${crashes} crashes · ` +
    `slowest ${maxMs}ms · ${Math.round(totalRoutes / (totalMs / 1000))} routes/s`,
);
console.log(
  `\nNote: "routes compiled" is a parser claim (reproduced above). Per-repo PROVEN/NOT_PROVEN\n` +
    `is the honest verdict — most real apps are NOT_PROVEN, and that is the true state.\n`,
);

const proof = {
  when: new Date().toISOString().slice(0, 10),
  node: process.version,
  repos: rows.map((r) => ({
    name: r.name,
    routes: r.routes ?? null,
    verdict: r.verdict ?? null,
    ms: r.ms ?? null,
    floor: r.floor,
  })),
  totals: { routes: totalRoutes, crashes, slowestMs: maxMs },
};

if (getFlag('update')) {
  fs.writeFileSync(
    path.join(here, 'route-proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log('✓ wrote bench/route-proof.json');
}

const regressed = rows.some((r) => r.routes != null && !r.pass);
if (crashes > 0 || regressed) process.exitCode = 1;
