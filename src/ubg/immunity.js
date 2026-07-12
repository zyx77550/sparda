// ubg/immunity.js — the immunity capsule (ADR-037).
//
// The capsule is the "mini-intelligence that costs nothing": SPARDA does the
// expensive static reasoning ONCE at compile time (graph → obligations → polarity
// + a portable behaviorHash per route), then freezes the result into a tiny,
// self-contained artifact. Each route reduces to (behaviorHash, one polarity byte).
// The capsule needs nothing to "run" — it is a frozen judgment consulted by a pure
// lookup: no recompile, no LLM, no network. That is BitNet's move applied to trust —
// amortize the thinking, ship a cheap representation that acts on its own.
//
// It is also the atom of the world genome (ADR-035): one app's capsule is its
// contribution; capsules compose (posture column-sums stack app → fleet → world).
import { fingerprintGraph } from './fingerprint.js';
import { checkGraph } from './apocalypse.js';
import { cmp } from './schema.js';
import { AXES, posture, provenByPolarity, packVector, exposedAxes } from './polarity.js';

export const CAPSULE_VERSION = 'imm1';

// canonical graph → a compact, portable, deterministic safety capsule.
export function buildCapsule(graph) {
  const prints = new Map(fingerprintGraph(graph).map((p) => [p.entrypoint, p]));
  const { polarity } = checkGraph(graph);

  const routes = polarity
    .map(({ entrypoint, vector }) => ({
      behaviorHash: prints.get(entrypoint)?.behaviorHash ?? null,
      pol: packVector(vector), // one byte: the route's whole safety character
      exposed: exposedAxes(vector), // convenience; derivable from pol
    }))
    .sort((a, b) => cmp(a.behaviorHash ?? '', b.behaviorHash ?? ''));

  return {
    v: CAPSULE_VERSION,
    proven: provenByPolarity(polarity),
    routes,
    posture: posture(polarity),
    bytes: routes.length, // the whole app's safety, one byte per route
  };
}

// The lookup that makes the capsule act on its own: given a behavior shape, what
// does this capsule already know about it? Pure, O(routes), no compute. This is the
// seam an agent (or the runtime) consults BEFORE doing expensive work — the local,
// offline face of collective immunity.
export function judge(capsule, behaviorHash) {
  const hit = capsule.routes.find((r) => r.behaviorHash === behaviorHash);
  if (!hit) return { known: false };
  return {
    known: true,
    pol: hit.pol,
    exposed: hit.exposed,
    safe: hit.exposed.length === 0,
  };
}

// Merge capsules into a fleet posture — composition is a column sum, nothing more.
export function mergePosture(capsules) {
  const cols = {};
  for (const a of AXES) cols[a] = { protected: 0, exposed: 0, na: 0 };
  for (const c of capsules)
    for (const a of AXES)
      for (const k of ['protected', 'exposed', 'na']) cols[a][k] += c.posture[a][k];
  return cols;
}
