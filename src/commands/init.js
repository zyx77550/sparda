// commands/init.js
import path from 'node:path';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import { detectStack } from '../detect.js';
import { parseExpressProject } from '../parser/express.js';
import { parseFastAPIProject } from '../parser/fastapi.js';
import { parseNextProject } from '../parser/nextjs.js';
import { sanitizeDescription } from '../security/sanitize.js';
import { generateExpress } from '../generator/express.js';
import { generateFastAPI } from '../generator/fastapi.js';
import { generateNext } from '../generator/nextjs.js';
import { c, gradient, colorizeJson } from '../ui/style.js';

const VERSION = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

export async function runInit(opts) {
  const t0 = Date.now();
  p.intro(`${gradient('SPARDA')} ${c.dim(`v${VERSION}`)}`);

  const s = p.spinner();
  s.start('Scanning project...');
  const stack = detectStack(opts.cwd);

  let routes, skipped, entryAppVars;
  let dynamicGaps = [];
  if (stack.framework === 'express') {
    const res = parseExpressProject(opts.cwd, stack.entryFile);
    routes = res.routes;
    skipped = res.skipped;
    s.stop(
      `Stack detected: ${c.cyan(`Express (${stack.moduleType.toUpperCase()})`)} — entry: ${stack.entryFile}, port: ${stack.port}`,
    );
  } else if (stack.framework === 'fastapi') {
    const res = parseFastAPIProject(opts.cwd, stack.entryFile, stack.pythonCmd);
    routes = res.routes;
    skipped = res.skipped;
    entryAppVars = res.entryAppVars;
    s.stop(
      `Stack detected: ${c.cyan('FastAPI')} — entry: ${stack.entryFile}, port: ${stack.port}`,
    );
  } else if (stack.framework === 'nextjs') {
    const res = parseNextProject(opts.cwd, stack.entryFile);
    routes = res.routes;
    skipped = res.skipped;
    s.stop(
      `Stack detected: ${c.cyan('Next.js (App Router)')} — app dir: ${stack.entryFile}/, port: ${stack.port}`,
    );
  }

  // Opt-in runtime probe (Brief #3): static is the floor, probe only ADDS routes
  // the AST missed (dynamic mounts, programmatic registration). Off by default →
  // behavior byte-identical. Executing the host app has side-effects, so it is
  // gated behind --probe, warned on stderr, and degrades to static-only on any
  // failure — a probe error must never break init (R1).
  if (opts.probe && stack.framework === 'nextjs') {
    p.log.warn(
      '--probe is not supported on Next.js (file-based routing needs no runtime probe).',
    );
  } else if (opts.probe) {
    p.log.warn(
      "--probe runs your app to observe routes the static scan missed. Use only on code you trust (it triggers your app's import side-effects).",
    );
    try {
      const { discoverDynamicRoutes } = await import('../probe/integrate.js');
      const { added, gaps, probedCount } = await discoverDynamicRoutes({
        framework: stack.framework,
        entryFile: path.resolve(opts.cwd, stack.entryFile),
        projectRoot: opts.cwd,
        staticRoutes: routes,
      });
      dynamicGaps = gaps;
      if (added.length) {
        routes.push(...added);
        p.log.success(
          `Probe added ${added.length} dynamic route(s) the static scan missed (${probedCount} observed at runtime).`,
        );
      } else {
        p.log.info(
          `Probe observed ${probedCount} route(s); the static scan already covered them.`,
        );
      }
    } catch (err) {
      p.log.warn(`Probe failed (${err.message}); continuing with static routes only.`);
    }
  }

  if (routes.length === 0) {
    throw Object.assign(new Error('0 routes extracted.'), {
      code: 'USER',
      hint:
        stack.framework === 'nextjs'
          ? `SPARDA found Next.js but no route.js handlers under ${stack.entryFile}/. Page components are not API routes — SPARDA exposes route handlers only.`
          : `SPARDA found ${stack.framework === 'express' ? 'Express' : 'FastAPI'} but no literal-path routes. Dynamic routing is not supported in v0.`,
    });
  }

  let flaggedCount = 0;
  for (const r of routes) {
    const { text, flagged } = sanitizeDescription(
      r.description,
      `${r.method.toUpperCase()} ${r.path}`,
    );
    r.description = text;
    if (flagged) flaggedCount++;
  }

  const high = routes.filter((r) => r.confidence === 'high').length;
  p.log.info(
    `${routes.length} routes found — ${high} high confidence, ${routes.length - high} partial`,
  );

  const preview = routes
    .slice(0, 8)
    .map(
      (r) =>
        `${r.mutating ? c.red('✗') : c.green('✓')} ${r.method.toUpperCase().padEnd(6)} ${r.path}${r.mutating ? c.dim('   (disabled: write-safety)') : ''}`,
    )
    .join('\n');
  p.note(
    preview + (routes.length > 8 ? c.dim(`\n... (+${routes.length - 8} more)`) : ''),
    'TOOLS TO GENERATE',
  );

  if (flaggedCount)
    p.log.warn(
      `${flaggedCount} suspicious docstring(s) purged (prompt-injection defense)`,
    );
  if (skipped.length)
    p.log.warn(
      `${skipped.length} route(s) skipped — details in .sparda/scan-report.json`,
    );

  let inject = true;
  // Next.js is file-based: SPARDA adds one route-handler file and touches
  // nothing else — there is no injection decision to make.
  if (!opts.yes && stack.framework !== 'nextjs') {
    const answer = await p.select({
      message: `Inject the MCP router into ${stack.entryFile}?`,
      options: [
        {
          value: true,
          label: 'Yes, inject (adds a marked block, reversible via `sparda remove`)',
        },
        { value: false, label: 'No, generate files only (I will add 2 lines manually)' },
      ],
    });
    if (p.isCancel(answer)) {
      p.cancel('Aborted.');
      process.exit(1);
    }
    inject = answer;
  }

  const result =
    stack.framework === 'express'
      ? generateExpress({
          cwd: opts.cwd,
          entryFile: stack.entryFile,
          moduleType: stack.moduleType,
          port: stack.port,
          routes,
        })
      : stack.framework === 'nextjs'
        ? generateNext({
            cwd: opts.cwd,
            appDir: stack.entryFile,
            port: stack.port,
            routes,
          })
        : generateFastAPI({
            cwd: opts.cwd,
            entryFile: stack.entryFile,
            port: stack.port,
            routes,
            entryAppVars,
            pythonCmd: stack.pythonCmd,
          });

  fs.mkdirSync(path.join(opts.cwd, '.sparda'), { recursive: true });
  const scanReport = { routes, skipped };
  if (opts.probe) scanReport.dynamicGaps = dynamicGaps; // provenance, only when probed
  fs.writeFileSync(
    path.join(opts.cwd, '.sparda', 'scan-report.json'),
    JSON.stringify(scanReport, null, 2),
  );

  p.log.success(`Generated ${result.routerFile}`);
  if (result.injection.fileBased)
    p.log.success(
      'File-based injection: your code was not modified (remove deletes the file)',
    );
  else if (inject && result.injection.injected)
    p.log.success(`Injected into ${stack.entryFile} (backup: .sparda/backup/)`);
  else if (result.injection.manual) {
    p.note(
      result.injection.manual.join('\n'),
      `Add these lines to ${stack.entryFile} (after FastAPI/express instantiation)`,
    );
  }
  p.log.success('Wrote sparda.json');

  const cfg = JSON.stringify(
    {
      [path.basename(opts.cwd)]: {
        command: 'npx',
        args: ['sparda-mcp', 'dev'],
        cwd: opts.cwd,
      },
    },
    null,
    2,
  );
  p.outro(`${c.green(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`)}

   Next steps:
   1. Start your app:        ${c.cyan(stack.framework === 'fastapi' ? 'fastapi dev' : 'npm run dev')}
   2. Start the MCP bridge:  ${c.cyan('npx sparda-mcp dev')}
   3. Add to Claude Desktop config (claude_desktop_config.json):

${colorizeJson(cfg)
  .split('\n')
  .map((l) => '   ' + l)
  .join('\n')}

   ${c.dim('Write tools (POST/PUT/DELETE) are disabled by default.')}
   ${c.dim('Enable them in sparda.json, then re-run')} ${c.cyan('`npx sparda-mcp init --yes`')}${c.dim('.')}`);
}
