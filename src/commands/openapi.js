// commands/openapi.js — emit an OpenAPI 3.1 spec FROM the behavior graph.
// We produce the standard the rest of the industry consumes: any backend
// SPARDA can compile (Express, FastAPI, Next.js — or another spec via
// --openapi) gets a valid, deterministic spec, richer than most hand-written
// ones because it comes from what the code actually declares.
//   sparda openapi                       write .sparda/openapi.json
//   sparda openapi --out api.json        pick the path
//   sparda openapi --json                print to stdout
import path from 'node:path';
import fs from 'node:fs';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { emitOpenAPI } from '../ubg/openapi-emit.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

export async function runOpenapi(opts) {
  const { graph } = compileUBG(opts.cwd, {
    write: false,
    openapi: opts.openapi ?? null,
  });
  const title = packageNameOf(opts.cwd);
  const spec = emitOpenAPI(canonicalizeGraph(graph), { title });
  const body = JSON.stringify(spec, null, 2) + '\n';

  if (opts.json) {
    console.log(body);
    return { spec };
  }
  const target = opts.out
    ? path.resolve(opts.cwd, opts.out)
    : path.join(opts.cwd, '.sparda', 'openapi.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicWrite(target, body);

  const pathCount = Object.keys(spec.paths).length;
  const opCount = Object.values(spec.paths).reduce(
    (n, p) => n + Object.keys(p).length,
    0,
  );
  console.log(
    `✓ OpenAPI 3.1 emitted: ${rel(target, opts.cwd)} — ${pathCount} path(s), ${opCount} operation(s)`,
  );
  console.log(
    '  SPARDA produces the standard others consume — feed it to Swagger UI or a codegen.',
  );
  return { spec, target };
}

function packageNameOf(cwd) {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).name ??
      'sparda-compiled-api'
    );
  } catch {
    return 'sparda-compiled-api';
  }
}

const rel = (abs, cwd) =>
  abs.startsWith(cwd) ? abs.slice(cwd.length + 1).replaceAll('\\', '/') : abs;
