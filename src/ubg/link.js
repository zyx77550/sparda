// ubg/link.js — the Data-Flow Linker.
// The translator leaves db effects dangling with only a table NAME in meta;
// the SQL layer left state nodes with declared columns. Linking resolves
// name → node: writes become mutation edges (effect ─mutation{op}─▶ state),
// reads become data_flow edges (state ─data_flow{rows}─▶ effect). A table
// referenced in code but absent from any .sql file becomes an INFERRED state
// node (meta.inferred: true) — the code says it exists, the schema hasn't
// confirmed it, and that disagreement is itself a compiler finding.
import { addEdge, addNode, makeEdge, makeNode, stateId } from './schema.js';

export function linkDataFlow(graph) {
  const report = { mutations: 0, reads: 0, inferredTables: [] };

  // canonical name → state node id (schema-declared tables first)
  const stateByTable = new Map();
  for (const node of graph.nodes.values()) {
    if (node.kind === 'state' && node.meta.table)
      stateByTable.set(canonical(node.meta.table), node.id);
  }

  const effects = [...graph.nodes.values()]
    .filter(
      (n) =>
        n.kind === 'effect' &&
        (n.meta.effectType === 'db_write' || n.meta.effectType === 'db_read') &&
        n.meta.table,
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const eff of effects) {
    const table = canonical(eff.meta.table);
    let sid = stateByTable.get(table);
    if (!sid) {
      sid = stateId('inferred', table);
      addNode(
        graph,
        makeNode(sid, 'state', `table ${table} (inferred)`, null, {
          store: 'inferred',
          table,
          inferred: true,
          columns: [],
        }),
      );
      stateByTable.set(table, sid);
      report.inferredTables.push(table);
    }
    if (eff.meta.effectType === 'db_write') {
      addEdge(graph, makeEdge('mutation', eff.id, sid, { op: eff.meta.op ?? 'write' }));
      report.mutations++;
    } else {
      addEdge(graph, makeEdge('data_flow', sid, eff.id, { via: 'rows' }));
      report.reads++;
    }
  }

  report.inferredTables.sort();
  return report;
}

// users == "Users" == public.users — one identity per table
const canonical = (t) => t.toLowerCase().replace(/^public\./, '');
