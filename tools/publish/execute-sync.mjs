import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { globToRegExp, partition } from './publish-public.mjs';
import { checkSelfContained } from './self-contained.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PUBLIC_SYNC = 'C:\\Users\\zakar\\Developer\\sparda';

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  const allowlist = loadJson(path.join(HERE, 'allowlist.json'), { public: [] });
  const patterns = (allowlist.public || []).map(globToRegExp);

  const files = trackedFiles();
  const { pub } = partition(files, patterns);

  // Refuse to publish an incomplete runtime graph: if a published src/** module
  // imports a file the allowlist leaves behind, the public mirror ships broken
  // (this is exactly how apocalypse/heal once crashed with ERR_MODULE_NOT_FOUND).
  const dangling = checkSelfContained(pub, (f) =>
    fs.readFileSync(path.join(REPO, f), 'utf8'),
  );
  if (dangling.length) {
    console.error(
      `✗ Refusing to sync: ${dangling.length} published module(s) import a file that is NOT in the public set:`,
    );
    for (const d of dangling) console.error(`    ${d.file}  →  ${d.specifier}`);
    console.error(
      'Add the missing file to tools/publish/allowlist.json (or fix the import) and retry.',
    );
    process.exit(1);
  }

  console.log(`Syncing ${pub.length} public files from ${REPO} to ${PUBLIC_SYNC}...`);

  // Copy allowlisted files
  for (const f of pub) {
    const srcPath = path.join(REPO, f);
    const destPath = path.join(PUBLIC_SYNC, f);

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  // Overlay curated files
  const curated = [
    { src: 'tools/publish/public/README.md', dest: 'README.md' },
    { src: 'tools/publish/public/SKILL.md', dest: 'SKILL.md' },
    { src: 'tools/publish/public/DECISIONS.md', dest: 'docs/DECISIONS.md' },
  ];

  for (const item of curated) {
    const srcPath = path.join(REPO, item.src);
    const destPath = path.join(PUBLIC_SYNC, item.dest);
    console.log(`Overlaying curated ${item.src} -> ${item.dest}...`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  // Restore public-only .github/CODEOWNERS
  try {
    execFileSync('git', ['checkout', 'HEAD', '--', '.github/CODEOWNERS'], {
      cwd: PUBLIC_SYNC,
    });
    console.log('Restored public-only .github/CODEOWNERS');
  } catch {
    console.log('No .github/CODEOWNERS to restore or checkout failed');
  }

  // Remove tests that rely on private corpus data
  try {
    fs.unlinkSync(path.join(PUBLIC_SYNC, 'tests/corpus-snapshot.test.js'));
    console.log('Removed private test: tests/corpus-snapshot.test.js');
  } catch (e) {}

  console.log('Sync complete!');
}

main();
