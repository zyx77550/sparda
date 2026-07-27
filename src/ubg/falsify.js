// ubg/falsify.js — Popper, compiled (ADR-077). A verdict you cannot falsify is dogma, not
// proof. Every sound checker faces the same silent failure mode: the VACUOUS proof — a green
// verdict that would still be green if the protection it names vanished, because the checker
// went blind to that route (E-022/E-025/E-026 were exactly this class, and they are the
// cardinal sin). Testing SPARDA's fixtures catches the blindness we already imagined;
// falsification catches the blindness we didn't: for THIS app, ablate ALL protection in
// memory and demand that the verifier re-derives a violation on every route whose safety
// claim depended on it. The proof must be sensitive to its own premises — dP/dGuard ≠ 0,
// route by route — or it is not a proof.
//
// The counterfactual is GRAPH SURGERY, not recompilation: every guard node is CONTRACTED
// (predecessors rewired to successors, then the node removed) — contraction, never deletion,
// because deleting a mid-chain guard would disconnect the handler and make the mutation
// unreachable, which reads as "clean" for the wrong reason and would mask a real hole. The
// ablated world is the same app with its protection surgically absent and everything else
// still wired. One extra checkGraph pass over that world prices the whole audit at O(graph)
// — deterministic, offline, zero recompile.
//
// Read the direction carefully: falsify NEVER upgrades anything. A 100% score does not add
// PROVEN-ness; a hole SUBTRACTS trust — it says "this route's green does not depend on its
// guards; the checker cannot see it; do not believe the verdict there". It is the negative
// control of the whole proof system, the vaccine-challenge of the immune line (ADR-072):
// inject the weakened pathogen, require the response.
import { indexGraph, reachOf, checkGraph } from './apocalypse.js';

// The ablated world: every guard node contracted out of the graph. Pure — the input graph is
// never touched (nodes/edges are rebuilt, meta shared structurally). Contraction preserves
// route reachability: each control-flow predecessor is wired to each successor, carrying the
// PREDECESSOR's route meta so the route-scoped reach walk still follows the chain.
export function ablateGuards(graph) {
  const guardIds = new Set(
    graph.nodes.filter((n) => n.kind === 'guard').map((n) => n.id),
  );
  let nodes = graph.nodes.filter((n) => !guardIds.has(n.id));
  let edges = graph.edges;
  for (const gid of guardIds) {
    const preds = edges.filter((e) => e.kind === 'control_flow' && e.to === gid);
    const succs = edges.filter((e) => e.kind === 'control_flow' && e.from === gid);
    const rest = edges.filter((e) => e.from !== gid && e.to !== gid);
    const bridged = [];
    for (const p of preds)
      for (const s of succs)
        bridged.push({ from: p.from, to: s.to, kind: 'control_flow', meta: p.meta });
    edges = [...rest, ...bridged];
  }
  return { ...graph, nodes, edges };
}

// The routes whose safety claim DEPENDS on protection: every route that reaches a WRITE in
// exactly O1's sense — an effect carrying a mutation edge, or an opaque db_write with none
// (ADR-068) — and holds at least one guard on its resolved path. Mirroring O1's own write
// definition is what makes the counterfactual an OBLIGATION and not a heuristic: each of
// these routes, stripped of every guard, must make O1 itself fire. (An http_call-only route
// belongs to O4's jurisdiction, not O1's — expecting an UNGUARDED_MUTATION there would be
// a false hole in the falsifier, not a real one in the checker.)
export function protectedMutationRoutes(graph) {
  const g = indexGraph(graph);
  const out = [];
  for (const ep of g.entrypoints) {
    const reached = [...reachOf(ep.id, g.cfOut)].map((id) => g.nodes.get(id));
    const writes = reached.some(
      (n) =>
        n?.kind === 'effect' &&
        ((g.mutOut.get(n.id) ?? []).length > 0 ||
          (n.meta.opaque && n.meta.effectType === 'db_write')),
    );
    if (!writes) continue;
    if (reached.some((n) => n?.kind === 'guard'))
      out.push({ id: ep.id, label: ep.label });
  }
  return out;
}

// Run the falsification: for every protected mutation route, the world-without-guards must
// make the verifier fire an UNGUARDED_MUTATION on that route that the real world did not
// have. `check` is injectable ONLY so the tests can prove falsify catches a blind checker —
// production callers never pass it.
export function falsifyGraph(graph, { check = checkGraph } = {}) {
  const targets = protectedMutationRoutes(graph);
  if (targets.length === 0)
    return {
      controls: [],
      flipped: 0,
      holes: [],
      score: 1,
      note: 'no protected mutation routes — nothing to falsify',
    };

  // Per-route attribution, flood-aware: ablating EVERY guard at once makes UNGUARDED_MUTATION
  // pervasive on a real app, so checkGraph collapses it into one codebase-wide row — whose
  // `evidence` carries the exact per-route entrypoint list. Unfold it, or 100% of real-world
  // flips would be invisible to the per-route match (the first dub/ghostfolio run read 0.000
  // for exactly this reason — the counterfactual HAD fired, on every route at once).
  const unguardedOf = (findings) => {
    const set = new Set();
    for (const f of findings) {
      if (f.rule !== 'UNGUARDED_MUTATION') continue;
      if (f.entrypoint === '(codebase-wide)')
        for (const ep of f.evidence ?? []) set.add(ep);
      else set.add(f.entrypoint);
    }
    return set;
  };
  const before = unguardedOf(check(graph).findings);
  const after = unguardedOf(check(ablateGuards(graph)).findings);

  const controls = targets.map((t) => ({
    route: t.label,
    flipped: after.has(t.id) && !before.has(t.id),
  }));
  const holes = controls.filter((c) => !c.flipped).map((c) => c.route);
  return {
    controls,
    flipped: controls.length - holes.length,
    holes,
    score: (controls.length - holes.length) / controls.length,
  };
}
