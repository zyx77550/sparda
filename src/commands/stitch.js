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
  // A service that does not compile is UNMEASURED, and the join is only as complete as the
  // set it ran over. The failure used to go to stderr and nowhere else: the headline still
  // said "no cross-service calls resolved (targets may be dynamic or unrelated)" — a
  // reassuring parenthetical for what was really "we compiled one of your two services".
  // Cross-service BOLA is found by JOINING; half a join finds nothing and says nothing,
  // which is the most confident silence in the product.
  const services = [];
  const unread = [];
  for (const d of dirs) {
    const abs = path.resolve(opts.cwd, d);
    try {
      const { graph } = compileUBG(abs, { write: false });
      const g = canonicalizeGraph(graph);
      const { findings } = checkGraph(g);
      services.push({ name: path.basename(abs), graph: g, findings });
    } catch (e) {
      unread.push({ dir: d, reason: e.message.slice(0, 140) });
    }
  }

  const { edges, findings } = stitchServices(services);

  if (opts.json) {
    console.log(
      JSON.stringify(
        { services: services.map((s) => s.name), unread, edges, findings },
        null,
        2,
      ),
    );
    // the JSON consumer is a CI job, and it must not read an empty `findings` over a partial
    // join as a clean bill of health
    if (unread.length) process.exitCode = 1;
    return;
  }

  console.log(`\nSPARDA · stitch — ${services.map((s) => s.name).join(' · ')}`);
  console.log('─'.repeat(52));
  // stated BEFORE the result, because it is the qualifier on everything that follows
  for (const u of unread) console.log(`  ✗ ${u.dir} did not compile — ${u.reason}`);
  if (unread.length)
    console.log(
      `  ◐ PARTIAL JOIN — ${services.length} of ${dirs.length} service(s) read.` +
        ` Any call to or from the missing one(s) is UNMEASURED, not absent.`,
    );
  if (!edges.length) {
    console.log(
      unread.length
        ? '  no cross-service calls resolved among the services that DID compile'
        : '  no cross-service calls resolved (targets may be dynamic or unrelated)',
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
  if (unread.length) process.exitCode = 1;
  return { services: services.map((s) => s.name), unread, edges, findings };
}
