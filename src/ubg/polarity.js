// ubg/polarity.js — the ternary behavior algebra (ADR-036).
//
// Inspiration: BitNet reduces every network weight to {-1, 0, +1} so matrix
// multiplication collapses into addition. We do the analogue for VERIFICATION.
// Each entrypoint, against each safety obligation, is reduced to one ternary
// digit: +1 the protection is present, 0 the obligation does not apply, -1 it is
// violated. The vector is produced in checkGraph (one source of truth with the
// findings — a -1 IS a finding). This file is the algebra over those vectors:
//
//   • a verdict is a sign check     — PROVEN ⇔ no gating axis is -1
//   • a PR review is a SUBTRACTION  — candidate − base; a negative delta on an
//                                     axis means the change REMOVED a protection
//   • a posture is a COLUMN SUM     — count the -1/+1/0 per axis across routes;
//                                     stack routes → app, stack apps → fleet.
//
// That closure — verification as add/subtract over a tiny alphabet — is what lets
// the collective genome (ADR-035) compose behavior at scale: merging knowledge is
// adding ternary columns, not re-running proofs. No floats, no drift, deterministic.
import { cmp } from './schema.js';

// The five obligations apocalypse discharges, in gating order. Severity is the
// same mapping the findings use, so the arithmetic verdict matches the worded one.
export const AXES = Object.freeze([
  'auth', // O1 UNGUARDED_MUTATION
  'atomicity', // O3 NON_ATOMIC_AGGREGATE_WRITE
  'reversibility', // O4 IRREVERSIBLE_OBSERVABLE
  'validation', // O2 UNVALIDATED_CONSTRAINED_WRITE
  'aggregate', // O5 AGGREGATE_MEMBER_BYPASS
]);

export const AXIS_SEVERITY = Object.freeze({
  auth: 'critical',
  atomicity: 'high',
  reversibility: 'high',
  validation: 'medium',
  aggregate: 'info',
});

const GATING = new Set(['critical', 'high']); // a -1 here means NOT PROVEN
export const POLARITY_SYMBOL = Object.freeze({ '-1': '−', 0: '·', 1: '+' });

// A route is "exposed" on an axis when its digit is -1. Gating exposure (auth /
// atomicity / reversibility) is what flips a verdict to NOT PROVEN.
export function exposedAxes(vector) {
  return AXES.filter((a) => vector[a] === -1);
}

// PROVEN ⇔ no gating axis is -1, across every entrypoint. Pure sign check — the
// arithmetic twin of verdictOf's `safe`.
export function provenByPolarity(polarity) {
  return polarity.every((p) =>
    exposedAxes(p.vector).every((a) => !GATING.has(AXIS_SEVERITY[a])),
  );
}

// Column sums: the app's exposure profile. protected/exposed/na per axis — the
// ternary matrix collapsed to one row you can stack across apps into a fleet view.
export function posture(polarity) {
  const cols = {};
  for (const a of AXES) cols[a] = { protected: 0, exposed: 0, na: 0 };
  for (const { vector } of polarity) {
    for (const a of AXES) {
      const d = vector[a];
      cols[a][d === 1 ? 'protected' : d === -1 ? 'exposed' : 'na']++;
    }
  }
  return cols;
}

// review as subtraction: candidate − base, per shared entrypoint, per axis. A
// negative delta means this change WEAKENED that axis (a protection removed); a
// positive delta means it strengthened it. `regressed` is the headline: the axes
// a PR made worse — the same thing diffGraphs reports in prose, as arithmetic.
export function polarityDelta(baseList, candList) {
  const base = new Map(baseList.map((p) => [p.entrypoint, p.vector]));
  const out = [];
  for (const { entrypoint, vector } of candList) {
    const b = base.get(entrypoint);
    if (!b) continue; // new entrypoint — surfaced by the endpoint diff, not here
    const deltas = {};
    const regressed = [];
    for (const a of AXES) {
      const d = (vector[a] ?? 0) - (b[a] ?? 0);
      deltas[a] = d;
      if (d < 0) regressed.push(a);
    }
    if (regressed.length || Object.values(deltas).some((d) => d !== 0)) {
      out.push({ entrypoint, deltas, regressed });
    }
  }
  return out.sort((x, y) => cmp(x.entrypoint, y.entrypoint));
}

// Compact printable signature of a vector, e.g. "auth:− validation:+ …" — order
// fixed by AXES so it is stable across machines.
export function polaritySignature(vector) {
  return AXES.map((a) => `${a}:${POLARITY_SYMBOL[vector[a]]}`).join(' ');
}

// --- BitNet-style packing: a route's whole safety character in ONE byte -------
// The five axes are five trits {-1,0,+1}. Five trits = 3^5 = 243 states < 256, so
// the entire polarity vector packs into a single byte (base-3, digit = trit+1).
// This is the atom of the immunity capsule (ADR-037): frozen judgment, near-zero
// storage, decoded by a pure table lookup — no recompile, no LLM, no network.
export function packVector(vector) {
  let byte = 0;
  for (let i = AXES.length - 1; i >= 0; i--)
    byte = byte * 3 + ((vector[AXES[i]] ?? 0) + 1);
  return byte; // 0..242
}

export function unpackVector(byte) {
  const vector = {};
  let b = byte;
  for (const a of AXES) {
    vector[a] = (b % 3) - 1;
    b = Math.floor(b / 3);
  }
  return vector;
}
