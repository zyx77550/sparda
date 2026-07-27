'use strict';
// Pure helpers for the SPARDA VS Code extension — deliberately NO `vscode` import, so they are
// unit-testable outside the editor host (see tests/vscode-extension.test.js). extension.cjs maps
// these into vscode.Diagnostic objects and status-bar text.

// One-line status from `sparda prove --json`.
function verdictSummary(prove) {
  const v = (prove && prove.verdict) || 'UNKNOWN';
  const cov =
    prove && prove.coverage != null ? Math.round(prove.coverage * 100) + '%' : '—';
  return {
    verdict: v,
    label: `SPARDA: ${v}`,
    detail: `${v} · ${(prove && prove.routes) || 0} routes · coverage ${cov}`,
    counts: (prove && prove.counts) || {},
  };
}

// Extract { file, line } from an apocalypse evidence token such as
// "effect:db_read:src/app.js:24:0 (src/app.js:24)". Prefer the trailing "(file:line)"; fall
// back to the first "path.ext:line" in the token. null when nothing locatable.
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

module.exports = { verdictSummary, locOfEvidence, findingsToDiagnostics };
