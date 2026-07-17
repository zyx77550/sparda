// ubg/llm-resolve.js — LLM-assisted resolution of unverified guards, with the
// verify-before-admit guardrail the literature identifies as the critical step (Thakur et al.,
// "Interleaving static analysis and LLM prompting", STTT 2025; "Boosting Pointer Analysis with
// LLM-Enhanced Allocation Detection", arXiv 2509.22530). See docs/RESEARCH-AND-10X-IDEAS §Part 1.
//
// THE CONTRACT (soundness — non-negotiable): an LLM may only produce a *resolution hint* (where a
// guard's deny logic likely lives) or a *candidate classification*. It never asserts behavior.
// SPARDA re-verifies the hint STRUCTURALLY against the real graph before anything enters the
// proof. A guard becomes `verified` ONLY when a deny path is structurally proven — never on the
// model's word. Skipping this exact step is what produced E-022/E-025/E-026 (false PROVEN), the
// cardinal sin. This module makes the guardrail executable and testable; the hint *producer*
// (MCP sampling — the host never pays, CLAUDE.md rule 1) plugs in on top and is out of scope
// here on purpose, so no LLM dependency and no un-verified path can ever leak into the graph.

// The unverified guards worth an LLM resolution attempt: protection asserted by name, whose body
// SPARDA never saw deny (the `unverified-guard` blind-spot category, blindspots.js). These are
// the ambiguous DI/factory/opaque-import patterns the AST walker can't resolve structurally.
export function resolutionTargets(graph) {
  if (!graph?.nodes) return [];
  return graph.nodes.filter((n) => n.kind === 'guard' && !n.meta?.verified);
}

// Admit an LLM resolution hint for ONE guard — and ONLY if SPARDA's own structural prover
// confirms a deny path at the hinted location. `proveDeny(hint)` is SPARDA's deny-detection,
// injected so this module stays testable and carries no LLM dependency itself. The hint is NEVER
// trusted on its own; it only tells the structural prover where to look.
//
// On success the guard is marked `verified: true` with `verifiedVia: 'llm-guided'` — a distinct
// provenance so an LLM-guided verification is always auditable and never silently indistinguish-
// able from a natively-proven guard (guardsVerified counting, dossier, audits can separate them).
// Returns { admitted, reason }; mutates guardNode.meta only on a confirmed admit.
export function admitResolutionHint(guardNode, hint, { proveDeny } = {}) {
  if (!guardNode || guardNode.kind !== 'guard')
    return { admitted: false, reason: 'not-a-guard' };
  if (guardNode.meta?.verified) return { admitted: false, reason: 'already-verified' };
  if (typeof proveDeny !== 'function')
    return { admitted: false, reason: 'no-structural-prover' };
  if (!hint) return { admitted: false, reason: 'no-hint' };

  // THE GUARDRAIL. The model's hint buys nothing until SPARDA itself proves the deny.
  const denies = proveDeny(hint) === true;
  if (!denies) return { admitted: false, reason: 'hint-not-structurally-confirmed' };

  guardNode.meta = { ...guardNode.meta, verified: true, verifiedVia: 'llm-guided' };
  return { admitted: true, reason: 'structurally-confirmed' };
}
