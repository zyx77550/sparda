#!/usr/bin/env node
// scripts/release-gate.mjs — the gate a RELEASE must pass, not just a commit.
//
// v0.69.0 shipped a half-state. It was cut BETWEEN two pull requests: it carried ADR-084
// and neither ADR-085 nor ADR-086, so the package on npm analysed a NestJS app with house
// decorator brands at a quarter of its size — the exact Direction 3 violation three
// sessions had just removed from the codebase.
//
// Nothing was broken. Every test passed at the commit that was published. `prepublishOnly`
// ran `vitest run` and `vitest run` was green, because the defect was never in the CODE:
// it was in WHICH COMMIT got published, and in the release artefacts nobody updated
// (CHANGELOG had no 0.69.0 entry; no tag has been pushed since v0.68.0).
//
// A gate that only asks "do the tests pass" cannot see any of that. This one asks the
// questions a release actually fails on:
//
//   1. is the tree clean, on main, and identical to origin/main?   ← catches "cut mid-flight"
//   2. is this version already on npm?                             ← catches a no-op republish
//   3. do all the manifests agree?                                 ← catches a partial bump
//   4. does the CHANGELOG describe this version?                   ← catches an unrecorded release
//   5. is there a tag for it, pointing at HEAD?                    ← catches the drift since v0.68.0
//   6. suite green, mutants dead, corpus undrifted                 ← the ordinary bar, restated
//
// This file is the I/O half: it gathers state and prints. The DECISIONS live in
// `release-checks.mjs`, pure, so the tests can hand them a mid-flight release and watch
// them refuse it — rather than grepping this source and hoping a comment is a check.
//
// NO ESCAPE HATCH, deliberately. A gate that can be talked out of a check gets talked out
// of it, and the one release that skips the gate is the one that needed it. If a check is
// wrong, fix the check.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  treeChecks,
  manifestChecks,
  changelogChecks,
  tagChecks,
  publishedCheck,
  registryUrlFor,
  MANIFEST_FIELDS,
} from './release-checks.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// NO SHELL, anywhere. The only two programs the gate starts are `git` and `node`, both real
// executables on every platform. The one command that needed a shell was `npm view` — npm is
// `npm.cmd` on Windows — and it is gone: the registry answers over HTTP, so the question no
// longer costs a child process at all.
//
// This matters beyond portability. Node warns (DEP0190) that arguments passed with
// `shell: true` are concatenated, not escaped, and the values that flowed into that call were
// `pkg.name` and `pkg.version` — read from a file in the tree. A gate whose job is to be
// trustworthy should not be building command lines out of the repository it is judging.
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: repo, encoding: 'utf8', ...opts }).trim();

// A node script run by the SAME node that is running the gate. This is how the suite and the
// mutation harness are invoked, and it is why `npx` is gone: `npx` is a shell wrapper
// (`npx.cmd`) that `execFileSync` cannot start on Windows, and reaching for a shell to work
// around it widens the blast radius of every other call in the file. `process.execPath` is an
// absolute path to a real binary — no shell, no PATH lookup, no version ambiguity.
const nodeRun = (script, args = []) =>
  run(process.execPath, [path.join(repo, script), ...args]);
const read = (f) => JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8'));

const failures = [];
const add = (list) => failures.push(...list);
const ok = (what) => console.log(`  ✓ ${what}`);
const unmeasured = (what, why) => console.log(`  ◐ ${what} — ${why}`);

const pkg = read('package.json');
const version = pkg.version;
console.log(`RELEASE GATE — ${pkg.name}@${version}\n`);

// --- 1. the tree is exactly what will be published --------------------------------
try {
  let fetched = true;
  try {
    run('git', ['fetch', 'origin', 'main'], { stdio: 'pipe' });
  } catch {
    fetched = false;
  }
  const found = treeChecks({
    dirty: run('git', ['status', '--porcelain']),
    branch: run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    head: run('git', ['rev-parse', 'HEAD']),
    remote: run('git', ['rev-parse', 'origin/main']),
    fetched,
  });
  add(found);
  if (!found.length) ok('tree is clean, on main, identical to origin/main');
} catch (err) {
  add([{ what: 'git is usable', detail: String(err.message).slice(0, 140) }]);
}

// --- 2. this version is not already published -------------------------------------
// The interesting case is not the republish npm rejects on its own — it is forgetting to bump,
// then wondering why the fix "did not ship".
//
// Asked over HTTP rather than through `npm view`. npm is `npm.cmd` on Windows, which
// `execFileSync` cannot start without a shell, and Node then warns — correctly — that
// arguments passed with `shell: true` are concatenated rather than escaped. `pkg.name` and
// `pkg.version` come from a file in the tree, so that put the repo's own JSON on a command
// line to ask a question `fetch` answers directly. With this, the gate spawns no shell at all.
let published;
try {
  const res = await fetch(registryUrlFor(pkg.name, version), { method: 'HEAD' });
  published = publishedCheck({ status: res.status });
} catch {
  published = publishedCheck({ status: 0 }); // unreachable — UNMEASURED, never a pass
}
if (published.state === 'ok') ok('version is unpublished');
else if (published.state === 'unverified')
  unmeasured('version is unpublished', 'UNVERIFIED (registry unreachable, not a pass)');
else
  add([
    {
      what: 'version is unpublished',
      detail: `${pkg.name}@${version} ${published.detail}`,
    },
  ]);

// --- 3. every manifest carries the same version ------------------------------------
const docs = {};
for (const [file] of MANIFEST_FIELDS) {
  try {
    docs[file] = read(file);
  } catch {
    docs[file] = null;
  }
}
const manifests = manifestChecks(version, docs);
add(manifests);
if (!manifests.length) ok('server.json + glama.json agree with package.json');

// --- 4. the CHANGELOG describes this version ---------------------------------------
const log = changelogChecks(
  fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'),
  version,
);
add(log);
if (!log.length) ok(`CHANGELOG has a [${version}] entry`);

// --- 5. a tag exists for it, and points at HEAD ------------------------------------
const tag = `v${version}`;
let at = null;
let atObject = null;
let remoteAt = null;
try {
  at = run('git', ['rev-list', '-n', '1', tag], { stdio: ['ignore', 'pipe', 'ignore'] });
  // An annotated tag is TWO objects. `rev-list` gave the commit; this gives the tag object, and
  // origin may legitimately answer with either one (E-112).
  atObject = run('git', ['rev-parse', tag], { stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  /* no such tag — tagChecks says so */
}
// `ls-remote` EXITS 0 with empty output for a tag that is simply absent, and exits non-zero
// when it could not reach origin at all. Keeping those apart is the whole of rule 13 here:
// the old single `catch` turned "the network is down" into "your tag is not pushed", sending
// the operator to look for something that was already there.
let remoteReachable = true;
try {
  // `${tag}*`, not `${tag}` — filtering on the exact name DROPS the peeled `^{}` line, because
  // `v1.2.3^{}` does not match the pattern `v1.2.3`. That single character is why every annotated
  // tag read as "not on origin" (E-112). The glob is belt; `tagChecks` accepting either sha is
  // braces, and the braces are what makes this independent of git's peeling behaviour.
  const lsRemote = run('git', ['ls-remote', '--tags', 'origin', `${tag}*`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // The glob can also match a NEIGHBOUR (v0.71.2 and v0.71.20), so anchor on the exact ref name.
  const lines = lsRemote.split('\n').map((l) => l.trim());
  const exact = (suffix) =>
    lines
      .find(
        (l) =>
          l.endsWith(`\trefs/tags/${tag}${suffix}`) ||
          l.endsWith(` refs/tags/${tag}${suffix}`),
      )
      ?.split(/\s+/)[0] ?? null;
  remoteAt = exact('^{}') ?? exact('');
} catch {
  remoteReachable = false;
}
const tagged = tagChecks(tag, {
  at,
  atObject,
  head: run('git', ['rev-parse', 'HEAD']),
  remoteAt,
  remoteReachable,
});
add(tagged);
if (!tagged.length) ok(`${tag} exists, points at HEAD, and is pushed to origin`);

// --- 6. the ordinary bar, restated ------------------------------------------------
const step = (label, script, args = []) => {
  process.stdout.write(`  … ${label}\r`);
  try {
    nodeRun(script, args);
    ok(label);
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`
      .trim()
      .split('\n')
      .slice(-4)
      .join('\n      ');
    add([{ what: label, detail: out || String(err.message).slice(0, 140) }]);
  }
};

// vitest's own node entry, not `npx vitest`. Beyond the Windows problem, this runs the vitest
// the repo installed rather than whatever `npx` would resolve — the gate should not be able to
// green a release against a different test runner than the one the lockfile pins.
step('suite green', 'node_modules/vitest/vitest.mjs', ['run']);
step('mutants dead', 'tests/mutation/run.mjs');

// The corpus needs clones the repo does not carry. Absent, it is SKIPPED and said so —
// never counted as a pass, because "we could not measure" and "we measured nothing wrong"
// are the two states this whole codebase exists to keep apart.
if (process.env.SPARDA_CORPUS) step('corpus undrifted', 'scripts/corpus-oracle.mjs');
else unmeasured('corpus undrifted', 'SKIPPED (set SPARDA_CORPUS to a clone dir)');

// --- verdict -----------------------------------------------------------------------
//
// The verdict is also WRITTEN, not only printed. When the gate runs under `prepublishOnly`,
// npm reports `command failed … exit 1` and its debug log contains none of the child's output
// — so a blocked publish reads, from the log the user actually keeps, as a failure with no
// stated reason. That is the shape of silence this whole project exists to refuse, and the
// gate was doing it to its own operator. The file survives the terminal being closed, the
// scrollback being lost, and npm's capture.
const VERDICT_FILE = path.join(repo, '.sparda-release-gate.log');
const stamp = new Date().toISOString();
const lines = failures.length
  ? [
      `✗ RELEASE BLOCKED — ${pkg.name}@${version} — ${failures.length} check(s) failed`,
      '',
      ...failures.flatMap((f) => [`    ${f.what}`, `      ${f.detail}`, '']),
    ]
  : [`✓ ${pkg.name}@${version} is releasable.`];

console.log('');
for (const line of lines) (failures.length ? console.error : console.log)(line);
try {
  fs.writeFileSync(VERDICT_FILE, `${stamp}\n${lines.join('\n')}\n`);
  if (failures.length)
    console.error(`    (also written to ${path.basename(VERDICT_FILE)})\n`);
} catch {
  /* the verdict on stdout is the one that matters; a read-only tree must not mask it */
}
if (failures.length) process.exit(1);
