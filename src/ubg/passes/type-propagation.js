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
export const name = 'TypePropagation';

export function run(graph) {
  let resolved = 0;
  let entrypointsTyped = 0;

  const cfOut = new Map();
  const dfIn = new Map(); // effect id -> state ids feeding it
  for (const e of graph.edges) {
    if (e.kind === 'control_flow') {
      if (!cfOut.has(e.from)) cfOut.set(e.from, []);
      cfOut.get(e.from).push(e.to);
    }
    if (e.kind === 'data_flow' && graph.nodes.get(e.from)?.kind === 'state') {
      if (!dfIn.has(e.to)) dfIn.set(e.to, []);
      dfIn.get(e.to).push(e.from);
    }
  }

  const entrypoints = [...graph.nodes.values()]
    .filter((n) => n.kind === 'entrypoint')
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const ep of entrypoints) {
    const inputTypes = {};
    for (const p of ep.meta.inputs ?? []) inputTypes[p.name] = p.type;

    // everything this entrypoint reaches: its handler(s), effects, helpers
    const reach = bfs(ep.id, cfOut);

    // columns visible to this entrypoint = union of columns of tables read
    const columnTypes = {};
    for (const id of reach) {
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

function bfs(start, out) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of out.get(id) ?? []) if (!seen.has(next)) queue.push(next);
  }
  seen.delete(start);
  return seen;
}

function unionType(prev, next) {
  if (prev === undefined || prev === next) return next;
  const parts = new Set([...String(prev).split('|'), ...String(next).split('|')]);
  return [...parts].sort().join('|');
}
