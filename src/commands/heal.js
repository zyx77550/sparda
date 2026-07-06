// commands/heal.js — the closed loop as one gesture.
//   sparda heal <flightId>                    diagnose + write the fix brief
//   sparda heal <flightId> --agent "claude -p"   let an AI attempt the fix, then gate
//   sparda heal <flightId> --check [--expect '{"status":200}']   gate a fix (human or AI)
// The gate is the product: lenient replay against the recorded taps must meet
// the EXPECTATION (not the recorded bug), compiler laws must hold (verify),
// and apocalypse must find no new critical/high and no removed guard. SPARDA
// orchestrates and proves — whoever writes the fix, the machine judges it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadFlight } from '../flight/format.js';
import { getFlightBox } from '../flight/box.js';
import { replayFlight } from '../flight/replayer.js';
import { evaluateHealing, buildBrief } from '../flight/heal.js';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph, diffGraphs, verdictOf } from '../ubg/apocalypse.js';
import { verifyProject } from '../ubg/verify.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

const err = (message, hint) => Object.assign(new Error(message), { code: 'USER', hint });

export async function runHeal(opts, args) {
  const id = args.filter((a) => !a.startsWith('--'))[0];
  if (!id) throw err('flight id required', 'run `sparda timeless` to list flights');
  const flight = loadFlight(opts.cwd, id);
  const healDir = path.join(opts.cwd, '.sparda', 'heal', id);
  fs.mkdirSync(healDir, { recursive: true });

  if (opts.check) return gate(opts, id, flight, healDir);

  // ---- phase 1: diagnose + brief -----------------------------------------
  const compiled = compileUBG(opts.cwd, { write: false });
  const graph = canonicalizeGraph(compiled.graph);
  const app = await loadAppFor(opts.cwd);
  const box = getFlightBox();
  box.arm();
  let strict;
  try {
    strict = await replayFlight(app, flight, box);
  } finally {
    box.disarm();
  }

  // freeze the pre-fix graph: the gate diffs the fixed tree against THIS
  atomicWrite(path.join(healDir, 'baseline.json'), JSON.stringify(graph, null, 2) + '\n');
  const brief = buildBrief(flight, graph, strict, id);
  const briefPath = path.join(healDir, 'BRIEF.md');
  atomicWrite(briefPath, brief);

  console.log(`HEAL — flight ${id}: ${flight.request.method} ${flight.request.url}`);
  console.log(
    strict.match
      ? '  ✓ bug reproduced byte-identically against current code'
      : '  ⚠ current code already answers differently — the bug may be partially fixed',
  );
  console.log(`  ✓ brief written: .sparda/heal/${id}/BRIEF.md`);
  console.log(`  ✓ pre-fix graph frozen: .sparda/heal/${id}/baseline.json`);

  if (opts.agent) {
    console.log(`  ▸ handing the brief to: ${opts.agent}`);
    const run = spawnSync(opts.agent, {
      input: brief,
      shell: true,
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: 600_000,
    });
    if (run.status !== 0)
      throw err(`agent exited ${run.status}`, (run.stderr ?? '').slice(0, 200));
    console.log('  ✓ agent finished — gating the fix now');
    return gate(opts, id, flight, healDir);
  }

  console.log('\nNext: apply the fix (yourself or an agent), then:');
  console.log(`  sparda heal ${id} --check --expect '{"status":200}'`);
  return { brief: briefPath };
}

// ---- phase 2: the gate ----------------------------------------------------
async function gate(opts, id, flight, healDir) {
  const expectation = opts.expect ? JSON.parse(opts.expect) : null;

  // 1. lenient replay: recorded inputs, candidate code, expected outcome
  const app = await loadAppFor(opts.cwd);
  const box = getFlightBox();
  box.arm();
  let replay;
  try {
    replay = await replayFlight(app, flight, box, { lenient: true });
  } finally {
    box.disarm();
  }
  const healing = evaluateHealing(flight, replay, expectation);

  // 2. compiler laws still hold on the fixed tree
  const laws = verifyProject(opts.cwd);

  // 3. apocalypse: no new critical/high, nothing protected got removed
  const fixedGraph = canonicalizeGraph(compileUBG(opts.cwd, { write: false }).graph);
  const staticFindings = checkGraph(fixedGraph).findings;
  let regressions = [];
  const baselinePath = path.join(healDir, 'baseline.json');
  if (fs.existsSync(baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    regressions = diffGraphs(baseline, fixedGraph).findings;
    // pre-existing static findings are not the fix's fault — only NEW ones gate
    const before = new Set(
      checkGraph(baseline).findings.map((f) => `${f.rule}:${f.entrypoint}`),
    );
    regressions = [
      ...regressions,
      ...staticFindings.filter((f) => !before.has(`${f.rule}:${f.entrypoint}`)),
    ];
  } else {
    regressions = staticFindings;
  }
  const apocalypse = verdictOf(regressions);

  // ---- verdict -------------------------------------------------------------
  console.log(`HEAL GATE — flight ${id}`);
  console.log(
    `  ${healing.healed ? '✓' : '✗'} behavior: ${healing.healed ? `bug gone (${healing.before.status} → ${healing.after.status})` : healing.reasons.join('; ')}`,
  );
  if (healing.relabels.length)
    console.log(
      `    · ${healing.relabels.length} tap(s) relabeled by the fix (allowed): ${healing.relabels.map((r) => r.kind).join(', ')}`,
    );
  console.log(`  ${laws.ok ? '✓' : '✗'} compiler laws: ${laws.passed}/${laws.total}`);
  console.log(
    `  ${apocalypse.safe ? '✓' : '✗'} apocalypse: ${regressions.length === 0 ? 'no new findings' : regressions.map((f) => f.rule).join(', ')}`,
  );

  const ok = healing.healed && laws.ok && apocalypse.safe;
  const report = { id, healed: healing, laws: laws.checks, regressions, ok };
  atomicWrite(path.join(healDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');

  if (ok) {
    console.log(
      `✓ HEALED & PROVEN — same recorded inputs, correct output, zero law broken, zero protection lost. Ship it.`,
    );
  } else {
    console.log(
      '✗ NOT PROVEN — the gate stays closed. Details: .sparda/heal/' +
        id +
        '/report.json',
    );
    process.exitCode = 1;
  }
  return report;
}

// same entry-loading discipline as timeless replay (listen suppressed)
async function loadAppFor(cwd) {
  const { detectStack } = await import('../detect.js');
  const http = await import('node:http');
  const { pathToFileURL } = await import('node:url');
  const stack = detectStack(cwd);
  if (stack.framework !== 'express')
    throw err('heal supports Express apps in v1', 'FastAPI replay is a later round');
  const origListen = http.default.Server.prototype.listen;
  http.default.Server.prototype.listen = function suppressed(...a) {
    const cb = a.find((x) => typeof x === 'function');
    if (cb) setImmediate(cb);
    return this;
  };
  try {
    // cache-bust: the gate must load the FIXED code, not the pre-fix module
    const entry = pathToFileURL(path.resolve(cwd, stack.entryFile)).href;
    const mod = await import(`${entry}?sparda-heal=${Date.now()}`);
    const app = mod.default ?? mod;
    if (typeof app !== 'function')
      throw err(
        'the entry file does not export the Express app',
        'add `module.exports = app`',
      );
    return app;
  } finally {
    http.default.Server.prototype.listen = origListen;
  }
}
