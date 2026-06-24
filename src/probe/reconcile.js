/**
 * SPARDA — Route Reconciler
 *
 * Pure function. No I/O. No side effects.
 * Merges static (AST floor) + probe (runtime-observed) route sets.
 *
 * Contract:
 *   - Static is the floor: a static route is always kept, never removed.
 *   - A key in both → source:'static' wins, flagged confirmed:true.
 *   - A key only in probe → source:'dynamic', pushed to gaps[].
 *   - Same inputs → identical output (sorted deterministically).
 *
 * Canonical key = `${METHOD} ${normalizePath(path)}`
 * normalizePath collapses :id, {id}, :anything → :param
 * so Express and FastAPI param styles compare equal.
 *
 * ESM, Node ≥ 18. Zero deps.
 */

/**
 * @typedef {Object} Route
 * @property {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'OPTIONS'|'HEAD'|'ALL'} method
 * @property {string}  path         Express-style (/users/:id)
 * @property {string[]} [pathParams]
 * @property {'static'|'dynamic'|'hybrid'} source
 * @property {boolean}  [confirmed]  true when found in both sets
 * @property {'read'|'write'} [writeClass]
 */

/**
 * @param {Route[]} staticRoutes   From parseExpressProject / parseFastAPIProject
 * @param {Route[]} probedRoutes   From probeRoutes()
 * @returns {{ routes: Route[], gaps: Route[], staticCount: number, dynamicCount: number }}
 */
export function reconcile(staticRoutes, probedRoutes) {
  // Fast path: probe empty → return static unchanged
  if (!probedRoutes || probedRoutes.length === 0) {
    const sorted = sortRoutes([...staticRoutes]);
    return {
      routes: sorted,
      gaps: [],
      staticCount: staticRoutes.length,
      dynamicCount: 0,
    };
  }

  // Index static routes by canonical key
  const staticIndex = new Map();
  for (const r of staticRoutes) {
    const key = routeKey(r);
    if (!staticIndex.has(key)) {
      // Clone so we don't mutate the caller's objects
      staticIndex.set(key, { ...r });
    }
  }

  const gaps = [];

  for (const dyn of probedRoutes) {
    const key = routeKey(dyn);
    if (staticIndex.has(key)) {
      // Confirm: enrich the static entry
      const existing = staticIndex.get(key);
      existing.confirmed = true;
      // source stays 'static' — static wins per spec
    } else {
      // Gap: probe found something the AST missed
      const gap = {
        method: (dyn.method ?? 'GET').toUpperCase(),
        path: normalizeFastAPIParams(dyn.path ?? '/'),
        pathParams: extractPathParams(dyn.path ?? '/'),
        source: 'dynamic',
        confirmed: false,
        writeClass: dyn.writeClass ?? inferWriteClass(dyn.method),
      };
      gaps.push(gap);
    }
  }

  // Union: all static (some confirmed) + gaps
  const union = [...staticIndex.values(), ...gaps];
  const sorted = sortRoutes(union);

  return {
    routes: sorted,
    gaps,
    staticCount: staticRoutes.length,
    dynamicCount: gaps.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Canonical key: METHOD + normalized path.
 * /users/:id === /users/{id} === /users/:userId (all become /users/:param)
 */
function routeKey(route) {
  const method = (route.method ?? 'GET').toUpperCase();
  const path = normalizePath(route.path ?? '/');
  return `${method} ${path}`;
}

/**
 * Collapse :param and {param} to :param, lowercase, deduplicate slashes.
 * Used only for comparison (key generation).
 */
function normalizePath(path) {
  return (
    (path ?? '/')
      .replace(/\{[^}]+\}/g, ':param') // FastAPI {id}
      .replace(/:[a-zA-Z_]\w*/g, ':param') // Express :id
      .replace(/\*\*[^/]*/g, ':wildcard') // FastAPI **rest
      .replace(/\/+/g, '/')
      .replace(/\/$/, '') // strip trailing slash (except root)
      .toLowerCase() || '/'
  );
}

/**
 * Normalize FastAPI {param} → :param for the stored path field.
 * Express :param style is already canonical.
 */
function normalizeFastAPIParams(path) {
  return (
    (path ?? '/')
      .replace(/\{([^}]+)\}/g, ':$1') // {id} → :id
      .replace(/\/+/g, '/') || '/'
  );
}

/** Extract ordered param names from a path (Express or FastAPI style). */
function extractPathParams(path) {
  const params = [];
  // Express :param
  for (const m of (path ?? '').matchAll(/:([a-zA-Z_]\w*)/g)) {
    params.push(m[1]);
  }
  // FastAPI {param}
  for (const m of (path ?? '').matchAll(/\{([^}]+)\}/g)) {
    if (!params.includes(m[1])) params.push(m[1]);
  }
  return params;
}

function inferWriteClass(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes((method ?? '').toUpperCase())
    ? 'write'
    : 'read';
}

/**
 * Deterministic sort: by canonical key (METHOD path).
 * Same inputs always produce the same order.
 */
function sortRoutes(routes) {
  return routes.slice().sort((a, b) => {
    const ka = routeKey(a);
    const kb = routeKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
