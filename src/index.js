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
  html: flags.has('--html'),
  json: flags.has('--json'),
  app: flags.has('--app'),
  learn: flags.has('--learn'),
  germinate: flags.has('--germinate'),
  port: getOpt('port', null),
  out: getOpt('out', null),
  cwd: process.cwd(),
};

try {
  switch (cmd) {
    case 'demo': {
      const { runDemo } = await import('./commands/demo.js');
      await runDemo(opts);
      break;
    }
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
    case 'report': {
      const { runReport } = await import('./commands/report.js');
      await runReport(opts);
      break;
    }
    case 'seed': {
      const { runSeed } = await import('./commands/seed.js');
      await runSeed(
        opts,
        rest.filter((a) => !a.startsWith('--')),
      );
      break;
    }
    case 'twin': {
      const { runTwin } = await import('./commands/twin.js');
      await runTwin(opts, rest);
      break;
    }
    case 'grammar': {
      const { runGrammar } = await import('./commands/grammar.js');
      await runGrammar(opts);
      break;
    }
    case 'evolve': {
      const { runEvolve } = await import('./commands/evolve.js');
      await runEvolve(opts);
      break;
    }
    case 'ubg': {
      const { runUbg } = await import('./commands/ubg.js');
      await runUbg(opts);
      break;
    }
    default:
      console.log(`SPARDA v${VERSION} — Turn any codebase into an MCP server.

Usage:
  npx sparda-mcp demo      Guided tour on a bundled app — no setup, nothing touched
  npx sparda-mcp init      Scan project, generate & inject the MCP router
  npx sparda-mcp dev       Run the MCP stdio bridge (connect Claude Desktop)
  npx sparda-mcp sync      Re-sync the router after route changes (no prompts)
  npx sparda-mcp hook      Install the git sentinel (auto-sync after commits)
  npx sparda-mcp remove    Remove SPARDA from this project (clean git diff)
  npx sparda-mcp doctor    Diagnose your setup (--app: negentropy scan — drift, dead routes, rot)
  npx sparda-mcp report    The black box: what AI agents did to this app
  npx sparda-mcp seed      Export/import the learned genome (export [--out f] | import <f> [--germinate])
  npx sparda-mcp twin      The living mock (--learn from the live app, then serve the ghost)
  npx sparda-mcp grammar   Which call sequences mean something (observed + hypotheses)
  npx sparda-mcp evolve    Trial hypothesis chains against the twin; survivors become suggestions
  npx sparda-mcp ubg       Compile the codebase to its Unified Behavior Graph (.sparda/ubg.json)

Flags: --yes (skip prompts)  --port <n>  --quiet  --verbose
       --probe (init: also run the app to discover dynamic routes the AST missed)
       --html / --json (report: write .sparda/report.html / print raw JSON)

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
