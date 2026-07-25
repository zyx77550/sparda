// commands/claude-hook.js — one-command install of the SPARDA gate into Claude Code's
// PostToolUse hook, so every AI edit is proven in the loop with zero manual wiring. This is
// the DX that makes the gate irreproachable: the agent edits, the gate fires, a regression
// comes back on stderr with a fix (see gate.js). Writes to the PROJECT's .claude/settings.json
// so the whole team inherits it via the repo.
//
// Two hard constraints, both honored by the pure functions below:
//   • idempotent — installing twice never duplicates the hook;
//   • cleanly removable (hard rule #4) — uninstall strips EXACTLY our entry and prunes the
//     containers it emptied, leaving any other hooks/settings byte-for-byte untouched.
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

// the exact command the hook runs; also the marker that identifies OUR entry on removal.
export const GATE_HOOK_CMD = 'npx --no-install sparda-mcp gate --hook';
const MATCHER = 'Edit|Write';

const isOurHook = (h) => h?.type === 'command' && h?.command === GATE_HOOK_CMD;

// Ensure our PostToolUse hook is present. Pure: takes a settings object, returns
// { settings, changed }. Idempotent — if any PostToolUse block already runs our command,
// nothing changes. Never touches unrelated hooks or matchers.
export function applyClaudeHook(settings) {
  const next = structuredClone(settings ?? {});
  next.hooks ??= {};
  const post = Array.isArray(next.hooks.PostToolUse) ? next.hooks.PostToolUse : [];
  const already = post.some((block) => (block?.hooks ?? []).some(isOurHook));
  if (already) return { settings: next, changed: false };
  post.push({ matcher: MATCHER, hooks: [{ type: 'command', command: GATE_HOOK_CMD }] });
  next.hooks.PostToolUse = post;
  return { settings: next, changed: true };
}

// Strip EXACTLY our hook and prune what that emptied: our command out of each block's hooks,
// then blocks left with no hooks, then PostToolUse if empty, then hooks if empty. Any other
// hook a user added is preserved. Pure: returns { settings, changed }.
export function removeClaudeHook(settings) {
  const next = structuredClone(settings ?? {});
  const post = next.hooks?.PostToolUse;
  if (!Array.isArray(post)) return { settings: next, changed: false };

  let changed = false;
  const kept = [];
  for (const block of post) {
    const hooks = block?.hooks ?? [];
    const remaining = hooks.filter((h) => !isOurHook(h));
    if (remaining.length !== hooks.length) changed = true;
    if (remaining.length) kept.push({ ...block, hooks: remaining });
    // a block whose only hook was ours is dropped entirely (never leave a matcher orphaned)
  }
  if (!changed) return { settings: next, changed: false };

  if (kept.length) next.hooks.PostToolUse = kept;
  else delete next.hooks.PostToolUse;
  if (next.hooks && Object.keys(next.hooks).length === 0) delete next.hooks;
  return { settings: next, changed: true };
}

function settingsPath(cwd) {
  return path.join(cwd, '.claude', 'settings.json');
}

// read .claude/settings.json into an object. `{}` when absent; throws a USER error (never a
// silent overwrite) when present-but-unparseable — we will not clobber a file we can't read.
function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(
      new Error(`${file} is not valid JSON — refusing to overwrite it.`),
      { code: 'USER', hint: 'Fix the JSON by hand, then re-run.' },
    );
  }
}

export function installClaudeHook(cwd) {
  const file = settingsPath(cwd);
  const { settings, changed } = applyClaudeHook(readSettings(file));
  if (!changed) return { changed: false, file };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
  return { changed: true, file };
}

// Uninstall for the CLI and for `sparda remove` (rule #4). Returns whether anything was
// removed. Never errors when the file/hook is absent — removal is best-effort cleanup.
export function uninstallClaudeHook(cwd) {
  const file = settingsPath(cwd);
  if (!fs.existsSync(file)) return { changed: false, file };
  let current;
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { changed: false, file }; // unreadable — leave it exactly as-is
  }
  const { settings, changed } = removeClaudeHook(current);
  if (!changed) return { changed: false, file };
  // if we emptied the file to `{}` AND it holds nothing else, remove it; else write it back
  if (Object.keys(settings).length === 0) fs.rmSync(file);
  else atomicWrite(file, JSON.stringify(settings, null, 2) + '\n');
  return { changed: true, file };
}
