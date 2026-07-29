// release-gate.test.js — the gate that would have stopped v0.69.0.
//
// v0.69.0 shipped a half-state: cut BETWEEN two pull requests, it carried ADR-084 and
// neither ADR-085 nor ADR-086, so the published package analysed a NestJS app with house
// decorator brands at a quarter of its size. Every test passed at the commit that was
// published — the defect was never in the code, it was in WHICH COMMIT got published and
// in the release artefacts nobody updated (no CHANGELOG entry, no tag since v0.68.0).
//
// `prepublishOnly` ran `vitest run`, and `vitest run` was green. A gate that only asks
// "do the tests pass" is structurally unable to see any of that.
//
// These tests do not run the gate end to end — it shells out to the full suite and the
// mutation harness, which would take ten minutes and recurse into itself. They do not need
// to: the gate's DECISIONS live in `release-checks.mjs` as pure functions, so each one can
// be handed the exact state 0.69.0 was released from and be required to refuse it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  treeChecks,
  manifestChecks,
  changelogChecks,
  tagChecks,
  publishedCheck,
  registryUrlFor,
  MANIFEST_FIELDS,
} from '../scripts/release-checks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const gate = fs.readFileSync(path.join(root, 'scripts', 'release-gate.mjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const whats = (list) => list.map((f) => f.what);

// The state a healthy release is cut from — each test below breaks exactly one thing.
const CLEAN = { dirty: '', branch: 'main', head: 'abc1234def', remote: 'abc1234def' };

// A fully-consistent manifest set at `version`, synthesized FROM `MANIFEST_FIELDS` rather
// than hard-coded. The fourth artefact that learns to carry a version must not be able to
// arrive by breaking these tests: it should arrive by being listed, and the tests should
// then be checking it. (This is not hypothetical — `extensions/vscode/package.json` was
// added to the list and turned three of them red.)
function docsAt(version) {
  const docs = {};
  for (const [file, fields] of MANIFEST_FIELDS) {
    const doc = {};
    for (const f of fields) {
      let cur = doc;
      const parts = f.split('.');
      for (const [i, k] of parts.entries()) {
        if (i === parts.length - 1) cur[k] = version;
        else cur = cur[k] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
    }
    docs[file] = doc;
  }
  return docs;
}

// The same set, read off disk — what a release would actually be cut from.
const onDisk = Object.fromEntries(
  MANIFEST_FIELDS.map(([f]) => [
    f,
    JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')),
  ]),
);

describe('the gate is wired where it cannot be skipped', () => {
  it('`prepublishOnly` runs it — npm cannot publish around it', () => {
    // The one hook that fires on the way out of the machine. A check that lives only in
    // CI is a check a local `npm publish` never sees.
    expect(pkg.scripts.prepublishOnly).toMatch(/release-gate\.mjs/);
  });

  it('and it is runnable on demand, so the answer is knowable before the push', () => {
    expect(pkg.scripts['release:check']).toMatch(/release-gate\.mjs/);
  });
});

describe('it refuses the exact state v0.69.0 was released from', () => {
  it('HEAD ahead of origin/main is refused — the root cause, stated once', () => {
    // This is 0.69.0. Everything else was green; the commit simply was not the one that
    // had been merged, and nothing in the pipeline was looking.
    const found = treeChecks({ ...CLEAN, head: 'aaaa1111', remote: 'bbbb2222' });
    expect(whats(found)).toContain('main is identical to origin/main');
    expect(found[0].detail).toMatch(/0\.69\.0/); // the failure explains itself
  });

  it('no CHANGELOG entry is refused', () => {
    const log = '# Changelog\n\n## [0.68.0] — earlier\n';
    expect(whats(changelogChecks(log, '0.69.0'))).toEqual([
      'CHANGELOG has an entry for this version',
    ]);
    expect(changelogChecks(`## [0.69.0] — today\n`, '0.69.0')).toEqual([]);
  });

  it('a missing tag is refused, and so is one pointing elsewhere', () => {
    // No tag has been pushed since v0.68.0 — two releases with nothing to check out. A
    // tag that names the wrong bytes is worse than no tag at all, so both are failures.
    expect(
      whats(tagChecks('v0.69.0', { at: null, head: 'abc1234', remoteAt: 'abc1234' })),
    ).toEqual(['v0.69.0 exists']);
    expect(
      whats(
        tagChecks('v0.69.0', { at: 'dead0000', head: 'abc1234', remoteAt: 'dead0000' }),
      ),
    ).toEqual(['v0.69.0 points at HEAD']);
    expect(
      tagChecks('v0.69.0', { at: 'abc1234', head: 'abc1234', remoteAt: 'abc1234' }),
    ).toEqual([]);
  });

  it('a tag that exists and points at HEAD but is not on origin is refused', () => {
    // The specific bug this mission targets: local tag looks perfect, but the world can't see it.
    expect(
      whats(tagChecks('v0.69.0', { at: 'abc1234', head: 'abc1234', remoteAt: null })),
    ).toEqual(['v0.69.0 is pushed to origin']);
  });

  it('an origin it could not REACH is refused for that reason, not for the other one', () => {
    // Both block — a release gate that cannot verify must not certify. What differs is the
    // sentence, and the sentence is what the operator acts on: told "your tag is not pushed"
    // when the network was down, they go hunting for a tag that is already there.
    const unreachable = tagChecks('v0.69.0', {
      at: 'abc1234',
      head: 'abc1234',
      remoteAt: null,
      remoteReachable: false,
    });
    expect(whats(unreachable)).toEqual(['v0.69.0 is pushed to origin']);
    expect(unreachable[0].detail).toMatch(/UNVERIFIED/);
    expect(unreachable[0].detail).not.toMatch(/is not on origin/);

    // and the reachable-but-absent case still says the actionable thing
    const absent = tagChecks('v0.69.0', {
      at: 'abc1234',
      head: 'abc1234',
      remoteAt: null,
      remoteReachable: true,
    });
    expect(absent[0].detail).toMatch(/git push origin v0\.69\.0/);
    expect(absent[0].detail).not.toMatch(/UNVERIFIED/);
  });
});

describe('and the other ways a release goes out wrong', () => {
  it('a dirty tree is refused', () => {
    expect(whats(treeChecks({ ...CLEAN, dirty: ' M src/ubg/nestjs.js' }))).toContain(
      'working tree is clean',
    );
  });

  it('a side branch is refused', () => {
    expect(whats(treeChecks({ ...CLEAN, branch: 'claude/release-gate' }))).toContain(
      'on main',
    );
  });

  it("a tag build's detached HEAD passes ONLY when it is origin/main's tip", () => {
    // `git rev-parse --abbrev-ref HEAD` says the literal 'HEAD' on a detached checkout, which is
    // what `actions/checkout` produces for every `push: tags:` event. The gate refused all of
    // them, so the release workflow could never publish — its very first run would have died
    // here. Accepting it is a restatement of `head === remote`, not an exemption, and the second
    // half of this test is what makes that true rather than merely claimed.
    expect(treeChecks({ ...CLEAN, branch: 'HEAD' })).toEqual([]);

    expect(
      whats(
        treeChecks({ ...CLEAN, branch: 'HEAD', head: 'aaaa1111', remote: 'bbbb2222' }),
      ),
    ).toContain('on main');
  });

  it('an unreachable origin is refused — not silently trusted', () => {
    // Without a fetch, `origin/main` is whatever was last seen, which can be arbitrarily
    // stale. Comparing against it and calling that a pass would assert the one thing the
    // failed fetch means we cannot know.
    expect(whats(treeChecks({ ...CLEAN, fetched: false }))).toContain(
      'could reach origin',
    );
  });

  it('a HALF-bumped manifest set is refused — including a manifest with two copies', () => {
    // server.json carries the version twice. A release-time grep finds the first and
    // reports agreement; the package on npm then advertises the old one.
    const half = docsAt('0.69.1');
    half['server.json'].packages[0].version = '0.69.0';
    expect(whats(manifestChecks('0.69.1', half))).toEqual([
      'server.json packages.0.version === 0.69.1',
    ]);
  });

  it('an unreadable manifest is refused, not skipped', () => {
    const none = Object.fromEntries(MANIFEST_FIELDS.map(([f]) => [f, null]));
    expect(whats(manifestChecks('0.69.1', none))).toEqual(
      MANIFEST_FIELDS.map(([f]) => `${f} is readable`),
    );
  });

  it('republishing a version already on npm is refused', () => {
    expect(publishedCheck({ live: true }).state).toBe('fail');
    expect(publishedCheck({ live: false }).state).toBe('ok');
  });
});

describe('it has no way around it', () => {
  // A gate with an escape hatch is a gate that gets escaped. Grepping the source for
  // `--force` cannot state that: the gate's own header says the word, to record the
  // refusal. A hatch is not a STRING, it is an INPUT — the gate can only be talked out of
  // a check by something the caller controls. So the assertion is about what it READS.
  const code = gate.replace(/^\s*\/\/.*$/gm, '');

  it('it takes no command-line argument — nothing to pass it', () => {
    expect(code).not.toMatch(/process\.argv/);
  });

  it('it reads exactly one env var, and that one cannot weaken a check', () => {
    const vars = [...code.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);
    // SPARDA_CORPUS ADDS the corpus check when clones are available. Its absence is
    // reported as SKIPPED, so the variable can only ever make the gate stricter.
    expect([...new Set(vars)]).toEqual(['SPARDA_CORPUS']);
  });

  it('it exits non-zero when anything failed', () => {
    expect(code).toMatch(/process\.exit\(1\)/);
  });

  it('nothing the gate RUNS shells out to npx either', () => {
    // E-101 fixed the gate and missed the mutation harness the gate calls — so the publish
    // still died on Windows, at `mutants dead` instead of `suite green`. A step is only as
    // portable as what it spawns.
    const harness = fs.readFileSync(
      path.join(root, 'tests', 'mutation', 'run.mjs'),
      'utf8',
    );
    // Assert on what it SPAWNS, not on whether the word appears. The harness carries `npx` as
    // DATA — a mutation target in `extensions/vscode/src/lib.cjs` mentions it — and a grep for
    // the string cannot tell a spawn from a payload. (The same mistake, in the same file, as
    // grepping this gate for `--force` when its own header says the word in order to refuse it.)
    expect(harness).not.toMatch(/exec\w*\(\s*['"]npx/);
    expect(harness).not.toMatch(/spawn\w*\(\s*['"]npx/);
    expect(harness).toMatch(/execFileSync\(process\.execPath/);
  });

  it('the verdict is written to a file, and that file cannot dirty the tree', () => {
    // Under `prepublishOnly`, npm reports `command failed … exit 1` and its debug log carries
    // none of the child's output: a blocked publish reads, from the log the operator keeps, as
    // a failure with no stated reason. The gate was doing to its own operator the exact thing
    // this project exists to refuse. It writes the verdict — and the file is ignored, or the
    // next run would fail its own `working tree is clean` check.
    expect(code).toMatch(/\.sparda-release-gate\.log/);
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toMatch(
      /^\.sparda-release-gate\.log$/m,
    );
  });

  it('it never shells out to npx — the wrapper Windows cannot spawn', () => {
    // `npx` is `npx.cmd` on Windows, a batch wrapper `execFileSync` cannot start: the real
    // publish failed with ENOENT, then EINVAL when named explicitly. Steps run through
    // `process.execPath` instead — an absolute path to the same node already running the gate.
    // That also removes a quieter problem: `npx vitest` resolves whatever npx finds, so a gate
    // could green a release against a different test runner than the lockfile pins.
    expect(code).not.toMatch(/'npx'|"npx"|npx\.cmd/);
    expect(code).toMatch(/process\.execPath/);
  });

  it('it spawns no shell at all, on any platform', () => {
    // The last one was `npm view` — npm is `npm.cmd` on Windows, so it needed one. Node then
    // warns (DEP0190) that arguments passed with `shell: true` are concatenated rather than
    // escaped, and the values flowing into that call were `pkg.name` and `pkg.version`, read
    // from a file in the tree: the gate was building a command line out of the repository it
    // was judging. The registry answers over HTTP, so the question costs no child process.
    expect(code).not.toMatch(/shell\s*:/);
    expect(code).not.toMatch(/'npm'|"npm"|npm\.cmd/);
  });

  it('and it asks the registry over HTTP, with the package name escaped', () => {
    // A scoped name (`@scope/pkg`) must have its slash encoded, or the path gains a segment
    // and the registry answers about a different package — a wrong answer to the one question
    // that decides whether these bytes may be published.
    expect(registryUrlFor('@scope/pkg', '1.0.0')).toBe(
      'https://registry.npmjs.org/%40scope%2Fpkg/1.0.0',
    );
    expect(registryUrlFor('sparda-mcp', '0.70.1')).toBe(
      'https://registry.npmjs.org/sparda-mcp/0.70.1',
    );
  });

  it('and reads its three answers apart — 200 published, 404 absent, anything else UNMEASURED', () => {
    expect(publishedCheck({ status: 200 }).state).toBe('fail');
    expect(publishedCheck({ status: 404 }).state).toBe('ok');
    // A 500, a proxy, no network. Reporting "we could not reach the registry" as "the version
    // is not there" would let a republish through on a bad network day.
    for (const status of [0, 403, 500, 502]) {
      expect(publishedCheck({ status }).state).toBe('unverified');
    }
  });

  it('an unmeasurable check is reported as unmeasured, never as a pass', () => {
    // The rule the whole codebase turns on: "we could not measure" and "we measured
    // nothing wrong" are different states. An unreachable registry is not an absent
    // version, and a corpus without clones is not a corpus that agrees.
    expect(publishedCheck({ error: 'ETIMEDOUT' }).state).toBe('unverified');
    expect(publishedCheck({ error: 'npm ERR! code E404' }).state).toBe('ok');
    expect(code).toMatch(/SKIPPED/);
    expect(code).toMatch(/UNVERIFIED|not a pass/);
  });
});

describe('the release artefacts it guards are actually in sync right now', () => {
  it('every manifest carries the package version', () => {
    expect(manifestChecks(pkg.version, onDisk)).toEqual([]);
  });

  it('the VS Code extension is one of them — it ships on its OWN command', () => {
    // `npm publish` fires prepublishOnly and therefore the gate. `npm run publish:vscode`
    // shells straight to `vsce publish`. So the extension's version is the one artefact
    // that can drift while every other check stays green — which is 0.69.0's failure with
    // a different artefact in the blank. Listing it here is what makes `release:check`
    // refuse a release where the marketplace would advertise a different version.
    expect(MANIFEST_FIELDS.map(([f]) => f)).toContain('extensions/vscode/package.json');
  });

  it('the CHANGELOG describes the current version', () => {
    const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    expect(changelogChecks(log, pkg.version)).toEqual([]);
  });
});
