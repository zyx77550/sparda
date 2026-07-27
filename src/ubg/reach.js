// ubg/reach.js — route-aware reachability, the ONE traversal everything
// per-entrypoint shares. Chain control_flow edges carry meta.route; walking
// from an entrypoint never crosses into a sibling route's chain (a middleware
// shared by N routes fans out to N handlers, but a request walks ONE edge).
//
// ── The route-partitioned index (why this file has an index at all) ─────────
// A flat adjacency list makes that route filter cost O(fan-out) per hop, and a
// GLOBAL middleware's fan-out IS the route count — so one walk per entrypoint
// costs O(routes) at the shared node, and a full pass costs O(routes²).
// Measured before this index, on a synthetic Express app with one global
// middleware: 100 routes → 10 250 edge visits, 1 000 → 1 002 500,
// 4 000 → 16 010 000. Exactly routes².
//
// So the index partitions each node's successors BY ROUTE at build time: a hop
// reads only the successors belonging to the walking entrypoint, plus the
// route-less ones. O(1) amortised instead of O(routes) — the pass is linear in
// the graph.
//
// ORDER IS PART OF THE CONTRACT. Successors keep their rank in the original
// edge order (`i`), and a hop merges the two partitions back by rank, so the
// visit order — and therefore the insertion order of the returned Set — is
// IDENTICAL to a flat scan of the unpartitioned list. Consumers that read the
// Set without sorting keep byte-for-byte identical output. This index is a
// speed change, never a semantic one.

// edges → Map<fromId, { shared: Succ[], byRoute: Map<routeId, Succ[]> }>
// Succ = { i, to }, where `i` is the successor's rank in the original edge order.
export function buildCfIndex(edges) {
  const cfOut = new Map();
  let rank = 0;
  for (const e of edges) {
    if (e.kind !== 'control_flow') continue;
    let slot = cfOut.get(e.from);
    if (!slot) cfOut.set(e.from, (slot = { shared: [], byRoute: null }));
    const succ = { i: rank++, to: e.to };
    const route = e.meta?.route ?? null;
    if (route === null) {
      slot.shared.push(succ);
    } else {
      slot.byRoute ??= new Map();
      const bucket = slot.byRoute.get(route);
      if (bucket) bucket.push(succ);
      else slot.byRoute.set(route, [succ]);
    }
  }
  return cfOut;
}

// The successors of a node that a request entering at `epId` may actually walk,
// in original edge order. Both partitions are already rank-sorted, so the merge
// is linear — and the common cases (only shared, or only routed) return an
// existing array with no allocation at all.
function successorsFor(slot, epId) {
  const routed = slot.byRoute?.get(epId);
  if (!routed) return slot.shared;
  if (slot.shared.length === 0) return routed;
  const out = [];
  let a = 0;
  let b = 0;
  while (a < slot.shared.length && b < routed.length)
    out.push(slot.shared[a].i < routed[b].i ? slot.shared[a++] : routed[b++]);
  while (a < slot.shared.length) out.push(slot.shared[a++]);
  while (b < routed.length) out.push(routed[b++]);
  return out;
}

// Breadth-first, exactly as before — but the queue is a cursor over an array
// instead of Array#shift(), which is O(n) per dequeue and made a wide frontier
// quadratic on its own. Same order, same Set, no copying.
export function reachFrom(epId, cfOut) {
  const seen = new Set();
  const queue = [epId];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (seen.has(id)) continue;
    seen.add(id);
    const slot = cfOut.get(id);
    if (!slot) continue;
    for (const succ of successorsFor(slot, epId)) queue.push(succ.to);
  }
  seen.delete(epId);
  return seen;
}

// entrypointId -> Set(reached node ids), for every entrypoint, sorted walk.
//
// MEMOISED per graph TOPOLOGY, because the pipeline asks for this same map
// several times over one unchanged graph (three optimizer passes, then
// checkGraph / blindspots / fingerprint / falsify / the type-lock). The stamp is
// the identity AND length of `graph.edges` plus `graph.nodes.size`, which is
// sound against every mutation shape in this codebase: passes that change
// topology REPLACE the edges array (`graph.edges = …filter(…)` — dead-path
// elimination, state minimization), giving a new identity, and `addEdge` pushes,
// changing the length. A stale map would silently UNDER-report reachability —
// i.e. hide a finding — so the stamp is deliberately over-sensitive: any doubt
// rebuilds.
const reachCache = new WeakMap();

export function reachabilityOf(graph) {
  const hit = reachCache.get(graph);
  if (
    hit &&
    hit.edgesRef === graph.edges &&
    hit.edgesLen === graph.edges.length &&
    hit.nodesSize === graph.nodes.size
  )
    return hit.map;

  const cfOut = buildCfIndex(graph.edges);
  const map = new Map();
  const entrypoints = [...graph.nodes.values()]
    .filter((n) => n.kind === 'entrypoint')
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const ep of entrypoints) map.set(ep.id, reachFrom(ep.id, cfOut));

  reachCache.set(graph, {
    edgesRef: graph.edges,
    edgesLen: graph.edges.length,
    nodesSize: graph.nodes.size,
    map,
  });
  return map;
}
