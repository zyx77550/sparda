// commands/remove.js
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { removeInjection as removeExpress } from '../generator/express.js';
import { removeInjection as removeFastAPI } from '../generator/fastapi.js';
import { detectStack } from '../detect.js';
import { removeHook } from './hook.js';

export async function runRemove(opts) {
  const manifestPath = path.join(opts.cwd, 'sparda.json');
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('sparda.json not found — nothing to remove.'), {
      code: 'USER',
    });
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (!opts.yes) {
    // clack crashes with uv_tty_init EBADF when stdin is not a TTY (CI, pipes)
    if (!process.stdin.isTTY) {
      throw Object.assign(new Error('Cannot ask for confirmation: stdin is not a TTY.'), {
        code: 'USER',
        hint: 'Re-run with --yes to skip the prompt.',
      });
    }
    const ok = await p.confirm({
      message:
        'Remove SPARDA from this project? (deletes generated files + injected block)',
    });
    if (p.isCancel(ok) || !ok) {
      p.cancel('Aborted.');
      process.exit(1);
    }
  }

  let pythonCmd = 'python';
  try {
    const stack = detectStack(opts.cwd);
    if (stack.pythonCmd) pythonCmd = stack.pythonCmd;
  } catch {
    // ignore
  }

  const results =
    manifest.framework === 'fastapi'
      ? removeFastAPI(opts.cwd, manifest, pythonCmd)
      : removeExpress(opts.cwd, manifest);

  for (const r of results) {
    if (r.ok) console.log(`✓ Removed injection from ${r.file} (file still parses)`);
    else
      console.log(
        `✗ Could not safely remove from ${r.file} — restore from .sparda/backup/`,
      );
  }
  for (const f of manifest.generatedFiles ?? []) {
    const abs = path.resolve(opts.cwd, f);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs);
      console.log(`✓ Deleted ${f}`);
    }
  }
  if (revertGitignore(opts.cwd, manifest.gitignore))
    console.log('✓ Reverted .gitignore edit');
  if (removeHook(opts.cwd)) console.log('✓ Uninstalled post-commit sentinel hook');
  fs.rmSync(manifestPath);
  fs.rmSync(path.join(opts.cwd, '.sparda'), { recursive: true, force: true });
  console.log('✓ Deleted sparda.json and .sparda/');
  console.log('\nSPARDA removed. `git diff` should be clean.');
}

// Undo exactly what init's ensureGitignore did (recorded in the manifest),
// so init→remove leaves a byte-for-byte clean tree (hard rule #4, E-010).
// Manifests written before v0.3.1 carry no `gitignore` field → no-op, as before.
function revertGitignore(cwd, action) {
  if (!action) return false;
  const gi = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gi)) return false;
  const content = fs.readFileSync(gi, 'utf8');
  const created = `.sparda/\n`;
  const appended = `\n.sparda/\n`;
  if (action === 'created' && content === created) {
    fs.rmSync(gi);
    return true;
  }
  if (content.endsWith(appended)) {
    fs.writeFileSync(gi, content.slice(0, -appended.length));
    return true;
  }
  // user edited around our line since init — best effort: drop the bare line
  const lines = content.split('\n');
  const idx = lines.indexOf('.sparda/');
  if (idx === -1) return false;
  lines.splice(idx, 1);
  fs.writeFileSync(gi, lines.join('\n'));
  return true;
}
