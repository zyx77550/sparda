// claude-hook.test.js — the one-command install of the SPARDA gate into Claude Code's
// PostToolUse hook. Two invariants: idempotent (install twice == install once) and cleanly
// removable (uninstall strips EXACTLY our entry, leaving every other hook/setting untouched —
// hard rule #4 applied to .claude/settings.json).
import { describe, it, expect } from 'vitest';
import {
  applyClaudeHook,
  removeClaudeHook,
  GATE_HOOK_CMD,
} from '../src/commands/claude-hook.js';

const ourHook = (s) =>
  (s.hooks?.PostToolUse ?? [])
    .flatMap((b) => b.hooks ?? [])
    .filter((h) => h.command === GATE_HOOK_CMD);

describe('Claude Code PostToolUse install/uninstall', () => {
  it('installs the gate hook into an empty settings object', () => {
    const { settings, changed } = applyClaudeHook({});
    expect(changed).toBe(true);
    expect(ourHook(settings).length).toBe(1);
  });

  it('is idempotent — installing twice never duplicates', () => {
    const once = applyClaudeHook({}).settings;
    const { settings, changed } = applyClaudeHook(once);
    expect(changed).toBe(false);
    expect(ourHook(settings).length).toBe(1);
  });

  it('round-trips: install then uninstall returns to the original', () => {
    const original = {};
    const installed = applyClaudeHook(original).settings;
    const { settings, changed } = removeClaudeHook(installed);
    expect(changed).toBe(true);
    expect(settings).toEqual(original); // no orphan hooks/PostToolUse/hooks key left behind
  });

  it('preserves a user’s own unrelated hooks and settings', () => {
    const user = {
      model: 'claude-opus',
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] },
        ],
        PostToolUse: [
          { matcher: 'Read', hooks: [{ type: 'command', command: 'my-linter' }] },
        ],
      },
    };
    const installed = applyClaudeHook(user).settings;
    const removed = removeClaudeHook(installed).settings;
    // our hook gone, everything the user had is byte-for-byte back
    expect(removed).toEqual(user);
    // and while installed, the user's linter still fires
    expect(
      installed.hooks.PostToolUse.some((b) =>
        (b.hooks ?? []).some((h) => h.command === 'my-linter'),
      ),
    ).toBe(true);
  });

  it('uninstall on settings without our hook changes nothing', () => {
    const user = {
      hooks: {
        PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'x' }] }],
      },
    };
    const { changed } = removeClaudeHook(user);
    expect(changed).toBe(false);
  });
});
