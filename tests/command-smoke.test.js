// command-smoke.test.js — end-to-end smoke coverage for the "proof/compile" command
// WRAPPERS (runApocalypse, runVerify, runUbg, runOpenapi). The underlying passes are
// unit-tested elsewhere (apocalypse.test.js, verify via the compiler laws), but the CLI
// entrypoints themselves were never exercised — exit codes, JSON shape, and console
// output could regress with a green suite. This drives each wrapper on a real fixture and
// asserts the contract a CI user relies on (audit rec: cover the command wrappers).
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runApocalypse } from '../src/commands/apocalypse.js';
import { runVerify } from '../src/commands/verify.js';
import { runUbg } from '../src/commands/ubg.js';
import { runOpenapi } from '../src/commands/openapi.js';
import { runFingerprint } from '../src/commands/fingerprint.js';
import { runPolarity } from '../src/commands/polarity.js';
import { runImmunize } from '../src/commands/immunize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const CLEAN_APP = path.join(REPO, 'demo-app'); // apocalypse: SURFACE ONLY (routes, no effects), exit 0
const PROVEN_APP = path.join(here, 'fixtures', 'ubg-proven'); // guarded+validated write: genuine PROVEN
const BAIT = path.join(here, 'fixtures', 'ubg-semantics'); // apocalypse: NOT PROVEN, exit 1
const BLIND = path.join(here, 'fixtures', 'ubg-blind'); // apocalypse: NO PROOF, exit 1
const INLINE_MOUNT = path.join(here, 'fixtures', 'ubg-inline-mount'); // inline-require mount

// Run a wrapper with console.log captured and process.exitCode isolated so a command that
// sets exitCode=1 (by design, for CI gating) never leaks into vitest's own exit status.
async function run(fn, opts) {
  const original = console.log;
  const prevExit = process.exitCode;
  const lines = [];
  console.log = (...a) => lines.push(a.map(String).join(' '));
  process.exitCode = 0;
  try {
    const result = await fn(opts);
    return { result, out: lines.join('\n'), exitCode: process.exitCode };
  } finally {
    console.log = original;
    process.exitCode = prevExit;
  }
}

const tmpFiles = [];
const tmp = (name) => {
  const f = path.join(os.tmpdir(), `sparda-smoke-${process.pid}-${Date.now()}-${name}`);
  tmpFiles.push(f);
  return f;
};
afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('runApocalypse (wrapper)', () => {
  it('proves a genuinely clean app (real effect, all obligations held): PROVEN, exit 0', async () => {
    const { result, out, exitCode } = await run(runApocalypse, { cwd: PROVEN_APP });
    expect(result.verdict.clean).toBe(true);
    expect(result.verdict.surfaceOnly).toBe(false);
    expect(result.verdict.observed).toBeGreaterThan(0); // SPARDA actually saw behavior
    expect(exitCode).toBe(0);
    expect(out).toContain('PROVEN');
  });

  it('does NOT bless a routes-but-no-behavior app as PROVEN: SURFACE ONLY, exit 0, safe', async () => {
    // an app whose handlers only echo static JSON has nothing to prove — the honest
    // verdict is "surface only", never a green PROVEN (the effect-level NO-PROOF guard).
    const { result, out, exitCode } = await run(runApocalypse, { cwd: CLEAN_APP });
    expect(result.verdict.surfaceOnly).toBe(true);
    expect(result.verdict.clean).toBe(false);
    expect(result.verdict.observed).toBe(0);
    expect(result.verdict.safe).toBe(true); // not risky → not blocked
    expect(exitCode).toBe(0);
    expect(out).toContain('SURFACE ONLY');
    expect(out).not.toContain('✓ PROVEN');
  });

  it('gates a risky deploy: exit 1, critical finding, NOT PROVEN', async () => {
    const { result, out, exitCode } = await run(runApocalypse, { cwd: BAIT });
    expect(result.verdict.safe).toBe(false);
    expect(result.verdict.counts.critical).toBeGreaterThanOrEqual(1);
    expect(exitCode).toBe(1); // the CI gate the command exists for
    expect(out).toContain('NOT PROVEN');
    expect(out).toContain('UNGUARDED_MUTATION');
  });

  it('--json emits a parseable verdict/findings envelope', async () => {
    const { out } = await run(runApocalypse, { cwd: BAIT, json: true });
    const parsed = JSON.parse(out);
    expect(parsed.verdict.safe).toBe(false);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.obligations).toBeGreaterThan(0);
  });

  it('refuses to bless a 0-route compile: NO PROOF, exit 1, never PROVEN', async () => {
    const { result, out, exitCode } = await run(runApocalypse, { cwd: BLIND });
    expect(result.verdict.provable).toBe(false);
    expect(result.verdict.safe).toBe(false);
    expect(exitCode).toBe(1); // a parser-coverage miss must fail CI, not pass it
    expect(out).toContain('NO PROOF');
    expect(out).not.toContain('✓ PROVEN');
  });
});

describe('runFingerprint (wrapper)', () => {
  it('prints a portable behavior hash per route on a real app: exit 0', async () => {
    const { result, out, exitCode } = await run(runFingerprint, { cwd: CLEAN_APP });
    expect(result.prints.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
    expect(out).toContain('BEHAVIOR FINGERPRINTS');
    for (const p of result.prints) expect(p.behaviorHash).toMatch(/^bh1_[0-9a-f]{32}$/);
  });

  it('--json emits [{ entrypoint, behaviorHash, descriptor }]', async () => {
    const { out } = await run(runFingerprint, { cwd: CLEAN_APP, json: true });
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('behaviorHash');
    expect(parsed[0]).toHaveProperty('descriptor');
  });

  it('refuses a 0-route compile: NO FINGERPRINT, exit 1', async () => {
    const { out, exitCode } = await run(runFingerprint, { cwd: BLIND });
    expect(exitCode).toBe(1);
    expect(out).toContain('NO FINGERPRINT');
  });
});

describe('runPolarity (wrapper)', () => {
  it('scores a clean app PROVEN: exit 0, proven true', async () => {
    const { result, out, exitCode } = await run(runPolarity, { cwd: CLEAN_APP });
    expect(result.proven).toBe(true);
    expect(exitCode).toBe(0);
    expect(out).toContain('PROVEN');
  });

  it('gates a risky app: exit 1, NOT PROVEN, an exposed axis', async () => {
    const { result, out, exitCode } = await run(runPolarity, { cwd: BAIT });
    expect(result.proven).toBe(false);
    expect(exitCode).toBe(1);
    expect(out).toContain('NOT PROVEN');
  });

  it('--json emits { proven, polarity, posture }', async () => {
    const { out } = await run(runPolarity, { cwd: BAIT, json: true });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty('proven');
    expect(Array.isArray(parsed.polarity)).toBe(true);
    expect(parsed.posture).toHaveProperty('auth');
  });

  it('refuses a 0-route compile: NO POLARITY, exit 1', async () => {
    const { out, exitCode } = await run(runPolarity, { cwd: BLIND });
    expect(exitCode).toBe(1);
    expect(out).toContain('NO POLARITY');
  });
});

describe('runImmunize (wrapper)', () => {
  it('--json emits a capsule: one byte per route, proven flag, posture', async () => {
    const { result, out } = await run(runImmunize, { cwd: CLEAN_APP, json: true });
    const cap = JSON.parse(out);
    expect(cap.v).toBe('imm1');
    expect(cap.bytes).toBe(cap.routes.length);
    expect(result.capsule.routes.length).toBeGreaterThan(0);
    for (const r of cap.routes) expect(r.pol).toBeLessThan(256);
  });

  it('a risky app freezes to NOT PROVEN', async () => {
    const { result } = await run(runImmunize, { cwd: BAIT, json: true });
    expect(result.capsule.proven).toBe(false);
  });

  it('writes a capsule to .sparda/immunity.json and prints summary', async () => {
    const { result, out, exitCode } = await run(runImmunize, { cwd: PROVEN_APP });
    expect(exitCode).toBe(0);
    expect(out).toContain('IMMUNITY CAPSULE');
    expect(out).toContain('✓ PROVEN');
    expect(result.capsule.surfaceOnly).toBe(false);
    expect(fs.existsSync(result.outPath)).toBe(true);
  });

  it('freezes a routes-but-no-behavior app as SURFACE ONLY, not proven, exit 0', async () => {
    const { result, out, exitCode } = await run(runImmunize, { cwd: CLEAN_APP });
    expect(exitCode).toBe(0); // surface-only is not risky, so it does not gate
    expect(result.capsule.surfaceOnly).toBe(true);
    expect(result.capsule.proven).toBe(false);
    expect(out).toContain('SURFACE ONLY');
  });

  it('refuses a 0-route compile: NO CAPSULE, exit 1', async () => {
    const { out, exitCode } = await run(runImmunize, { cwd: BLIND });
    expect(exitCode).toBe(1);
    expect(out).toContain('NO CAPSULE');
  });
});

import { runGenome } from '../src/commands/genome.js';
describe('runGenome (wrapper)', () => {
  // genome writes into the app dir (key + genome file + .gitignore), so run on a
  // throwaway COPY of the clean app — never the fixture itself.
  const tmpApps = [];
  const copyApp = () => {
    const dir = path.join(os.tmpdir(), `sparda-genome-${process.pid}-${Date.now()}`);
    fs.cpSync(CLEAN_APP, dir, { recursive: true });
    tmpApps.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const d of tmpApps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('signs antibodies, writes a committable genome + a gitignored private key', async () => {
    const cwd = copyApp();
    const { result, out } = await run(runGenome, { cwd });
    expect(out).toContain('GENOME — signed');
    expect(result.minted.length).toBeGreaterThan(0);
    expect(result.identity.issuer).toMatch(/^gk1_/);
    expect(fs.existsSync(path.join(cwd, 'sparda-genome.jsonl'))).toBe(true);
    // the private key lands only under .sparda/ …
    expect(fs.existsSync(path.join(cwd, '.sparda', 'genome.key'))).toBe(true);
    // … and .sparda/ is git-ignored so it can never be committed
    expect(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toContain('.sparda/');
  });

  it('is idempotent: a second run adds nothing (content-addressed dedup)', async () => {
    const cwd = copyApp();
    await run(runGenome, { cwd });
    const { out } = await run(runGenome, { cwd });
    expect(out).toContain('+0 new');
  });

  it('--json emits self-verifying antibodies', async () => {
    const { out } = await run(runGenome, { cwd: copyApp(), json: true });
    const abs = JSON.parse(out);
    expect(Array.isArray(abs)).toBe(true);
    expect(abs[0].id).toMatch(/^ab1_/);
    expect(abs[0].sig).toBeTruthy();
  });
});

describe('runVerify (wrapper)', () => {
  it("proves the compiler's own laws on a real app: ok, PROVEN", async () => {
    const { result, out, exitCode } = await run(runVerify, { cwd: CLEAN_APP });
    expect(result.ok).toBe(true);
    expect(exitCode).toBe(0);
    expect(out).toContain('PROVEN');
  });
});

describe('runUbg (wrapper)', () => {
  it('compiles the codebase to a UBG and reports node/edge counts', async () => {
    const out = tmp('ubg.json');
    const { result, out: log } = await run(runUbg, { cwd: CLEAN_APP, out });
    expect(log).toContain('UBG compiled');
    expect(result.report.counts.totalNodes).toBeGreaterThan(0);
    const graph = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(0);
  });

  it('resolves an inline-require router mount (C-001a): both routes reach the graph', async () => {
    const out = tmp('ubg-inline.json');
    const { result } = await run(runUbg, { cwd: INLINE_MOUNT, out });
    expect(result.report.routes).toBe(2); // app.use('/things', require('./things.controller'))
    const graph = JSON.parse(fs.readFileSync(out, 'utf8'));
    const eps = graph.nodes.filter((n) => n.kind === 'entrypoint').map((n) => n.id);
    expect(eps).toContain('entrypoint:GET /things');
    expect(eps).toContain('entrypoint:POST /things');
  });
});

describe('runOpenapi (wrapper)', () => {
  it('emits a valid OpenAPI 3.1 document from the graph', async () => {
    const { result, out } = await run(runOpenapi, { cwd: CLEAN_APP, json: true });
    expect(result.spec.openapi).toMatch(/^3\.1/);
    expect(Object.keys(result.spec.paths).length).toBeGreaterThan(0);
    const parsed = JSON.parse(out);
    expect(parsed.openapi).toBe(result.spec.openapi);
  });
});

import { spawnSync } from 'node:child_process';
describe('CLI Entrypoint (index.js dispatch)', () => {
  const CLI = path.join(REPO, 'src', 'index.js');
  const NODE = process.execPath;
  it('dispatches fingerprint', () => {
    const r = spawnSync(NODE, [CLI, 'fingerprint'], { cwd: CLEAN_APP, encoding: 'utf8' });
    expect(r.stdout).toContain('BEHAVIOR FINGERPRINTS');
  });
  it('dispatches polarity', () => {
    const r = spawnSync(NODE, [CLI, 'polarity'], { cwd: CLEAN_APP, encoding: 'utf8' });
    expect(r.stdout).toContain('BEHAVIOR POLARITY');
  });
  it('dispatches immunize', () => {
    const r = spawnSync(NODE, [CLI, 'immunize'], { cwd: CLEAN_APP, encoding: 'utf8' });
    expect(r.stdout).toContain('IMMUNITY CAPSULE');
  });
});
