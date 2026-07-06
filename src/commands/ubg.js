// commands/ubg.js — compile the codebase to its Unified Behavior Graph.
// The UBG is the IR every future SPARDA tool reads (time-travel debuggers,
// deploy provers, state-machine runtimes): compile once here, write passes
// there. Artifact: .sparda/ubg.json — regenerable, deterministic, never
// committed. `--json` prints the raw graph, `--out <file>` redirects it.
import { compileUBG } from '../ubg/compile.js';

export async function runUbg(opts) {
  const { report, json, outPath } = compileUBG(opts.cwd, {
    write: true,
    out: opts.out,
    openapi: opts.openapi ?? null,
  });

  if (opts.json) {
    console.log(json);
    return { report };
  }

  const { counts } = report;
  console.log(
    `✓ UBG compiled: ${rel(outPath, opts.cwd)} — ${counts.totalNodes} nodes, ${counts.totalEdges} edges`,
  );
  console.log(
    `  ${report.framework} · ${report.routes} routes · ${report.tables} SQL tables`,
  );
  console.log(`  Nodes: ${fmtCounts(counts.nodes)}`);
  console.log(`  Edges: ${fmtCounts(counts.edges)}`);

  for (const p of report.passes) {
    if (p.pass === 'DeadPathElimination' && p.removed)
      console.log(`  ${p.pass}: ${p.removed} dead node(s) removed`);
    else if (p.pass === 'StateMinimization' && p.merged)
      console.log(`  ${p.pass}: ${p.merged} logic block(s) merged`);
    else if (p.pass === 'TypePropagation' && (p.resolved || p.entrypointsTyped))
      console.log(
        `  ${p.pass}: ${p.entrypointsTyped} entrypoint return schema(s), ${p.resolved} type(s) resolved`,
      );
    else if (p.pass === 'EffectAlgebra' && p.classified)
      console.log(
        `  ${p.pass}: ${p.classified} effect(s) classified, ${p.observable} observable`,
      );
    else if (p.pass === 'ConsistencyDomains' && Object.keys(p.domains ?? {}).length) {
      const names = Object.keys(p.domains).sort();
      console.log(
        `  ${p.pass}: ${names.length} domain(s) — ${names.join(', ')}${p.cycles.length ? ` (⚠ FK cycle: ${p.cycles.join(', ')})` : ''}`,
      );
    } else if (p.pass === 'CapabilityExtraction' && p.capabilities)
      console.log(
        `  ${p.pass}: ${p.capabilities} capability(ies), ${p.guardsAnnotated} guard(s) annotated`,
      );
    else if (p.pass === 'ResourceLifetimes' && p.annotated)
      console.log(
        `  ${p.pass}: ${p.annotated} state(s)${p.immortal.length ? ` — immortal: ${p.immortal.join(', ')}` : ''}`,
      );
    else if (p.pass === 'StateMachineInference' && p.machines)
      console.log(`  ${p.pass}: ${p.machines} machine(s) inferred`);
  }

  if (report.link.inferredTables.length)
    console.log(
      `  ⚠ tables referenced in code but absent from .sql schemas: ${report.link.inferredTables.join(', ')}`,
    );
  if (report.skipped.length) {
    console.log(`  · ${report.skipped.length} construct(s) out of static reach:`);
    for (const s of report.skipped.slice(0, opts.verbose ? 100 : 5))
      console.log(`    - ${s.reason}${s.file ? ` (${s.file})` : ''}`);
    if (!opts.verbose && report.skipped.length > 5)
      console.log(`    … ${report.skipped.length - 5} more (--verbose)`);
  }
  return { report };
}

const fmtCounts = (obj) =>
  Object.entries(obj)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');

const rel = (abs, cwd) =>
  abs.startsWith(cwd) ? abs.slice(cwd.length + 1).replaceAll('\\', '/') : abs;
