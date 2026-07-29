'use strict';
// Pure helpers for the SPARDA VS Code extension — deliberately NO `vscode` require, so they are
// unit-testable outside the editor host (see tests/vscode-extension.test.js). extension.cjs maps
// these into vscode.Diagnostic objects and status-bar text and does nothing else.
//
// A module that requires `vscode` can only run inside Electron, so anything living in it is
// testable only by launching an editor — which means, in practice, not tested. That is why the
// split exists, and it is the same argument that put the release gate's decisions in
// `scripts/release-checks.mjs`.

const path = require('node:path');

// --- which binary gets run ----------------------------------------------------------------
// Never a bare global `sparda` on PATH: the version that PROVES the code must be the version the
// project pinned, or the user must have said which one. A global install could be any release,
// and would silently change verdicts between two machines looking at the same commit — the one
// thing a determinism claim cannot survive.
//
//   1. the `sparda.command` setting          — explicit wins, always
//   2. the workspace's own node_modules/.bin — the pinned version, the normal case
//   3. `npx --no-install sparda-mcp`         — --no-install so a missing package is an ERROR,
//                                              never a silent background download of a different
//                                              program, fetched without asking, to produce a
//                                              security verdict
function resolveCli(root, configured, exists) {
  if (configured) {
    const parts = String(configured).trim().split(/\s+/);
    return { command: parts[0], args: parts.slice(1), source: 'setting' };
  }
  const local = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'sparda.cmd' : 'sparda',
  );
  if (exists(local)) return { command: local, args: [], source: 'workspace' };
  return { command: 'npx', args: ['--no-install', 'sparda-mcp'], source: 'npx' };
}

// --- reading the CLI ----------------------------------------------------------------------
// stdout is the DATA channel (the project's hard rule 2, mirrored on this side of the pipe), so
// a plain parse is nearly safe — but a banner ahead of the JSON must not turn a real verdict
// into a crash, and anything unreadable is a measurement we did NOT get, which says so.
function parseJson(stdout) {
  const text = String(stdout == null ? '' : stdout);
  const start = text.indexOf('{');
  if (start === -1) return { ok: false, reason: 'no JSON on stdout' };
  try {
    const json = JSON.parse(text.slice(start));
    if (!json || typeof json !== 'object')
      return { ok: false, reason: 'stdout was not an object' };
    return { ok: true, json };
  } catch (err) {
    return { ok: false, reason: 'unreadable JSON — ' + err.message };
  }
}

// --- what the status bar is allowed to say -------------------------------------------------
// The seven words `verdictState` can produce, plus the one this layer adds. UNKNOWN is not a
// verdict SPARDA emits: it is what the editor shows when it could not obtain one, and it is
// deliberately not the calm colour — "we could not measure" and "we measured nothing wrong" are
// the two states this whole codebase exists to keep apart.
const PRESENTATION = {
  PROVEN: { icon: '$(pass)', tone: 'ok' },
  PARTIAL: { icon: '$(shield)', tone: 'warn' },
  RISKY: { icon: '$(warning)', tone: 'warn' },
  SURFACE: { icon: '$(question)', tone: 'warn' },
  NO_PROOF: { icon: '$(question)', tone: 'warn' },
  PREMISE_GAP: { icon: '$(alert)', tone: 'error' },
  NOT_PROVEN: { icon: '$(error)', tone: 'error' },
  UNKNOWN: { icon: '$(circle-slash)', tone: 'unknown' },
};

function presentationOf(result) {
  if (!result || !result.ok || !result.json || typeof result.json.verdict !== 'string') {
    const why = result && result.reason ? result.reason : 'not run yet';
    return {
      state: 'UNKNOWN',
      icon: PRESENTATION.UNKNOWN.icon,
      tone: 'unknown',
      text: PRESENTATION.UNKNOWN.icon + ' SPARDA: unknown',
      // The tooltip carries the REASON, because "unknown" with no cause is the kind of silence
      // that gets an honest tool switched off.
      tooltip:
        'SPARDA could not measure this workspace — ' +
        why +
        '.\nThis is NOT a passing result.',
    };
  }
  const s = result.json;
  const state = s.enforced && s.verdict === 'PROVEN' ? 'PROVEN (ENFORCED)' : s.verdict;
  const shape = PRESENTATION[s.verdict] || PRESENTATION.UNKNOWN;
  const pct =
    typeof s.coverage === 'number' ? ' · ' + Math.round(s.coverage * 100) + '%' : '';
  return {
    state: state,
    icon: shape.icon,
    tone: shape.tone,
    text: shape.icon + ' SPARDA: ' + state + pct,
    tooltip: tooltipFor(s, state),
  };
}

function tooltipFor(s, state) {
  const cov = typeof s.coverage === 'number' ? Math.round(s.coverage * 100) + '%' : '—';
  const lines = [
    s.app + ': ' + state,
    (s.routes || 0) +
      ' route(s) · ' +
      (s.guardsVerified || 0) +
      '/' +
      (s.guards || 0) +
      ' guard(s) proven · coverage ' +
      cov,
  ];
  if (s.blindSpots != null)
    lines.push(s.blindSpots + ' blind spot(s), ' + (s.blindHigh || 0) + ' high');
  // A premise that was never verified is louder than any finding: it means the route table
  // SPARDA proved over may not be the one the app actually serves.
  if (s.premise && s.premise.verified === false)
    lines.push('⚠ premise NOT verified — ' + s.premise.reason);
  else if (s.premise && s.premise.gaps > 0)
    lines.push('⚠ ' + s.premise.gaps + ' route(s) served but never compiled');
  const c = s.counts || {};
  if (c.critical || c.high)
    lines.push((c.critical || 0) + ' critical · ' + (c.high || 0) + ' high');
  return lines.join('\n');
}

// One-line status from `sparda prove --json`, kept for callers that want the raw strings.
function verdictSummary(prove) {
  const v = (prove && prove.verdict) || 'UNKNOWN';
  const cov =
    prove && prove.coverage != null ? Math.round(prove.coverage * 100) + '%' : '—';
  return {
    verdict: v,
    label: 'SPARDA: ' + v,
    detail: v + ' · ' + ((prove && prove.routes) || 0) + ' routes · coverage ' + cov,
    counts: (prove && prove.counts) || {},
  };
}

// --- findings to the Problems panel ---------------------------------------------------------
// Extract { file, line } from an apocalypse evidence token such as
// "effect:db_read:src/app.js:24:0 (src/app.js:24)". Prefer the trailing "(file:line)"; fall back
// to the first "path.ext:line" in the token. null when nothing locatable.
function locOfEvidence(ev) {
  if (typeof ev !== 'string') return null;
  const paren = ev.match(/\(([^()]+):(\d+)\)\s*$/);
  if (paren) return { file: paren[1], line: Number(paren[2]) };
  const bare = ev.match(/([^\s:()]+\.(?:[cm]?[jt]s|py)):(\d+)/);
  if (bare) return { file: bare[1], line: Number(bare[2]) };
  return null;
}

const SEVERITY = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  info: 'information',
};

// `sparda apocalypse --json` -> flat diagnostics [{ file, line, severity, rule, message }].
// A finding with no locatable evidence keeps file=null (extension.cjs pins it to the workspace
// root, line 1) — a finding is NEVER dropped just because we couldn't place it precisely.
function findingsToDiagnostics(apoc) {
  const out = [];
  for (const f of (apoc && apoc.findings) || []) {
    const loc = ((f && f.evidence) || []).map(locOfEvidence).find(Boolean);
    out.push({
      file: (loc && loc.file) || null,
      line: (loc && loc.line) || 1,
      severity: SEVERITY[f && f.severity] || 'information',
      rule: (f && f.rule) || 'FINDING',
      message: (f && f.message) || (f && f.rule) || 'SPARDA finding',
    });
  }
  return out;
}

// --- the CLI is missing, and that is a DIFFERENT failure ------------------------------------
// Every other failure ("the analysis crashed", "the JSON was unreadable") is something the user
// can only report. This one they can fix in a click, so it earns its own branch — but only when
// we are sure, because offering "Install sparda-mcp" for an unrelated crash is a wrong answer
// delivered with a button.
//
// The certain case is narrow on purpose: we fell all the way through to `npx --no-install`,
// which means neither an explicit setting nor a workspace binary existed, AND the run failed to
// start or npx reported nothing installed. A configured command that fails is NOT this — the
// user pointed us somewhere, and the honest thing is to say that place did not work.
function isCliMissing(result, cli) {
  if (!result || result.ok) return false;
  if (!cli || cli.source !== 'npx') return false;
  return /not installed|could not (be )?start|ENOENT|npm ERR|could not determine executable/i.test(
    String(result.reason ?? ''),
  );
}

// The install line, in the package manager the workspace actually uses. Getting this wrong is
// not cosmetic: `npm i` inside a pnpm workspace creates a second, divergent node_modules, and
// the user ends up debugging a tree they never asked for. Detected from the lockfile — evidence
// on disk, never a guess.
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm add -D sparda-mcp'],
  ['yarn.lock', 'yarn add -D sparda-mcp'],
  ['bun.lockb', 'bun add -d sparda-mcp'],
  ['package-lock.json', 'npm i -D sparda-mcp'],
];

function installCommandFor(exists) {
  for (const [lock, cmd] of LOCKFILES) if (exists(lock)) return { cmd, from: lock };
  // No lockfile: npm is the safe default — it is the one every Node install ships with.
  return { cmd: 'npm i -D sparda-mcp', from: null };
}

// --- what clicking the status bar offers ----------------------------------------------------
// A fixed target would be wrong: what the user needs depends on what the bar is currently
// saying. UNKNOWN wants the CLI fixed; findings want the Problems panel; a clean verdict wants
// a re-run. The menu is built from the state so the first item is always the useful one.
function quickPickFor(result, cliMissing) {
  const items = [];
  if (cliMissing)
    items.push({
      label: '$(cloud-download) Install sparda-mcp',
      description: 'the CLI this extension reads its verdict from',
      command: 'sparda.install',
    });
  const counts = (result && result.ok && result.json && result.json.counts) || {};
  const hard = (counts.critical || 0) + (counts.high || 0);
  if (hard)
    items.push({
      label: '$(list-flat) Open the Problems panel',
      description: hard + ' finding(s) SPARDA could not discharge',
      command: 'sparda.openProblems',
    });
  items.push(
    {
      label: '$(shield) Prove this workspace',
      description: 'recompile and re-derive the verdict',
      command: 'sparda.prove',
    },
    {
      label: '$(search) Apocalypse — findings to the Problems panel',
      command: 'sparda.apocalypse',
    },
    {
      label: '$(lock) Gate — arm this graph as the baseline',
      description: 'every later edit is proven against it',
      command: 'sparda.gate.arm',
    },
    { label: '$(output) Show the SPARDA output', command: 'sparda.showOutput' },
  );
  return items;
}

// --- what a finding earns in the editor -----------------------------------------------------
// NOT a "fix it" action. A SPARDA finding says an authorization decision is missing, and that
// decision belongs to a human who knows who may touch what — there is no mechanical repair, and
// a lightbulb that implies one invites the single most dangerous edit possible: silencing the
// finding rather than closing the hole. SPARDA would then read PROVEN over a real hole, through
// its own UI. (See ADR-090.)
//
// So the actions offered are EXPLAIN and VERIFY:
//   - explain  — show the evidence chain that produced this finding
//   - enforce  — only for UNGUARDED_MUTATION, and only because `sparda enforce` recompiles and
//                keeps the edit ONLY if the app then proves PROVEN, reverting byte-for-byte
//                otherwise (ADR-076). It is the one "fix" that cannot lie, because it is
//                re-derived after the fact rather than asserted.
const ENFORCEABLE = new Set(['UNGUARDED_MUTATION']);

function codeActionsFor(rule) {
  const actions = [
    {
      title: 'SPARDA: explain this finding',
      command: 'sparda.explain',
      kind: 'quickfix',
    },
  ];
  if (ENFORCEABLE.has(rule))
    actions.push({
      // "(dry run)" is in the title because the command plans by default and writes nothing.
      // A lightbulb that edits code on click, in a security tool, would be indefensible.
      title: 'SPARDA: plan a verified boundary check (dry run)',
      command: 'sparda.enforce',
      kind: 'quickfix',
    });
  return actions;
}

module.exports = {
  resolveCli,
  parseJson,
  presentationOf,
  verdictSummary,
  locOfEvidence,
  findingsToDiagnostics,
  isCliMissing,
  installCommandFor,
  quickPickFor,
  codeActionsFor,
  PRESENTATION,
  ENFORCEABLE,
};
