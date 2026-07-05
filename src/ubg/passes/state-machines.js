// ubg/passes/state-machines.js — pass 8 (SBIR v1.2 §2.7).
// "POST /orders then PATCH /orders/:id/pay" is routing; "∅→pending→paid" is
// what the system MEANS. The machine is derived from three declared sources,
// never guessed: (1) the status-like column, (2) the CHECK … IN (…) invariant
// naming the legal states, (3) literal column values the effects write —
// INSERT literals are initial transitions (∅→v), UPDATE SET literals are
// transitions whose from-state is the WHERE literal when present, '*' when
// the code doesn't constrain it (over-approximation, said out loud).
// Annotation-only.
import { reachabilityOf } from '../reach.js';

export const name = 'StateMachineInference';

const FIELD_RE = /^(status|state)$/;

export function run(graph) {
  const reach = reachabilityOf(graph);
  const epsOfEffect = new Map();
  for (const [epId, reached] of reach) {
    for (const id of reached) {
      if (graph.nodes.get(id)?.kind !== 'effect') continue;
      if (!epsOfEffect.has(id)) epsOfEffect.set(id, new Set());
      epsOfEffect.get(id).add(epId);
    }
  }

  const mutIn = new Map(); // state id -> [{ effect, op }]
  for (const e of graph.edges) {
    if (e.kind !== 'mutation') continue;
    if (!mutIn.has(e.to)) mutIn.set(e.to, []);
    mutIn.get(e.to).push({ effect: graph.nodes.get(e.from), op: e.meta.op });
  }

  let machines = 0;
  const states = [...graph.nodes.values()]
    .filter((n) => n.kind === 'state')
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const state of states) {
    const field = fieldOf(state);
    if (!field) continue;

    const declared = declaredStatesOf(state, field);
    const transitions = [];
    const observed = new Set();

    for (const { effect } of mutIn.get(state.id) ?? []) {
      if (!effect) continue;
      const via = [...(epsOfEffect.get(effect.id) ?? [])].sort();
      const insertV = effect.meta.inserts?.[field];
      if (insertV !== undefined) {
        transitions.push({ from: '∅', to: insertV, via });
        observed.add(insertV);
      }
      const setV = effect.meta.sets?.[field];
      if (setV !== undefined) {
        const from = effect.meta.where?.[field] ?? '*';
        transitions.push({ from, to: setV, via });
        observed.add(setV);
        if (from !== '*') observed.add(from);
      }
    }

    if (!transitions.length && !declared.length) continue;
    transitions.sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        (a.via[0] ?? '').localeCompare(b.via[0] ?? ''),
    );
    state.meta.stateMachine = {
      field,
      states: declared.length ? declared : [...observed].sort(),
      transitions,
    };
    machines++;
  }

  return { machines };
}

// a column literally named status/state, else one whose CHECK names it
function fieldOf(state) {
  for (const col of state.meta.columns ?? []) {
    if (FIELD_RE.test(col.name)) return col.name;
  }
  for (const inv of state.meta.invariants ?? []) {
    if (inv.type !== 'check') continue;
    const m = inv.expression?.match(/^(\w+)\s+in\s*\(/i);
    if (m && FIELD_RE.test(m[1])) return m[1];
  }
  return null;
}

// CHECK (status IN ('pending', 'paid')) → ['paid', 'pending']
function declaredStatesOf(state, field) {
  for (const inv of state.meta.invariants ?? []) {
    if (inv.type !== 'check') continue;
    const m = inv.expression?.match(new RegExp(`${field}\\s+in\\s*\\(([^)]*)\\)`, 'i'));
    if (!m) continue;
    return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).sort();
  }
  return [];
}
