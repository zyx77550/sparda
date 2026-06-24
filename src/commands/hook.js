// commands/hook.js — install the git sentinel (post-commit sync)
import fs from 'node:fs';
import path from 'node:path';

const MARKER = '# sparda-sentinel';

export async function runHook(opts) {
  const gitDir = path.join(opts.cwd, '.git');
  if (!fs.existsSync(gitDir)) {
    throw Object.assign(new Error('Not a git repository.'), {
      code: 'USER',
      hint: 'Run this from your project root (where .git lives).',
    });
  }
  const hooksDir = path.join(gitDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'post-commit');

  const line = `${MARKER}\nnpx --no-install sparda-mcp sync --quiet || true\n`;
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes(MARKER)) {
      console.error('[sparda] sentinel already installed (post-commit).');
      return;
    }
    fs.appendFileSync(hookPath, `\n${line}`);
  } else {
    fs.writeFileSync(hookPath, `#!/bin/sh\n${line}`);
  }
  fs.chmodSync(hookPath, 0o755);
  console.error(
    '[sparda] sentinel installed: routes re-sync after every commit (post-commit hook).',
  );
}

// Uninstall exactly what runHook installed (hard rule #4 applied to .git/hooks):
// delete the file if we created it whole, strip our exact block if we appended,
// line-filter as a last resort if the user edited around it. Returns whether
// anything was removed so `remove` can report it.
export function removeHook(cwd) {
  const hookPath = path.join(cwd, '.git', 'hooks', 'post-commit');
  let content;
  try {
    content = fs.readFileSync(hookPath, 'utf8');
  } catch {
    return false;
  }
  if (!content.includes(MARKER)) return false;
  const block = `${MARKER}\nnpx --no-install sparda-mcp sync --quiet || true\n`;
  if (content === `#!/bin/sh\n${block}`) {
    fs.rmSync(hookPath);
    return true;
  }
  let out = content.includes(`\n${block}`)
    ? content.replace(`\n${block}`, '')
    : content.replace(block, '');
  if (out.includes(MARKER)) {
    out = out
      .split('\n')
      .filter(
        (l) => l !== MARKER && l !== 'npx --no-install sparda-mcp sync --quiet || true',
      )
      .join('\n');
  }
  fs.writeFileSync(hookPath, out);
  return true;
}
