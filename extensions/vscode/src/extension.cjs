'use strict';
// SPARDA VS Code extension — brings the trust verdict into the editor. It shells out to the
// SPARDA CLI; it ships NO copy of the engine and has zero runtime deps, so its verdict can never
// drift from the CLI's. The parsing lives in lib.cjs (pure, tested in the ordinary suite).
//
// Three constraints shape everything below:
//
//   1. NEVER BLOCK THE EDITOR. `spawn`, never `execSync`. A monorepo takes seconds to compile
//      (twenty: ~4 s), and a frozen editor is how a background tool gets uninstalled.
//   2. stdout is DATA, stderr is LOGS — the project's hard rule 2, honoured from this side:
//      stdout is parsed, stderr is streamed to the output channel for humans.
//   3. AN ANALYSIS THAT DID NOT RUN IS NOT A CLEAN ANALYSIS. Every failure path shows UNKNOWN
//      with its reason, and UNKNOWN is never the calm colour. A trust layer whose own status bar
//      can over-claim has lost the argument in the most visible pixel it owns.
const vscode = require('vscode');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  resolveCli,
  parseJson,
  presentationOf,
  findingsToDiagnostics,
  isCliMissing,
  installCommandFor,
  quickPickFor,
  codeActionsFor,
} = require('./lib.cjs');

let status, diag, out;
/** The last result, so the status-bar menu can offer what THIS state needs. */
let lastResult = null;
let lastCliMissing = false;
/** Single-flight per command, so a save-storm cannot fork ten compilers. */
const running = new Map();

function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : null;
}

function cliFor(root) {
  const configured = String(
    vscode.workspace.getConfiguration('sparda').get('command') || '',
  ).trim();
  return resolveCli(root, configured, (p) => fs.existsSync(p));
}

// Spawn the CLI and resolve to lib.cjs's parse result. NEVER rejects: a spawn failure, a
// non-zero exit and a cancellation are all ANSWERS this layer must render, not exceptions to
// leak into a promise nobody awaits.
function runCli(cli, args, cwd, token) {
  return new Promise((resolve) => {
    const argv = cli.args.concat(args);
    let child;
    try {
      child = cp.spawn(cli.command, argv, { cwd, shell: false });
    } catch (err) {
      resolve({
        ok: false,
        reason: 'could not start ' + cli.command + ' — ' + err.message,
      });
      return;
    }
    let stdout = '';
    out.appendLine(
      '\n$ ' + cli.command + ' ' + argv.join(' ') + '   (' + cli.source + ')',
    );
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => out.append(b.toString()));
    if (token)
      token.onCancellationRequested(() => {
        child.kill();
        resolve({ ok: false, reason: 'cancelled' });
      });
    child.on('error', () =>
      resolve({
        ok: false,
        reason:
          cli.source === 'npx'
            ? 'sparda-mcp is not installed here (npm i -D sparda-mcp), and no sparda.command is set'
            : cli.command + ' failed to start',
      }),
    );
    // `prove` and `apocalypse` exit non-zero to GATE — that is a verdict, not a crash. The exit
    // code is only fatal when there is no readable JSON to go with it.
    child.on('close', (code) => {
      const parsed = parseJson(stdout);
      resolve(
        parsed.ok
          ? parsed
          : { ok: false, reason: parsed.reason + ' (exit ' + code + ')' },
      );
    });
  });
}

// One place where a command becomes a run: root check, single-flight, progress, cancellation.
async function withCli(key, args, handler) {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage('SPARDA: open a folder first.');
    return null;
  }
  if (running.get(key)) {
    out.show(true);
    return null; // already measuring — a second click is not a second question
  }
  running.set(key, true);
  try {
    const cli = cliFor(root);
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'SPARDA', cancellable: true },
      (_p, token) => runCli(cli, args, root, token),
    );
    return handler(result, root);
  } finally {
    running.delete(key);
  }
}

function render(result) {
  const view = presentationOf(result);
  status.text = view.text;
  status.tooltip = view.tooltip;
  // Only two background colours exist in the API (warning, error). A PROVEN bar is deliberately
  // plain: the absence of alarm IS the signal, and painting it green would put SPARDA's most
  // emphatic pixel on its least defensible claim.
  status.backgroundColor =
    view.tone === 'error'
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : view.tone === 'warn' || view.tone === 'unknown'
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
}

function prove() {
  status.text = '$(sync~spin) SPARDA: proving…';
  return withCli('prove', ['prove', '--json'], (result, root) => {
    lastResult = result;
    lastCliMissing = isCliMissing(result, cliFor(root));
    render(result);
    if (!result.ok) {
      // A failed measurement is surfaced, not swallowed: the user asked a question and did not
      // get an answer, and the status bar alone is too quiet to say so.
      out.appendLine('✗ no verdict — ' + result.reason);
      // The CLI being absent is the one failure the user can fix in a click, so it gets a
      // button. Every other failure gets the honest report and nothing else — offering
      // "Install sparda-mcp" for an unrelated crash is a wrong answer delivered with a button.
      const actions = lastCliMissing
        ? ['Install sparda-mcp', 'Show output']
        : ['Show output'];
      const message = lastCliMissing
        ? 'SPARDA: the CLI is not installed in this workspace. The extension is a thin bridge — it ships no engine, so its verdict can never drift from the CLI’s.'
        : 'SPARDA could not measure this workspace: ' + result.reason;
      vscode.window.showErrorMessage(message, ...actions).then((pick) => {
        if (pick === 'Install sparda-mcp') installCli();
        else if (pick === 'Show output') out.show(true);
      });
      return;
    }
    const s = result.json;
    out.appendLine(
      s.app + ': ' + s.verdict + ' · ' + s.routes + ' route(s) · seal ' + s.seal,
    );
    vscode.window.showInformationMessage(
      'SPARDA · ' + presentationOf(result).tooltip.split('\n')[1],
    );
  });
}

function apocalypse() {
  return withCli('apocalypse', ['apocalypse', '--json'], (result, root) => {
    if (!result.ok) {
      // The Problems panel is NOT cleared on a failed run. Wiping it would turn "we could not
      // measure" into a clean bill of health in the one place a developer trusts by habit.
      out.appendLine(
        '✗ no findings read — ' + result.reason + ' (Problems panel left as-is)',
      );
      vscode.window
        .showErrorMessage(
          'SPARDA: apocalypse did not run — ' + result.reason,
          'Show output',
        )
        .then((pick) => pick && out.show(true));
      return;
    }
    diag.clear();
    const byFile = new Map();
    for (const d of findingsToDiagnostics(result.json)) {
      const rel = d.file || '.';
      const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
      const line = Math.max(0, d.line - 1);
      const sev =
        d.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : d.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;
      const item = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, 500),
        '[' + d.rule + '] ' + d.message,
        sev,
      );
      item.source = 'SPARDA';
      if (!byFile.has(abs)) byFile.set(abs, []);
      byFile.get(abs).push(item);
    }
    for (const entry of byFile) diag.set(vscode.Uri.file(entry[0]), entry[1]);
    const n = (result.json.findings || []).length;
    vscode.window.showInformationMessage(
      'SPARDA apocalypse: ' + n + ' finding(s) — see the Problems panel.',
    );
  });
}

function gateArm() {
  return withCli('gate', ['gate', '--arm'], (result) => {
    if (!result.ok && result.reason === 'cancelled') return;
    vscode.window.showInformationMessage(
      'SPARDA gate armed — this graph is now the baseline every edit is proven against.',
    );
  });
}

function installClaudeHook() {
  return withCli('claude', ['gate', '--install-claude'], () =>
    vscode.window.showInformationMessage(
      'SPARDA gate installed into Claude Code (PostToolUse).',
    ),
  );
}

// --- installing the CLI ----------------------------------------------------------------------
//
// In a TERMINAL the user can see, never a background `npm install`. Two reasons, and the second
// is the one that matters:
//
//   1. an install can prompt, fail, or take a minute — all of which are unreadable from a
//      spinner and obvious in a terminal;
//   2. this extension's entire job is to be trustworthy about what runs. A security tool that
//      silently downloads and executes a package because a button was clicked has borrowed the
//      exact habit it exists to argue against. The command is shown, the user can read it, stop
//      it, or copy it elsewhere.
//
// The package manager comes from the lockfile on disk, not from a guess: `npm i` inside a pnpm
// workspace creates a second, divergent node_modules and the user ends up debugging a tree they
// never asked for.
function installCli() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage('SPARDA: open a folder first.');
    return;
  }
  const { cmd, from } = installCommandFor((f) => fs.existsSync(path.join(root, f)));
  out.appendLine(
    '\n$ ' +
      cmd +
      (from ? '   (package manager read from ' + from + ')' : '   (no lockfile — npm)'),
  );
  const term = vscode.window.createTerminal({ name: 'SPARDA — install', cwd: root });
  term.show(true);
  term.sendText(cmd);

  // Re-prove when the binary APPEARS, rather than after a guessed delay. We cannot know when the
  // install finished — the terminal is the user's, not ours — so we watch for the one artefact
  // that means it worked. Fires once, then disposes: a watcher left alive would re-prove on
  // every future install in the workspace.
  const pattern = new vscode.RelativePattern(root, 'node_modules/.bin/sparda*');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, true, true);
  const done = watcher.onDidCreate(() => {
    done.dispose();
    watcher.dispose();
    vscode.window.showInformationMessage(
      'SPARDA: CLI installed — proving the workspace.',
    );
    prove();
  });
  // Bounded: if the install is abandoned, the watcher must not outlive the intent.
  setTimeout(
    () => {
      done.dispose();
      watcher.dispose();
    },
    10 * 60 * 1000,
  );
}

// The status bar's click. A fixed target would be wrong — what the user needs depends on what
// the bar is currently saying — so the menu is built from the last result, with the useful item
// first (install when the CLI is missing, Problems when findings stand, prove otherwise).
async function statusMenu() {
  const items = quickPickFor(lastResult, lastCliMissing);
  const pick = await vscode.window.showQuickPick(items, {
    title: 'SPARDA',
    placeHolder: presentationOf(lastResult).state,
  });
  if (pick) vscode.commands.executeCommand(pick.command);
}

// --- the lightbulb on a finding ---------------------------------------------------------------
//
// See lib.cjs `codeActionsFor` and ADR-090 for why there is no "fix this" action here. In short:
// a SPARDA finding says an authorization decision is MISSING, that decision belongs to a human,
// and a lightbulb implying a mechanical repair invites the one edit that must never be easy —
// silencing the finding instead of closing the hole.
const codeActions = {
  provideCodeActions(document, range, ctx) {
    const out_ = [];
    for (const d of ctx.diagnostics) {
      if (d.source !== 'SPARDA') continue;
      const rule = (String(d.message).match(/^\[([A-Z_]+)\]/) || [])[1] || '';
      for (const a of codeActionsFor(rule)) {
        const action = new vscode.CodeAction(a.title, vscode.CodeActionKind.QuickFix);
        action.command = { command: a.command, title: a.title, arguments: [rule, d] };
        action.diagnostics = [d];
        // `isPreferred` would put it on the default lightbulb keystroke. Deliberately not set:
        // nothing here repairs anything, and a preferred action reads as "the fix".
        out_.push(action);
      }
    }
    return out_;
  },
};

function explainFinding(rule, d) {
  out.show(true);
  out.appendLine(
    '\n── ' +
      (rule || 'FINDING') +
      (d && d.message ? ' — ' + d.message : '') +
      '\n' +
      '   SPARDA flags this because it could not prove the mutation is dominated by a guard it\n' +
      '   saw deny. Run “SPARDA: Apocalypse” for the full evidence chain, or “Prove workspace”\n' +
      '   after your change to see whether the finding clears.\n' +
      '   It will clear only if the recompiled graph says so — never because the code moved.',
  );
}

function enforcePlan() {
  // Dry run, always. `sparda enforce` writes nothing without --apply, and a lightbulb that edits
  // code on click, in a security tool, would be indefensible. The user reads the plan and runs
  // the apply themselves.
  return withCli('enforce', ['enforce'], (result) => {
    out.show(true);
    if (!result.ok) out.appendLine('✗ enforce could not plan — ' + result.reason);
  });
}

function activate(context) {
  out = vscode.window.createOutputChannel('SPARDA');
  diag = vscode.languages.createDiagnosticCollection('sparda');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'sparda.statusMenu'; // the click offers what THIS state needs, not one action
  render(null); // UNKNOWN until something is measured — never a blank, optimistic bar
  status.show();
  context.subscriptions.push(
    out,
    diag,
    status,
    vscode.commands.registerCommand('sparda.prove', prove),
    vscode.commands.registerCommand('sparda.apocalypse', apocalypse),
    vscode.commands.registerCommand('sparda.gate.arm', gateArm),
    vscode.commands.registerCommand('sparda.installClaudeHook', installClaudeHook),
    vscode.commands.registerCommand('sparda.showOutput', () => out.show(true)),
    vscode.commands.registerCommand('sparda.install', installCli),
    vscode.commands.registerCommand('sparda.statusMenu', statusMenu),
    vscode.commands.registerCommand('sparda.explain', explainFinding),
    vscode.commands.registerCommand('sparda.enforce', enforcePlan),
    vscode.commands.registerCommand('sparda.openProblems', () =>
      vscode.commands.executeCommand('workbench.actions.view.problems'),
    ),
    // The lightbulb, on every language SPARDA can analyse.
    vscode.languages.registerCodeActionsProvider(
      [
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'python' },
      ],
      codeActions,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
  // A workspace already carrying `sparda.json` has opted in: measure it once, so the first
  // thing shown is the truth about the repo rather than an invitation to click.
  const root = workspaceRoot();
  if (root && fs.existsSync(path.join(root, 'sparda.json'))) prove();
}

function deactivate() {}

module.exports = { activate, deactivate };
