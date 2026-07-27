#!/usr/bin/env node
// tools/publish/publish-public.mjs — the one-way HQ→public valve (ADR-016).
//
// SECURITY-FIRST slice: only `--dry-run` is wired. It
//   1. lists every git-tracked file (the only set that could ever be pushed),
//   2. partitions it into PUBLIC (matches tools/publish/allowlist.json) vs
//      PRIVATE (everything else — default-deny: silence keeps a file private),
//   3. runs the secret-gate on the PUBLIC set, and
//   4. prints a verdict.
// It NEVER copies, commits, or pushes. Staging + push are intentionally stubbed
// until the full split is approved — so this file can exist, be read, and be
// trusted long before it is ever allowed to touch a public remote.
//
// Run: `node tools/publish/publish-public.mjs --dry-run`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scanForSecrets } from './secret-gate.mjs';
import { checkSelfContained } from './self-contained.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// Minimal glob → RegExp. Supports `**` (any depth, incl. zero segments) and `*`
// (within one path segment). Enough for allowlist entries like `src/**` or
// `docs/ARCHITECTURE.md`. Anchored to a full-path match. No dependency (rule #8).
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // `**/` also matches zero leading segments
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$+?.()|{}[]'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

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

export function partition(files, patterns) {
  const pub = [];
  const priv = [];
  for (const f of files) (patterns.some((re) => re.test(f)) ? pub : priv).push(f);
  return { pub, priv };
}

function main() {
  const mode = process.argv[2] || '--dry-run';

  const allowlist = loadJson(path.join(HERE, 'allowlist.json'), { public: [] });
  const exceptions = loadJson(path.join(HERE, 'gate-exceptions.json'), []);
  const patterns = (allowlist.public || []).map(globToRegExp);

  const files = trackedFiles();
  const { pub, priv } = partition(files, patterns);

  const contents = [];
  for (const f of pub) {
    try {
      contents.push({ path: f, text: fs.readFileSync(path.join(REPO, f), 'utf8') });
    } catch {
      contents.push({ path: f, text: '' }); // unreadable/binary: nothing to scan
    }
  }
  const gate = scanForSecrets(contents, exceptions);

  // Self-containment: no published src/** module may import a file the valve
  // leaves behind. Catches the under-send failure mode the secret-gate can't see.
  const dangling = checkSelfContained(
    pub,
    (f) => contents.find((c) => c.path === f)?.text ?? '',
  );

  // ---- report (stdout: this is a CLI tool, not the MCP server) ----
  const line = (s = '') => process.stdout.write(s + '\n');
  line('SPARDA publish valve — DRY RUN (nothing is copied, committed, or pushed)');
  line('='.repeat(72));
  line(
    `tracked files: ${files.length}   →   PUBLIC: ${pub.length}   PRIVATE (kept): ${priv.length}`,
  );
  line('');
  line(`PUBLIC — would be published (${pub.length}):`);
  for (const f of pub) line('  + ' + f);
  line('');
  line(`PRIVATE — stays in HQ by default-deny (${priv.length}):`);
  for (const f of priv) line('  · ' + f);
  line('');
  line('Secret-gate verdict');
  line('-'.repeat(72));
  if (gate.hardHits.length === 0 && gate.reviewHits.length === 0) {
    line('  CLEAN — no secrets or private markers in the public set.');
  } else {
    if (gate.hardHits.length) {
      line(`  ⛔ HARD secrets (${gate.hardHits.length}) — would block a real publish:`);
      for (const h of gate.hardHits)
        line(`     ${h.path}:${h.line}  [${h.id}] ${h.note}`);
    }
    if (gate.reviewHits.length) {
      line(
        `  ⚠ REVIEW markers (${gate.reviewHits.length}) — scrub the text or add a documented exception:`,
      );
      for (const h of gate.reviewHits)
        line(`     ${h.path}:${h.line}  [${h.id}] ${h.note}`);
    }
  }
  line('');
  line('Self-containment verdict');
  line('-'.repeat(72));
  if (dangling.length === 0) {
    line(
      '  CLOSED — every relative import in the public src/** resolves inside the set.',
    );
  } else {
    line(`  ⛔ DANGLING imports (${dangling.length}) — a required file is left behind:`);
    for (const d of dangling)
      line(`     ${d.file}  →  ${d.specifier}  (not in the public set)`);
  }

  const blocked = gate.blocked || dangling.length > 0;
  line('');
  line(
    blocked
      ? 'RESULT: a real publish would be BLOCKED until the findings above are resolved.'
      : 'RESULT: a real publish would PASS the secret-gate and self-containment check.',
  );

  if (mode !== '--dry-run') {
    process.stderr.write(
      '\nOnly --dry-run is wired in the security-first slice. Staging and push to a\n' +
        'public remote stay disabled until the full split is approved.\n',
    );
    process.exit(2);
  }
}

// Only run when invoked directly, so tests can import the helpers above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
