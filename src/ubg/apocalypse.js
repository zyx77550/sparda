// ubg/apocalypse.js — the deployment prover.
// THE existence proof for SBIR: this file never parses source code. It reads
// the canonical graph and discharges proof obligations against the semantics
// the compiler already extracted — guards, invariants, transaction scopes,
// effect algebra, consistency domains. Every finding is a counterexample
// path (entrypoint → … → violation), never a vibe. Two modes:
//   static  — obligations over one graph (can THIS tree hurt itself?)
//   diff    — obligations over (baseline, candidate) (can THIS DEPLOY remove
//             a protection someone relies on?)
// Honesty contract: "proven" means "no declared obligation is violated under
// structural reachability" — the prover is exactly as strong as what the code
// and DDL declare. It proves the absence of whole bug classes, not of bugs.

import { cmp } from './schema.js';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, info: 3 };
const CONSTRAINING = new Set(['check', 'not_null', 'unique']);

// canonical serialized graph ({ nodes: [], edges: [] }) → indexed view
export function indexGraph(graph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const cfOut = new Map();
  const mutOut = new Map();
  const gateTargets = new Set();
  const compensators = new Set(); // effects whose JOB is undoing another effect
  for (const e of graph.edges) {
    if (e.kind === 'control_flow') {
      if (!cfOut.has(e.from)) cfOut.set(e.from, []);
      cfOut.get(e.from).push({ to: e.to, route: e.meta?.route ?? null });
    } else if (e.kind === 'mutation') {
      if (!mutOut.has(e.from)) mutOut.set(e.from, []);
      mutOut.get(e.from).push(e);
    } else if (e.kind === 'gate') {
      gateTargets.add(e.to);
    } else if (e.kind === 'compensation') {
      compensators.add(e.from);
    }
  }
  const entrypoints = graph.nodes
    .filter((n) => n.kind === 'entrypoint')
    .sort((a, b) => cmp(a.id, b.id));
  return { nodes, cfOut, mutOut, gateTargets, compensators, entrypoints };
}

export function reachOf(epId, cfOut) {
  const seen = new Set();
  const queue = [epId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of cfOut.get(id) ?? []) {
      // a chain edge belongs to one route — never cross into a sibling chain
      if (next.route === null || next.route === epId) queue.push(next.to);
    }
  }
  seen.delete(epId);
  return seen;
}

const locOf = (node) => (node?.loc ? `${node.loc.file}:${node.loc.line}` : 'unknown');

// ---------------------------------------------------------------------------
// static obligations
// ---------------------------------------------------------------------------

export function checkGraph(graph) {
  const g = indexGraph(graph);
  const findings = [];
  let obligations = 0;
  // Behavior polarity (ADR-036): per entrypoint, a ternary vector over the same
  // obligations checked below — +1 protection present, 0 not applicable, -1
  // violated. Built HERE so a -1 is literally the same condition as the finding
  // (one source of truth, no drift). The algebra over these vectors lives in
  // ubg/polarity.js; this function just records them.
  const polarity = [];

  for (const ep of g.entrypoints) {
    const reach = reachOf(ep.id, g.cfOut);
    const reached = [...reach].sort().map((id) => g.nodes.get(id));
    const guards = reached.filter((n) => n?.kind === 'guard');
    const writes = []; // { effect, stateId }
    for (const n of reached) {
      if (n?.kind !== 'effect') continue;
      for (const e of g.mutOut.get(n.id) ?? []) writes.push({ effect: n, stateId: e.to });
    }
    const observables = reached.filter((n) => n?.kind === 'effect' && n.meta.observable);
    const vec = { auth: 0, validation: 0, atomicity: 0, reversibility: 0, aggregate: 0 };

    // O1 — every mutation path must pass a guard
    obligations++;
    if (writes.length) vec.auth = guards.length ? 1 : -1;
    if (writes.length && guards.length === 0) {
      findings.push({
        rule: 'UNGUARDED_MUTATION',
        severity: 'critical',
        entrypoint: ep.id,
        message: `${ep.label} mutates ${fmtStates(writes)} with no guard anywhere on the path`,
        evidence: writes.map((w) => `${w.effect.id} (${locOf(w.effect)})`),
      });
    }

    // O2 — writes into constrained tables need validated input
    obligations++;
    const constrained = writes.filter((w) =>
      (g.nodes.get(w.stateId)?.meta.invariants ?? []).some((i) =>
        CONSTRAINING.has(i.type),
      ),
    );
    if (constrained.length) vec.validation = ep.meta.inputValidated ? 1 : -1;
    if (!ep.meta.inputValidated && constrained.length) {
      findings.push({
        rule: 'UNVALIDATED_CONSTRAINED_WRITE',
        severity: 'medium',
        entrypoint: ep.id,
        message: `${ep.label} writes ${fmtStates(constrained)} whose declared invariants (CHECK/NOT NULL/UNIQUE) can be violated by unvalidated input`,
        evidence: constrained.map((w) => w.stateId),
      });
    }

    // O3 — multi-table writes inside one aggregate must share a transaction
    obligations++;
    const byDomain = new Map();
    for (const w of writes) {
      const domain = g.nodes.get(w.stateId)?.meta.consistencyDomain;
      if (!domain) continue;
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push(w);
    }
    for (const [domain, ws] of [...byDomain].sort((a, b) => cmp(a[0], b[0]))) {
      const states = new Set(ws.map((w) => w.stateId));
      if (states.size < 2) continue;
      const txIds = new Set(ws.map((w) => w.effect.meta.transaction?.id ?? null));
      const atomic = txIds.size === 1 && !txIds.has(null);
      vec.atomicity = atomic && vec.atomicity !== -1 ? 1 : -1;
      if (!atomic) {
        findings.push({
          rule: 'NON_ATOMIC_AGGREGATE_WRITE',
          severity: 'high',
          entrypoint: ep.id,
          message: `${ep.label} writes ${states.size} tables of aggregate "${domain}" outside a single transaction — a partial failure leaves the aggregate inconsistent`,
          evidence: ws.map((w) => `${w.effect.id} → ${w.stateId}`),
        });
      }
    }

    // O4 — an observable effect the outside world sees must be compensable
    // when the entrypoint also mutates state (the write can fail after the
    // world already saw the effect)
    obligations++;
    if (observables.length && writes.length) {
      let bad = false;
      for (const obs of observables) {
        if (obs.meta.compensable) continue;
        if (g.compensators.has(obs.id)) continue; // the undo itself is not a risk
        bad = true;
        findings.push({
          rule: 'IRREVERSIBLE_OBSERVABLE',
          severity: 'high',
          entrypoint: ep.id,
          message: `${ep.label} makes an irreversible external call (${obs.meta.target ?? obs.label}) while also mutating state — no compensation path exists if the write fails`,
          evidence: [`${obs.id} (${locOf(obs)})`],
        });
      }
      vec.reversibility = bad ? -1 : 1;
    }

    // O5 — mutating an aggregate member without touching its root
    obligations++;
    for (const w of writes) {
      const state = g.nodes.get(w.stateId);
      if (state?.meta.role !== 'member') continue;
      const touchesRoot = writes.some(
        (o) =>
          g.nodes.get(o.stateId)?.meta.role === 'aggregate_root' &&
          g.nodes.get(o.stateId)?.meta.consistencyDomain === state.meta.consistencyDomain,
      );
      vec.aggregate = touchesRoot && vec.aggregate !== -1 ? 1 : -1;
      if (!touchesRoot) {
        findings.push({
          rule: 'AGGREGATE_MEMBER_BYPASS',
          severity: 'info',
          entrypoint: ep.id,
          message: `${ep.label} mutates member table "${state.meta.table}" of aggregate "${state.meta.consistencyDomain}" without going through its root`,
          evidence: [w.stateId],
        });
      }
    }

    polarity.push({ entrypoint: ep.id, vector: vec });
  }

  return { findings: sortFindings(findings), obligations, polarity };
}

// ---------------------------------------------------------------------------
// diff obligations — what did this deploy take away?
// ---------------------------------------------------------------------------

export function diffGraphs(baseline, candidate) {
  const base = indexGraph(baseline);
  const cand = indexGraph(candidate);
  const findings = [];

  for (const ep of base.entrypoints) {
    const now = cand.nodes.get(ep.id);
    // D1 — entrypoint disappeared
    if (!now) {
      findings.push({
        rule: 'ENTRYPOINT_REMOVED',
        severity: 'high',
        entrypoint: ep.id,
        message: `${ep.label} existed in the baseline and is gone — breaking API change`,
        evidence: [],
      });
      continue;
    }
    // D2 — guard protection dropped
    const guardedBefore = [...reachOf(ep.id, base.cfOut)].some(
      (id) => base.nodes.get(id)?.kind === 'guard',
    );
    const guardedNow = [...reachOf(ep.id, cand.cfOut)].some(
      (id) => cand.nodes.get(id)?.kind === 'guard',
    );
    if (guardedBefore && !guardedNow) {
      findings.push({
        rule: 'GUARD_REMOVED',
        severity: 'critical',
        entrypoint: ep.id,
        message: `${ep.label} was guarded in the baseline and is now reachable without any guard`,
        evidence: [],
      });
    }
    // D3 — blast radius grew
    const before = new Set(ep.meta.mutatesDomains ?? []);
    const grew = (now.meta.mutatesDomains ?? []).filter((d) => !before.has(d)).sort();
    if (grew.length) {
      findings.push({
        rule: 'BLAST_RADIUS_GREW',
        severity: 'medium',
        entrypoint: ep.id,
        message: `${ep.label} now mutates aggregate(s) it did not touch before: ${grew.join(', ')}`,
        evidence: grew,
      });
    }
  }

  // D4 — declared invariant disappeared from a still-existing table
  for (const n of baseline.nodes) {
    if (n.kind !== 'state') continue;
    const now = cand.nodes.get(n.id);
    if (!now) continue;
    const still = new Set((now.meta.invariants ?? []).map((i) => JSON.stringify(i)));
    for (const inv of n.meta.invariants ?? []) {
      if (!still.has(JSON.stringify(inv))) {
        findings.push({
          rule: 'INVARIANT_REMOVED',
          severity: 'high',
          entrypoint: n.id,
          message: `table "${n.meta.table}" lost a declared invariant: ${fmtInvariant(inv)}`,
          evidence: [JSON.stringify(inv)],
        });
      }
    }
  }

  return { findings: sortFindings(findings) };
}

// ---------------------------------------------------------------------------

// State-touching behavior SPARDA could actually fault: state nodes + db/http/fs
// effects. `entropy` (a bare `new Date()`) is not safety-relevant, so it doesn't
// count — an app of only time-reads has no behavior to prove. This is the effect-level
// analogue of the provability guard, shared by the verdict and the immunity capsule so
// the two artifacts never disagree about whether SPARDA saw anything to prove.
const OBSERVABLE_EFFECT = new Set(['db_write', 'db_read', 'http_call', 'fs_write']);
export function countObserved(graph) {
  let n = 0;
  for (const node of graph.nodes.values ? graph.nodes.values() : graph.nodes) {
    if (
      node.kind === 'state' ||
      (node.kind === 'effect' && OBSERVABLE_EFFECT.has(node.meta?.effectType))
    )
      n++;
  }
  return n;
}

export function verdictOf(findings, graph) {
  const counts = { critical: 0, high: 0, medium: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  // Provability guard: a compile that reached ZERO entrypoints proved nothing —
  // an empty graph must never read as PROVEN/RISKY. A parser-coverage miss (a
  // route surface the static eye could not see) has to be loud, not a silent
  // green. `safe`/`clean` fold `provable` in, so every caller that gates on them
  // (apocalypse & review both `exit 1` on !safe) refuses a blind compile for free.
  // `graph` omitted (e.g. heal's regression delta, which isn't a whole-app
  // proof) → provability is not asserted and the old semantics hold.
  const entrypoints = graph
    ? graph.nodes.filter((n) => n.kind === 'entrypoint').length
    : null;
  const provable = entrypoints === null || entrypoints > 0;
  const observed = graph ? countObserved(graph) : null;
  // only assert surface-only for a WHOLE-app proof (graph given with entrypoints);
  // a partial graph (heal's delta, entrypoints===null) keeps the old semantics.
  const surfaceOnly = provable && entrypoints > 0 && observed === 0;
  // guard provenance: how many guards did SPARDA actually VERIFY (see a deny path in
  // the body) vs only assert by name (opaque middleware/decorators it couldn't read).
  // Honest signal — it does not change the verdict, but it tells you how much of the
  // auth posture rests on trust vs proof.
  const guards = graph ? graph.nodes.filter((n) => n.kind === 'guard') : [];
  const guardsVerified = guards.filter((g) => g.meta?.verified).length;
  // `safe` is the CI gate (block a risky deploy): a surface-only app has no
  // critical/high findings and is NOT risky, so it does not fail the gate — it just
  // isn't a positive proof. `clean` is the strong claim (PROVEN) and DOES require
  // observed behavior, so a hollow "everything's fine" can never read as PROVEN.
  return {
    counts,
    entrypoints,
    observed,
    provable,
    surfaceOnly,
    guards: guards.length,
    guardsVerified,
    safe: provable && counts.critical === 0 && counts.high === 0,
    clean: provable && !surfaceOnly && findings.length === 0,
  };
}

function sortFindings(findings) {
  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      cmp(a.rule, b.rule) ||
      cmp(a.entrypoint, b.entrypoint),
  );
}

const fmtStates = (writes) =>
  [...new Set(writes.map((w) => w.stateId.split(':').pop()))].sort().join(', ');

const fmtInvariant = (inv) =>
  inv.type === 'check'
    ? `CHECK (${inv.expression})`
    : `${inv.type.toUpperCase()} (${(inv.fields ?? []).join(', ')})`;
