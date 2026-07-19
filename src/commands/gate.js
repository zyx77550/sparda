// commands/gate.js — the agent edit-loop gate: did THIS edit lose a protection
// or introduce a risk, relative to the armed baseline? Delta-only by design: an
// edit gate must never scream about pre-existing state (that noise is fatal to
// adoption — see docs/TWO-FALSE-POSITIVE-CLASSES-2026-07-19.md), so everything
// already true at arm time is silent and only the regression speaks.
//   sparda gate            report the edit's behavior delta vs baseline (exit 1 on critical/high)
//   sparda gate --arm      freeze the current graph as the accepted baseline
//   sparda gate --hook     Claude Code PostToolUse contract: silent when clean,
//                          report on stderr + exit 2 (blocking feedback) on regression;
//                          arms itself on first run so there is nothing to configure.
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph, diffGraphs } from '../ubg/apocalypse.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

// severities that block the edit; medium/info regressions are reported, never fatal
const BLOCKING = new Set(['critical', 'high']);
const findingKey = (f) => `${f.rule}|${f.entrypoint}`;

// The gate's whole judgment, pure over two canonical graphs (testable without a repo):
// diff regressions (guard/route/invariant lost, blast radius grown) + static findings
// the candidate has that the baseline did not — the same composition `review` proved
// out (ADR-030), pointed at the baseline instead of a git ref.
export function gateDelta(baseline, candidate) {
  const diff = diffGraphs(baseline, candidate).findings;
  const before = new Set(checkGraph(baseline).findings.map(findingKey));
  const introduced = checkGraph(candidate).findings.filter(
    (f) => !before.has(findingKey(f)),
  );
  const seen = new Set(diff.map(findingKey));
  const findings = [...diff, ...introduced.filter((f) => !seen.has(findingKey(f)))];
  return {
    findings,
    blocking: findings.filter((f) => BLOCKING.has(f.severity)),
  };
}

function locOf(canonical, f) {
  const loc = canonical.nodes.find((n) => n.id === f.entrypoint)?.loc;
  return loc ? ` (${loc.file}:${loc.line || 1})` : '';
}

export async function runGate(opts) {
  const t0 = process.hrtime.bigint();
  const hook = opts.hook;
  // in hook mode stdout belongs to nobody and stderr is what the agent reads
  const say = hook ? (s) => console.error(s) : (s) => console.log(s);

  const { graph } = compileUBG(opts.cwd, { write: false });
  const candidate = canonicalizeGraph(graph);
  const baselinePath = path.join(opts.cwd, '.sparda', 'ubg.baseline.json');

  const arm = () => {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    atomicWrite(baselinePath, JSON.stringify(candidate, null, 2) + '\n');
  };

  if (opts.arm || opts.saveBaseline) {
    arm();
    say(
      `✓ GATE ARMED — baseline frozen (.sparda/ubg.baseline.json). Every edit is now proven against it.`,
    );
    return { armed: true, findings: [] };
  }

  if (!fs.existsSync(baselinePath)) {
    // first run arms instead of failing: a hook must work with zero configuration
    arm();
    say(
      `✓ GATE ARMED (first run) — baseline frozen. Future edits are proven against it; re-arm with \`sparda gate --arm\` after intended changes.`,
    );
    return { armed: true, findings: [] };
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const { findings, blocking } = gateDelta(baseline, candidate);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  if (opts.json) {
    console.log(
      JSON.stringify(
        { ok: blocking.length === 0, ms: Math.round(ms), findings },
        null,
        2,
      ),
    );
    if (blocking.length) process.exitCode = 1;
    return { armed: false, findings };
  }

  if (findings.length === 0) {
    if (!hook)
      say(
        `✓ GATE CLEAN — this edit lost no guard, dropped no route, grew no blast radius (proven vs baseline in ${Math.round(ms)} ms).`,
      );
    return { armed: false, findings };
  }

  say(
    `✗ SPARDA GATE — this edit changed the app's proven behavior (${Math.round(ms)} ms, deterministic):`,
  );
  for (const f of findings)
    say(`  [${f.severity}] ${f.rule} — ${f.message}${locOf(candidate, f)}`);
  say(
    blocking.length
      ? `  → fix the edit or, if intended, accept it with \`sparda gate --arm\`.`
      : `  → advisory only (no critical/high regression) — review, then \`sparda gate --arm\` if intended.`,
  );

  if (blocking.length) process.exitCode = hook ? 2 : 1;
  return { armed: false, findings };
}
