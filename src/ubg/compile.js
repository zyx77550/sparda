// ubg/compile.js — the orchestrator: codebase in, UBG out.
// detect → extract (framework routes + SQL schemas) → translate → link →
// optimize → canonicalize. 100% local, zero network, zero LLM, deterministic:
// the only inputs are the bytes of the source tree, the only output is the
// graph plus an honest report of everything the static eye could NOT see.
import { detectStack } from '../detect.js';
import { clearModuleCache } from './extract.js';
import { extractExpress } from './express.js';
import { extractNext } from './nextjs.js';
import { parseSqlSchemas } from './sql.js';
import { translate } from './translate.js';
import { linkDataFlow } from './link.js';
import { optimize } from './pipeline.js';
import { validateGraph } from './schema.js';
import { serializeGraph, sourceHashOf, writeGraph } from './serialize.js';

export function compileUBG(
  cwd,
  { write = true, out = null, optimizePasses = true } = {},
) {
  clearModuleCache(); // each compile run parses fresh — no stale-file ghosts

  const stack = detectStack(cwd);
  if (stack.framework !== 'express' && stack.framework !== 'nextjs') {
    throw Object.assign(
      new Error(`UBG compiler supports Express & Next.js — detected ${stack.framework}.`),
      { code: 'USER', hint: 'FastAPI lowering lands in a later round.' },
    );
  }

  const extracted =
    stack.framework === 'express'
      ? extractExpress(cwd, stack.entryFile)
      : extractNext(cwd, stack.entryFile);

  const sql = parseSqlSchemas(cwd);

  const graph = translate({
    framework: stack.framework,
    routes: extracted.routes,
    globalMiddlewares: extracted.globalMiddlewares,
    helpers: extracted.helpers,
    tables: sql.tables,
  });
  validateGraph(graph);

  const linkReport = linkDataFlow(graph);
  validateGraph(graph);

  const passReports = optimizePasses ? optimize(graph) : [];

  graph.meta = {
    framework: stack.framework,
    entry: stack.entryFile,
    sourceHash: sourceHashOf(cwd, [
      ...extracted.scannedFiles,
      ...sql.tables.map((t) => t.sourceFile),
    ]),
  };

  const report = {
    framework: stack.framework,
    entry: stack.entryFile,
    routes: extracted.routes.length,
    tables: sql.tables.length,
    link: linkReport,
    passes: passReports,
    skipped: [...extracted.skipped, ...sql.skipped],
    counts: countGraph(graph),
  };

  const outPath = write ? writeGraph(graph, cwd, out) : null;
  return { graph, json: serializeGraph(graph), report, outPath };
}

function countGraph(graph) {
  const nodes = {};
  const edges = {};
  for (const n of graph.nodes.values()) nodes[n.kind] = (nodes[n.kind] ?? 0) + 1;
  for (const e of graph.edges) edges[e.kind] = (edges[e.kind] ?? 0) + 1;
  return { nodes, edges, totalNodes: graph.nodes.size, totalEdges: graph.edges.length };
}
