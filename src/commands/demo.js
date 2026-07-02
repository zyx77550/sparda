// commands/demo.js — zero-setup guided tour. Runs the REAL init pipeline
// (detect → parse → sanitize → generate → inject → remove) on a bundled demo
// app inside a throwaway temp dir. No network, no port, no host process, no
// express install — detect/parse/generate are pure AST + file ops, so this can
// never fail on the user's machine and never touches their project. It is the
// try-it entry point for the npm/registry listing (the registry user has no
// app of their own yet, so `dev` would have nothing to attach to — `demo` does).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { detectStack } from '../detect.js';
import { parseExpressProject } from '../parser/express.js';
import { sanitizeDescription } from '../security/sanitize.js';
import { generateExpress, removeInjection } from '../generator/express.js';
import { c, gradient } from '../ui/style.js';

const VERSION = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

// shipped in the npm tarball via package.json "files" — resolved relative to
// this file so it works from both a source checkout and an installed package.
const DEMO_APP_DIR = fileURLToPath(new URL('../../demo-app', import.meta.url));
const MARK_END = '// <<< sparda-injection <<<';

export async function runDemo(opts = {}) {
  const show = !opts.quiet;
  const note = (msg, title) => show && p.note(msg, title);
  const log = (kind, msg) => show && p.log[kind](msg);

  if (show)
    p.intro(`${gradient('SPARDA')} ${c.dim(`v${VERSION}`)} ${c.dim('— guided demo')}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-demo-'));
  try {
    fs.cpSync(DEMO_APP_DIR, tmp, { recursive: true });
    log(
      'info',
      'Running the real SPARDA pipeline on a bundled demo CRM (Express), in a throwaway temp folder. Nothing here touches your own project.',
    );

    // STEP 1 — detect (reads package.json + source; installs/executes nothing)
    const stack = detectStack(tmp);
    const pristineEntry = fs.readFileSync(path.join(tmp, stack.entryFile), 'utf8');
    note(
      `${c.cyan(`Express (${stack.moduleType.toUpperCase()})`)}  ·  entry ${stack.entryFile}  ·  port ${stack.port}\n` +
        c.dim('Read from package.json + source. No dependency installed, no code run.'),
      'STEP 1 — DETECT',
    );

    // STEP 2 — parse + sanitize + generate the router & manifest
    const { routes, skipped } = parseExpressProject(tmp, stack.entryFile);
    const flagged = [];
    for (const r of routes) {
      const label = `${r.method.toUpperCase()} ${r.path}`;
      const { text, flagged: f } = sanitizeDescription(r.description, label);
      r.description = text;
      if (f) flagged.push(label);
    }
    const result = generateExpress({
      cwd: tmp,
      entryFile: stack.entryFile,
      moduleType: stack.moduleType,
      port: stack.port,
      routes,
    });

    const entries = Object.entries(result.manifest.tools);
    const enabled = entries.filter(([, t]) => t.enabled);
    const disabled = entries.filter(([, t]) => !t.enabled);
    const table = entries
      .map(
        ([name, t]) =>
          `${t.enabled ? c.green('✓') : c.red('✗')} ${t.method.padEnd(6)} ${t.path.padEnd(22)} ${c.dim('→')} ${name}` +
          (t.enabled ? '' : c.dim('   (disabled: write-safety)')),
      )
      .join('\n');
    note(
      table,
      `STEP 2 — GENERATE  (${routes.length} routes → ${entries.length} MCP tools)`,
    );
    log(
      'success',
      `${enabled.length} read tools live. ${disabled.length} write tools generated but OFF by default — you enable them per-tool in sparda.json.`,
    );

    // STEP 3 — refuse to guess: the variable-built path is skipped, not invented
    if (skipped.length)
      note(
        skipped.map((s) => `${c.yellow('skipped')}  ${s.reason}`).join('\n') +
          '\n' +
          c.dim("SPARDA never invents a path it can't prove from the source."),
        'STEP 3 — REFUSE TO GUESS',
      );

    // STEP 4 — defend: a poisoned docstring is purged before it reaches the LLM
    if (flagged.length)
      note(
        `${c.red('purged')}  a prompt-injection hidden in the docstring of ${flagged.join(', ')}\n` +
          c.dim("Deleted before it could ever reach your client's model."),
        'STEP 4 — DEFEND',
      );

    // STEP 5 — the entire edit to the user's code: one marked, reversible block
    const injectedEntry = fs.readFileSync(path.join(tmp, stack.entryFile), 'utf8');
    const block = extractBlock(injectedEntry);
    if (block) note(block, `STEP 5 — INJECT  (the only edit to ${stack.entryFile})`);

    // STEP 6 — prove `remove` restores a byte-for-byte clean diff (hard rule #4)
    removeInjection(tmp, result.manifest);
    const restoredEntry = fs.readFileSync(path.join(tmp, stack.entryFile), 'utf8');
    const cleanDiff = restoredEntry === pristineEntry;
    note(
      (cleanDiff ? c.green('✓ byte-for-byte clean') : c.red('✗ diff not clean')) +
        `\n` +
        c.dim(
          `After \`npx sparda-mcp remove\`, ${stack.entryFile} is identical to the original.`,
        ),
      'STEP 6 — REMOVE LEAVES A CLEAN GIT DIFF',
    );

    if (show)
      p.outro(
        `${c.green('That was the whole loop, on a bundled demo.')}\n\n` +
          `   On ${c.bold('your')} Express or FastAPI app:\n` +
          `   1. ${c.cyan('npx sparda-mcp init')}   ${c.dim('— same transformation, your routes')}\n` +
          `   2. ${c.cyan('npx sparda-mcp dev')}    ${c.dim('— bridge it to your MCP client over stdio')}\n\n` +
          `   ${c.dim('Reads go live immediately; writes stay disabled until you opt in.')}`,
      );

    return {
      tmpDir: tmp,
      framework: stack.framework,
      toolCount: entries.length,
      enabled: enabled.map(([n]) => n),
      disabled: disabled.map(([n]) => n),
      skipped: skipped.length,
      flagged,
      cleanDiff,
    };
  } finally {
    // user's machine left exactly as we found it
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function extractBlock(src) {
  const start = src.indexOf('// >>> sparda-injection');
  const end = src.indexOf(MARK_END);
  if (start === -1 || end === -1) return null;
  return src.slice(start, end + MARK_END.length);
}
