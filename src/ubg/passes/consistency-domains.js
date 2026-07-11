// ubg/passes/consistency-domains.js — pass 5 (SBIR v1.1 §2.3).
// Ownership is DERIVED from foreign keys, never guessed: a child's FK to a
// parent means the parent owns the child. Roots (children, no parent) name
// their domain; FK-descendants are members; FK-less tables stand alone; FK
// cycles make every participant its own root — reported, never silently
// broken. Then every entrypoint learns its blast radius: mutatesDomains =
// sorted domains of states it can reach through a mutation edge. Additive
// only (Law of Soundness): ownership edges and meta tags, zero removals.
import { addEdge, makeEdge } from '../schema.js';

export const name = 'ConsistencyDomains';

export function run(graph) {
  const states = [...graph.nodes.values()]
    .filter((n) => n.kind === 'state')
    .sort((a, b) => a.id.localeCompare(b.id));
  const byTable = new Map(states.map((n) => [n.meta.table, n]));

  // parent -> children (only between tables present in the graph)
  const children = new Map();
  const parents = new Map();
  for (const child of states) {
    for (const ref of child.meta.references ?? []) {
      const parent = byTable.get(ref.table);
      if (!parent || parent.id === child.id) continue;
      if (!children.has(parent.id)) children.set(parent.id, new Set());
      children.get(parent.id).add(child.id);
      if (!parents.has(child.id)) parents.set(child.id, new Set());
      parents.get(child.id).add(parent.id);
    }
  }

  // ownership edges — one per direct FK parent→child, sorted emission
  let ownershipEdges = 0;
  for (const parent of states) {
    for (const childId of [...(children.get(parent.id) ?? [])].sort()) {
      addEdge(graph, makeEdge('ownership', parent.id, childId, { via: 'foreign_key' }));
      ownershipEdges++;
    }
  }

  // domains: BFS from roots over the ownership relation
  const domains = {};
  const assigned = new Map(); // stateId -> domain
  const roots = states.filter((n) => children.has(n.id) && !parents.has(n.id));
  for (const root of roots) {
    const domain = pascalCase(root.meta.table);
    root.meta.consistencyDomain = domain;
    root.meta.role = 'aggregate_root';
    assigned.set(root.id, domain);
    domains[domain] = [root.meta.table];
    const queue = [...(children.get(root.id) ?? [])].sort();
    while (queue.length) {
      const id = queue.shift();
      if (assigned.has(id)) continue;
      const node = graph.nodes.get(id);
      node.meta.consistencyDomain = domain;
      node.meta.role = 'member';
      assigned.set(id, domain);
      domains[domain].push(node.meta.table);
      queue.push(...[...(children.get(id) ?? [])].sort());
    }
  }

  // leftovers: standalone tables and FK cycles (each cycle member becomes its
  // own root, deterministically — the cycle is reported, not broken)
  const cycles = [];
  for (const node of states) {
    if (assigned.has(node.id)) continue;
    const domain = pascalCase(node.meta.table);
    node.meta.consistencyDomain = domain;
    const inCycle = parents.has(node.id); // unreached + has a parent ⇒ cyclic FK chain
    node.meta.role = inCycle ? 'aggregate_root' : 'standalone';
    if (inCycle) cycles.push(node.meta.table);
    assigned.set(node.id, domain);
    domains[domain] = [node.meta.table];
  }

  // blast radius: entrypoint -> (control_flow BFS) -> effect -mutation-> state
  const cfOut = new Map();
  const mutOut = new Map();
  for (const e of graph.edges) {
    if (e.kind === 'control_flow') {
      if (!cfOut.has(e.from)) cfOut.set(e.from, []);
      cfOut.get(e.from).push({ to: e.to, route: e.meta?.route ?? null });
    }
    if (e.kind === 'mutation') {
      if (!mutOut.has(e.from)) mutOut.set(e.from, []);
      mutOut.get(e.from).push(e.to);
    }
  }
  const entrypoints = [...graph.nodes.values()]
    .filter((n) => n.kind === 'entrypoint')
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const ep of entrypoints) {
    const touched = new Set();
    const seen = new Set();
    const queue = [ep.id];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const sid of mutOut.get(id) ?? []) {
        const domain = assigned.get(sid);
        if (domain) touched.add(domain);
      }
      for (const next of cfOut.get(id) ?? []) {
        // route-tagged chain edges: never walk into a sibling route's chain
        if (next.route === null || next.route === ep.id) queue.push(next.to);
      }
    }
    if (touched.size) ep.meta.mutatesDomains = [...touched].sort();
  }

  for (const tables of Object.values(domains)) tables.sort();
  cycles.sort();
  return { domains, ownershipEdges, cycles };
}

const pascalCase = (table) =>
  table
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
