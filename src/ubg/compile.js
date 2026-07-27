// ubg/compile.js — the orchestrator: codebase in, UBG out.
// detect → extract (framework routes + SQL schemas) → translate → link →
// optimize → canonicalize. 100% local, zero network, zero LLM, deterministic:
// the only inputs are the bytes of the source tree, the only output is the
// graph plus an honest report of everything the static eye could NOT see.
import { detectStack } from '../detect.js';
import { clearModuleCache } from './extract.js';
import { extractExpress } from './express.js';
import { extractNest } from './nestjs.js';
import { extractMedusa } from './medusa.js';
import { extractStrapi } from './strapi.js';
import { extractNext } from './nextjs.js';
import { extractFastAPI } from './fastapi.js';
import { extractOpenAPI } from './openapi.js';
import { parseSqlSchemas } from './sql.js';
import { parsePrismaSchemas } from './prisma.js';
import { translate } from './translate.js';
import { linkDataFlow } from './link.js';
import { optimize } from './pipeline.js';
import { validateGraph } from './schema.js';
import { serializeGraph, sourceHashOf, writeGraph } from './serialize.js';

export function compileUBG(
  cwd,
  { write = true, out = null, optimizePasses = true, openapi = null, budgetMs } = {},
) {
  clearModuleCache(); // each compile run parses fresh — no stale-file ghosts

  // --openapi: the universal lowering — no framework detection, ANY backend
  // that carries a spec enters the graph (Go, Java, Rails, .NET, whatever)
  const stack = openapi ? { framework: 'openapi', entryFile: openapi } : detectStack(cwd);
  const extractors = {
    express: () => extractExpress(cwd, stack.entryFile, { budgetMs }),
    nestjs: () => extractNest(cwd, stack.entryFile),
    medusa: () => extractMedusa(cwd, stack.entryFile),
    strapi: () => extractStrapi(cwd, stack.entryFile),
    nextjs: () => extractNext(cwd, stack.entryFile),
    fastapi: () => extractFastAPI(cwd, stack.entryFile, stack.pythonCmd),
    // Flask reuses the FastAPI (Python) extractor — same stdlib-ast walk, Flask route
    // discovery folded in (Flask()/Blueprint/@app.route/register_blueprint/@login_required).
    flask: () => extractFastAPI(cwd, stack.entryFile, stack.pythonCmd),
    openapi: () => extractOpenAPI(cwd, stack.entryFile),
  };
  if (!extractors[stack.framework]) {
    throw Object.assign(
      new Error(`UBG compiler has no lowering for ${stack.framework} yet.`),
      { code: 'USER' },
    );
  }
  const extracted = extractors[stack.framework]();

  const sql = parseSqlSchemas(cwd);
  const prisma = parsePrismaSchemas(cwd);
  // DDL beats ORM on a name collision — the database is the closer truth
  const sqlNames = new Set(sql.tables.map((t) => t.name));
  const tables = [...sql.tables, ...prisma.tables.filter((t) => !sqlNames.has(t.name))];

  const graph = translate({
    framework: stack.framework,
    routes: extracted.routes,
    globalMiddlewares: extracted.globalMiddlewares,
    helpers: extracted.helpers,
    tables,
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
      ...tables.map((t) => t.sourceFile),
    ]),
  };

  const report = {
    framework: stack.framework,
    entry: stack.entryFile,
    routes: extracted.routes.length,
    tables: tables.length,
    ...(prisma.tables.length ? { prismaTables: prisma.tables.length } : {}),
    link: linkReport,
    passes: passReports,
    skipped: [
      ...extracted.skipped,
      ...sql.skipped,
      ...prisma.skipped,
      // A GUESSED entry point is a premise problem, not a parsing one: if the search
      // picked the wrong file, every route, guard and verdict below is about another
      // program. Measured on the parse-server repository, where the fallback chose a
      // benchmark harness. The doubt is declared at high risk so it bars PROVEN, and
      // the rejected candidates are named so a human can settle it in one look.
      ...(stack.entryCandidates?.length > 1
        ? [
            {
              reason: `entry point GUESSED: ${stack.entryFile} was chosen among ${stack.entryCandidates.length} files that create an Express app (${stack.entryCandidates.slice(0, 4).join(', ')}${stack.entryCandidates.length > 4 ? ', …' : ''}) — if it is the wrong one, everything below describes a different program`,
              file: stack.entryFile,
              risk: 'high',
            },
          ]
        : []),
    ],
    // registrations SPARDA saw but could not bind statically (computed verbs,
    // Reflect.apply, …) — each already carries a high-risk skipped twin, this is
    // the structured object for tooling
    ...(extracted.unknownHandlers?.length
      ? { unknownHandlers: extracted.unknownHandlers }
      : {}),
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
