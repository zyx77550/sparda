// commands/stitch.js — cross-repo / cross-service behavior stitching. Point it at two or more app
// directories (microservices of the same system); it compiles each, joins the outbound HTTP calls
// of one to the entrypoints of another, and reports the trust boundaries + any cross-service BOLA
// the join reveals — a finding no mono-repo tool can produce. Quorum sensing: each service's graph
// is a signal; the collective behavior emerges from reading them together.
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph } from '../ubg/apocalypse.js';
import { stitchServices } from '../ubg/stitch.js';

export async function runStitch(opts, dirs) {
  if (!dirs || dirs.length < 2) {
    console.error(
      'Usage: sparda stitch <dir1> <dir2> [...]  — two or more service/app directories',
    );
    process.exitCode = 1;
    return;
  }
  const services = [];
  for (const d of dirs) {
    const abs = path.resolve(opts.cwd, d);
    try {
      const { graph } = compileUBG(abs, { write: false });
      const g = canonicalizeGraph(graph);
      const { findings } = checkGraph(g);
      services.push({ name: path.basename(abs), graph: g, findings });
    } catch (e) {
      console.error(`  ✗ ${d}: ${e.message.slice(0, 70)}`);
    }
  }

  const { edges, findings } = stitchServices(services);

  if (opts.json) {
    console.log(
      JSON.stringify({ services: services.map((s) => s.name), edges, findings }, null, 2),
    );
    return;
  }

  console.log(`\nSPARDA · stitch — ${services.map((s) => s.name).join(' · ')}`);
  console.log('─'.repeat(52));
  if (!edges.length) {
    console.log(
      '  no cross-service calls resolved (targets may be dynamic or unrelated)',
    );
  } else {
    console.log(`  ${edges.length} cross-service call(s):`);
    for (const e of edges)
      console.log(`    ${e.fromService} → ${e.toService}  ${e.method} ${e.path}`);
  }
  if (findings.length) {
    console.log(`\n  ◐ ${findings.length} cross-service advisory(ies):`);
    for (const f of findings) console.log(`    ${f.message}`);
  }
  console.log('');
}
