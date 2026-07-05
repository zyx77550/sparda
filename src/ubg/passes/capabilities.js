// ubg/passes/capabilities.js — pass 6 (SBIR v1.2 §2.5).
// "POST /transfer" is a route; "update:users + insert:orders" is what it can
// DO. Capabilities are derived, never declared: the sorted set of verbs an
// entrypoint's reachable effects perform on named resources. Guards then
// learn what they protect — the union of the capabilities behind them. This
// is the vocabulary a permission auditor or an AI-agent policy layer reads
// instead of guessing from URL strings. Annotation-only.
import { reachabilityOf } from '../reach.js';

export const name = 'CapabilityExtraction';

export function run(graph) {
  const reach = reachabilityOf(graph);
  const mutOut = new Map();
  const readIn = new Map(); // effect id -> state ids read
  for (const e of graph.edges) {
    if (e.kind === 'mutation') {
      if (!mutOut.has(e.from)) mutOut.set(e.from, []);
      mutOut.get(e.from).push(e);
    }
    if (e.kind === 'data_flow' && graph.nodes.get(e.from)?.kind === 'state') {
      if (!readIn.has(e.to)) readIn.set(e.to, []);
      readIn.get(e.to).push(e.from);
    }
  }

  const all = new Set();
  const guardProtects = new Map();

  for (const [epId, reached] of reach) {
    const ep = graph.nodes.get(epId);
    const caps = new Set();
    for (const id of [...reached].sort()) {
      const node = graph.nodes.get(id);
      if (node?.kind !== 'effect') continue;
      for (const m of mutOut.get(id) ?? []) {
        const table = graph.nodes.get(m.to)?.meta.table ?? 'unknown';
        caps.add(`${m.meta.op ?? 'write'}:${table}`);
      }
      for (const sid of readIn.get(id) ?? []) {
        caps.add(`read:${graph.nodes.get(sid)?.meta.table ?? 'unknown'}`);
      }
      if (node.meta.effectType === 'http_call')
        caps.add(`call:${hostOf(node.meta.target)}`);
      if (node.meta.effectType === 'fs_write') caps.add('fs:write');
      if (node.meta.effectType === 'fs_read') caps.add('fs:read');
    }
    if (caps.size) {
      ep.meta.capabilities = [...caps].sort();
      for (const c of caps) all.add(c);
    }
    // a guard on this route protects everything the route can do
    for (const id of reached) {
      if (graph.nodes.get(id)?.kind !== 'guard') continue;
      if (!guardProtects.has(id)) guardProtects.set(id, new Set());
      for (const c of caps) guardProtects.get(id).add(c);
    }
  }

  for (const [guardId, caps] of guardProtects) {
    graph.nodes.get(guardId).meta.protects = [...caps].sort();
  }

  return { capabilities: all.size, guardsAnnotated: guardProtects.size };
}

function hostOf(target) {
  try {
    return new URL(target).host;
  } catch {
    return 'dynamic';
  }
}
