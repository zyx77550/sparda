// ubg/passes/resource-lifetimes.js — pass 7 (SBIR v1.2 §2.6).
// Every state answers four questions: who creates me, who updates me, who
// destroys me, who reads me — as sorted entrypoint lists derived from the
// mutation/data_flow edges. The report flags two smells worth a human eye:
// immortal resources (created, never destroyed — unbounded growth) and
// unmanaged ones (destroyed here, created elsewhere — split ownership).
// Annotation-only.
import { reachabilityOf } from '../reach.js';

export const name = 'ResourceLifetimes';

const OP_BUCKET = {
  insert: 'createdBy',
  update: 'updatedBy',
  upsert: 'updatedBy',
  delete: 'destroyedBy',
};

export function run(graph) {
  const reach = reachabilityOf(graph);

  // effect id -> entrypoints that can reach it
  const epsOfEffect = new Map();
  for (const [epId, reached] of reach) {
    for (const id of reached) {
      if (graph.nodes.get(id)?.kind !== 'effect') continue;
      if (!epsOfEffect.has(id)) epsOfEffect.set(id, new Set());
      epsOfEffect.get(id).add(epId);
    }
  }

  const lifetimes = new Map(); // state id -> buckets
  const bucketsFor = (sid) => {
    if (!lifetimes.has(sid))
      lifetimes.set(sid, {
        createdBy: new Set(),
        updatedBy: new Set(),
        destroyedBy: new Set(),
        readBy: new Set(),
      });
    return lifetimes.get(sid);
  };

  for (const e of graph.edges) {
    if (e.kind === 'mutation') {
      const bucket = OP_BUCKET[e.meta.op] ?? 'updatedBy';
      for (const ep of epsOfEffect.get(e.from) ?? []) bucketsFor(e.to)[bucket].add(ep);
    }
    if (e.kind === 'data_flow' && graph.nodes.get(e.from)?.kind === 'state') {
      for (const ep of epsOfEffect.get(e.to) ?? []) bucketsFor(e.from).readBy.add(ep);
    }
  }

  const immortal = [];
  const unmanaged = [];
  let annotated = 0;
  for (const [sid, buckets] of [...lifetimes].sort((a, b) => a[0].localeCompare(b[0]))) {
    const state = graph.nodes.get(sid);
    if (!state) continue;
    state.meta.lifetime = Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, [...v].sort()]),
    );
    annotated++;
    if (buckets.createdBy.size && !buckets.destroyedBy.size)
      immortal.push(state.meta.table);
    if (buckets.destroyedBy.size && !buckets.createdBy.size)
      unmanaged.push(state.meta.table);
  }

  immortal.sort();
  unmanaged.sort();
  return { annotated, immortal, unmanaged };
}
