#!/usr/bin/env node
// demo.mjs — "AI writes. SPARDA proves." in 60 seconds, reproducible and
// self-verifying. It builds a throwaway Express app with a GUARDED delete
// (the safe baseline), commits it, then applies the kind of change an AI
// assistant plausibly writes — dropping the auth guard — and asks SPARDA to
// review the diff. SPARDA catches the removed guard as a CRITICAL behavior
// regression, from the graph, before the code is ever merged.
//
//   node integrations/claude-code/demo.mjs        # run the scene
//
// Exits non-zero if SPARDA FAILS to catch the regression — so this doubles as
// a living test of the pitch (it cannot rot into a lie). No network, no deps
// installed (SPARDA reads source, never runs it).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPARDA = process.env.SPARDA_BIN
  ? process.env.SPARDA_BIN.split(' ')
  : ['node', path.join(REPO, 'src', 'index.js')];

const app = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-demo-'));
const git = (...a) => execFileSync('git', a, { cwd: app, stdio: 'ignore' });
const sparda = (...a) =>
  spawnSync(SPARDA[0], [...SPARDA.slice(1), ...a], { cwd: app, encoding: 'utf8' });

try {
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({
      name: 'demo',
      private: true,
      main: 'app.js',
      dependencies: { express: '^4' },
    }),
  );
  // ── the safe baseline: the delete is behind an auth guard ──────────────
  const guarded = `const express = require('express');
const app = express();
const db = { user: { delete: async () => null } };
function auth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).end();
  next();
}
app.delete('/users/:id', auth, async (req, res) => {
  await db.user.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
app.listen(3000);
module.exports = app;
`;
  fs.writeFileSync(path.join(app, 'app.js'), guarded);
  git('init');
  git('config', 'user.email', 'demo@example.com');
  git('config', 'user.name', 'demo');
  git('add', '-A');
  git('commit', '-m', 'safe: guarded delete');

  console.log('1. Baseline committed: DELETE /users/:id is behind an auth guard.\n');
  console.log('2. The AI assistant edits the handler and drops the guard:\n');

  // ── the "AI-written" change: the auth guard is gone ────────────────────
  const unguarded = guarded.replace(
    "app.delete('/users/:id', auth,",
    "app.delete('/users/:id',",
  );
  fs.writeFileSync(path.join(app, 'app.js'), unguarded);
  console.log("   -  app.delete('/users/:id', auth, async (req, res) => {");
  console.log("   +  app.delete('/users/:id', async (req, res) => {\n");

  console.log('3. SPARDA reviews the behavior diff (not the text):\n');
  const review = sparda('review', '--base', 'HEAD', '--markdown');
  const out = (review.stdout || '') + (review.stderr || '');
  console.log(out.replace(/^/gm, '   '));

  const caught = /GUARD_REMOVED/.test(out) || /reachable without any guard/i.test(out);
  if (!caught) {
    console.error(
      '\n✗ DEMO FAILED — SPARDA did not flag the removed guard. The pitch is not true here; fix before shipping.',
    );
    process.exit(1);
  }
  console.log(
    '\n✓ SPARDA caught it: a guard the baseline relied on is gone — a CRITICAL',
  );
  console.log('  behavior regression, proven from the graph, before the merge.');
  console.log('  This is the loop: AI writes, SPARDA proves.');
} finally {
  fs.rmSync(app, { recursive: true, force: true });
}
