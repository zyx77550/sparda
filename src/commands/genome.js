// commands/genome.js — contribute this app's proofs to the world immune memory (ADR-041).
// Brick 2: the capsule (immunize) is one app's frozen judgment; the genome is how that
// judgment travels between strangers' machines as SIGNED, self-verifying antibodies —
// zero infrastructure, git as the whole backplane.
//   sparda genome            mint from this app, merge into sparda-genome.jsonl, report
//   sparda genome --json     print this app's freshly-minted antibodies to stdout
// The signing identity (an Ed25519 keypair) lives in .sparda/genome.key — PRIVATE, and
// .sparda/ is gitignored, so the private half can never be committed. The public half
// rides inside every antibody. The genome file itself is meant to be committed & shared.
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { buildCapsule } from '../ubg/immunity.js';
import {
  generateIdentity,
  mintGenome,
  mergeGenome,
  parseGenome,
  serializeGenome,
  emptyGenome,
  recall,
} from '../ubg/genome.js';
import { premiseFor, basisFrom } from '../ubg/premise.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

const GENOME_FILE = 'sparda-genome.jsonl';
const KEY_FILE = 'genome.key';

export async function runGenome(opts) {
  const compiled = compileUBG(opts.cwd, { write: false, openapi: opts.openapi });
  const canonical = canonicalizeGraph(compiled.graph);
  // The premise matters MORE here than anywhere, and it was the one place that never asked
  // (E-106). An antibody is a per-behavior claim, so a route the compiler never saw does not
  // falsify the antibodies that were minted — it means no antibody exists for it. But this
  // contribution is signed, content-addressed and merged into a file other people pull, and
  // a genome that silently under-represents an app teaches the world that the surface it
  // covers IS the app. The gaps are named below rather than counted.
  const premise = await premiseFor(canonical, compiled.report, { cwd: opts.cwd });
  const capsule = buildCapsule(canonical, { premiseBasis: basisFrom(premise) });
  const identity = loadOrCreateIdentity(opts.cwd);
  const minted = mintGenome(capsule, identity);

  if (opts.json) {
    console.log(JSON.stringify(minted, null, 2));
    return { minted, identity: { issuer: identity.issuer } };
  }

  if (!minted.length) {
    console.log(
      '✗ NO ANTIBODIES — 0 routes carried a behaviorHash; nothing to contribute (a coverage gap, not a pass).',
    );
    process.exitCode = 1;
    return { minted, identity: { issuer: identity.issuer } };
  }

  // the genome file is the shared memory: load what's there, merge our contribution,
  // write it back. git push/pull is the replication — there is no server anywhere.
  const genomePath = path.join(opts.cwd, GENOME_FILE);
  const existing = fs.existsSync(genomePath)
    ? parseGenome(fs.readFileSync(genomePath, 'utf8')).genome
    : emptyGenome();
  const { genome, added, corroborated } = mergeGenome(existing, minted);
  atomicWrite(genomePath, serializeGenome(genome));

  console.log(
    `GENOME — signed ${minted.length} antibody(ies) as ${identity.issuer} (Ed25519, self-verifying)`,
  );
  console.log(
    `  merged: +${added} new, ${corroborated} corroborated → ${genome.antibodies.length} antibody(ies) in ${GENOME_FILE}`,
  );
  // What this contribution is NOT. A count of antibodies reads as a measure of the app; it is
  // a measure of the surface SPARDA had. Gaps are NAMED, because "3 routes missing" is a
  // number a reader discounts and "GET /api/legacy/purge" is one they go and look at.
  if (premise.available && premise.gaps.length)
    for (const g of premise.gaps)
      console.log(
        `  ⚠ no antibody for ${g.method} ${g.path} — the ${premise.oracle} oracle serves it, the compiler never saw it`,
      );
  else if (capsule.premiseBasis === 'unmeasured')
    console.log(
      `  ◐ UNMEASURED PREMISE — no oracle checked this app's route table, so this contribution` +
        ` covers the surface SPARDA saw, which may not be the app (${premise.reason}).`,
    );
  // surface any behavior the world now disagrees about — load-bearing signal
  const conflicts = distinctHashes(genome).filter((h) => recall(genome, h).conflict);
  if (conflicts.length)
    console.log(
      `  ⚠ ${conflicts.length} behavior(s) with conflicting verdicts across issuers — inspect before trusting.`,
    );
  console.log(
    `  ${GENOME_FILE} is committable; .sparda/${KEY_FILE} is your PRIVATE key (gitignored) — never share it.`,
  );
  return { minted, genome, outPath: genomePath, identity: { issuer: identity.issuer } };
}

// the local proving identity. Created once, reused forever (carry-over is sacred —
// a stable issuer is how reputation accrues to this install across sessions).
function loadOrCreateIdentity(cwd) {
  const keyPath = path.join(cwd, '.sparda', KEY_FILE);
  if (fs.existsSync(keyPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      if (saved.publicKey && saved.privateKey && saved.issuer) return saved;
    } catch {
      // corrupt key file — fall through and mint a fresh identity
    }
  }
  const identity = generateIdentity();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  ensureSpardaIgnored(cwd); // the key is a SECRET — make the "gitignored" claim true
  atomicWrite(keyPath, JSON.stringify(identity, null, 2) + '\n');
  return identity;
}

// guarantee `.sparda/` (which holds the private key) is git-ignored before we write
// the key — a leaked signing key lets anyone forge antibodies under this issuer.
function ensureSpardaIgnored(cwd) {
  const gi = path.join(cwd, '.gitignore');
  const line = '.sparda/';
  try {
    if (fs.existsSync(gi)) {
      const content = fs.readFileSync(gi, 'utf8');
      if (!content.split(/\r?\n/).includes(line)) fs.appendFileSync(gi, `\n${line}\n`);
    } else {
      fs.writeFileSync(gi, `${line}\n`);
    }
  } catch {
    // best-effort: if we can't touch .gitignore, the key is still only written to
    // .sparda/ — the user's own ignore rules govern; we simply couldn't add ours.
  }
}

function distinctHashes(genome) {
  return [...new Set((genome.antibodies ?? []).map((a) => a.behaviorHash))];
}
