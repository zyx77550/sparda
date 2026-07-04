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
  return (
    Array.isArray(circuit.steps) &&
    circuit.steps.length >= 2 &&
    circuit.steps.every((s) => toolSpecs[s]?.enabled && toolSpecs[s].method === 'GET') &&
    Array.isArray(circuit.links) &&
    circuit.links.length > 0 &&
    circuit.links.every((l) => typeof l.fromKey === 'string' && l.fromKey.length > 0)
  );
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

// ── R2.4: nothing disappears, x becomes y ──────────────────────────────────
// Tool names derive from method+path, so a renamed route means a vanished step
// name. Instead of letting the composite die silently at wake-up, we look for
// the step's UNIQUE deterministic successor: an enabled GET whose name keeps
// the old name's segments in order (api_users ⊂ api_v2_users) and ends on the
// same resource segment. One candidate → re-map; zero or many → dormant with a
// recorded reason. Never a guess: ambiguity is a reason, not a coin flip.

function nameSegments(toolName) {
  const parts = String(toolName).split('_');
  return ['get', 'post', 'put', 'patch', 'delete'].includes(parts[0])
    ? parts.slice(1)
    : parts;
}

function isSubsequence(small, big) {
  let i = 0;
  for (const seg of big) if (seg === small[i]) i++;
  return i === small.length;
}

export function successorFor(oldName, toolSpecs, exclude = new Set()) {
  const oldSegs = nameSegments(oldName);
  if (!oldSegs.length) return null;
  const last = oldSegs[oldSegs.length - 1];
  const candidates = Object.entries(toolSpecs)
    .filter(([name, t]) => {
      if (exclude.has(name) || !t.enabled || t.method !== 'GET') return false;
      const segs = nameSegments(name);
      return segs[segs.length - 1] === last && isSubsequence(oldSegs, segs);
    })
    .map(([name]) => name);
  return candidates.length === 1 ? candidates[0] : null;
}

// (circuits map, today's tools) → what survives, what becomes, what sleeps.
// Pure: never mutates the input; the caller decides what to persist.
export function remapComposites(circuits, toolSpecs) {
  const remapped = [];
  const dormant = [];
  for (const [oldKey, circuit] of Object.entries(circuits ?? {})) {
    if (!circuit?.composite?.name) continue;
    if (eligibleForCrystallization(circuit, toolSpecs)) continue; // alive as-is

    const disabled = (circuit.steps ?? []).filter(
      (s) => toolSpecs[s] && !toolSpecs[s].enabled,
    );
    if (disabled.length) {
      // the user disabled a step on purpose — respect it, do not re-route around it
      dormant.push({
        composite: circuit.composite.name,
        key: oldKey,
        reason: `step disabled by the user: ${disabled.join(', ')} — composite sleeps until re-enabled`,
      });
      continue;
    }

    const renames = {};
    const newSteps = [];
    let resolvable = true;
    for (const step of circuit.steps ?? []) {
      if (toolSpecs[step]?.enabled && toolSpecs[step].method === 'GET') {
        newSteps.push(step);
        continue;
      }
      const successor = successorFor(step, toolSpecs, new Set(newSteps));
      if (!successor) {
        resolvable = false;
        dormant.push({
          composite: circuit.composite.name,
          key: oldKey,
          reason: `step vanished with no unique successor: ${step} — structure kept, waiting for a sync that brings it back`,
        });
        break;
      }
      renames[step] = successor;
      newSteps.push(successor);
    }
    if (!resolvable) continue;

    const next = structuredClone(circuit);
    next.steps = newSteps;
    next.links = (next.links ?? []).map((l) => ({
      ...l,
      from: renames[l.from] ?? l.from,
      to: renames[l.to] ?? l.to,
    }));
    if (!eligibleForCrystallization(next, toolSpecs)) {
      dormant.push({
        composite: circuit.composite.name,
        key: oldKey,
        reason:
          'successor found but the re-mapped circuit is not crystallizable — kept dormant',
      });
      continue;
    }
    remapped.push({
      oldKey,
      newKey: next.steps.join('>'),
      circuit: next,
      renames,
    });
  }
  return { remapped, dormant };
}

// a sampled name is untrusted input: normalize hard, reject anything shapeless
export function normalizeCompositeName(raw) {
  const n = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
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
      properties[p.name] = {
        type: p.type === 'unknown' ? 'string' : p.type,
        description: `${p.description ?? p.in} (for ${step})`,
      };
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
    if (k === key) {
      found = v;
      return false;
    }
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
    trace.push({
      tool: step,
      upstreamStatus: status ?? null,
      ...(payload?.error ? { error: payload.error } : {}),
    });
    if (
      !payload ||
      payload.error !== undefined ||
      status === undefined ||
      status >= 400
    ) {
      return { ok: false, trace }; // honest failure: stop the chain, show where
    }
    outputs[step] = payload.data;
    data = payload.data;
  }
  return { ok: true, trace, data };
}
