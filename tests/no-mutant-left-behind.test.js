// no-mutant-left-behind.test.js — the shipped tree may not contain a mutation.
//
// WHAT HAPPENED (E-108). `src/ubg/apocalypse.js` reached `main` carrying
//
//     if (false)
//       routes.push({ id: ep.id, ... }); // guarded, but by trust only
//
// in `assertedOnlyMutationRoutes`, inside a commit whose stated scope was release automation.
// With that line dead, `assertedMutations` is always 0, the PARTIAL rung never fires, and a route
// guarded ONLY by an unverified guard reads PROVEN — the exact false-PROVEN generator ADR-070
// exists to remove.
//
// It was not written by hand. `if (false)` is BYTE-FOR-BYTE the `repl` of a mutant that has
// lived in `tests/mutation/run.mjs` since ADR-070:
//
//     desc: 'apocalypse: let an asserted-only-guarded mutation still read PROVEN …'
//     find: 'if (!guards.some((n) => n.meta.verified === true))'
//     repl: 'if (false)'
//
// The harness writes the mutated file, runs one test, and restores in a `finally`. Kill the
// process mid-mutant — Ctrl-C, a timeout, an OOM — and the restore never runs. The mutation
// stays on disk, `git add -A` sweeps it into the next commit, and the suite stays green,
// because a mutant that survives is BY CONSTRUCTION invisible to the tests.
//
// THE POINT OF THIS FILE. The harness already knows every mutation it can make. So "is the tree
// mutated?" is not a judgement call, it is a lookup — and it costs milliseconds, where
// `npm run mutation` costs ten minutes. This runs in the ordinary suite, so the residue is
// caught before the commit rather than by an audit three commits later.
//
// The predicate is exact, not a heuristic on `repl` alone (several mutants replace with the
// same generic text, and `if (false)` is legitimate in plenty of code): a file is mutated when
// the mutant's `find` is ABSENT **and** its `repl` is PRESENT. If `find` is there, the line is
// intact. If neither is there, the target genuinely moved — reported separately, because that
// is the harness silently protecting nothing.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutation/run.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => {
  const abs = path.join(repo, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
};

describe('no mutant left behind (E-108)', () => {
  it('exports its mutants, so this check cannot drift from the harness', () => {
    // If the harness stops exporting them, this file would silently test nothing.
    expect(Array.isArray(MUTANTS)).toBe(true);
    expect(MUTANTS.length).toBeGreaterThan(100);
  });

  it('no source file carries a mutation from the harness', () => {
    const mutated = [];
    for (const m of MUTANTS) {
      const src = read(m.file);
      if (src == null) continue; // missing file is the next test's problem
      if (src.includes(m.find)) continue; // the real line is there — intact
      if (src.includes(m.repl)) mutated.push(`${m.file} :: ${m.desc}`);
    }
    expect(mutated).toEqual([]);
  });

  it('every mutant still finds its target — a harness guarding nothing is worse than none', () => {
    // A mutant whose `find` no longer matches is reported by `npm run mutation` as SURVIVED,
    // which is correct but arrives ten minutes and one commit too late. Prettier moving a line
    // is enough to cause it.
    const lost = [];
    for (const m of MUTANTS) {
      const src = read(m.file);
      if (src == null) {
        lost.push(`${m.file} (file missing) :: ${m.desc}`);
        continue;
      }
      if (!src.includes(m.find)) lost.push(`${m.file} :: ${m.desc}`);
    }
    expect(lost).toEqual([]);
  });

  it('the test each mutant is graded by exists', () => {
    const missing = MUTANTS.filter((m) => !fs.existsSync(path.join(repo, m.test))).map(
      (m) => `${m.test} :: ${m.desc}`,
    );
    expect(missing).toEqual([]);
  });
});
