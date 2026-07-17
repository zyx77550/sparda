// prove.test.js — the unified trust verdict. One command assembles the verdict
// (apocalypse), coverage (blindspots), the 1-byte capsule (immunize) and the portable
// seal (fingerprint) into one coherent output — every fact from exactly one organ, so
// prove can never disagree with the specialists it composes.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProve } from '../src/commands/prove.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(here, 'fixtures', name);

function capture(run) {
  const lines = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((...a) => lines.push(a.join(' ')));
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  return run()
    .then(() => ({ out: lines.join('\n'), exit: process.exitCode }))
    .finally(() => {
      spy.mockRestore();
      process.exitCode = prevExit;
    });
}

describe('prove — the whole trust verdict in one gesture', () => {
  it('a clean app: PROVEN, a seal, exit 0', async () => {
    const { out, exit } = await capture(() => runProve({ cwd: fix('ubg-proven') }));
    expect(out).toMatch(/✓ PROVEN/);
    expect(out).toMatch(/seal seal_[0-9a-f]{16}/);
    expect(out).toMatch(/capsule 1 B/);
    expect(exit).toBeUndefined(); // exit 0
  });

  it('an exposed app: NOT PROVEN, lists the findings, exit 1', async () => {
    const { out, exit } = await capture(() =>
      runProve({ cwd: fix('ubg-unbounded-write') }),
    );
    expect(out).toMatch(/✗ NOT PROVEN/);
    expect(out).toMatch(/writes to a request-named table/);
    expect(out).toMatch(/unguarded mutation/);
    expect(exit).toBe(1); // the CI gate
  });

  it('--json emits the assembled summary', async () => {
    const { out } = await capture(() => runProve({ cwd: fix('ubg-proven'), json: true }));
    const j = JSON.parse(out);
    expect(j.verdict).toBe('PROVEN');
    expect(j.seal).toMatch(/^seal_/);
    expect(j.coverage).toBeGreaterThan(0);
    expect(Array.isArray(j.findings)).toBe(true);
  });
});
