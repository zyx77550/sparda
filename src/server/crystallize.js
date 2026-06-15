// server/crystallize.js — observation freezes state into a composite tool.
// A circuit observed enough times crystallizes into a composite tool: one MCP
// call that runs the whole chain, auto-feeding each linked argument from the
// previous step's output (by fromKey — structure recorded at observation time,
// never values). GET-only on purpose: a write inside a circuit keeps its own
// per-call confirmation (ADR-004); composites never bypass it.
import { walkPayload } from './condenser.js';

// crystallizable = every step is an enabled GET and every link knows where to
// re-feed from. Re-checked at every bridge start: tools change, circuits stay.
export function eligibleForCrystallization(circuit, toolSpecs) {
  return Array.isArray(circuit.steps) && circuit.steps.length >= 2 &&
    circuit.steps.every((s) => toolSpecs[s]?.enabled && toolSpecs[s].method === 'GET') &&
    Array.isArray(circuit.links) && circuit.links.length > 0 &&
    circuit.links.every((l) => typeof l.fromKey === 'string' && l.fromKey.length > 0);
}

// graceful degradation (survival rule): no sampling → a deterministic name and
// an honest description, built only from structure the manifest already holds
export function fallbackComposite(circuit) {
  const flow = circuit.links
    .map((l) => `'${l.arg}' of ${l.to} comes from '${l.fromKey}' of ${l.from}`)
    .join('; ');
  return {
    name: `circuit_${circuit.steps.join('_then_')}`.slice(0, 60).replace(/_+$/, ''),
    description: `Runs ${circuit.steps.join(', then ')} as one call — ${flow}.`,
    source: 'deterministic',
  };
}

// a sampled name is untrusted input: normalize hard, reject anything shapeless
export function normalizeCompositeName(raw) {
  const n = String(raw ?? '').toLowerCase().trim()
    .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z][a-z0-9_]{2,}$/.test(n) ? n : null;
}

// the composite exposes the union of its steps' params, minus the auto-fed ones
export function compositeSchema(circuit, toolSpecs) {
  const autoFed = new Set(circuit.links.map((l) => `${l.to}:${l.arg}`));
  const properties = {};
  const required = [];
  for (const step of circuit.steps) {
    for (const p of toolSpecs[step]?.params ?? []) {
      if (autoFed.has(`${step}:${p.name}`) || properties[p.name]) continue;
      properties[p.name] = { type: p.type === 'unknown' ? 'string' : p.type, description: `${p.description ?? p.in} (for ${step})` };
      if (p.required) required.push(p.name);
    }
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

// first scalar living under `key` in a payload — same bounded walk as detection,
// so what was observable is exactly what is re-feedable
export function findByKey(node, key) {
  let found;
  walkPayload(node, (k, v) => {
    if (k === key) { found = v; return false; }
  });
  return found;
}

// run the chain. The truth is always the real call (survival rule): every step
// hits the live route through the router, and the trace reports what happened.
export async function runComposite({ circuit, args, toolSpecs, invokeFn }) {
  const outputs = {};
  const trace = [];
  let data = null;
  for (const step of circuit.steps) {
    const stepArgs = {};
    for (const p of toolSpecs[step]?.params ?? []) {
      if (args[p.name] !== undefined) stepArgs[p.name] = args[p.name];
    }
    for (const l of circuit.links) {
      if (l.to !== step) continue;
      const v = findByKey(outputs[l.from], l.fromKey);
      if (v !== undefined) stepArgs[l.arg] = v;
    }
    const payload = await invokeFn(step, stepArgs);
    const status = payload?.upstreamStatus;
    trace.push({ tool: step, upstreamStatus: status ?? null, ...(payload?.error ? { error: payload.error } : {}) });
    if (!payload || payload.error !== undefined || status === undefined || status >= 400) {
      return { ok: false, trace }; // honest failure: stop the chain, show where
    }
    outputs[step] = payload.data;
    data = payload.data;
  }
  return { ok: true, trace, data };
}
