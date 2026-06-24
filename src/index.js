#!/usr/bin/env node
// SPARDA — Turn any codebase into an MCP server. Residual Labs.
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const [, , cmd, ...rest] = process.argv;

const flags = new Set(rest.filter((a) => a.startsWith('--')));
const getOpt = (name, dflt) => {
  const i = rest.indexOf(`--${name}`);
  return i !== -1 && rest[i + 1] ? rest[i + 1] : dflt;
};

const opts = {
  yes: flags.has('--yes') || flags.has('-y'),
  verbose: flags.has('--verbose'),
  quiet: flags.has('--quiet'),
  probe: flags.has('--probe'),
  port: getOpt('port', null),
  cwd: process.cwd(),
};

try {
  switch (cmd) {
    case 'init': {
      const { runInit } = await import('./commands/init.js');
      await runInit(opts);
      break;
    }
    case 'dev': {
      const { runDev } = await import('./commands/dev.js');
      await runDev(opts);
      break;
    }
    case 'remove': {
      const { runRemove } = await import('./commands/remove.js');
      await runRemove(opts);
      break;
    }
    case 'doctor': {
      const { runDoctor } = await import('./commands/doctor.js');
      const { healthy } = await runDoctor(opts);
      if (!healthy) process.exitCode = 1; // let scripts/CI gate on doctor
      break;
    }
    case 'sync': {
      const { runSync } = await import('./commands/sync.js');
      await runSync(opts);
      break;
    }
    case 'hook': {
      const { runHook } = await import('./commands/hook.js');
      await runHook(opts);
      break;
    }
    default:
      console.log(`SPARDA v${VERSION} — Turn any codebase into an MCP server.

Usage:
  npx sparda-mcp init      Scan project, generate & inject the MCP router
  npx sparda-mcp dev       Run the MCP stdio bridge (connect Claude Desktop)
  npx sparda-mcp sync      Re-sync the router after route changes (no prompts)
  npx sparda-mcp hook      Install the git sentinel (auto-sync after commits)
  npx sparda-mcp remove    Remove SPARDA from this project (clean git diff)
  npx sparda-mcp doctor    Diagnose your setup

Flags: --yes (skip prompts)  --port <n>  --quiet  --verbose
       --probe (init: also run the app to discover dynamic routes the AST missed)

By Residual Labs — residual-labs.fr`);
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error(`\n✗ ${err?.message ?? err}`);
  if (err?.hint) console.error(`  → ${err.hint}`);
  if (opts.verbose && err?.stack) console.error(err.stack);
  else
    console.error(
      '  (run with --verbose for details — or open an issue: github.com/zyx77550/sparda/issues)',
    );
  process.exit(err?.code === 'USER' ? 1 : 2);
}
