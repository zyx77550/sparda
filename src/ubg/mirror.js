// ubg/mirror.js — the Mirror VM: the graph IS the server.
// Everything the compiler extracted — entrypoints, guards, gate edges, typed
// return schemas, state machines — is enough to ANSWER HTTP. No Express, no
// FastAPI, no source code: `sparda mirror` boots a server from ubg.json alone.
// This is the existence proof that SBIR is an executable IR, and a working
// product on day one: front-end teams develop against the mirror of a backend
// that isn't deployed (or isn't written) yet, contracts are enforced by
// construction, guards actually deny.
//
// STATEFUL (R5/M2): when the compiler inferred a state machine (e.g. orders.status
// pending→paid→refunded), the mirror doesn't just echo a typed shape — it LIVES the
// lifecycle. A create seeds the initial state, a transition route advances it, a read
// reflects the current value, and an ILLEGAL transition (pay an already-paid order)
// is refused 409. WireMock does this by hand and drifts; ours is derived from the
// code + schema, so it is synchronized with the backend by construction.
//
// Honesty contract: the mirror serves the DECLARED behavior — typed shapes, guard
// denials, and state-machine-aware state — never invented business values. Every
// response carries `x-sparda-mirror: true`.
import http from 'node:http';

export function createMirrorServer(graph) {
  const { routes, machines } = buildRouteTable(graph);
  // Per-instance live state: `${stateId}#${id}` -> { [field]: value }. RAM-only,
  // dies with the process — a mock has no durable store, and says so.
  const store = new Map();
  const counters = new Map(); // stateId -> last auto-minted numeric id (for creates)

  const machineInitial = (stateId) => machines.get(stateId)?.initial ?? null;
  const currentState = (stateId, field, id) =>
    store.get(`${stateId}#${id}`)?.[field] ?? machineInitial(stateId);

  const server = http.createServer((req, res) => {
    req.resume(); // the mirror never needs the request body — drain it so a client
    // that sent one (and a reused keep-alive socket) never hangs waiting on us.
    const url = (req.url ?? '/').split('?')[0];
    const method = (req.method ?? 'GET').toLowerCase();

    const match = routes.find((r) => r.method === method && r.pattern.test(url));
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-sparda-mirror', 'true');
    // A mock has no need for keep-alive, and it must not tempt a client into
    // reusing a socket. Close each connection so no HTTP client — including Node
    // 18's undici, which otherwise caches a keep-alive socket to a since-recycled
    // ephemeral port and hangs on the stale reuse — ever waits on a dead connection.
    res.setHeader('Connection', 'close');

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

    const params = pathParamsOf(match, url);

    // ── stateful writes: advance (or refuse) the declared lifecycle ──
    if (match.transitions.length) {
      const t = match.transitions[0]; // one status field per route in practice
      let id = params[match.resourceParam];
      if (t.from === '∅') {
        // a create: mint an id when the route carries none (POST /orders)
        if (id === undefined) id = mintId(counters, t.stateId);
        setState(store, t.stateId, t.field, id, t.to);
        res.statusCode = 201;
        res.end(JSON.stringify(withState(responseOf(match, url), t.field, t.to, id)));
        return;
      }
      // a transition: legal only from the declared source state ('*' = unconstrained)
      const from = currentState(t.stateId, t.field, id);
      if (t.from !== '*' && from !== t.from) {
        res.statusCode = 409;
        res.end(
          JSON.stringify({
            error: `illegal transition: ${match.method.toUpperCase()} ${match.path} requires status "${t.from}", but ${id} is "${from}"`,
            resource: id,
            field: t.field,
            from,
            attempted: t.to,
            legalFrom: t.from,
            mirror: true,
          }),
        );
        return;
      }
      setState(store, t.stateId, t.field, id, t.to);
      res.statusCode = 200;
      res.end(
        JSON.stringify(withState(responseOf(match, url), t.field, t.to, undefined)),
      );
      return;
    }

    // ── stateful reads: reflect the current lifecycle value ──
    if (match.reflect) {
      const { stateId, field } = match.reflect;
      const id = params[match.resourceParam];
      const value = currentState(stateId, field, id);
      res.statusCode = 200;
      res.end(JSON.stringify(withState(responseOf(match, url), field, value, undefined)));
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

  // state machines the compiler inferred, indexed for the runtime + per-route wiring
  const machines = new Map(); // stateId -> { stateId, field, initial, collections:Set }
  const transitionsByEp = new Map(); // epId -> [{ stateId, field, from, to }]
  const epPath = (id) => nodes.get(id)?.meta?.path ?? '';
  for (const node of nodes.values()) {
    const sm = node.meta?.stateMachine;
    if (!sm) continue;
    const insert = sm.transitions.find((t) => t.from === '∅');
    const initial = insert ? insert.to : (sm.states?.[0] ?? null);
    const collections = new Set();
    for (const t of sm.transitions)
      for (const epId of t.via ?? []) {
        collections.add(collectionBase(epPath(epId)));
        if (!transitionsByEp.has(epId)) transitionsByEp.set(epId, []);
        transitionsByEp.get(epId).push({
          stateId: node.id,
          field: sm.field,
          from: t.from,
          to: t.to,
        });
      }
    machines.set(node.id, { stateId: node.id, field: sm.field, initial, collections });
  }

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
    const params = node.meta.inputs ?? [];
    const pathParams = params.filter((p) => p.in === 'path');
    routes.push({
      method: node.meta.method,
      path: node.meta.path,
      pattern: patternOf(node.meta.path),
      params,
      returns: node.meta.returns ?? null,
      mutating: Boolean(node.meta.mutating),
      guarded: guards.length > 0,
      guards: guards.sort(),
      mutatesDomains: node.meta.mutatesDomains ?? [],
      // stateful wiring (M2)
      transitions: transitionsByEp.get(node.id) ?? [],
      resourceParam: pathParams.length ? pathParams[pathParams.length - 1].name : null,
      reflect: reflectOf(node, pathParams, machines),
    });
  }
  return { routes, machines };
}

// A read reflects a lifecycle when it targets a resource (has a path param) whose
// collection a state machine mutates, and it declares that machine's field in its
// return shape. Both conditions are structural — no guessing which read means what.
function reflectOf(node, pathParams, machines) {
  if (node.meta.mutating || !pathParams.length) return null;
  const base = collectionBase(node.meta.path);
  const returns = node.meta.returns ?? {};
  for (const m of machines.values()) {
    if (m.collections.has(base) && Object.prototype.hasOwnProperty.call(returns, m.field))
      return { stateId: m.stateId, field: m.field };
  }
  return null;
}

// '/orders/:id/pay' → '/orders'  ·  '/orders' → '/orders'  ·  '/users/{uid}/x' → '/users'
function collectionBase(routePath) {
  const out = [];
  for (const seg of String(routePath).split('/')) {
    if (seg.startsWith(':') || (seg.startsWith('{') && seg.endsWith('}'))) break;
    out.push(seg);
  }
  return out.join('/') || '/';
}

function mintId(counters, stateId) {
  const next = (counters.get(stateId) ?? 0) + 1;
  counters.set(stateId, next);
  return String(next);
}

function setState(store, stateId, field, id, value) {
  const key = `${stateId}#${id}`;
  store.set(key, { ...(store.get(key) ?? {}), [field]: value });
}

// merge the live state field (and an auto-minted id) into the typed response
function withState(base, field, value, id) {
  const out = { ...base, [field]: value };
  if (id !== undefined && out.id === undefined) out.id = id;
  return out;
}

// '/users/:id' and '/users/{id}' both match '/users/42'
function patternOf(routePath) {
  const escaped = routePath
    .replace(/[.*+?^$()[\]\\|]/g, '\\$&')
    .replace(/:(\w+)/g, '([^/]+)')
    .replace(/\\?\{(\w+)\\?\}/g, '([^/]+)');
  return new RegExp(`^${escaped}/?$`);
}

// the path params of a matched request, as { name: value }
function pathParamsOf(match, url) {
  const values = match.pattern.exec(url)?.slice(1) ?? [];
  const pathParams = match.params.filter((p) => p.in === 'path');
  return Object.fromEntries(pathParams.map((p, i) => [p.name, values[i]]));
}

// typed placeholders, deterministic: the mirror never invents business values,
// it renders the declared SHAPE — path params echo back, unions take the
// first branch, everything else is the zero value of its type
function responseOf(match, url) {
  const byParam = pathParamsOf(match, url);
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
