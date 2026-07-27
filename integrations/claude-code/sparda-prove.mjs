#!/usr/bin/env node
// sparda-prove.mjs — the Claude Code "prove what the AI just wrote" hook.
//
// Wired as a Stop hook (see settings.json): when Claude Code finishes a turn,
// this runs `sparda review --base HEAD` — the SEMANTIC diff of what the turn
// changed (guards dropped, blast radius grown, invariants removed, new
// endpoints), derived from the compiled behavior graph, not from the text.
//
// Design contract: it must NEVER break the Claude Code loop. It is silent when
// there is nothing to say (no repo, no changes, an unsupported backend, or
// SPARDA not installed), and it ALWAYS exits 0. It reads nothing it should not
// and writes nothing — it prints a short review to the transcript and returns.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function quiet(msg) {
  // a single dim line at most; never an error, never a non-zero exit
  if (msg) process.stdout.write(`SPARDA: ${msg}\n`);
  process.exit(0);
}

// 1. must be a git repo (review diffs against a ref)
try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' });
} catch {
  quiet(); // not a repo — nothing to prove against
}

// 2. must have uncommitted changes since HEAD (that IS what the turn wrote)
let dirty = '';
try {
  dirty = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
} catch {
  quiet();
}
if (!dirty.trim()) quiet(); // clean tree — the turn changed nothing to prove

// 3. find a sparda binary WITHOUT triggering a network install (hook must be fast)
function findSparda() {
  const local = path.join(cwd, 'node_modules', '.bin', 'sparda');
  if (fs.existsSync(local)) return { cmd: local, args: [] };
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['sparda'], {
    encoding: 'utf8',
  });
  if (onPath.status === 0 && onPath.stdout.trim())
    return { cmd: onPath.stdout.split(/\r?\n/)[0].trim(), args: [] };
  return null;
}
const sparda = findSparda();
if (!sparda)
  quiet(
    'install `sparda-mcp` to prove AI-written changes (npm i -D sparda-mcp), then re-add this hook.',
  );

// 4. the actual proof: the behavior diff of the working tree vs the last commit
const run = spawnSync(
  sparda.cmd,
  [...sparda.args, 'review', '--base', 'HEAD', '--markdown'],
  {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
  },
);
// unsupported backend / no compilable surface → review exits non-zero or prints
// NO PROOF; either way we stay silent rather than nag on every turn.
const out = (run.stdout || '').trim();
if (run.status !== 0 || !out || /NO PROOF/.test(out)) quiet();

process.stdout.write(
  '\n— SPARDA proof of this turn (behavior diff vs last commit) —\n\n' + out + '\n',
);
process.exit(0);
