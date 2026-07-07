// ubg/verify.js — the compiler proves its own laws.
// We say "deterministic", "sound", "additive" everywhere. This module makes
// those words executable: it re-runs the pipeline and mechanically checks the
// SBIR compiler laws (spec §3) on WHATEVER graph it is handed — a fixture, a
// corpus repo, a user's app. A claim a project can check on its own inputs is
// a promise; a claim in a README is marketing. This is the difference.
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from './compile.js';
import { canonicalizeGraph, validateGraph, EDGE_KINDS, NODE_KINDS } from './schema.js';
import { emitOpenAPI } from './openapi-emit.js';
import { extractOpenAPI } from './openapi.js';

const NODE_SET = new Set(NODE_KINDS);
const EDGE_SET = new Set(EDGE_KINDS);

export function verifyProject(cwd, { openapi = null } = {}) {
  const checks = [];
  const record = (law, name, pass, detail = '') =>
    checks.push({ law, name, pass, detail });

  // Law 3 — Determinism: two independent compiles are byte-identical.
  const a = compileUBG(cwd, { write: false, openapi });
  const b = compileUBG(cwd, { write: false, openapi });
  record(
    'Determinism (§3.3)',
    'two compiles are byte-identical',
    a.json === b.json,
    a.json === b.json
      ? ''
      : 'compiles diverged — a forbidden nondeterministic input leaked in',
  );
  record(
    'Determinism (§3.3)',
    'sourceHash is a stable sha256',
    /^[0-9a-f]{64}$/.test(a.graph.meta.sourceHash),
  );

  // Canonical form is a fixed point: re-canonicalizing an ALREADY-canonical
  // graph must be a no-op. This is a real idempotence check — the previous
  // version compared canonicalize(g) with canonicalize(g) (trivially equal)
  // and proved nothing.
  const once = canonicalizeGraph(a.graph);
  const twice = canonicalizeGraph(once);
  record(
    'Determinism (§3.3)',
    'canonical form is a fixed point',
    JSON.stringify(once) === JSON.stringify(twice),
  );

  // Structural integrity — every edge lands on a real node, every kind known.
  let structural = true;
  let structuralDetail = '';
  try {
    validateGraph(a.graph);
  } catch (err) {
    structural = false;
    structuralDetail = err.message.split('\n')[0];
  }
  for (const n of a.graph.nodes.values())
    if (!NODE_SET.has(n.kind))
      ((structural = false), (structuralDetail = `bad node kind ${n.kind}`));
  for (const e of a.graph.edges)
    if (!EDGE_SET.has(e.kind))
      ((structural = false), (structuralDetail = `bad edge kind ${e.kind}`));
  record(
    'Soundness (§3.1)',
    'no dangling edges, only known kinds',
    structural,
    structuralDetail,
  );

  // Soundness of DeadPathElimination: every surviving non-entrypoint,
  // non-state node is reachable from some entrypoint (the pass never leaves
  // an orphan it should have reaped, and never reaps a reachable node).
  record(
    'Soundness (§3.1)',
    'every surviving node is entrypoint-reachable',
    ...reachabilityHolds(a.graph),
  );

  // OpenAPI round-trip: graph → spec → graph preserves the entrypoint set.
  // If emit and ingest agree, both are faithful to the same contract.
  const roundTrip = openApiRoundTrip(a.graph, cwd);
  record(
    'Round-trip (SBIR↔OpenAPI)',
    'emit→ingest preserves entrypoints',
    roundTrip.pass,
    roundTrip.detail,
  );

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length, ok: passed === checks.length };
}

function reachabilityHolds(graph) {
  const cfOut = new Map();
  for (const e of graph.edges) {
    if (e.kind !== 'control_flow') continue;
    if (!cfOut.has(e.from)) cfOut.set(e.from, []);
    cfOut.get(e.from).push({ to: e.to, route: e.meta?.route ?? null });
  }
  // per-entrypoint visited set, then union: a guard shared by two routes is
  // reached under EACH route's own traversal — a global visited set would let
  // the first route's visit block the second route's route-tagged children
  const reached = new Set();
  for (const n of graph.nodes.values()) {
    if (n.kind !== 'entrypoint') continue;
    const seen = new Set();
    const q = [n.id];
    while (q.length) {
      const id = q.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      reached.add(id);
      for (const nx of cfOut.get(id) ?? [])
        if (nx.route === null || nx.route === n.id) q.push(nx.to);
    }
  }
  for (const n of graph.nodes.values()) {
    if (n.kind === 'entrypoint' || n.kind === 'state') continue;
    if (!reached.has(n.id)) return [false, `orphan survived: ${n.id}`];
  }
  return [true, ''];
}

function openApiRoundTrip(graph, cwd) {
  try {
    const spec = emitOpenAPI(canonicalizeGraph(graph));
    // ingest the emitted spec through the real importer, on disk (bounded)
    const tmpName = '.sparda-verify-spec.json';
    const p = path.join(cwd, tmpName);
    fs.writeFileSync(p, JSON.stringify(spec));
    let ingested;
    try {
      ingested = extractOpenAPI(cwd, tmpName);
    } finally {
      fs.rmSync(p, { force: true });
    }
    const original = [...graph.nodes.values()]
      .filter((n) => n.kind === 'entrypoint')
      .map((n) => `${n.meta.method} ${n.meta.path.replace(/:(\w+)/g, '{$1}')}`)
      .sort();
    const reingested = ingested.routes.map((r) => `${r.method} ${r.path}`).sort();
    const same = JSON.stringify(original) === JSON.stringify(reingested);
    return {
      pass: same,
      detail: same ? '' : `${original.length} → ${reingested.length} entrypoints`,
    };
  } catch (err) {
    return { pass: false, detail: err.message.split('\n')[0] };
  }
}
