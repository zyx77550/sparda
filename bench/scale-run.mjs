// bench/scale-run.mjs — the Z5 regression witness.
//
// Times each pipeline phase, then measures the honest scaling metric: how many
// successor entries one full reachability pass EXAMINES. The old flat adjacency
// list scanned every successor of a shared node and filtered by route, so a
// global middleware (fan-out = route count) made this exactly routes². The
// route-partitioned index (ubg/reach.js) examines only the successors that
// belong to the walking entrypoint. Both strategies are counted here, on the
// same graph, so the ratio is machine-independent.
//   node bench/scale-run.mjs <appDir>
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { checkGraph, verdictOf, indexGraph } from '../src/ubg/apocalypse.js';
import { surveyBlindspots } from '../src/ubg/blindspots.js';

const dir = process.argv[2];
const t = (label, fn) => {
  const a = process.hrtime.bigint();
  const out = fn();
  const ms = Number(process.hrtime.bigint() - a) / 1e6;
  console.log(`  ${label.padEnd(22)} ${ms.toFixed(1).padStart(9)} ms`);
  return [out, ms];
};

console.log(`\n${dir}`);
const [compiled, tc] = t('compileUBG', () => compileUBG(dir, { write: false }));
const [canon, tk] = t('canonicalize', () => canonicalizeGraph(compiled.graph));
const [checked, tch] = t('checkGraph', () => checkGraph(canon));
const [blind, tb] = t('surveyBlindspots', () => surveyBlindspots(canon, compiled.report));
const [, tv] = t('verdictOf', () =>
  verdictOf(checked.findings, canon, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
  }),
);
console.log(
  `  ${'TOTAL'.padEnd(22)} ${(tc + tk + tch + tb + tv).toFixed(1).padStart(9)} ms`,
);
console.log(
  `  routes=${compiled.report.routes} nodes=${canon.nodes.length} edges=${canon.edges.length} findings=${checked.findings.length} heap=${(process.memoryUsage().heapUsed / 1e6).toFixed(0)}MB`,
);

// ---- successor examinations, old strategy vs new, on the identical graph ----
const g = indexGraph(canon);

// the pre-Z5 shape: one flat successor list per node, filtered per walk
const flat = new Map();
for (const e of canon.edges) {
  if (e.kind !== 'control_flow') continue;
  if (!flat.has(e.from)) flat.set(e.from, []);
  flat.get(e.from).push({ to: e.to, route: e.meta?.route ?? null });
}

let flatVisits = 0;
for (const ep of g.entrypoints) {
  const seen = new Set();
  const q = [ep.id];
  for (let h = 0; h < q.length; h++) {
    const id = q[h];
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nx of flat.get(id) ?? []) {
      flatVisits++; // every successor is EXAMINED, even the ones filtered out
      if (nx.route === null || nx.route === ep.id) q.push(nx.to);
    }
  }
}

let idxVisits = 0;
for (const ep of g.entrypoints) {
  const seen = new Set();
  const q = [ep.id];
  for (let h = 0; h < q.length; h++) {
    const id = q[h];
    if (seen.has(id)) continue;
    seen.add(id);
    const slot = g.cfOut.get(id);
    if (!slot) continue;
    for (const s of slot.shared) {
      idxVisits++;
      q.push(s.to);
    }
    for (const s of slot.byRoute?.get(ep.id) ?? []) {
      idxVisits++;
      q.push(s.to);
    }
  }
}

const eps = g.entrypoints.length;
console.log(
  `  edge visits: flat=${flatVisits} (routes²=${eps * eps})  partitioned=${idxVisits}  →  ${(flatVisits / Math.max(idxVisits, 1)).toFixed(1)}× fewer`,
);
