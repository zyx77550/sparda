// ubg/passes/dead-path-elimination.js — pass 1.
// Entrypoints are the only doors into a backend. Anything logic/guard/effect
// that no entrypoint can reach is dead weight in the IR: helpers nobody calls,
// middlewares registered nowhere, effects of dead helpers. Two reaps:
//   1. entrypoints with an empty chain (unresolvable handler) — a door to
//      nowhere is not behavior, it is a scan failure already reported.
//   2. logic/guard/effect nodes unreachable from any surviving entrypoint.
// State nodes are never removed — a table is declared truth whether or not
// this snapshot of the code touches it; orphans are reported, not erased.
export const name = 'DeadPathElimination';

export function run(graph) {
  const removed = [];

  // reap 1: doors to nowhere
  const hasOutgoing = new Set(graph.edges.map((e) => e.from));
  for (const node of [...graph.nodes.values()]) {
    if (node.kind === 'entrypoint' && !hasOutgoing.has(node.id)) {
      graph.nodes.delete(node.id);
      removed.push({ id: node.id, reason: 'entrypoint with no resolvable chain' });
    }
  }
  graph.edges = graph.edges.filter(
    (e) => graph.nodes.has(e.from) && graph.nodes.has(e.to),
  );

  // reap 2: flood-fill from entrypoints over all edge kinds (state→effect
  // data_flow edges are traversed backwards implicitly: an effect is reached
  // via its handler's control_flow, and state is exempt anyway)
  const out = new Map();
  for (const e of graph.edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  const reachable = new Set();
  const queue = [...graph.nodes.values()]
    .filter((n) => n.kind === 'entrypoint')
    .map((n) => n.id)
    .sort();
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of out.get(id) ?? []) if (!reachable.has(next)) queue.push(next);
  }

  const orphanState = [];
  for (const node of [...graph.nodes.values()]) {
    if (node.kind === 'entrypoint') continue;
    if (node.kind === 'state') {
      if (!touchedState(graph, node.id, reachable)) orphanState.push(node.id);
      continue;
    }
    if (!reachable.has(node.id)) {
      graph.nodes.delete(node.id);
      removed.push({ id: node.id, reason: 'unreachable from any entrypoint' });
    }
  }
  graph.edges = graph.edges.filter(
    (e) => graph.nodes.has(e.from) && graph.nodes.has(e.to),
  );

  removed.sort((a, b) => a.id.localeCompare(b.id));
  orphanState.sort();
  return { removed: removed.length, details: removed, orphanState };
}

function touchedState(graph, stateNodeId, reachable) {
  return graph.edges.some(
    (e) =>
      (e.to === stateNodeId && reachable.has(e.from)) ||
      (e.from === stateNodeId && reachable.has(e.to)),
  );
}
