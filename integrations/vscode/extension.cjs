'use strict';
// SPARDA VS Code extension — brings the trust verdict into the editor. It shells out to the
// SPARDA CLI (`npx sparda-mcp …`); it ships NO copy of the engine and has zero runtime deps, so
// it never drifts from the CLI's verdict. The heavy lifting (parsing) lives in lib.cjs (tested).
const vscode = require('vscode');
const cp = require('node:child_process');
const path = require('node:path');
const { verdictSummary, findingsToDiagnostics } = require('./lib.cjs');

let status, diag, out;

function cliCommand() {
  return (
    vscode.workspace.getConfiguration('sparda').get('command') ||
    'npx --no-install sparda-mcp'
  );
}
function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : null;
}
function runCli(args, cwd) {
  return new Promise((resolve) => {
    cp.exec(
      `${cliCommand()} ${args}`,
      { cwd, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) =>
        resolve({ err, stdout: stdout || '', stderr: stderr || '' }),
    );
  });
}
// the CLI prints ONLY JSON on --json (logs go to stderr), so a plain parse is safe.
function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

async function prove() {
  const root = workspaceRoot();
  if (!root) return vscode.window.showWarningMessage('SPARDA: open a folder first.');
  status.text = '$(sync~spin) SPARDA proving…';
  const { stdout, stderr } = await runCli('prove --json', root);
  const j = parseJson(stdout);
  if (!j) {
    status.text = '$(error) SPARDA: failed';
    out.appendLine(stderr || stdout);
    out.show(true);
    return;
  }
  const s = verdictSummary(j);
  const hard = (j.counts && (j.counts.critical || j.counts.high)) || 0;
  const icon = j.verdict === 'PROVEN' ? '$(pass)' : hard ? '$(error)' : '$(warning)';
  status.text = `${icon} ${s.label}`;
  status.tooltip = s.detail;
  vscode.window.showInformationMessage(`SPARDA · ${s.detail}`);
}

async function apocalypse() {
  const root = workspaceRoot();
  if (!root) return vscode.window.showWarningMessage('SPARDA: open a folder first.');
  const { stdout, stderr } = await runCli('apocalypse --json', root);
  const j = parseJson(stdout);
  diag.clear();
  if (!j) {
    out.appendLine(stderr || stdout);
    out.show(true);
    return;
  }
  const byFile = new Map();
  for (const d of findingsToDiagnostics(j)) {
    const rel = d.file || '.';
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    const line = Math.max(0, d.line - 1);
    const range = new vscode.Range(line, 0, line, 500);
    const sev =
      d.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : d.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;
    const item = new vscode.Diagnostic(range, `[${d.rule}] ${d.message}`, sev);
    item.source = 'SPARDA';
    if (!byFile.has(abs)) byFile.set(abs, []);
    byFile.get(abs).push(item);
  }
  for (const [abs, items] of byFile) diag.set(vscode.Uri.file(abs), items);
  const n = (j.findings && j.findings.length) || 0;
  vscode.window.showInformationMessage(
    `SPARDA apocalypse: ${n} finding(s) — see the Problems panel.`,
  );
}

async function gateArm() {
  const root = workspaceRoot();
  if (!root) return;
  await runCli('gate --arm', root);
  vscode.window.showInformationMessage(
    'SPARDA gate armed — this graph is now the baseline every edit is proven against.',
  );
}

async function installClaudeHook() {
  const root = workspaceRoot();
  if (!root) return;
  const { stdout } = await runCli('gate --install-claude', root);
  vscode.window.showInformationMessage(
    (stdout && stdout.trim()) || 'SPARDA gate installed into Claude Code (PostToolUse).',
  );
}

function activate(context) {
  out = vscode.window.createOutputChannel('SPARDA');
  diag = vscode.languages.createDiagnosticCollection('sparda');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = 'SPARDA';
  status.tooltip = 'Prove this workspace with SPARDA';
  status.command = 'sparda.prove';
  status.show();
  context.subscriptions.push(
    out,
    diag,
    status,
    vscode.commands.registerCommand('sparda.prove', prove),
    vscode.commands.registerCommand('sparda.apocalypse', apocalypse),
    vscode.commands.registerCommand('sparda.gate.arm', gateArm),
    vscode.commands.registerCommand('sparda.installClaudeHook', installClaudeHook),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
