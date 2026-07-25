// wedge.test.js — the README hero demo must keep working. `bench/wedge.mjs` is self-checking: it
// arms a baseline on a guarded route, injects the guard-removing "AI edit", runs `sparda gate`, and
// exits 0 ONLY if the regression was blocked (GUARD_REMOVED + `--hook` exit 2). So running it and
// asserting exit 0 guards the whole wedge story — if any of gate/arm/hook/diff breaks, the demo the
// README shows breaks too, and this test goes red.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the wedge demo (README hero) still blocks a guard removal', () => {
  it('bench/wedge.mjs runs clean and reports the block', () => {
    let out;
    let code = 0;
    try {
      out = execFileSync('node', [path.join(root, 'bench', 'wedge.mjs')], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      code = e.status ?? 1;
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(code, `wedge demo exited ${code}\n${out}`).toBe(0);
    expect(out).toMatch(/GUARD_REMOVED/);
    expect(out).toMatch(/exit code 2 on `--hook`/);
    expect(out).toMatch(/caught BEFORE merge/);
  });
});
