// flight/heal.js — the healing brain (pure functions, no I/O).
// heal = the closed loop as ONE decision: given the recorded flight (the
// bug), the lenient replay against current code (the candidate fix), and an
// expectation, decide HEALED or NOT — then the command gates it behind
// verify + apocalypse. The subtlety this module owns: the exported flight
// test asserts the PAST; healing asserts the OPPOSITE — same deterministic
// inputs (the recorded taps), a NEW expected outcome. Without an explicit
// expectation we accept exactly one default: the recorded response was a 5xx
// and the replay no longer is. Anything subtler demands --expect; guessing
// intent would be dishonest.

// expectation: null | { status?: number, body?: object (subset match) }
export function evaluateHealing(flight, replay, expectation = null) {
  const recorded = { status: flight.response.status, body: flight.response.body };
  const reasons = [];

  if (replay.divergences.length) {
    reasons.push(
      `replay diverged structurally (${replay.divergences.length}): the fix must keep the same effect ORDER and KINDS — only labels may change`,
    );
  }

  const stillIdentical =
    replay.actual.status === recorded.status &&
    bodiesEqual(replay.actual.body, recorded.body);
  if (stillIdentical && !replay.divergences.length) {
    reasons.push('response is byte-identical to the recorded bug — nothing changed');
  }

  let expectationMet = null;
  if (expectation) {
    expectationMet = true;
    if (expectation.status !== undefined && replay.actual.status !== expectation.status) {
      expectationMet = false;
      reasons.push(`expected status ${expectation.status}, got ${replay.actual.status}`);
    }
    if (expectation.body !== undefined) {
      const actualBody = parseMaybe(replay.actual.body);
      if (!subsetMatch(expectation.body, actualBody)) {
        expectationMet = false;
        reasons.push(`response body does not contain the expected subset`);
      }
    }
  } else if (recorded.status >= 500) {
    // the one honest default: a crash that no longer crashes
    expectationMet = replay.actual.status < 500;
    if (!expectationMet)
      reasons.push(
        `still failing: recorded ${recorded.status}, replay ${replay.actual.status}`,
      );
  } else {
    expectationMet = false;
    reasons.push(
      `recorded response was ${recorded.status} (not a crash) — pass --expect '{"status":200,...}' to state what CORRECT looks like`,
    );
  }

  const healed =
    expectationMet === true && !stillIdentical && replay.divergences.length === 0;
  return {
    healed,
    reasons,
    before: recorded,
    after: replay.actual,
    relabels: replay.relabels ?? [],
    leftover: replay.leftover,
  };
}

// the brief the fixing agent (or human) receives — self-contained, built from
// the flight AND the compiler's understanding of the entrypoint
export function buildBrief(flight, graph, strictReplay, flightId) {
  const ep = matchEntrypoint(graph, flight.request);
  const nodes = Array.isArray(graph.nodes)
    ? new Map(graph.nodes.map((n) => [n.id, n]))
    : graph.nodes;

  const lines = [
    `# SPARDA Heal Brief — flight ${flightId}`,
    '',
    '## The bug (recorded from production)',
    `- Request: \`${flight.request.method} ${flight.request.url}\``,
    `- Request body: \`${JSON.stringify(flight.request.body)}\``,
    `- Response: **${flight.response.status}** \`${flight.response.body.slice(0, 300)}\``,
    `- Recorded taps: ${flight.taps.map((t) => t.kind).join(', ') || 'none'}`,
    '',
    '## Replay against current code',
    strictReplay.match
      ? '- Reproduces byte-identically — the bug is alive in this tree.'
      : `- Differs already: status ${strictReplay.actual.status}; divergences: ${strictReplay.divergences.length}`,
    '',
  ];

  if (ep) {
    lines.push('## What the compiler knows about this entrypoint');
    if (ep.loc) lines.push(`- Handler: \`${ep.loc.file}:${ep.loc.line}\``);
    if (ep.meta.capabilities?.length)
      lines.push(
        `- Capabilities (must not grow): \`${ep.meta.capabilities.join(', ')}\``,
      );
    if (ep.meta.mutatesDomains?.length)
      lines.push(`- Mutates aggregates: \`${ep.meta.mutatesDomains.join(', ')}\``);
    const guards = guardsOf(graph, nodes, ep.id);
    if (guards.length)
      lines.push(
        `- Guarded by: \`${guards.join(', ')}\` — REMOVING A GUARD FAILS THE GATE`,
      );
    const effectLocs = effectsOf(graph, nodes, ep.id);
    if (effectLocs.length) {
      lines.push('- Effects on this path:');
      for (const e of effectLocs) lines.push(`  - ${e}`);
    }
    lines.push('');
  }

  lines.push(
    '## Acceptance criteria (mechanically gated — `sparda heal <id> --check`)',
    '1. Lenient replay of the flight must produce the EXPECTED response (not the recorded bug).',
    '2. Effect order and kinds must be preserved (labels may change).',
    '3. `sparda verify` — all compiler laws still hold.',
    '4. `sparda apocalypse` — zero new critical/high findings; no guard removed.',
    '',
    'Fix the code. Do not edit flights, tests, or `.sparda/`.',
    '',
  );
  return lines.join('\n');
}

function matchEntrypoint(graph, request) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [...graph.nodes.values()];
  const url = request.url.split('?')[0];
  const method = request.method.toLowerCase();
  for (const n of nodes) {
    if (n.kind !== 'entrypoint' || n.meta.method !== method) continue;
    const escaped = n.meta.path
      .replace(/[.*+?^$()[\]\\|]/g, '\\$&')
      .replace(/:(\w+)/g, '([^/]+)')
      .replace(/\\?\{(\w+)\\?\}/g, '([^/]+)');
    if (new RegExp(`^${escaped}/?$`).test(url)) return n;
  }
  return null;
}

function guardsOf(graph, nodes, epId) {
  const chain = graph.edges.filter(
    (e) => e.kind === 'control_flow' && e.meta?.route === epId,
  );
  const chainIds = new Set(chain.map((e) => e.to));
  return [...chainIds]
    .map((id) => nodes.get(id))
    .filter((n) => n?.kind === 'guard')
    .map((n) => n.label)
    .sort();
}

function effectsOf(graph, nodes, epId) {
  const chain = graph.edges.filter(
    (e) => e.kind === 'control_flow' && e.meta?.route === epId,
  );
  const handler = chain.reduce(
    (a, b) => (!a || b.meta.order > a.meta.order ? b : a),
    null,
  );
  if (!handler) return [];
  return graph.edges
    .filter((e) => e.kind === 'control_flow' && e.from === handler.to && !e.meta?.route)
    .map((e) => nodes.get(e.to))
    .filter((n) => n?.kind === 'effect')
    .map((n) => `${n.label} (${n.loc ? `${n.loc.file}:${n.loc.line}` : '?'})`)
    .sort();
}

const parseMaybe = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

const bodiesEqual = (a, b) => {
  if (a === b) return true;
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
};

// every key in `expected` must be present and equal (deep) in `actual`
function subsetMatch(expected, actual) {
  if (expected === null || typeof expected !== 'object')
    return JSON.stringify(expected) === JSON.stringify(actual);
  if (actual === null || typeof actual !== 'object') return false;
  for (const [k, v] of Object.entries(expected)) {
    if (!subsetMatch(v, actual[k])) return false;
  }
  return true;
}
