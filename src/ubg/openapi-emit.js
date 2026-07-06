// ubg/openapi-emit.js — SBIR → OpenAPI 3.1.
// The inversion of openapi.js: the graph does not just CONSUME the industry
// standard, it PRODUCES it. Everything a spec can hold, the compiler already
// knows richer — entrypoints, typed inputs, guard-derived security, typed
// return schemas. We emit that as a valid OpenAPI document so any downstream
// tool (Swagger UI, client codegen, Postman) reads SPARDA's understanding of
// a Go/Java/Rails backend it never had a spec for. Deterministic: sorted
// paths, sorted keys, no timestamps — same graph, same bytes.
const OA_TYPE = {
  string: { type: 'string' },
  integer: { type: 'integer' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  array: { type: 'array', items: {} },
  object: { type: 'object' },
  null: { type: 'null' },
};

function schemaFor(type) {
  const first = String(type ?? 'unknown').split('|')[0];
  return OA_TYPE[first] ?? {}; // {} is OpenAPI's "any" — honest for unknowns
}

export function emitOpenAPI(
  graph,
  { title = 'sparda-compiled-api', version = '1.0.0' } = {},
) {
  const nodes = Array.isArray(graph.nodes)
    ? new Map(graph.nodes.map((n) => [n.id, n]))
    : graph.nodes;

  // handler id -> guard labels (gate edges), and entrypoint -> handler
  const gateByHandler = new Map();
  for (const e of graph.edges) {
    if (e.kind !== 'gate') continue;
    if (!gateByHandler.has(e.to)) gateByHandler.set(e.to, []);
    gateByHandler.get(e.to).push(nodes.get(e.from)?.label ?? e.from);
  }
  const handlerOf = new Map();
  for (const e of graph.edges) {
    if (e.kind !== 'control_flow' || !e.meta?.route) continue;
    const prev = handlerOf.get(e.meta.route);
    if (!prev || e.meta.order > prev.order)
      handlerOf.set(e.meta.route, { to: e.to, order: e.meta.order });
  }

  const paths = {};
  let anyGuarded = false;

  const entrypoints = [...nodes.values()]
    .filter((n) => n.kind === 'entrypoint')
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const ep of entrypoints) {
    const oaPath = ep.meta.path.replace(/:(\w+)/g, '{$1}'); // :id → {id}
    const method = ep.meta.method;
    const handlerId = handlerOf.get(ep.id)?.to;
    const guards = handlerId ? (gateByHandler.get(handlerId) ?? []) : [];
    if (guards.length) anyGuarded = true;

    const op = { operationId: operationId(method, ep.meta.path) };
    if (ep.meta.description) op.summary = ep.meta.description;

    const parameters = (ep.meta.inputs ?? [])
      .filter((p) => p.in === 'path' || p.in === 'query')
      .map((p) => ({
        name: p.name,
        in: p.in,
        required: p.in === 'path' ? true : Boolean(p.required),
        schema: schemaFor(p.type),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (parameters.length) op.parameters = parameters;

    if (ep.meta.inputValidated && method !== 'get') {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      };
    }

    const status = ep.meta.mutating ? '201' : '200';
    const responses = {
      [status]: buildResponse(ep.meta.returns),
    };
    if (guards.length) responses['401'] = { description: 'unauthorized (guard denies)' };
    op.responses = responses;

    if (guards.length) op.security = [{ bearerAuth: [] }];

    paths[oaPath] ??= {};
    paths[oaPath][method] = op;
  }

  const doc = {
    openapi: '3.1.0',
    info: { title, version },
    paths: sortKeysDeep(paths),
  };
  if (anyGuarded) {
    doc.components = {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    };
  }
  return sortKeysDeep(doc);
}

function buildResponse(returns) {
  if (!returns || !Object.keys(returns).length) return { description: 'OK' };
  const properties = {};
  for (const [key, type] of Object.entries(returns)) properties[key] = schemaFor(type);
  return {
    description: 'OK',
    content: { 'application/json': { schema: { type: 'object', properties } } },
  };
}

function operationId(method, routePath) {
  const slug = routePath
    .replace(/[{}]/g, '')
    .replace(/:(\w+)/g, 'by_$1')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return `${method}_${slug}`.toLowerCase();
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}
