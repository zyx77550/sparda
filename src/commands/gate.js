// commands/gate.js — the agent edit-loop gate: did THIS edit lose a protection
// or introduce a risk, relative to the armed baseline? Delta-only by design: an
// edit gate must never scream about pre-existing state (that noise is fatal to
// adoption — see docs/TWO-FALSE-POSITIVE-CLASSES-2026-07-19.md), so everything
// already true at arm time is silent and only the regression speaks.
//
// The load-bearing subtlety (E-GATE-1): a PostToolUse hook fires after EVERY
// edit, including the mid-sequence ones that leave a file temporarily
// unparseable. When a file fails to parse its routes vanish from the graph, so a
// naive diff reads that as ENTRYPOINT_REMOVED / GUARD_REMOVED and cries a false
// regression on the agent's own in-progress work. That false alarm, fired
// constantly, is what gets the gate uninstalled in five minutes. So: a regression
// whose baseline entrypoint lives in a now-unparseable file is NOT a regression —
// it is "unproven, come back when it parses". The gate ABSTAINS, never claims
// clean (it proved nothing) and never claims safe. An unparseable tree has no
// defined behavior to regress against — abstention is the sound call.
//
// Note on PostToolUse semantics: the edit has already landed, so exit 2 does not
// *prevent* it — it feeds the regression back to the agent as stderr, which the
// agent reads and corrects in the same session (self-heal in the loop). That is
// the honest claim: immediate feedback, not a hard block. (A hard pre-commit
// block is the pre-commit hook / CI Action's job — same command, `apocalypse`.)
//   sparda gate            report the edit's behavior delta vs baseline
//   sparda gate --arm      freeze the current graph as the accepted baseline
//   sparda gate --hook     Claude Code PostToolUse contract: silent when clean,
//                          report on stderr + exit 2 (feedback to the agent) on a
//                          real regression; abstains (exit 0) while a file is
//                          mid-edit; arms itself on first run — zero config.
import fs from 'node:fs';
import path from 'node:path';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph, diffGraphs } from '../ubg/apocalypse.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

// severities that block the edit; medium/info regressions are reported, never fatal
const BLOCKING = new Set(['critical', 'high']);
const findingKey = (f) => `${f.rule}|${f.entrypoint}`;
// diff rules that mean "this route/protection disappeared" — the ones a vanished
// (unparseable) file can forge. Introduced-risk rules can never be forged by a
// missing file, so they are never suppressed.
const REMOVAL_RULES = new Set(['ENTRYPOINT_REMOVED', 'GUARD_REMOVED']);

// files the compiler could not read/parse this run — reason is prefixed by the
// module error (`parse error: …` / `unreadable: …`) in every extractor's skipped list.
function unparsedFiles(report) {
  const out = new Set();
  for (const s of report?.skipped ?? []) {
    if (s.file && /(^|\b)(parse error|unreadable|Unexpected|SyntaxError)/i.test(s.reason))
      out.add(s.file);
  }
  return out;
}

// The gate's whole judgment, pure over two canonical graphs (testable without a repo):
// diff regressions (guard/route/invariant lost, blast radius grown) + static findings
// the candidate has that the baseline did not — the same composition `review` proved
// out (ADR-030), pointed at the baseline instead of a git ref. `unparsed` (the set of
// files that failed to parse in the candidate) splits the diff removals into real
// regressions vs in-progress edits whose baseline route lives in a now-broken file.
export function gateDelta(baseline, candidate, unparsed = new Set()) {
  const baseLoc = new Map((baseline.nodes ?? []).map((n) => [n.id, n.loc?.file]));
  const diff = diffGraphs(baseline, candidate).findings;
  const before = new Set(checkGraph(baseline).findings.map(findingKey));
  const introduced = checkGraph(candidate).findings.filter(
    (f) => !before.has(findingKey(f)),
  );
  const seen = new Set(diff.map(findingKey));
  const all = [...diff, ...introduced.filter((f) => !seen.has(findingKey(f)))];

  const findings = [];
  const abstained = [];
  for (const f of all) {
    if (REMOVAL_RULES.has(f.rule) && unparsed.has(baseLoc.get(f.entrypoint)))
      abstained.push(f);
    else findings.push(f);
  }
  return {
    findings,
    blocking: findings.filter((f) => BLOCKING.has(f.severity)),
    abstained,
  };
}

function locOf(canonical, f) {
  const loc = canonical.nodes.find((n) => n.id === f.entrypoint)?.loc;
  return loc ? ` (${loc.file}:${loc.line || 1})` : '';
}

// Per-rule remediation the AGENT reads and acts on. The gate's whole value in the edit
// loop is self-heal: the agent gets exact, imperative feedback on stderr and fixes it in
// the same turn. A regression message that only says WHAT broke (not HOW to fix) makes the
// agent guess; naming the fix closes the loop. Each hint also names the honest escape hatch
// (`--arm`) for when the change was intentional, so an intended refactor is never a dead end.
const REMEDIATION = {
  GUARD_REMOVED:
    'restore the guard/auth that protected this route in the baseline — or, if the route is now intentionally public, re-arm',
  ENTRYPOINT_REMOVED:
    'restore this route if the removal was unintentional; if it was renamed or removed on purpose, re-arm',
  INVARIANT_REMOVED:
    'restore the removed constraint on this table — or, if the schema change is intended, re-arm',
  BLAST_RADIUS_GREW:
    'scope this write so it only touches its own aggregate, or confirm the wider write is intended and re-arm',
};
// A finding always resolves to actionable text: its own rule hint, or a safe generic fallback
// (never an empty string — the agent must always know its next move).
export function remediationFor(finding) {
  return (
    REMEDIATION[finding.rule] ??
    'review this change against the baseline; if intended, re-arm with `sparda gate --arm`'
  );
}

export async function runGate(opts) {
  const t0 = process.hrtime.bigint();
  const hook = opts.hook;
  // in hook mode stdout belongs to nobody and stderr is what the agent reads
  const say = hook ? (s) => console.error(s) : (s) => console.log(s);

  const baselinePath = path.join(opts.cwd, '.sparda', 'ubg.baseline.json');

  // A tree that does not compile at all (broken entry / detection throw) has no
  // behavior to judge. Abstain instead of crashing the hook — the agent is mid-edit.
  let graph, report;
  try {
    ({ graph, report } = compileUBG(opts.cwd, { write: false }));
  } catch (err) {
    if (opts.json)
      console.log(JSON.stringify({ ok: true, abstained: err.message }, null, 2));
    else if (!hook)
      say(
        `⏳ GATE ABSTAINED — the tree does not compile yet (${err.message}). Fix it, then re-check.`,
      );
    return { armed: false, findings: [], abstained: true };
  }
  const candidate = canonicalizeGraph(graph);
  const unparsed = unparsedFiles(report);

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
  const { findings, blocking, abstained } = gateDelta(baseline, candidate, unparsed);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: blocking.length === 0,
          ms: Math.round(ms),
          findings: findings.map((f) => ({ ...f, fix: remediationFor(f) })),
          abstained: abstained.map((f) => f.entrypoint),
        },
        null,
        2,
      ),
    );
    if (blocking.length) process.exitCode = 1;
    return { armed: false, findings };
  }

  // Abstention notice: a route vanished only because its file doesn't parse yet.
  // Never blocking — this is the normal mid-edit state, not a regression.
  if (abstained.length) {
    const files = [...new Set([...unparsed])].join(', ');
    say(
      `⏳ GATE HELD — ${abstained.length} route(s) can't be proven while ${files} doesn't parse (mid-edit?). Not a regression; I'll re-check once it parses.`,
    );
  }

  if (findings.length === 0) {
    if (!hook && !abstained.length)
      say(
        `✓ GATE CLEAN — this edit lost no guard, dropped no route, grew no blast radius (proven vs baseline in ${Math.round(ms)} ms).`,
      );
    return { armed: false, findings };
  }

  say(
    `✗ SPARDA GATE — this edit changed the app's proven behavior (${Math.round(ms)} ms, deterministic):`,
  );
  for (const f of findings) {
    say(`  [${f.severity}] ${f.rule} — ${f.message}${locOf(candidate, f)}`);
    say(`      ↳ fix: ${remediationFor(f)}`);
  }
  say(
    blocking.length
      ? `  → fix the edit or, if intended, accept it with \`sparda gate --arm\`.`
      : `  → advisory only (no critical/high regression) — review, then \`sparda gate --arm\` if intended.`,
  );

  if (blocking.length) process.exitCode = hook ? 2 : 1;
  return { armed: false, findings };
}
