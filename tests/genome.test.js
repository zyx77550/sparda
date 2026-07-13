// genome.test.js — the world immune memory (ADR-041, Brick 2).
// The "technology of faith" is three OFFLINE-checkable guarantees, and these tests
// pin each one: (1) INTEGRITY — the id is the content address, so any tamper to the
// claim is caught; (2) PROVENANCE — the Ed25519 signature binds the claim to a key
// that travels with it, so a forged/relabelled issuer is caught; (3) REPRODUCIBILITY
// — minting is a pure function, so the same verdict is byte-identical (idempotent).
// Plus: merge dedups + corroborates + surfaces conflicts; recall reports consensus;
// a poisoned genome file degrades to the antibodies that still verify.
import { describe, it, expect } from 'vitest';
import {
  generateIdentity,
  issuerOf,
  mintAntibody,
  mintGenome,
  verifyAntibody,
  mergeGenome,
  emptyGenome,
  recall,
  indexGenome,
  recallIndexed,
  serializeGenome,
  parseGenome,
  ANTIBODY_VERSION,
} from '../src/ubg/genome.js';

const alice = generateIdentity();
const bob = generateIdentity();

describe('identity', () => {
  it('mints a distinct Ed25519 keypair whose issuer is its key fingerprint', () => {
    expect(alice.issuer).toMatch(/^gk1_[0-9a-f]{16}$/);
    expect(alice.issuer).not.toBe(bob.issuer);
    expect(issuerOf(alice.publicKey)).toBe(alice.issuer);
  });
});

describe('antibody — the three guarantees', () => {
  it('REPRODUCIBILITY: minting the same verdict is byte-identical (idempotent)', () => {
    const a = mintAntibody('bh1_abc', 12, alice);
    const b = mintAntibody('bh1_abc', 12, alice);
    expect(a).toEqual(b);
    expect(a.id).toMatch(new RegExp(`^${ANTIBODY_VERSION}_[0-9a-f]{32}$`));
  });

  it('a valid antibody verifies', () => {
    expect(verifyAntibody(mintAntibody('bh1_abc', 12, alice))).toEqual({ ok: true });
  });

  it('INTEGRITY: tampering the verdict breaks the content address', () => {
    const a = mintAntibody('bh1_abc', 12, alice);
    expect(verifyAntibody({ ...a, pol: 0 }).reason).toBe('content-address');
    expect(verifyAntibody({ ...a, behaviorHash: 'bh1_evil' }).reason).toBe(
      'content-address',
    );
  });

  it('PROVENANCE: a relabelled issuer or forged signature is rejected', () => {
    const a = mintAntibody('bh1_abc', 12, alice);
    // claim someone else issued it — the label must equal the carried key's fingerprint
    expect(verifyAntibody({ ...a, issuer: bob.issuer }).reason).toBe('issuer-mismatch');
    // keep alice's key + claim, but swap in a signature over a DIFFERENT claim:
    // the content address still matches (same pol), so it fails at the signature.
    const b = mintAntibody('bh1_abc', 0, alice);
    expect(verifyAntibody({ ...a, sig: b.sig }).reason).toBe('signature');
    // an all-zero signature that isn't over these bytes either
    const forged = { ...a, sig: Buffer.from(new Uint8Array(64)).toString('base64url') };
    expect(verifyAntibody(forged).reason).toBe('signature');
  });

  it('rejects malformed antibodies (range, type, version)', () => {
    const a = mintAntibody('bh1_abc', 12, alice);
    expect(verifyAntibody({ ...a, pol: 999 }).reason).toBe('pol-range');
    expect(verifyAntibody({ ...a, v: 'ab0' }).reason).toBe('version');
    expect(verifyAntibody(null).ok).toBe(false);
  });
});

describe('merge — dedup, corroboration, conflict', () => {
  it('admits only verified antibodies and dedups exact repeats', () => {
    const a = mintAntibody('bh1_a', 12, alice);
    const bad = { ...a, pol: 0 }; // fails content-address
    const r = mergeGenome(emptyGenome(), [a, a, bad]);
    expect(r.added).toBe(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.genome.antibodies).toHaveLength(1);
  });

  it('counts corroboration when a second issuer agrees on the same verdict', () => {
    let { genome } = mergeGenome(emptyGenome(), [mintAntibody('bh1_a', 12, alice)]);
    const r = mergeGenome(genome, [mintAntibody('bh1_a', 12, bob)]);
    expect(r.added).toBe(1);
    expect(r.corroborated).toBe(1);
  });

  it('is order-independent and canonically sorted (deterministic bytes)', () => {
    const abs = [
      mintAntibody('bh1_b', 121, bob),
      mintAntibody('bh1_a', 12, alice),
      mintAntibody('bh1_a', 12, bob),
    ];
    const g1 = mergeGenome(emptyGenome(), abs).genome;
    const g2 = mergeGenome(emptyGenome(), [...abs].reverse()).genome;
    expect(serializeGenome(g1)).toBe(serializeGenome(g2));
  });
});

describe('recall — the world memory answers', () => {
  const abs = [
    mintAntibody('bh1_safe', 121, alice), // all-neutral: safe
    mintAntibody('bh1_risk', 12, alice), // exposed on several axes
    mintAntibody('bh1_risk', 12, bob), // bob agrees
    mintAntibody('bh1_disp', 121, alice), // alice: safe
    mintAntibody('bh1_disp', 12, bob), // bob: not safe → conflict
  ];
  const genome = mergeGenome(emptyGenome(), abs).genome;

  it('reports an unknown behavior as unknown', () => {
    expect(recall(genome, 'bh1_none')).toEqual({ known: false });
  });

  it('reports witnesses and safety for an agreed verdict', () => {
    const r = recall(genome, 'bh1_risk');
    expect(r.known).toBe(true);
    expect(r.witnesses).toBe(2);
    expect(r.conflict).toBe(false);
    expect(r.safe).toBe(false);
    expect(r.exposed.length).toBeGreaterThan(0);
  });

  it('surfaces disagreement between issuers instead of hiding it', () => {
    const r = recall(genome, 'bh1_disp');
    expect(r.conflict).toBe(true);
    expect(r.verdicts).toHaveLength(2);
    expect(r.witnesses).toBe(2);
  });

  it('indexed recall is O(1) and byte-for-byte identical to linear recall', () => {
    const index = indexGenome(genome);
    for (const h of ['bh1_safe', 'bh1_risk', 'bh1_disp', 'bh1_none']) {
      expect(recallIndexed(index, h)).toEqual(recall(genome, h));
    }
    // the index is a plain Map keyed by behaviorHash — one entry per known behavior
    expect(index.size).toBe(3);
    expect(recallIndexed(index, 'bh1_none')).toEqual({ known: false });
  });
});

describe('serialization — the committable file IS the database', () => {
  it('round-trips byte-for-byte and re-verifies every line', () => {
    const genome = mergeGenome(emptyGenome(), [
      mintAntibody('bh1_a', 12, alice),
      mintAntibody('bh1_b', 121, bob),
    ]).genome;
    const text = serializeGenome(genome);
    const { genome: back, admitted, rejected } = parseGenome(text);
    expect(admitted).toBe(2);
    expect(rejected).toHaveLength(0);
    expect(serializeGenome(back)).toBe(text); // stable bytes across the round trip
  });

  it('a poisoned file degrades to the antibodies that still verify', () => {
    const good = mintAntibody('bh1_a', 12, alice);
    const forged = JSON.stringify({ ...good, pol: 0 }); // signature no longer matches
    const text = serializeGenome({ v: 'gen1', antibodies: [good] }) + forged + '\n';
    const { admitted, rejected } = parseGenome(text + 'not-json\n');
    expect(admitted).toBe(1);
    expect(rejected.length).toBe(2); // the forged line + the garbage line
  });

  it('mintGenome turns a capsule into a sorted antibody set (skips null hashes)', () => {
    const capsule = {
      routes: [
        { behaviorHash: 'bh1_z', pol: 12 },
        { behaviorHash: null, pol: 0 }, // no fingerprint → no antibody
        { behaviorHash: 'bh1_a', pol: 121 },
      ],
    };
    const abs = mintGenome(capsule, alice);
    expect(abs).toHaveLength(2);
    expect(abs.every((a) => verifyAntibody(a).ok)).toBe(true);
  });
});
