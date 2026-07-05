// ubg/reach.js — route-aware reachability, the one traversal everything
// per-entrypoint shares. Chain control_flow edges carry meta.route; walking
// from an entrypoint never crosses into a sibling route's chain (a middleware
// shared by N routes fans out to N handlers, but a request walks ONE edge).
export function buildCfIndex(edges) {
  const cfOut = new Map();
  for (const e of edges) {
    if (e.kind !== 'control_flow') continue;
    if (!cfOut.has(e.from)) cfOut.set(e.from, []);
    cfOut.get(e.from).push({ to: e.to, route: e.meta?.route ?? null });
  }
  return cfOut;
}

export function reachFrom(epId, cfOut) {
  const seen = new Set();
  const queue = [epId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of cfOut.get(id) ?? []) {
      if (next.route === null || next.route === epId) queue.push(next.to);
    }
  }
  seen.delete(epId);
  return seen;
}

// entrypointId -> Set(reached node ids), for every entrypoint, sorted walk
export function reachabilityOf(graph) {
  const cfOut = buildCfIndex(graph.edges);
  const map = new Map();
  const entrypoints = [...graph.nodes.values()]
    .filter((n) => n.kind === 'entrypoint')
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const ep of entrypoints) map.set(ep.id, reachFrom(ep.id, cfOut));
  return map;
}
