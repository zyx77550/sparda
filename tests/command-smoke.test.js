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

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const CLEAN_APP = path.join(REPO, 'demo-app'); // apocalypse: PROVEN, exit 0
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
  it('proves a clean app: exit 0, verdict safe, PROVEN in output', async () => {
    const { result, out, exitCode } = await run(runApocalypse, { cwd: CLEAN_APP });
    expect(result.verdict.safe).toBe(true);
    expect(exitCode).toBe(0);
    expect(out).toContain('PROVEN');
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
