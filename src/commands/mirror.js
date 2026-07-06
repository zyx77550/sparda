// commands/mirror.js — serve the compiled behavior, delete the framework.
//   sparda mirror                 compile the tree (or --openapi spec) and serve it
//   sparda mirror --port 5050     pick the port
//   sparda ubg --openapi api.json && sparda mirror   any backend on earth
// The graph answers HTTP: guards deny (401), responses come out typed from
// the compiled return schemas, unknown paths list what the graph knows.
// Front-ends develop against backends that aren't deployed — or written.
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { createMirrorServer } from '../ubg/mirror.js';

export async function runMirror(opts) {
  // prefer the already-compiled artifact; compile fresh when absent
  const artifact = path.join(opts.cwd, '.sparda', 'ubg.json');
  let graph;
  if (fs.existsSync(artifact) && !opts.openapi) {
    graph = JSON.parse(fs.readFileSync(artifact, 'utf8'));
  } else {
    graph = JSON.parse(
      compileUBG(opts.cwd, { write: false, openapi: opts.openapi ?? null }).json,
    );
  }

  const { server, routes } = createMirrorServer(graph);
  const port = Number(opts.port ?? 4477);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  console.log(
    `MIRROR — the graph is serving. ${routes.length} entrypoint(s) on http://127.0.0.1:${port}`,
  );
  for (const r of routes) {
    console.log(
      `  ${r.method.toUpperCase().padEnd(6)} ${r.path}${r.guarded ? '  🔒 ' + r.guards.join(',') : ''}${r.returns ? '  → {' + Object.keys(r.returns).join(', ') + '}' : ''}`,
    );
  }
  console.log('  (every response carries x-sparda-mirror: true — Ctrl+C to stop)');
  return { server, routes, port };
}
