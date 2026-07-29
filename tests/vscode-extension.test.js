// vscode-extension.test.js — the editor bridge, tested without an editor.
//
// A VS Code extension is normally testable only by launching Electron, which is why most of them
// are not tested at all — and why `extensions/vscode/` shipped a stub to the Marketplace under a
// real publisher account before anything noticed. So the extension is split the way the release
// gate was: every DECISION lives in `src/lib.cjs`, pure, and `extension.cjs` is glue that
// requires `vscode` and does nothing a test would want to assert.
//
// Two properties are pinned here, and the second matters more than any feature:
//   1. a finding is never DROPPED on its way to the Problems panel, even unlocatable;
//   2. the editor may never show a verdict it did not obtain.
// SPARDA's whole argument is that "we could not measure" and "we measured nothing wrong" are
// different states. A status bar that goes quiet, or calm, when the CLI is missing would break
// that argument in the most visible pixel the product owns.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const {
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
  ENFORCEABLE,
} = require(path.join(here, '..', 'extensions', 'vscode', 'src', 'lib.cjs'));

const PROVEN = {
  app: 'shop',
  verdict: 'PROVEN',
  routes: 12,
  guards: 9,
  guardsVerified: 9,
  coverage: 0.94,
  blindSpots: 2,
  blindHigh: 0,
  premise: { verified: true, oracle: 'convention', probed: 12, gaps: 0 },
  findings: [],
  counts: { critical: 0, high: 0, medium: 0, info: 0 },
  seal: 'seal_abc',
};

describe('which binary gets run — never a bare global', () => {
  it('an explicit setting always wins, arguments included', () => {
    expect(resolveCli('/w', 'npx sparda-mcp', () => true)).toEqual({
      command: 'npx',
      args: ['sparda-mcp'],
      source: 'setting',
    });
  });

  it('otherwise the workspace’s own pinned binary', () => {
    // The version that PROVES the code must be the version the project pinned. A global install
    // could be any release, and would silently change verdicts between two machines looking at
    // the same commit — the one thing a determinism claim cannot survive.
    const got = resolveCli('/w', '', (p) =>
      p.includes(path.join('node_modules', '.bin')),
    );
    expect(got.source).toBe('workspace');
    expect(got.command).toContain(path.join('node_modules', '.bin'));
  });

  it('and npx only with --no-install, so a missing package is an ERROR', () => {
    // Without --no-install, npx silently downloads a package from the network on first audit.
    // That is a different program than the one the project pinned, fetched without asking, to
    // produce a security verdict.
    expect(resolveCli('/w', '', () => false)).toEqual({
      command: 'npx',
      args: ['--no-install', 'sparda-mcp'],
      source: 'npx',
    });
  });
});

describe('reading the CLI — stdout is data, and unreadable data is not a pass', () => {
  it('parses the payload, even behind a banner on stdout', () => {
    const got = parseJson(`some noise\n${JSON.stringify(PROVEN)}`);
    expect(got.ok).toBe(true);
    expect(got.json.verdict).toBe('PROVEN');
  });

  it('empty output is a failure, not an empty verdict', () => {
    expect(parseJson('')).toEqual({ ok: false, reason: 'no JSON on stdout' });
  });

  it('malformed JSON is a failure, with the reason kept', () => {
    const got = parseJson('{ "verdict": ');
    expect(got.ok).toBe(false);
    expect(got.reason).toMatch(/unreadable JSON/);
  });
});

describe('what the status bar is allowed to say', () => {
  it('a real verdict is shown with its coverage', () => {
    const view = presentationOf({ ok: true, json: PROVEN });
    expect(view.state).toBe('PROVEN');
    expect(view.text).toContain('PROVEN');
    expect(view.text).toContain('94%');
    expect(view.tone).toBe('ok');
  });

  it('an ENFORCED proof discloses itself, never a bare PROVEN', () => {
    // Same rule the CLI already obeys: a proof resting on a SPARDA-synthesized check says so.
    // The status bar is the LAST place that disclosure may be dropped for brevity.
    const view = presentationOf({ ok: true, json: { ...PROVEN, enforced: true } });
    expect(view.state).toBe('PROVEN (ENFORCED)');
  });

  it('NOT having measured reads UNKNOWN, and UNKNOWN is never the calm tone', () => {
    const cases = [
      null,
      { ok: false, reason: 'cancelled' },
      { ok: true, json: { routes: 3 } }, // parsed fine, carried no verdict
    ];
    for (const result of cases) {
      const view = presentationOf(result);
      expect(view.state).toBe('UNKNOWN');
      expect(view.tone).not.toBe('ok');
      expect(view.tooltip).toMatch(/NOT a passing result/);
    }
  });

  it('the reason a measurement failed is carried, never just "unknown"', () => {
    const view = presentationOf({
      ok: false,
      reason: 'sparda-mcp is not installed here',
    });
    expect(view.tooltip).toContain('sparda-mcp is not installed here');
  });

  it('an unverified premise is surfaced above the findings', () => {
    // A premise gap means the route table SPARDA proved over may not be the one the app serves
    // — louder than any individual finding, so it must reach the tooltip.
    const view = presentationOf({
      ok: true,
      json: {
        ...PROVEN,
        verdict: 'PREMISE_GAP',
        premise: { verified: false, reason: 'no oracle' },
      },
    });
    expect(view.tone).toBe('error');
    expect(view.tooltip).toMatch(/premise NOT verified/);
  });

  it('every verdict word the CLI can emit has a presentation', () => {
    // If `verdictState` grows an eighth word, it must not silently render as UNKNOWN — that
    // would report a real verdict as an unmeasured one, quietly, which is the exact inversion
    // this file exists to forbid.
    for (const word of [
      'PROVEN',
      'PARTIAL',
      'RISKY',
      'SURFACE',
      'NO_PROOF',
      'PREMISE_GAP',
      'NOT_PROVEN',
    ]) {
      const view = presentationOf({ ok: true, json: { ...PROVEN, verdict: word } });
      expect(view.state).toBe(word);
      expect(view.text).toContain(word);
    }
  });

  it('verdictSummary renders coverage as a percentage', () => {
    const s = verdictSummary({ verdict: 'PARTIAL', routes: 12, coverage: 0.78 });
    expect(s.verdict).toBe('PARTIAL');
    expect(s.detail).toBe('PARTIAL · 12 routes · coverage 78%');
  });
});

describe('the manifest cannot advertise a command nothing implements', () => {
  // The failure this pins actually shipped. `extensions/vscode/` went to the Marketplace under
  // a real publisher account with ONE command whose whole body was
  // `showInformationMessage('Audit command triggered! (Integration pending)')`. An outside
  // reviewer read the manifest, read the source, and correctly called it a placeholder.
  //
  // Nothing could have caught it: the stub was syntactically fine, the suite was green, and the
  // gate checks the extension's VERSION, not whether it does anything. So the check is here —
  // the contributed commands and the registered handlers must be the same set.
  const ext = JSON.parse(
    fs.readFileSync(
      path.join(here, '..', 'extensions', 'vscode', 'package.json'),
      'utf8',
    ),
  );
  const source = fs.readFileSync(
    path.join(here, '..', 'extensions', 'vscode', 'src', 'extension.cjs'),
    'utf8',
  );
  const contributed = ext.contributes.commands.map((c) => c.command).sort();
  const registered = [...source.matchAll(/registerCommand\(\s*'([^']+)'/g)]
    .map((m) => m[1])
    .sort();

  it('every contributed command is registered, and vice versa', () => {
    expect(registered).toEqual(contributed);
  });

  it('the entry point the manifest names actually exists', () => {
    expect(fs.existsSync(path.join(here, '..', 'extensions', 'vscode', ext.main))).toBe(
      true,
    );
  });

  it('no command body is a placeholder', () => {
    // The literal string that shipped, plus its family. A command that announces its own
    // absence is worse than a missing command: it spends the user's trust to say nothing.
    expect(source).not.toMatch(/Integration pending|not implemented|coming soon|TODO:/i);
  });

  it('the extension actually invokes the CLI', () => {
    // The one behaviour that distinguishes this extension from a dialog box.
    expect(source).toMatch(/spawn\(/);
    expect(source).toMatch(/'prove', '--json'/);
  });
});

describe('the one failure the user can fix in a click', () => {
  const NPX = { command: 'npx', args: ['--no-install', 'sparda-mcp'], source: 'npx' };

  it('a missing CLI is recognised — and only when we fell through to npx', () => {
    expect(
      isCliMissing({ ok: false, reason: 'sparda-mcp is not installed here' }, NPX),
    ).toBe(true);
  });

  it('a CONFIGURED command that fails is NOT "install the CLI"', () => {
    // The dangerous case, and the exact message extension.cjs produces for it: the user pointed
    // `sparda.command` at a path that does not exist, so the spawn fails with ENOENT — the same
    // word an absent CLI produces. Installing sparda-mcp would NOT fix their setting, so the
    // remedy has to be decided by WHERE we were pointed, not by what the error said.
    const configured = { command: '/opt/sparda', args: [], source: 'setting' };
    for (const reason of [
      'could not start /opt/sparda — spawn ENOENT',
      '/opt/sparda failed to start',
      'sparda-mcp is not installed here',
    ]) {
      expect(isCliMissing({ ok: false, reason }, configured)).toBe(false);
    }
    // A workspace binary that vanishes mid-session is the same shape: we found it once, so the
    // answer is not "install it" — something removed it, and saying so is the honest report.
    const workspace = {
      command: '/w/node_modules/.bin/sparda',
      args: [],
      source: 'workspace',
    };
    expect(isCliMissing({ ok: false, reason: 'spawn ENOENT' }, workspace)).toBe(false);
  });

  it('and neither is an unrelated crash', () => {
    // A button offering the wrong remedy is a wrong answer delivered with more confidence than
    // a plain error message. Only failures that actually mean "absent" earn it.
    expect(
      isCliMissing({ ok: false, reason: 'unreadable JSON — Unexpected token' }, NPX),
    ).toBe(false);
    expect(isCliMissing({ ok: false, reason: 'cancelled' }, NPX)).toBe(false);
    expect(isCliMissing({ ok: true, json: { verdict: 'PROVEN' } }, NPX)).toBe(false);
  });

  it('the install line comes from the lockfile, never a guess', () => {
    // `npm i` inside a pnpm workspace creates a second, divergent node_modules and the user
    // ends up debugging a tree they never asked for.
    expect(installCommandFor((f) => f === 'pnpm-lock.yaml').cmd).toBe(
      'pnpm add -D sparda-mcp',
    );
    expect(installCommandFor((f) => f === 'yarn.lock').cmd).toBe(
      'yarn add -D sparda-mcp',
    );
    expect(installCommandFor((f) => f === 'bun.lockb').cmd).toBe('bun add -d sparda-mcp');
    expect(installCommandFor((f) => f === 'package-lock.json').cmd).toBe(
      'npm i -D sparda-mcp',
    );
  });

  it('no lockfile falls back to npm, and says it was a fallback', () => {
    const got = installCommandFor(() => false);
    expect(got.cmd).toBe('npm i -D sparda-mcp');
    expect(got.from).toBeNull(); // the caller can tell the user this was a default
  });

  it('every install is a DEV dependency, never global, never a bare install', () => {
    // The version that proves the code must be the version the project pinned. A global
    // install would silently change verdicts between two machines on the same commit.
    for (const exists of [
      () => true,
      () => false,
      (f) => f === 'pnpm-lock.yaml',
      (f) => f === 'yarn.lock',
    ]) {
      const { cmd } = installCommandFor(exists);
      expect(cmd).toMatch(/\s-D\s|\s-d\s/);
      expect(cmd).not.toMatch(/\s-g\b|--global/);
      expect(cmd).toContain('sparda-mcp');
    }
  });
});

describe('the status bar offers what THIS state needs', () => {
  it('a missing CLI puts install first — the only thing that unblocks anything', () => {
    const items = quickPickFor(null, true);
    expect(items[0].command).toBe('sparda.install');
  });

  it('hard findings put the Problems panel first', () => {
    const items = quickPickFor(
      { ok: true, json: { counts: { critical: 2, high: 1 } } },
      false,
    );
    expect(items[0].command).toBe('sparda.openProblems');
  });

  it('a clean verdict offers to re-prove, and never offers install', () => {
    const items = quickPickFor({ ok: true, json: { counts: {} } }, false);
    expect(items[0].command).toBe('sparda.prove');
    expect(items.map((i) => i.command)).not.toContain('sparda.install');
  });

  it('every item names a command the extension registers', () => {
    const source = fs.readFileSync(
      path.join(here, '..', 'extensions', 'vscode', 'src', 'extension.cjs'),
      'utf8',
    );
    const registered = new Set(
      [...source.matchAll(/registerCommand\(\s*'([^']+)'/g)].map((m) => m[1]),
    );
    for (const state of [
      [null, true],
      [{ ok: true, json: { counts: { critical: 1 } } }, false],
      [{ ok: true, json: { counts: {} } }, false],
    ]) {
      for (const item of quickPickFor(...state)) {
        expect(registered.has(item.command)).toBe(true);
      }
    }
  });
});

describe('the lightbulb never implies a mechanical fix (ADR-090)', () => {
  it('a finding offers to EXPLAIN, always', () => {
    expect(codeActionsFor('OBJECT_SCOPE_UNPROVEN').map((a) => a.command)).toContain(
      'sparda.explain',
    );
  });

  it('no action claims to fix, repair, or silence a finding', () => {
    // A SPARDA finding says an authorization decision is MISSING. That decision belongs to a
    // human who knows who may touch what. A lightbulb implying a mechanical repair invites the
    // one edit that must never be easy: silencing the finding instead of closing the hole —
    // after which SPARDA would read PROVEN over a real hole, through its own UI.
    for (const rule of ['UNGUARDED_MUTATION', 'OBJECT_SCOPE_UNPROVEN', 'ANYTHING']) {
      for (const a of codeActionsFor(rule)) {
        expect(a.title).not.toMatch(/\bfix\b|repair|resolve|suppress|ignore|dismiss/i);
      }
    }
  });

  it('the only write-adjacent action is `enforce`, and it is a DRY RUN', () => {
    // `sparda enforce` is the one "fix" that cannot lie: it recompiles and keeps the edit ONLY
    // if the app then proves PROVEN, reverting byte-for-byte otherwise (ADR-076). Even so, the
    // lightbulb only PLANS — a code action that edits on click, in a security tool, would be
    // indefensible.
    const [, enforce] = codeActionsFor('UNGUARDED_MUTATION');
    expect(enforce.command).toBe('sparda.enforce');
    expect(enforce.title).toMatch(/dry run/i);
  });

  it('and it is offered only where a boundary check is even meaningful', () => {
    // An ownership finding is not closed by "deny anonymous callers" — the caller is
    // authenticated and still must not touch that object. Offering enforce there would propose
    // a check that cannot fix the problem it is attached to.
    expect(codeActionsFor('OBJECT_SCOPE_UNPROVEN').map((a) => a.command)).not.toContain(
      'sparda.enforce',
    );
    expect(ENFORCEABLE.has('UNGUARDED_MUTATION')).toBe(true);
  });
});

describe('findings on their way to the Problems panel', () => {
  it('locOfEvidence prefers the trailing (file:line)', () => {
    expect(locOfEvidence('effect:db_read:src/app.js:24:0 (src/app.js:24)')).toEqual({
      file: 'src/app.js',
      line: 24,
    });
  });

  it('locOfEvidence falls back to a bare path:line, and abstains when nothing is locatable', () => {
    expect(locOfEvidence('some effect at src/x.ts:9 inside')).toEqual({
      file: 'src/x.ts',
      line: 9,
    });
    expect(locOfEvidence('no location here')).toBeNull();
  });

  it('findingsToDiagnostics maps severity and extracts the location', () => {
    const apoc = {
      findings: [
        {
          rule: 'UNGUARDED_MUTATION',
          severity: 'critical',
          message: 'unguarded write',
          evidence: ['effect:db_write:src/app.js:42:0 (src/app.js:42)'],
        },
      ],
    };
    expect(findingsToDiagnostics(apoc)).toEqual([
      {
        file: 'src/app.js',
        line: 42,
        severity: 'error',
        rule: 'UNGUARDED_MUTATION',
        message: 'unguarded write',
      },
    ]);
  });

  it('never drops a finding with no locatable evidence (file=null, line=1)', () => {
    // Direction 1's discipline, one layer out: a finding SPARDA cannot place is still a finding.
    // Silently omitting it because the UI has nowhere pretty to put it is the same failure as
    // dropping an effect because the analyser could not resolve it.
    const d = findingsToDiagnostics({
      findings: [{ rule: 'X', severity: 'info', message: 'no loc', evidence: [] }],
    });
    expect(d).toHaveLength(1);
    expect(d[0].file).toBeNull();
    expect(d[0].line).toBe(1);
    expect(d[0].severity).toBe('information');
  });
});
