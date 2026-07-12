// immunity.test.js — the 1-byte-per-route capsule (ADR-037) + trit packing.
// Two claims: (1) a route's whole 5-axis polarity round-trips through a SINGLE
// byte (5 trits, 3^5 = 243 < 256) with zero loss; (2) the capsule is a
// self-contained, portable judgment consulted by pure lookup — no recompile.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import { AXES, packVector, unpackVector } from '../src/ubg/polarity.js';
import { buildCapsule, judge, mergePosture } from '../src/ubg/immunity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const graphOf = (fx) =>
  canonicalizeGraph(compileUBG(path.join(here, 'fixtures', fx), { write: false }).graph);

// enumerate all 3^5 ternary vectors
function allVectors() {
  const out = [];
  const digits = [-1, 0, 1];
  for (const a of digits)
    for (const b of digits)
      for (const c of digits)
        for (const d of digits)
          for (const e of digits)
            out.push({
              auth: a,
              atomicity: b,
              reversibility: c,
              validation: d,
              aggregate: e,
            });
  return out;
}

describe('trit packing — a route in one byte', () => {
  it('round-trips every one of the 243 vectors, and every byte is < 256', () => {
    const seen = new Set();
    for (const v of allVectors()) {
      const byte = packVector(v);
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThan(256);
      seen.add(byte);
      // reorder unpack result onto AXES for a stable compare
      const back = unpackVector(byte);
      for (const a of AXES) expect(back[a]).toBe(v[a]);
    }
    expect(seen.size).toBe(243); // injective — no two vectors share a byte
  });

  it('the all-neutral vector and a known-bad vector pack to stable bytes', () => {
    expect(
      packVector({
        auth: 0,
        atomicity: 0,
        reversibility: 0,
        validation: 0,
        aggregate: 0,
      }),
    ).toBe(121);
    // auth/validation/aggregate exposed, atomicity/reversibility n/a (the Prisma PUT shape)
    expect(
      packVector({
        auth: -1,
        atomicity: 0,
        reversibility: 0,
        validation: -1,
        aggregate: -1,
      }),
    ).toBe(12);
  });
});

describe('immunity capsule — frozen, portable judgment', () => {
  it('one byte per route; bytes === route count', () => {
    const cap = buildCapsule(graphOf('ubg-express'));
    expect(cap.v).toBe('imm1');
    expect(cap.bytes).toBe(cap.routes.length);
    for (const r of cap.routes) {
      expect(r.pol).toBeGreaterThanOrEqual(0);
      expect(r.pol).toBeLessThan(256);
      expect(r.behaviorHash).toMatch(/^bh1_[0-9a-f]{32}$/);
    }
  });

  it('judge() answers a known shape by pure lookup, and admits an unknown one', () => {
    const cap = buildCapsule(graphOf('ubg-express'));
    const known = cap.routes[0].behaviorHash;
    const verdict = judge(cap, known);
    expect(verdict.known).toBe(true);
    expect(verdict.pol).toBe(cap.routes[0].pol);
    expect(judge(cap, 'bh1_deadbeefdeadbeefdeadbeefdeadbeef').known).toBe(false);
  });

  it('is deterministic (byte-stable) across runs', () => {
    const g = graphOf('ubg-semantics');
    expect(JSON.stringify(buildCapsule(g))).toBe(JSON.stringify(buildCapsule(g)));
  });

  it('capsules compose — fleet posture is a column sum', () => {
    const a = buildCapsule(graphOf('ubg-express'));
    const b = buildCapsule(graphOf('ubg-semantics'));
    const fleet = mergePosture([a, b]);
    for (const axis of AXES) {
      expect(fleet[axis].exposed).toBe(a.posture[axis].exposed + b.posture[axis].exposed);
      expect(fleet[axis].protected).toBe(
        a.posture[axis].protected + b.posture[axis].protected,
      );
    }
  });
});
