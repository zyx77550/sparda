// bench/check-readme.mjs — the README-vs-evidence divergence gate (URGENT-ADOPTION J1 #3 / audit
// lever #4). The README quotes route counts for the named repos; bench/route-proof.json is the
// committed, reproducible evidence (regenerate with `node bench/repro.mjs --update`). This fails
// CI if the two ever disagree, so a heroic number can never silently drift from what the bench
// actually measured. Runs in the lint job — no clone, no network, instant.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const proof = JSON.parse(fs.readFileSync(path.join(here, 'route-proof.json'), 'utf8'));
const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');

const misses = [];
for (const r of proof.repos) {
  if (r.routes == null) continue;
  // the README must quote this repo's exact route count somewhere (case-insensitive name check
  // keeps the message useful; the number is the actual assertion)
  const hasNumber = new RegExp(`\\b${r.routes}\\b`).test(readme);
  if (!hasNumber)
    misses.push(`${r.name}: route-proof says ${r.routes} routes, not found in README`);
}

if (misses.length) {
  console.error('✗ README diverges from bench/route-proof.json:');
  for (const m of misses) console.error(`    ${m}`);
  console.error(
    '\n  Re-run `node bench/repro.mjs --update`, then update the README numbers to match.',
  );
  process.exit(1);
}
console.log(
  `✓ README matches bench/route-proof.json (${proof.repos.filter((r) => r.routes != null).length} repos, measured ${proof.when})`,
);
