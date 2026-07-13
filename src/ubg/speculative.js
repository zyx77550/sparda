// ubg/speculative.js — speculative verification (ADR-038).
//
// Inspiration: speculative decoding — a cheap draft model proposes, the expensive
// model verifies, and you only pay full cost on the residual the draft got wrong.
// The analogue for a proof engine: re-proving a whole app after every agent edit is
// expensive (seconds on a monster like Dub — 559 routes). But most edits touch shapes
// SPARDA has ALREADY proven. So we speculate: look each candidate route's behaviorHash
// up in a frozen capsule (O(1), no compile) and accept/reject from that; only the
// routes whose SHAPE is novel fall through to the full prover.
//
// Stronger than speculative decoding: there, the draft can be wrong and the verifier
// overrides it. Here a capsule hit is EXACT — identical behaviorHash ⇒ identical
// behavioral shape ⇒ identical obligations ⇒ the same verdict the full prover would
// give. The shortcut is provably equal to the full answer; we skip the compute, never
// the correctness. Zero infra: a hash lookup over a few bytes per route.
import { fingerprintGraph } from './fingerprint.js';
import { judge } from './immunity.js';
import { cmp } from './schema.js';

// (frozen capsule, candidate graph) → a triage: which routes are settled for free
// from the capsule, and which are NOVEL and must pay the full prover.
//   accepted — shape known & safe   (0 prover work)
//   rejected — shape known & exposed (0 prover work)
//   novel    — shape unseen          → hand to checkGraph/apocalypse
export function speculativeVerify(capsule, candidateGraph) {
  const prints = fingerprintGraph(candidateGraph);
  const accepted = [];
  const rejected = [];
  const novel = [];

  for (const { entrypoint, behaviorHash } of prints) {
    const verdict = judge(capsule, behaviorHash);
    const row = { entrypoint, behaviorHash };
    if (!verdict.known) novel.push(row);
    else if (verdict.safe) accepted.push({ ...row, exposed: [] });
    else rejected.push({ ...row, exposed: verdict.exposed });
  }

  const bySort = (a, b) => cmp(a.entrypoint, b.entrypoint);
  accepted.sort(bySort);
  rejected.sort(bySort);
  novel.sort(bySort);

  const total = prints.length;
  const settled = accepted.length + rejected.length; // verified WITHOUT the prover
  return {
    accepted,
    rejected,
    novel,
    total,
    settled,
    // the speedup metric: fraction of routes decided by lookup alone (0..1).
    // 1.0 means the whole re-verification cost nothing; only `novel` pays.
    acceptanceRate: total ? settled / total : 1,
  };
}
