// ubg/openapi.js — ANY backend enters the graph.
// The industry already agreed on one universal behavior declaration: OpenAPI.
// Instead of writing a parser per language, this importer lowers a spec into
// the same route facts the AST extractors produce — Go, Java, Rails, Laravel,
// .NET: if it has a spec, it compiles. What a spec declares: entrypoints,
// input schemas (declared schema ⇒ the framework validates ⇒ inputValidated),
// security schemes (⇒ guard nodes gating every secured operation), response
// shapes (⇒ returns, typed). What a spec cannot declare — effects, state,
// transactions — stays honestly absent; pair the spec with .sql/schema.prisma
// files and the state layer fills in from declared truth.
// JSON specs only in v1 (YAML needs either a dep or a lie — we take neither).
import fs from 'node:fs';
import path from 'node:path';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);

const err = (message, hint) => Object.assign(new Error(message), { code: 'USER', hint });

export function extractOpenAPI(cwd, specPath) {
  const abs = path.resolve(cwd, specPath);
  if (!fs.existsSync(abs)) throw err(`OpenAPI spec not found: ${specPath}`);
  if (/\.ya?ml$/i.test(abs))
    throw err(
      'YAML specs are not supported in v1 — the compiler takes zero dependencies and refuses to half-parse YAML.',
      'convert once: npx -y js-yaml your-spec.yaml > openapi.json',
    );

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw err(`OpenAPI spec is not valid JSON: ${e.message.slice(0, 80)}`);
  }
  if (!spec.paths || typeof spec.paths !== 'object')
    throw err('not an OpenAPI document: no "paths" object');

  const sourceFile = path.relative(cwd, abs).split(path.sep).join('/');
  const skipped = [];
  const routes = [];
  const securitySchemes = Object.keys(spec.components?.securitySchemes ?? {}).sort();
  const globalSecurity = (spec.security ?? []).flatMap((s) => Object.keys(s));

  for (const [rawPath, item] of Object.entries(spec.paths).sort()) {
    if (typeof item !== 'object' || item === null) continue;
    for (const verb of [...VERBS].sort()) {
      const op = item[verb];
      if (!op) continue;
      const schemes = opSecurity(op, globalSecurity, securitySchemes);
      const chain = schemes.map((scheme) => ({
        name: scheme,
        role: 'middleware',
        sourceFile,
        sourceLine: 0,
        // a declared security scheme IS a guard: classify via the same
        // signal the AST scanners emit
        scan: {
          effects: [],
          returnShapes: [],
          calls: [],
          guardSignals: { deniesWithStatus: true },
          validatesInput: false,
          async: false,
        },
      }));
      chain.push({
        name: op.operationId ?? `${verb}_${rawPath}`,
        role: 'handler',
        sourceFile,
        sourceLine: 0,
        scan: {
          effects: [],
          returnShapes: returnShapesOf(op, spec),
          calls: [],
          guardSignals: { deniesWithStatus: false },
          validatesInput: hasDeclaredBody(op, spec),
          async: false,
        },
      });

      routes.push({
        method: verb,
        path: rawPath,
        sourceFile,
        sourceLine: 0,
        params: paramsOf(op, item, rawPath),
        chain,
        description: (op.summary ?? op.description ?? '').slice(0, 400),
      });
    }
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return {
    routes,
    globalMiddlewares: [],
    helpers: [],
    skipped,
    scannedFiles: [sourceFile],
  };
}

function opSecurity(op, globalSecurity, known) {
  const local = op.security ? op.security.flatMap((s) => Object.keys(s)) : null;
  const active = local ?? globalSecurity;
  return [...new Set(active.filter((s) => known.includes(s) || active.length))].sort();
}

function paramsOf(op, item, rawPath) {
  const params = [];
  const declared = [...(item.parameters ?? []), ...(op.parameters ?? [])];
  const seen = new Set();
  for (const p of declared) {
    if (!p?.name || seen.has(p.name)) continue;
    seen.add(p.name);
    if (p.in !== 'path' && p.in !== 'query') continue;
    params.push({
      name: p.name,
      in: p.in,
      type: schemaType(p.schema),
      required: Boolean(p.required),
    });
  }
  // path template params not redundantly declared still exist
  for (const m of rawPath.matchAll(/\{(\w+)\}/g)) {
    if (!seen.has(m[1]))
      params.push({ name: m[1], in: 'path', type: 'string', required: true });
  }
  return params;
}

function hasDeclaredBody(op, spec) {
  const schema =
    op.requestBody?.content?.['application/json']?.schema ?? op.requestBody?.content;
  return Boolean(deref(schema, spec));
}

// 2xx application/json schema → one returnShape with typed values
function returnShapesOf(op, spec) {
  for (const [status, resp] of Object.entries(op.responses ?? {}).sort()) {
    if (!/^2\d\d$/.test(status)) continue;
    const schema = deref(resp?.content?.['application/json']?.schema, spec);
    if (!schema) continue;
    const target = schema.type === 'array' ? deref(schema.items, spec) : schema;
    if (!target?.properties) continue;
    const shape = {};
    for (const [key, prop] of Object.entries(target.properties).sort()) {
      shape[key] = schemaType(deref(prop, spec));
    }
    return [{ line: 0, shape }];
  }
  return [];
}

function schemaType(schema) {
  switch (schema?.type) {
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    case 'string':
      return 'string';
    default:
      return 'unknown';
  }
}

// local $ref only ('#/components/…') — remote refs are out of v1 scope
function deref(schema, spec, hops = 0) {
  if (!schema || hops > 8) return schema ?? null;
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    let cur = spec;
    for (const part of schema.$ref.slice(2).split('/')) cur = cur?.[part];
    return deref(cur, spec, hops + 1);
  }
  return schema;
}
