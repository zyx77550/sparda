// ubg/passes/state-minimization.js — pass 2.
// Linear chains of plain logic (mw₁ → mw₂ → …) carry no branching, no gates,
// no independent identity: for every downstream tool they are ONE block that
// runs top to bottom. Merging them shrinks the graph without losing a single
// behavior. Merge rule (all must hold — deterministic, order-free):
//   • edge A ─control_flow─▶ B, both kind 'logic', same source file
//   • B is A's only control_flow successor; A is B's only predecessor (any kind)
//   • B is not a handler (handlers anchor data_flow schemas and return shapes)
//   • no gate edge targets B (a gated node is a security boundary, untouchable)
// B's edges are remapped onto A, B's identity is preserved in A.meta.merged.
// Runs to fixpoint; candidates processed in sorted order so the result never
// depends on Map iteration.
import { cmp } from '../schema.js';

export const name = 'StateMinimization';

export function run(graph) {
  const mergedInto = []; // { absorbed, into }
  let changed = true;

  while (changed) {
    changed = false;
    const pair = findMergeCandidate(graph);
    if (pair) {
      mergeNodes(graph, pair.a, pair.b);
      mergedInto.push({ absorbed: pair.b, into: pair.a });
      changed = true;
    }
  }

  return { merged: mergedInto.length, details: mergedInto };
}

function findMergeCandidate(graph) {
  const outCf = new Map(); // id -> control_flow targets
  const inAll = new Map(); // id -> incoming edges (all kinds)
  const gated = new Set();
  for (const e of graph.edges) {
    if (e.kind === 'control_flow') {
      if (!outCf.has(e.from)) outCf.set(e.from, []);
      outCf.get(e.from).push(e.to);
    }
    if (e.kind === 'gate') gated.add(e.to);
    if (!inAll.has(e.to)) inAll.set(e.to, []);
    inAll.get(e.to).push(e);
  }

  const candidates = [];
  for (const [aId, targets] of outCf) {
    if (targets.length !== 1) continue;
    const bId = targets[0];
    if (aId === bId) continue;
    const a = graph.nodes.get(aId);
    const b = graph.nodes.get(bId);
    if (!a || !b || a.kind !== 'logic' || b.kind !== 'logic') continue;
    if (b.meta.role === 'handler') continue;
    if (gated.has(bId)) continue;
    if ((inAll.get(bId) ?? []).length !== 1) continue;
    if (a.loc?.file !== b.loc?.file) continue;
    candidates.push([aId, bId]);
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => cmp(x[0], y[0]) || cmp(x[1], y[1]));
  return { a: candidates[0][0], b: candidates[0][1] };
}

function mergeNodes(graph, aId, bId) {
  const a = graph.nodes.get(aId);
  const b = graph.nodes.get(bId);

  a.label = `${a.label} » ${b.label}`;
  a.meta.merged = [...(a.meta.merged ?? []), bId, ...(b.meta.merged ?? [])].sort();
  if (b.meta.returnShapes) {
    a.meta.returnShapes = [...(a.meta.returnShapes ?? []), ...b.meta.returnShapes];
  }

  const nextEdges = [];
  for (const e of graph.edges) {
    if (e.kind === 'control_flow' && e.from === aId && e.to === bId) continue; // the seam
    let { from, to } = e;
    if (from === bId) from = aId;
    if (to === bId) to = aId;
    if (from === to && e.kind === 'control_flow') continue; // no self-loops from merging
    nextEdges.push({ ...e, from, to });
  }
  graph.edges = nextEdges;
  graph.nodes.delete(bId);
}
