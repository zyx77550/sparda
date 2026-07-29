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
  it('a clean app whose PREMISE was never measured: PARTIAL, and it says why (E-104)', async () => {
    // This fixture is Express: no boot-free oracle, and `prove` here does not pass --probe,
    // so NOTHING checked that the route table analysed is the one the app serves. Direction 3
    // is unverified, and `PROVEN` asserts it — so the word is withheld.
    //
    // It used to read a bare ✓ PROVEN. Seven of our eight proving fixtures did, every one of
    // them Express or FastAPI, because `{ available: false, gaps: [] }` reached the verdict
    // through `premiseGaps === 0` — indistinguishable from an oracle that ran and agreed.
    const { out, exit } = await capture(() => runProve({ cwd: fix('ubg-proven') }));
    expect(out).toMatch(/PROVEN \(PARTIAL\)/);
    // The REASON must name the premise, and must lead with it. "PARTIAL: 100% of the surface
    // resolved" is a true sentence that sends the reader to the wrong remedy.
    expect(out).toMatch(/route table was never checked by an oracle/);
    expect(out).toMatch(/PARTIAL: the route table/);
    expect(out).toMatch(/seal seal_[0-9a-f]{16}/);
    expect(out).toMatch(/capsule 1 B/);
    // NOT a gate failure. An unmeasured premise is the absence of a witness, not evidence of
    // a fault — PARTIAL already means "proved what was seen", and blocking a deploy on it
    // would invent a problem rather than withhold a claim.
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
    expect(j.verdict).toBe('PARTIAL');
    // A machine consumer must be able to tell WHICH kind of "not proven" this is. Coverage
    // here is 100% and there are no findings — reading `verdict` alone would suggest a
    // thorough analysis being merely cautious, when the truth is that nothing checked the
    // route table. `basis` is what makes the two distinguishable (E-104).
    expect(j.premise).toMatchObject({ verified: false, basis: 'unmeasured' });
    expect(j.premise.reason).toMatch(/--probe/);
    expect(j.coverage).toBe(1); // the point: 100% coverage, and still not PROVEN
    expect(j.seal).toMatch(/^seal_/);
    expect(Array.isArray(j.findings)).toBe(true);
  });
});
