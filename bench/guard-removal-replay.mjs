// bench/guard-removal-replay.mjs — the 60-second "aha", reproducible in one command.
//
// Simulates the exact failure mode of the agent era: an AI edit that replaces an auth
// wrapper with an identity function (syntactically valid, semantically unprotected) on a
// real production codebase (dub, 580 routes), then shows `sparda gate` catching it as a
// deterministic GUARD_REMOVED regression, with file:line and wall-clock timing.
//
//   node bench/guard-removal-replay.mjs                 # clones dub into a cache dir
//   node bench/guard-removal-replay.mjs --corpus <dir>  # reuse an existing clone
//
// RESPONSIBLE DISCLOSURE: the regression shown is INJECTED by this script and reverted
// after the run. It is never a real finding of the target repo — real findings of
// third-party repos are not marketing material.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { gateDelta } from '../src/commands/gate.js';

const args = process.argv.slice(2);
const optAt = args.indexOf('--corpus');
const corpus =
  (optAt !== -1 && args[optAt + 1]) || path.join(os.tmpdir(), 'sparda-bench-corpus');

const REPO = { name: 'dub', url: 'https://github.com/dubinc/dub', dir: 'apps/web' };
const TARGET = 'app/api/links/route.ts';
const WRAPPED = 'export const POST = withWorkspace(';
const SABOTAGE = 'const noWrap = (fn: any, _o?: any) => fn;\nexport const POST = noWrap(';

function ensureClone() {
  const dest = path.join(corpus, REPO.name);
  if (fs.existsSync(path.join(dest, REPO.dir))) return dest;
  fs.mkdirSync(corpus, { recursive: true });
  process.stderr.write(`  cloning ${REPO.name} (shallow)…\n`);
  execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', REPO.url, dest], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return dest;
}

const app = path.join(ensureClone(), REPO.dir);
const file = path.join(app, TARGET);
const original = fs.readFileSync(file, 'utf8');
if (!original.includes(WRAPPED)) {
  console.error(`✗ upstream drift: ${TARGET} no longer exports POST via withWorkspace`);
  process.exit(1);
}

const graphOf = () => canonicalizeGraph(compileUBG(app, { write: false }).graph);

console.log(`GUARD-REMOVAL REPLAY — ${REPO.name}/${REPO.dir} (real production codebase)`);

let t = performance.now();
const baseline = graphOf();
console.log(
  `  1. baseline armed: ${baseline.nodes.filter((n) => n.kind === 'entrypoint').length} routes compiled in ${Math.round(performance.now() - t)} ms`,
);

console.log(
  `  2. simulated agent edit: POST /api/links auth wrapper replaced by an identity fn (valid TS, guard gone)`,
);
fs.writeFileSync(file, original.replace(WRAPPED, SABOTAGE));

try {
  t = performance.now();
  const { blocking } = gateDelta(baseline, graphOf());
  const ms = Math.round(performance.now() - t);
  const hit = blocking.find((f) => f.rule === 'GUARD_REMOVED');
  if (!hit) {
    console.error(`✗ REPLAY FAILED — the injected regression was not caught`);
    process.exit(1);
  }
  console.log(`  3. sparda gate verdict, ${ms} ms after the edit:`);
  console.log(`       [${hit.severity}] ${hit.rule} — ${hit.message}`);
  console.log(
    `\n✓ caught deterministically in ${ms} ms — no LLM, no network, no API key. Same input, same verdict, every time.`,
  );
} finally {
  fs.writeFileSync(file, original); // always leave the clone clean
}
