// ubg/passes/type-propagation.js — pass 3.
// The scanner records response shapes with unresolved identifier slots
// ('unknown:userId'). This pass resolves them statically, per entrypoint, by
// walking the graph the data actually walks:
//   1. input schema (path/query params) flows entrypoint → handler — a return
//      key matching an input name inherits the input type;
//   2. rows flow state → db_read effect → handler — a return key matching a
//      column of a table the handler READS inherits the column type.
// The result lands on the entrypoint as meta.returns: the final API return
// structure, resolved without running a single line of the app. Conflicting
// shapes across res.json() branches union into 'a|b' — the IR reports
// divergence, it does not pick a winner.
import { reachabilityOf } from '../reach.js';

export const name = 'TypePropagation';

export function run(graph) {
  let resolved = 0;
  let entrypointsTyped = 0;

  const dfIn = new Map(); // effect id -> state ids feeding it
  for (const e of graph.edges) {
    if (e.kind === 'data_flow' && graph.nodes.get(e.from)?.kind === 'state') {
      if (!dfIn.has(e.to)) dfIn.set(e.to, []);
      dfIn.get(e.to).push(e.from);
    }
  }

  // the shared route-aware reachability (ubg/reach.js) — this pass used to carry
  // its own third copy of the BFS *and* its own flat adjacency index, which made
  // it the single largest cost in the pipeline (31% of CPU on a 4 000-route app)
  const reachability = reachabilityOf(graph);
  const entrypoints = [...graph.nodes.values()]
    .filter((n) => n.kind === 'entrypoint')
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const ep of entrypoints) {
    const inputTypes = {};
    for (const p of ep.meta.inputs ?? []) inputTypes[p.name] = p.type;

    // everything this entrypoint reaches: its handler(s), effects, helpers —
    // chain edges are route-tagged so shared middlewares never leak a sibling
    // route's shapes into this entrypoint
    const reach = reachability.get(ep.id) ?? new Set();

    // Columns visible to this entrypoint = union of columns of tables read.
    // Walked in SORTED id order because the merge below is first-wins: two tables
    // declaring the same column name would otherwise resolve by traversal order,
    // making the output depend on edge insertion order rather than on the graph.
    const columnTypes = {};
    for (const id of [...reach].sort()) {
      const node = graph.nodes.get(id);
      if (node?.kind !== 'effect' || node.meta.effectType !== 'db_read') continue;
      for (const sid of dfIn.get(id) ?? []) {
        const state = graph.nodes.get(sid);
        for (const col of state?.meta.columns ?? []) {
          if (!(col.name in columnTypes)) columnTypes[col.name] = col.type;
        }
      }
    }

    // collect return shapes from reached logic nodes, resolve unknown slots
    const returns = {};
    let sawShape = false;
    for (const id of [...reach].sort()) {
      const node = graph.nodes.get(id);
      if (node?.kind !== 'logic' || !node.meta.returnShapes) continue;
      for (const rs of node.meta.returnShapes) {
        sawShape = true;
        for (const [key, rawType] of Object.entries(rs.shape ?? {})) {
          let type = rawType;
          if (typeof rawType === 'string' && rawType.startsWith('unknown:')) {
            const ident = rawType.slice('unknown:'.length);
            if (inputTypes[ident]) {
              type = inputTypes[ident];
              resolved++;
            } else if (columnTypes[ident] ?? columnTypes[key]) {
              type = columnTypes[ident] ?? columnTypes[key];
              resolved++;
            } else if (columnTypes[key]) {
              type = columnTypes[key];
              resolved++;
            } else {
              type = 'unknown';
            }
          } else if (rawType === 'unknown' && columnTypes[key]) {
            type = columnTypes[key];
            resolved++;
          }
          returns[key] = unionType(returns[key], type);
        }
      }
    }

    if (sawShape) {
      ep.meta.returns = returns;
      entrypointsTyped++;
    }

    // enrich the request data_flow edge with the concrete schema types
    for (const e of graph.edges) {
      if (e.kind === 'data_flow' && e.from === ep.id && e.meta.via === 'request') {
        e.meta.schema = { ...inputTypes };
      }
    }
  }

  return { resolved, entrypointsTyped };
}

function unionType(prev, next) {
  if (prev === undefined || prev === next) return next;
  const parts = new Set([...String(prev).split('|'), ...String(next).split('|')]);
  return [...parts].sort().join('|');
}
