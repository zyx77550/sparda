// tests/helpers/copy-fixture.js — copy a fixture tree WITHOUT its generated residue.
//
// WHY THIS EXISTS (E-113). `tests/gossip.test.js` failed intermittently with `ENOENT` from
// `fs.cpSync` on `express-demo/.sparda/backup/...`. Not a Windows quirk and not bad luck:
//
//   - `tests/sparda.test.js` runs its injection round-trip IN the shared fixture directory
//     (deliberately — it proves `remove` restores the entry file byte-for-byte in a real tree),
//     so for the length of that test `tests/fixtures/express-demo/.sparda/backup/` exists and
//     is then deleted. The cleanup is correct.
//   - `tests/gossip.test.js` lives in a DIFFERENT file, so vitest runs it in a different worker,
//     in parallel, and it copies that same fixture recursively.
//
// `cpSync` enumerates the source tree and then reads each entry. A file that vanishes between
// those two moments is an `ENOENT`. Two correct tests, one shared directory, and a race whose
// odds depend on machine speed — which is why it appeared on Windows during a release and not
// in CI.
//
// The fix belongs on the READER side, because it holds no matter what any other test does:
// `.sparda/` is GENERATED residue, never fixture input. Nothing that copies a fixture wants it,
// so nothing copies it. Same for `node_modules` and `.git` — heavy, machine-specific, and never
// the thing under test.
import fs from 'node:fs';
import path from 'node:path';

// Basenames that are never part of a fixture's meaning.
const RESIDUE = new Set(['.sparda', 'node_modules', '.git']);

/**
 * Recursive copy of a fixture, minus its residue. Drop-in for
 * `fs.cpSync(from, to, { recursive: true })`.
 */
export function copyFixture(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    // Returning false for a directory skips its whole subtree, which is what makes this immune
    // to another worker writing inside it: we never enumerate it at all.
    filter: (src) => !RESIDUE.has(path.basename(src)),
  });
}
