#!/usr/bin/env node
// SPARDA — Turn any codebase into an MCP server. Residual Labs.
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
  saveBaseline: flags.has('--save-baseline'),
  sarif: flags.has('--sarif'),
  verbose: flags.has('--verbose'),
  quiet: flags.has('--quiet'),
  probe: flags.has('--probe'),
  html: flags.has('--html'),
  json: flags.has('--json'),
  app: flags.has('--app'),
  learn: flags.has('--learn'),
  germinate: flags.has('--germinate'),
  check: flags.has('--check'),
  markdown: flags.has('--markdown'),
  port: getOpt('port', null),
  out: getOpt('out', null),
  base: getOpt('base', null),
  openapi: getOpt('openapi', null),
  expect: getOpt('expect', null),
  agent: getOpt('agent', null),
  // Point SPARDA at a sub-directory without `cd` — essential in a monorepo (the app lives in
  // apps/web, packages/api, …) and for reproducing a result in place. `--dir` and `--cwd` are
  // aliases; resolved against the real working directory. Every command reads opts.cwd.
  cwd: path.resolve(process.cwd(), getOpt('dir', null) ?? getOpt('cwd', null) ?? '.'),
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
    case 'prove': {
      const { runProve } = await import('./commands/prove.js');
      await runProve(opts);
      break;
    }
    case 'ubg': {
      const { runUbg } = await import('./commands/ubg.js');
      await runUbg(opts);
      break;
    }
    case 'badge': {
      const { runBadge } = await import('./commands/badge.js');
      await runBadge(opts);
      break;
    }
    case 'apocalypse': {
      const { runApocalypse } = await import('./commands/apocalypse.js');
      await runApocalypse(opts);
      break;
    }
    case 'review': {
      const { runReview } = await import('./commands/review.js');
      await runReview(opts);
      break;
    }
    case 'fingerprint': {
      const { runFingerprint } = await import('./commands/fingerprint.js');
      await runFingerprint(opts);
      break;
    }
    case 'polarity': {
      const { runPolarity } = await import('./commands/polarity.js');
      await runPolarity(opts);
      break;
    }
    case 'immunize': {
      const { runImmunize } = await import('./commands/immunize.js');
      await runImmunize(opts);
      break;
    }
    case 'speculate': {
      const { runSpeculate } = await import('./commands/speculate.js');
      await runSpeculate(opts);
      break;
    }
    case 'dossier': {
      const { runDossier } = await import('./commands/dossier.js');
      await runDossier(opts);
      break;
    }
    case 'blindspots': {
      const { runBlindspots } = await import('./commands/blindspots.js');
      await runBlindspots(opts);
      break;
    }
    case 'genome': {
      const { runGenome } = await import('./commands/genome.js');
      await runGenome(opts);
      break;
    }
    case 'timeless': {
      const { runTimeless } = await import('./commands/timeless.js');
      await runTimeless(opts, rest);
      break;
    }
    case 'mirror': {
      const { runMirror } = await import('./commands/mirror.js');
      await runMirror(opts);
      break;
    }
    case 'openapi': {
      const { runOpenapi } = await import('./commands/openapi.js');
      await runOpenapi(opts);
      break;
    }
    case 'verify': {
      const { runVerify } = await import('./commands/verify.js');
      await runVerify(opts);
      break;
    }
    case 'heal': {
      const { runHeal } = await import('./commands/heal.js');
      await runHeal(opts, rest);
      break;
    }
    default: {
      const labs = process.argv.includes('--labs');
      console.log(`SPARDA v${VERSION} — AI writes. SPARDA proves.

PROVE — the point
  prove        The whole trust verdict in one gesture: proof + coverage + seal (--json / --markdown / --openapi)
  apocalypse   Prove the deploy: guards, invariants, transactions, aggregates (--save-baseline)
  review       Semantic diff of a PR vs a base ref (--base main / --json / --markdown)
  blindspots   Map SPARDA's own blindness — every unseen route/effect/guard, ranked (--json)
  badge        Emit a shareable SVG badge + README snippet (verdict · coverage · routes)
  dossier      Render the whole proof as one self-contained HTML page anyone can read
  verify       Prove the compiler's own laws (determinism, soundness, round-trip)
  heal         Turn a production bug into a fix brief + a gate (--check / --expect / --agent)

IMMUNITY — the portable proof
  fingerprint  Portable behavior hash per route — the address for shared diagnoses (--json)
  immunize     Freeze proven safety into a tiny capsule (1 byte/route)
  speculate    Re-verify vs the frozen capsule — full proof only on novel shapes (--json)
  polarity     Ternary safety matrix per route — proof as arithmetic (--json)
  genome       Sign proofs into the shared world memory — self-verifying antibodies, zero infra

INGEST & RUNTIME
  ubg          Compile the codebase to its Unified Behavior Graph (.sparda/ubg.json)
  openapi      Emit an OpenAPI 3.1 spec FROM the graph (--out / --json)
  mirror       Serve the compiled graph over HTTP — no framework, no source (--port)
  timeless     Replay production requests (list | replay <id> | export <id> → vitest)

SETUP — the MCP lifecycle
  demo         Guided tour on a bundled app — no setup, nothing touched
  init         Scan project, generate & inject the MCP router
  dev          Run the MCP stdio bridge (connect Claude Desktop)
  sync         Re-sync the router after route changes · hook  Install the git sentinel
  doctor       Diagnose your setup (--app: rot scan) · report  What AI agents did to this app
  remove       Remove SPARDA from this project (clean git diff)
${
  labs
    ? `
LABS — experimental, not load-bearing (--labs)
  seed         Export/import the learned genome (export [--out f] | import <f>)
  twin         The living mock (--learn from the live app, then serve the ghost)
  grammar      Which call sequences mean something (observed + hypotheses)
  evolve       Trial hypothesis chains against the twin; survivors become suggestions
`
    : `\nRun \`sparda --labs\` to see experimental commands.`
}
Flags: --dir <path>  --yes  --json  --markdown  --openapi <spec>  --port <n>  --base <ref>  --quiet  --verbose

By Residual Labs — residual-labs.fr`);
      process.exit(cmd ? 1 : 0);
    }
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
