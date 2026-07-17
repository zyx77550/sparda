// ubg/blindspots.js — the Unknown Behavior Surface (UBS) ledger.
//
// Every other prover tells you what it PROVED. This one also tells you, precisely
// and ranked by danger, what it could NOT see — SPARDA's own blindness, made into a
// first-class, measurable artifact. A static tool that silently drops the 20% it
// can't resolve reads as green and lies by omission; a tool that hands you the map
// of its blind spots is the honest one. (Idea seeded by Reyna's UBS, but derived
// from the REAL graph + skip log here — no hand-authored regions, nothing invented.)
//
// A blind spot is one of four things, each computable without guessing:
//   opaque-target    — an effect SPARDA saw but whose target it could not name
//                      (db op with no table, http/fs with a computed path)
//   skipped-surface  — a route/handler/mount the extractor could not bring into the
//                      graph at all (a dynamic path, an unresolved handler arg/mount)
//   blind-mutation   — a MUTATING entrypoint that resolved to zero behavior: SPARDA
//                      saw the door but nothing behind it (an unreadable handler)
//   unverified-guard — a guard trusted only by NAME, never seen to deny (auth on faith)
//
// Risk is assigned from what the blind spot could be HIDING, not from its name.
import { indexGraph, reachOf } from './apocalypse.js';
import { cmp } from './schema.js';

const RISK_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const MUTATING_VERB = /\b(post|put|patch|delete)\b/i;

// An effect whose target SPARDA could not resolve to a concrete (or symbolic) name.
// A `symbolic` table (`:collection`, param-derived) is NOT opaque — it is a precise
// answer expressed as a rule, so it is deliberately excluded.
function isOpaqueTarget(node) {
  if (node.kind !== 'effect') return false;
  const m = node.meta ?? {};
  if (m.symbolic) return false;
  if (m.effectType === 'db_read' || m.effectType === 'db_write')
    return m.table == null || m.table === '?';
  if (
    m.effectType === 'http_call' ||
    m.effectType === 'fs_write' ||
    m.effectType === 'fs_read'
  )
    return m.target == null || m.target === 'dynamic' || m.target === 'unknown';
  return false;
}

function opaqueRisk(effectType) {
  if (
    effectType === 'db_write' ||
    effectType === 'fs_write' ||
    effectType === 'http_call'
  )
    return 'high';
  return 'medium'; // reads: SPARDA can't name what's read, but nothing changes state
}

// → { surface, byRisk, coverage, spots } — deterministic (sorted), report-optional.
export function surveyBlindspots(graph, report = {}) {
  const g = indexGraph(graph);
  const spots = [];

  // 1 — opaque-target effects (SPARDA saw the effect, not its target)
  for (const node of graph.nodes) {
    if (!isOpaqueTarget(node)) continue;
    spots.push({
      kind: 'opaque-target',
      risk: opaqueRisk(node.meta.effectType),
      location: node.loc ? `${node.loc.file}:${node.loc.line}` : null,
      label: node.label,
      why: `${node.meta.effectType} with an unresolved target — SPARDA saw the call but not what it touches`,
    });
  }

  // 2 — blind mutations: a mutating entrypoint that reached zero observable behavior.
  // Its handler body was unreadable (opaque fn) or delegated somewhere static analysis
  // couldn't follow — the single most dangerous blind spot, because an unguarded write
  // could be hiding right there and the proof would never see it.
  for (const ep of g.entrypoints) {
    if (!ep.meta?.mutating) continue;
    const reached = [...reachOf(ep.id, g.cfOut)].map((id) => g.nodes.get(id));
    const sawBehavior = reached.some((n) => n?.kind === 'effect' || n?.kind === 'state');
    if (sawBehavior) continue;
    // Only a blind spot if a handler body was actually UNREADABLE (opaque) — a
    // mutating route that resolved to a genuinely empty body (SPARDA read it, there
    // was nothing) is not blindness, it's a no-op, and must not be flagged.
    const hasOpaqueBody = reached.some((n) => n?.meta?.opaque);
    if (!hasOpaqueBody) continue;
    // Risk reflects what it could hide: an unreadable mutation with NO guard anywhere on
    // its path is the worst case (an unguarded write, unseen) → critical; behind a guard
    // it is high (the guard limits, but SPARDA still can't see the write).
    const guarded = reached.some((n) => n?.kind === 'guard');
    spots.push({
      kind: 'blind-mutation',
      risk: guarded ? 'high' : 'critical',
      entrypoint: ep.id,
      location: ep.loc ? `${ep.loc.file}:${ep.loc.line}` : null,
      label: ep.label,
      why: guarded
        ? 'a guarded state-changing route whose write did not resolve — SPARDA cannot see what it mutates'
        : 'an UNGUARDED state-changing route whose behavior did not resolve — an unguarded write could hide here entirely unseen',
    });
  }

  // 3 — unverified guards: protection asserted by name, never seen to deny.
  for (const node of graph.nodes) {
    if (node.kind !== 'guard' || node.meta?.verified) continue;
    spots.push({
      kind: 'unverified-guard',
      risk: 'low',
      location: node.loc ? `${node.loc.file}:${node.loc.line}` : null,
      label: node.label,
      why: 'trusted as a guard by its name, but SPARDA never saw it deny (opaque body) — auth resting on faith',
    });
  }

  // 4 — skipped surface: routes/handlers/mounts the extractor could not graph at all.
  for (const s of report.skipped ?? []) {
    const reason = s.reason ?? '';
    spots.push({
      kind: 'skipped-surface',
      risk: MUTATING_VERB.test(reason) ? 'high' : 'medium',
      location: s.file ? `${s.file}${s.line ? `:${s.line}` : ''}` : null,
      label: reason,
      why: 'a surface the static walk could not bring into the graph — its behavior is entirely unseen',
    });
  }

  spots.sort(
    (a, b) =>
      RISK_RANK[a.risk] - RISK_RANK[b.risk] ||
      cmp(a.kind, b.kind) ||
      cmp(a.location ?? '', b.location ?? '') ||
      cmp(a.label ?? '', b.label ?? ''),
  );

  const byRisk = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const s of spots) byRisk[s.risk]++;

  // coverage: of the state-touching behavior SPARDA found SIGNAL for (resolved effects
  // + blind spots that are effect/route-shaped), what fraction did it fully resolve?
  // The honest CBS/UBS ratio — 1.0 means nothing seen was left unresolved.
  const resolved = countResolved(graph);
  const blindBehavior = spots.filter(
    (s) =>
      s.kind === 'opaque-target' ||
      s.kind === 'blind-mutation' ||
      s.kind === 'skipped-surface',
  ).length;
  const denom = resolved + blindBehavior;
  const coverage = {
    resolved,
    blind: blindBehavior,
    ratio: denom === 0 ? 1 : Math.round((resolved / denom) * 1000) / 1000,
  };

  return { surface: spots.length, byRisk, coverage, spots };
}

// resolved behavior = state nodes + effects whose target IS known (concrete or symbolic).
const OBSERVABLE = new Set(['db_write', 'db_read', 'http_call', 'fs_write', 'fs_read']);
function countResolved(graph) {
  let n = 0;
  for (const node of graph.nodes) {
    if (node.kind === 'state') n++;
    else if (
      node.kind === 'effect' &&
      OBSERVABLE.has(node.meta?.effectType) &&
      !isOpaqueTarget(node)
    )
      n++;
  }
  return n;
}
