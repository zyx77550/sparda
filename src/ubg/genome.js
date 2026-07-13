// ubg/genome.js — the world immune memory (ADR-041). Brick 2 of collective immunity.
//
// The capsule (immunity.js, Brick 1) is one app's frozen judgment. The genome is
// how that judgment travels between strangers' machines and becomes shared memory —
// with ZERO infrastructure and a trust model that needs no server, no CA, no chain.
//
// The unit is an ANTIBODY: a single portable claim — "behavior X has polarity byte
// P, per prover V" — wrapped in a self-certifying envelope. Its trust rests on three
// guarantees, each checkable OFFLINE, with nothing but this file's bytes and a CPU:
//
//   1. INTEGRITY by content-addressing — the antibody's `id` is the hash of its own
//      claim. Alter one bit of the claim and the id no longer matches. You do not
//      trust the transport; the artifact proves its own wholeness. (git objects, CIDs.)
//   2. PROVENANCE by signature — an Ed25519 signature binds the claim to a keypair,
//      and the public key travels WITH the antibody (`key`), its fingerprint being the
//      `issuer`. You know exactly which prover vouched, and forging under its identity
//      is infeasible. Reputation accrues to keys, not to a database. (signed commits.)
//   3. TRUTH by reproducibility — this is the one only a PROVER can offer: the claim
//      (the polarity byte) is a DETERMINISTIC function of the behaviorHash's shape.
//      So an antibody is not merely "believed because signed" — it is RE-DERIVABLE:
//      recompile the same behavior and you must get the same byte. Signature says who,
//      content-address says intact, reproducibility says true.
//
// That is the "technology of faith": you extend trust to a claim from a stranger's
// SPARDA because MATH — not an authority — lets you verify it. Cost model (hard
// rule #1): all crypto happens at MINT and MERGE, never on the request path. Storage
// is a file; replication is git; there is no server to run and no bill to pay. And no
// new dependency (hard rule #8): the signatures are Node's built-in `node:crypto`.
import crypto from 'node:crypto';
import { cmp, stableStringify } from './schema.js';
import { unpackVector, exposedAxes } from './polarity.js';

export const GENOME_VERSION = 'gen1';
export const ANTIBODY_VERSION = 'ab1';
// the proving logic's identity: a verdict is only comparable to another made by the
// same prover. Bump when the obligation set / polarity semantics change (ADR-036/040).
export const PROVER = 'sparda-apoc1';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── identity: an Ed25519 keypair, the private half stays local forever ──────

// A fresh proving identity. `publicKey`/`privateKey` are base64url DER strings so
// they persist as plain text (private → `.sparda/genome.key`, gitignored; public
// rides inside every antibody). Never write `privateKey` anywhere shareable.
export function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = b64u(publicKey.export({ type: 'spki', format: 'der' }));
  const priv = b64u(privateKey.export({ type: 'pkcs8', format: 'der' }));
  return { publicKey: pub, privateKey: priv, issuer: issuerOf(pub) };
}

// a short, stable fingerprint of a public key — the issuer's name in the genome.
export function issuerOf(publicKeyB64u) {
  return `gk1_${sha256(fromB64u(publicKeyB64u)).slice(0, 16)}`;
}

function publicKeyObj(publicKeyB64u) {
  return crypto.createPublicKey({
    key: fromB64u(publicKeyB64u),
    type: 'spki',
    format: 'der',
  });
}
function privateKeyObj(privateKeyB64u) {
  return crypto.createPrivateKey({
    key: fromB64u(privateKeyB64u),
    type: 'pkcs8',
    format: 'der',
  });
}

// ── minting: capsule → signed, content-addressed antibodies ─────────────────

// The claim IDENTITY — the bytes that are hashed into `id` and signed. Deliberately
// timestamp-free: the same prover+key asserting the same verdict about the same
// behavior IS the same antibody, so minting twice is idempotent and dedups perfectly.
// (A safety verdict about a fixed behavior shape does not expire.)
function claimBody(behaviorHash, pol, publicKeyB64u) {
  return stableStringify({
    v: ANTIBODY_VERSION,
    behaviorHash,
    pol,
    prover: PROVER,
    key: publicKeyB64u,
  });
}

// one capsule route → one antibody (skips routes whose behaviorHash is null).
export function mintAntibody(behaviorHash, pol, identity) {
  const body = claimBody(behaviorHash, pol, identity.publicKey);
  const id = `${ANTIBODY_VERSION}_${sha256(body).slice(0, 32)}`;
  const sig = b64u(
    crypto.sign(null, Buffer.from(body), privateKeyObj(identity.privateKey)),
  );
  return {
    v: ANTIBODY_VERSION,
    behaviorHash,
    pol,
    prover: PROVER,
    key: identity.publicKey,
    issuer: issuerOf(identity.publicKey),
    id,
    sig,
  };
}

// a whole capsule → the app's antibody contribution to the genome.
export function mintGenome(capsule, identity) {
  return capsule.routes
    .filter((r) => r.behaviorHash)
    .map((r) => mintAntibody(r.behaviorHash, r.pol, identity))
    .sort((a, b) => cmp(a.id, b.id));
}

// ── verification: the whole trust check, offline, no network ────────────────

// Returns { ok, reason }. Every guarantee is re-checked from the antibody's own
// bytes: issuer matches its embedded key, id matches its claim, signature verifies.
export function verifyAntibody(ab) {
  if (!ab || typeof ab !== 'object') return { ok: false, reason: 'not-an-object' };
  if (ab.v !== ANTIBODY_VERSION) return { ok: false, reason: 'version' };
  if (typeof ab.behaviorHash !== 'string' || !ab.behaviorHash)
    return { ok: false, reason: 'behaviorHash' };
  if (!Number.isInteger(ab.pol) || ab.pol < 0 || ab.pol > 242)
    return { ok: false, reason: 'pol-range' };
  // 2. provenance: the issuer label must be the fingerprint of the carried key —
  // it cannot be relabelled to impersonate another issuer.
  if (ab.issuer !== issuerOf(ab.key)) return { ok: false, reason: 'issuer-mismatch' };
  // 1. integrity: the id must be the content address of the claim.
  const body = claimBody(ab.behaviorHash, ab.pol, ab.key);
  const id = `${ANTIBODY_VERSION}_${sha256(body).slice(0, 32)}`;
  if (id !== ab.id) return { ok: false, reason: 'content-address' };
  // signature: Ed25519 over the same claim bytes the id commits to.
  let sigOk = false;
  try {
    sigOk = crypto.verify(
      null,
      Buffer.from(body),
      publicKeyObj(ab.key),
      fromB64u(ab.sig),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: 'signature' };
  return { ok: true };
}

// ── the genome: a verified, deduplicated corpus of antibodies ───────────────

export function emptyGenome() {
  return { v: GENOME_VERSION, antibodies: [] };
}

// Merge incoming antibodies into a genome. Only VERIFIED antibodies are admitted;
// exact duplicates (same id) collapse. Returns the new genome plus an honest report:
// how many were added, rejected (and why), and how many CORROBORATED an existing
// verdict (same behavior + same byte, independent issuer) — the signal that a claim
// is believed by more than one prover.
export function mergeGenome(genome, incoming) {
  const byId = new Map((genome.antibodies ?? []).map((a) => [a.id, a]));
  // behaviorHash+pol -> set of issuers already asserting it (for corroboration)
  const witnessed = new Map();
  for (const a of byId.values()) {
    const k = `${a.behaviorHash}|${a.pol}`;
    if (!witnessed.has(k)) witnessed.set(k, new Set());
    witnessed.get(k).add(a.issuer);
  }

  let added = 0;
  let corroborated = 0;
  const rejected = [];
  for (const ab of incoming) {
    const v = verifyAntibody(ab);
    if (!v.ok) {
      rejected.push({ id: ab?.id ?? null, reason: v.reason });
      continue;
    }
    if (byId.has(ab.id)) continue; // exact dup — already known
    const k = `${ab.behaviorHash}|${ab.pol}`;
    const seen = witnessed.get(k);
    if (seen && seen.size > 0 && !seen.has(ab.issuer)) corroborated++;
    if (!witnessed.has(k)) witnessed.set(k, new Set());
    witnessed.get(k).add(ab.issuer);
    byId.set(ab.id, ab);
    added++;
  }

  const antibodies = [...byId.values()].sort(
    (a, b) =>
      cmp(a.behaviorHash, b.behaviorHash) || cmp(a.issuer, b.issuer) || cmp(a.id, b.id),
  );
  return { genome: { v: GENOME_VERSION, antibodies }, added, corroborated, rejected };
}

// ── recall: what the world remembers about a behavior ───────────────────────

// The genome's answer for a behaviorHash: the verdict, how many INDEPENDENT issuers
// witnessed it, and whether they DISAGREE. Disagreement is surfaced, never hidden —
// two provers reaching different verdicts about one behavior is load-bearing signal.
// One-shot, O(n) in the genome — fine for a single lookup; for a hot loop (an agent
// asking per route across a large genome) build an index once (indexGenome) instead.
export function recall(genome, behaviorHash) {
  const hits = (genome.antibodies ?? []).filter((a) => a.behaviorHash === behaviorHash);
  return hits.length ? summarizeHits(hits) : { known: false };
}

// The consensus verdict over one behavior's antibodies. Consensus = the verdict with
// the most INDEPENDENT witnesses (ties broken by the lower byte, for determinism).
function summarizeHits(hits) {
  const byPol = new Map();
  const issuers = new Set();
  for (const a of hits) {
    issuers.add(a.issuer);
    if (!byPol.has(a.pol)) byPol.set(a.pol, new Set());
    byPol.get(a.pol).add(a.issuer);
  }
  const consensusPol = [...byPol.entries()].sort(
    (a, b) => b[1].size - a[1].size || a[0] - b[0],
  )[0][0];
  const exposed = exposedAxes(unpackVector(consensusPol));
  return {
    known: true,
    pol: consensusPol,
    safe: exposed.length === 0,
    exposed,
    witnesses: issuers.size,
    conflict: byPol.size > 1,
    verdicts: [...byPol.entries()]
      .map(([pol, iss]) => ({ pol, witnesses: iss.size }))
      .sort((a, b) => a.pol - b.pol),
  };
}

// ── indexed recall: O(1) lookup at genome scale ─────────────────────────────

// The honest version of a "bitmask engine": SPARDA's addresses are content hashes
// (sparse, not dense integers), so the right O(1) structure is a hash index, not a
// bit array — and the ternary compression Kimi's sandbox reached for already lives in
// the 1-byte `pol`. Build the index ONCE (O(n)); then every `recallIndexed` is a Map
// get, independent of genome size. Pure precomputation — no worker, no daemon, no infra.
export function indexGenome(genome) {
  const groups = new Map(); // behaviorHash -> hits[]
  for (const a of genome.antibodies ?? []) {
    const g = groups.get(a.behaviorHash);
    if (g) g.push(a);
    else groups.set(a.behaviorHash, [a]);
  }
  const index = new Map();
  for (const [hash, hits] of groups) index.set(hash, summarizeHits(hits));
  return index;
}

export function recallIndexed(index, behaviorHash) {
  return index.get(behaviorHash) ?? { known: false };
}

// ── serialization: the file that lives in a git repo (the whole backplane) ──

// Canonical JSONL: one antibody per line, deterministically ordered. This is the
// entire "database" — commit it, push it, pull it; git IS the replication layer.
export function serializeGenome(genome) {
  const sorted = [...(genome.antibodies ?? [])].sort(
    (a, b) =>
      cmp(a.behaviorHash, b.behaviorHash) || cmp(a.issuer, b.issuer) || cmp(a.id, b.id),
  );
  return sorted.map((a) => antibodyLine(a)).join('\n') + (sorted.length ? '\n' : '');
}

// each antibody serialized with a fixed key order (bytes are part of the contract).
function antibodyLine(a) {
  return JSON.stringify({
    v: a.v,
    behaviorHash: a.behaviorHash,
    pol: a.pol,
    prover: a.prover,
    key: a.key,
    issuer: a.issuer,
    id: a.id,
    sig: a.sig,
  });
}

// Parse a genome file back, verifying every line. Corrupt/forged lines are dropped
// and reported — a tampered genome degrades to the antibodies that still check out,
// it never poisons the memory.
export function parseGenome(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed = [];
  const rejected = [];
  for (const line of lines) {
    let ab;
    try {
      ab = JSON.parse(line);
    } catch {
      rejected.push({ id: null, reason: 'malformed-json' });
      continue;
    }
    parsed.push(ab);
  }
  const { genome, added, rejected: bad } = mergeGenome(emptyGenome(), parsed);
  return { genome, admitted: added, rejected: [...rejected, ...bad] };
}
