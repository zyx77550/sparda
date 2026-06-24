// commands/sync.js — sentinel: keep the generated router in sync with the routes
import fs from 'node:fs';
import path from 'node:path';
import { detectStack } from '../detect.js';
import { parseExpressProject } from '../parser/express.js';
import { parseFastAPIProject } from '../parser/fastapi.js';
import { sanitizeDescription } from '../security/sanitize.js';
import { generateExpress } from '../generator/express.js';
import { generateFastAPI } from '../generator/fastapi.js';

export async function runSync(opts) {
  const log = (m) => {
    if (!opts.quiet) console.error(m);
  };
  const manifestPath = path.join(opts.cwd, 'sparda.json');
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('sparda.json not found.'), {
      code: 'USER',
      hint: 'Run `npx sparda-mcp init` first.',
    });
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const stack = detectStack(opts.cwd);

  let routes, entryAppVars;
  if (stack.framework === 'express') {
    ({ routes } = parseExpressProject(opts.cwd, stack.entryFile));
  } else {
    ({ routes, entryAppVars } = parseFastAPIProject(
      opts.cwd,
      stack.entryFile,
      stack.pythonCmd,
    ));
  }
  for (const r of routes) {
    r.description = sanitizeDescription(
      r.description,
      `${r.method.toUpperCase()} ${r.path}`,
    ).text;
  }

  const current = new Set(
    Object.values(manifest.tools ?? {}).map((t) => `${t.method} ${t.path}`),
  );
  const next = new Set(routes.map((r) => `${r.method.toUpperCase()} ${r.path}`));
  const added = [...next].filter((x) => !current.has(x));
  const removed = [...current].filter((x) => !next.has(x));

  if (added.length === 0 && removed.length === 0) {
    log('[sparda] in sync — no route changes.');
    return { changed: false, added, removed };
  }

  // regenerate; carry-over keeps enabled overrides, semantic cache and localKey
  stack.framework === 'express'
    ? generateExpress({
        cwd: opts.cwd,
        entryFile: stack.entryFile,
        moduleType: stack.moduleType,
        port: manifest.port ?? stack.port,
        routes,
      })
    : generateFastAPI({
        cwd: opts.cwd,
        entryFile: stack.entryFile,
        port: manifest.port ?? stack.port,
        routes,
        entryAppVars,
        pythonCmd: stack.pythonCmd,
      });

  for (const a of added) log(`[sparda] + ${a}`);
  for (const r of removed) log(`[sparda] - ${r}`);
  log(
    `[sparda] router regenerated (${added.length} added, ${removed.length} removed). Restart your app or let hot-reload pick it up.`,
  );
  return { changed: true, added, removed };
}
