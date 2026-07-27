// enforce.test.js — the third leg (ADR-076): PARTIAL → PROVEN (ENFORCED) by SYNTHESIS.
// A clean mutation route resting on an ASSERTED-only guard (the ADR-070 type-lock gap) gets a
// minimal boundary check SPARDA can verify, inserted in the route's middleware chain — where
// domination is syntactically guaranteed. The three rails under test:
//   THE COURT      — the edit persists ONLY if the recompiled app proves PROVEN; a counterfeit
//                    (non-denying) check is rolled back byte-for-byte, it cannot buy green.
//   REVERSIBILITY  — `--revert` restores the pre-enforce bytes exactly (hash-verified), and
//                    `sparda remove`'s rule-#4 contract extends to enforcement edits.
//   DISCLOSURE     — the manifest counts only while the injected checks are in place; a
//                    hand-stripped shim must never read as ENFORCED (soundness never rests on
//                    the manifest — the type-lock itself drops the app back to PARTIAL).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import {
  checkGraph,
  verdictOf,
  verdictState,
  assertedOnlyMutationRoutes,
} from '../src/ubg/apocalypse.js';
import {
  runEnforce,
  revertEnforce,
  readEnforceManifest,
  ENFORCE_IDENT,
} from '../src/commands/enforce.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'ubg-typelock-asserted');

let dir;
beforeEach(() => {
  // enforce WRITES — every test runs on a throwaway copy, never the fixture itself
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-enforce-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const stateOf = (cwd) => {
  const canonical = canonicalizeGraph(compileUBG(cwd, { write: false }).graph);
  const { findings } = checkGraph(canonical);
  return { canonical, state: verdictState(verdictOf(findings, canonical, {})) };
};
const appSrc = () => fs.readFileSync(path.join(dir, 'src', 'app.js'), 'utf8');

describe('sparda enforce — synthesis under the court (ADR-076)', () => {
  it('targets exactly the type-lock routes (asserted-only guarded mutations)', () => {
    const { canonical } = stateOf(dir);
    const targets = assertedOnlyMutationRoutes(canonical);
    expect(targets.map((t) => t.label)).toEqual(['POST /posts/:id']);
    expect(targets[0].loc.file).toBe('src/app.js');
  });

  it('dry run (default) plans but writes NOTHING', async () => {
    const before = appSrc();
    await runEnforce({ cwd: dir });
    expect(appSrc()).toBe(before);
    expect(fs.existsSync(path.join(dir, '.sparda', 'enforce.json'))).toBe(false);
  });

  it('--apply flips PARTIAL → PROVEN, and the shim guard is VERIFIED not asserted', async () => {
    expect(stateOf(dir).state).toBe('PARTIAL');
    await runEnforce({ cwd: dir, apply: true });
    const { canonical, state } = stateOf(dir);
    expect(state).toBe('PROVEN');
    expect(assertedOnlyMutationRoutes(canonical)).toEqual([]);
    // the shim is proven by its BODY (deny scan), never by its name
    const shim = canonical.nodes.find(
      (n) => n.kind === 'guard' && n.label === ENFORCE_IDENT,
    );
    expect(shim?.meta?.verified).toBe(true);
    // disclosure: the manifest is live and names the enforced route
    expect(readEnforceManifest(dir)?.routes).toEqual(['POST /posts/:id']);
  });

  it('is idempotent — a second --apply reports nothing to enforce and changes nothing', async () => {
    await runEnforce({ cwd: dir, apply: true });
    const once = appSrc();
    await runEnforce({ cwd: dir, apply: true }); // now PROVEN → zero targets
    expect(appSrc()).toBe(once);
  });

  it('--revert restores the pre-enforce file BYTE-FOR-BYTE', async () => {
    const original = appSrc();
    await runEnforce({ cwd: dir, apply: true });
    expect(appSrc()).not.toBe(original);
    revertEnforce(dir, {});
    expect(appSrc()).toBe(original);
    expect(fs.existsSync(path.join(dir, '.sparda', 'enforce.json'))).toBe(false);
  });

  it('THE COURT: a counterfeit non-denying check cannot buy green — rolled back, error out', async () => {
    const original = appSrc();
    await expect(
      runEnforce({ cwd: dir, apply: true, _shimBody: "  console.warn('looks fine');" }),
    ).rejects.toThrow(/did not prove itself/);
    // every edit rolled back: the tree is byte-identical, no manifest left behind
    expect(appSrc()).toBe(original);
    expect(fs.existsSync(path.join(dir, '.sparda', 'enforce.json'))).toBe(false);
    expect(stateOf(dir).state).toBe('PARTIAL');
  });

  it('rejects an injection-shaped --principal before touching anything', async () => {
    const original = appSrc();
    await expect(
      runEnforce({ cwd: dir, apply: true, principal: 'req.user) || true || (0' }),
    ).rejects.toThrow(/invalid --principal/);
    expect(appSrc()).toBe(original);
  });

  it('a hand-stripped shim never reads as ENFORCED (disclosure follows the bytes)', async () => {
    await runEnforce({ cwd: dir, apply: true });
    expect(readEnforceManifest(dir)).not.toBeNull();
    // an editor deletes the injected block but leaves the manifest — the claim must die
    fs.writeFileSync(
      path.join(dir, 'src', 'app.js'),
      appSrc().replace(/\n\/\/ >>> sparda-enforce[\s\S]*?<<< sparda-enforce <<<\n/, ''),
    );
    expect(readEnforceManifest(dir)).toBeNull();
  });
});
