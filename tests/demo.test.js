import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { runDemo } from '../src/commands/demo.js';

// The `demo` command is the zero-setup try-it path for the npm/registry listing.
// It must run the real pipeline on the bundled demo-app, demonstrate every
// guarantee, and leave the machine clean — all without express, network, or a
// host process. These assertions pin that contract independent of the test
// fixtures (demo-app is its own shipped copy).
describe('sparda demo (standalone guided tour)', () => {
  it('runs the full pipeline on the bundled demo app and cleans up', async () => {
    const r = await runDemo({ quiet: true });

    expect(r.framework).toBe('express');
    // 5 literal routes (health, prospects GET/DELETE, users GET/POST) → 5 tools;
    // the variable-built /v${VERSION}/meta is skipped, not counted.
    expect(r.toolCount).toBe(5);
    // reads live, writes disabled by default (hard rule #3 write-safety)
    expect(r.enabled).toHaveLength(3);
    expect(r.disabled).toHaveLength(2);
    // dynamic path is skipped, never guessed
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    // the prompt-injection docstring on DELETE is purged (hard rule #7)
    expect(r.flagged.length).toBeGreaterThanOrEqual(1);
    // `remove` restores a byte-for-byte clean diff (hard rule #4)
    expect(r.cleanDiff).toBe(true);
    // the throwaway temp dir is gone — user's machine untouched
    expect(fs.existsSync(r.tmpDir)).toBe(false);
  });

  it('does not throw with human output enabled', async () => {
    await expect(runDemo({})).resolves.toMatchObject({ cleanDiff: true });
  });
});
