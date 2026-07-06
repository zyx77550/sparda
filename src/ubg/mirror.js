// ubg/mirror.js — the Mirror VM: the graph IS the server.
// Everything the compiler extracted — entrypoints, guards, gate edges, typed
// return schemas, state machines — is enough to ANSWER HTTP. No Express, no
// FastAPI, no source code: `sparda mirror` boots a server from ubg.json alone.
// This is the existence proof that SBIR is an executable IR, and a working
// product on day one: front-end teams develop against the mirror of a backend
// that isn't deployed (or isn't written) yet, contracts are enforced by
// construction, guards actually deny.
//
// Honesty contract: the mirror serves the DECLARED behavior — typed shapes,
// guard denials, state-machine-aware placeholders — never invented business
// values. Every response carries `x-sparda-mirror: true`.
import http from 'node:http';

export function createMirrorServer(graph) {
  const routes = buildRouteTable(graph);

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const method = (req.method ?? 'GET').toLowerCase();

    const match = routes.find((r) => r.method === method && r.pattern.test(url));
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-sparda-mirror', 'true');

    if (!match) {
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          error: `no compiled behavior for ${method.toUpperCase()} ${url}`,
          knownRoutes: routes.map((r) => `${r.method.toUpperCase()} ${r.path}`),
        }),
      );
      return;
    }

    // gates are real here: a guarded entrypoint denies without credentials —
    // the same fail-closed posture the compiled app declared
    if (match.guarded && !req.headers.authorization && !req.headers['x-api-key']) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          error: 'unauthorized',
          guard: match.guards.join(', '),
          hint: 'the graph gates this entrypoint — send Authorization or X-API-Key',
        }),
      );
      return;
    }

    res.statusCode = match.mutating ? 201 : 200;
    res.end(JSON.stringify(responseOf(match, url)));
  });

  return { server, routes };
}

function buildRouteTable(graph) {
  // canonical (serialized) graphs carry nodes as an array
  const nodes = Array.isArray(graph.nodes)
    ? new Map(graph.nodes.map((n) => [n.id, n]))
    : graph.nodes;
  const gateByHandler = new Map(); // handler id -> [guard labels]
  for (const e of graph.edges) {
    if (e.kind !== 'gate') continue;
    if (!gateByHandler.has(e.to)) gateByHandler.set(e.to, []);
    gateByHandler.get(e.to).push(nodes.get(e.from)?.label ?? e.from);
  }
  const handlerOf = new Map(); // entrypoint id -> handler id (last chain hop)
  const chainEdges = [...graph.edges].filter(
    (e) => e.kind === 'control_flow' && e.meta?.route,
  );
  for (const ep of nodes.values()) {
    if (ep.kind !== 'entrypoint') continue;
    const own = chainEdges.filter((e) => e.meta.route === ep.id);
    if (own.length) {
      const last = own.reduce((a, b) => (a.meta.order > b.meta.order ? a : b));
      handlerOf.set(ep.id, last.to);
    }
  }

  const routes = [];
  for (const node of [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (node.kind !== 'entrypoint') continue;
    const handlerId = handlerOf.get(node.id);
    const guards = handlerId ? (gateByHandler.get(handlerId) ?? []) : [];
    routes.push({
      method: node.meta.method,
      path: node.meta.path,
      pattern: patternOf(node.meta.path),
      params: node.meta.inputs ?? [],
      returns: node.meta.returns ?? null,
      mutating: Boolean(node.meta.mutating),
      guarded: guards.length > 0,
      guards: guards.sort(),
      mutatesDomains: node.meta.mutatesDomains ?? [],
    });
  }
  return routes;
}

// '/users/:id' and '/users/{id}' both match '/users/42'
function patternOf(routePath) {
  const escaped = routePath
    .replace(/[.*+?^$()[\]\\|]/g, '\\$&')
    .replace(/:(\w+)/g, '([^/]+)')
    .replace(/\\?\{(\w+)\\?\}/g, '([^/]+)');
  return new RegExp(`^${escaped}/?$`);
}

// typed placeholders, deterministic: the mirror never invents business values,
// it renders the declared SHAPE — path params echo back, unions take the
// first branch, everything else is the zero value of its type
function responseOf(match, url) {
  const paramValues = match.pattern.exec(url)?.slice(1) ?? [];
  const pathParams = match.params.filter((p) => p.in === 'path');
  const byParam = Object.fromEntries(pathParams.map((p, i) => [p.name, paramValues[i]]));

  if (!match.returns) {
    return match.mutating ? { ok: true, mirror: true } : { mirror: true, ...byParam };
  }
  const out = {};
  for (const [key, type] of Object.entries(match.returns)) {
    out[key] = byParam[key] !== undefined ? byParam[key] : zeroOf(type);
  }
  return out;
}

function zeroOf(type) {
  const first = String(type).split('|').sort()[0];
  switch (first) {
    case 'string':
      return 'mirror';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'null':
      return null;
    default:
      return null;
  }
}
