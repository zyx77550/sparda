// bench/wedge.mjs — the wedge, in one command, zero setup, ~1 second.
//
// The whole product in 20 lines of output: an AI edit neuters an auth guard (replaces the
// middleware with a syntactically-valid identity pass-through — the exact silent regression of the
// agent era), and `sparda gate` BLOCKS it as a deterministic GUARD_REMOVED before it can merge —
// offline, no API key, sub-second, exit 2 (the Claude Code PostToolUse contract that stops the
// agent's edit loop). Unlike guard-removal-replay.mjs (which clones a 580-route real app), this
// bundles its own tiny app so anyone can run it anywhere:
//
//   node bench/wedge.mjs
//
// The "before" is guarded; the regression is INJECTED by this script into a throwaway temp app and
// nothing is published — it is a demonstration, not a finding of anyone's code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'index.js',
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-wedge-'));
const appFile = path.join(dir, 'src', 'app.js');

const GUARDED = `import express from 'express';
const app = express();
app.use(express.json());
const prisma = { user: { delete: async () => null } };

// auth middleware — only an admin may delete a user
function requireAdmin(req, res, next) {
  if (req.headers['x-role'] !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

app.post('/admin/delete-user', requireAdmin, async (req, res) => {
  await prisma.user.delete({ where: { id: req.body.id } });
  res.json({ deleted: req.body.id });
});

app.listen(3000);
`;

// The "AI optimization": requireAdmin is replaced by a pass-through. Compiles, tests may still pass,
// route still 200s — the door is just open now. This is the failure a text diff review waves through.
const NEUTERED = GUARDED.replace(
  "if (req.headers['x-role'] !== 'admin') return res.status(403).json({ error: 'forbidden' });\n  next();",
  'next(); // refactor: simplified auth', // guard gutted, shape preserved
);

const sparda = (args) => {
  try {
    return {
      code: 0,
      out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }),
    };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

const line = (s = '') => process.stdout.write(s + '\n');

try {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', type: 'module', dependencies: { express: '^4' } }),
  );
  fs.writeFileSync(appFile, GUARDED);

  line('\n  SPARDA · the wedge — an agent removes an auth guard, the gate blocks it\n');

  // 1. arm the baseline on the guarded, correct code (what an agent starts from)
  sparda(['gate', '--arm', '--dir', dir]);
  line(
    '  1. baseline armed on the guarded code  (POST /admin/delete-user · requireAdmin)',
  );

  // 2. the agent edits: requireAdmin is gutted to a pass-through
  fs.writeFileSync(appFile, NEUTERED);
  line(
    '  2. an AI edit "simplifies" requireAdmin → a pass-through (still compiles, still 200s)',
  );

  // 3. the gate runs on the edit — deterministic, offline, timed
  const t0 = performance.now();
  const res = sparda(['gate', '--dir', dir]);
  const ms = Math.round(performance.now() - t0);
  const hook = sparda(['gate', '--hook', '--dir', dir]); // the PostToolUse contract

  line('  3. `sparda gate` on the edit:\n');
  for (const l of res.out.split('\n').filter(Boolean)) line('       ' + l);
  line('');
  line(`     ⏱  ${ms} ms · deterministic · offline · no API key`);
  line(
    `     ⛔ exit code ${hook.code} on \`--hook\` — Claude Code PostToolUse blocks the edit\n`,
  );

  const blocked = /GUARD_REMOVED/.test(res.out) && hook.code === 2;
  line(
    blocked
      ? '  ✓ The guard removal was caught BEFORE merge. A text diff review would have missed it.\n'
      : '  ✗ Unexpected: the regression was not blocked — investigate.\n',
  );
  process.exitCode = blocked ? 0 : 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
