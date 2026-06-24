// server/confirmation.js — Signal 2: out-of-band human approval the AI can never forge.
//
// Brief #1 (blast-radius). On MCP clients WITHOUT `elicitation`, SPARDA's two-phase write
// confirmation was forgeable: the AI received a confirm token (Signal 1, over stdio) and
// replayed it itself via `sparda_confirm`, with no human in the loop. This module adds
// Signal 2 — a click on a native OS dialog spawned on the operator's desktop, a channel a
// prompt-injected (or otherwise misbehaving) AI cannot reach. A write proceeds only when
// BOTH signals are present: Signal 1 is necessary-but-not-sufficient, by construction.
//
// Where it lives: the BRIDGE. Framework-agnostic — no template, no Express/FastAPI parity,
// no R4/R6 surface. The host's confirm token (single-use, already bound host-side to
// {tool, args}) is the key here, so no second binding is re-implemented in the bridge.
// R1 (host never pays): the dialog is spawned async, on a *gated write* only — never on a
// read, never on the request path; confirmWrite() is an O(1) map lookup. R8 (no new dep):
// node:child_process only. value-free: the dialog shows method+path+token-prefix, never an
// argument value. R2 (stdout is the protocol): the only log here (headless fail-closed)
// goes to stderr.

import { spawn } from 'node:child_process';

// the human's approval window. Defaults to the host's confirm-token TTL so the dialog never
// outlives the token it guards — both read the same env, kept in lockstep without coupling.
const TIMEOUT_MS = Number(process.env.SPARDA_CONFIRM_TTL_MS ?? 120_000);
const MAX_PENDING = 64; // R1: bounded RAM — far past any human's concurrent approvals
const S1 = 'signal1_pending';
const S2 = 'signal2_received';
const DENIED = 'denied';

const pendingWrites = new Map(); // token -> { state, expiresAt, label }

// testability: tests inject a provider so `vitest run` never spawns a real dialog.
let dialogProvider = null;

function evictOldest() {
  // bounded RAM: drop the entry nearest expiry (Map preserves insertion order).
  const oldest = pendingWrites.keys().next().value;
  if (oldest !== undefined) pendingWrites.delete(oldest);
}

function sweep(now = Date.now()) {
  for (const [tok, e] of pendingWrites) if (now > e.expiresAt) pendingWrites.delete(tok);
}

// ── Signal 1: the AI proposed a gated write. Register it and open the dialog (async). ──
// `token` is the host's single-use confirm nonce (the key); `label` is e.g. "POST /users/42".
// Returns immediately (R1). Idempotent per token. No-op when token is not a non-empty string.
export function initiateWrite({ token, label } = {}) {
  if (typeof token !== 'string' || !token) return;
  sweep();
  if (pendingWrites.has(token)) return; // dialog already armed for this token
  if (pendingWrites.size >= MAX_PENDING) evictOldest();
  pendingWrites.set(token, {
    state: S1,
    expiresAt: Date.now() + TIMEOUT_MS,
    label: String(label ?? token.slice(0, 12)),
  });
  // Signal 2 runs in parallel — it NEVER blocks the MCP response.
  setImmediate(() => {
    requestSignal2(token).catch(() => markDenied(token));
  });
}

// ── Pre-approval: the human already said yes out-of-band via native elicitation (client UI). ──
// Marks Signal 2 satisfied WITHOUT a second prompt — no double-confirmation for elicitation clients.
export function preapproveWrite(token) {
  if (typeof token !== 'string' || !token) return;
  sweep();
  if (!pendingWrites.has(token) && pendingWrites.size >= MAX_PENDING) evictOldest();
  pendingWrites.set(token, {
    state: S2,
    expiresAt: Date.now() + TIMEOUT_MS,
    label: 'elicitation',
  });
}

async function requestSignal2(token) {
  const entry = pendingWrites.get(token);
  if (!entry) return;
  const approved = dialogProvider
    ? await dialogProvider(entry.label, token)
    : await openOSDialog(entry.label, token);
  const e = pendingWrites.get(token);
  if (!e || e.state !== S1) return; // consumed, expired, or pre-approved meanwhile
  if (Date.now() > e.expiresAt) {
    pendingWrites.delete(token);
    return;
  }
  e.state = approved ? S2 : DENIED;
}

function markDenied(token) {
  const e = pendingWrites.get(token);
  if (e && e.state === S1) e.state = DENIED;
}

// ── confirmWrite: what `sparda_confirm` calls before forwarding to the host. ──
// Succeeds ONLY if Signal 2 was received. Burns the token on every terminal answer; an
// awaiting-human answer is kept so the AI can retry once the operator approves.
export function confirmWrite(token) {
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'invalid_input' };
  sweep();
  const entry = pendingWrites.get(token);
  if (!entry) return { ok: false, reason: 'unknown_token' };
  if (Date.now() > entry.expiresAt) {
    pendingWrites.delete(token);
    return { ok: false, reason: 'expired' };
  }
  switch (entry.state) {
    case S1:
      return { ok: false, reason: 'awaiting_human' }; // keep — the AI must retry after the click
    case DENIED:
      pendingWrites.delete(token);
      return { ok: false, reason: 'human_denied' };
    case S2:
      pendingWrites.delete(token);
      return { ok: true }; // burn — single use
    default:
      pendingWrites.delete(token);
      return { ok: false, reason: 'invalid_state' };
  }
}

// Build the argv for a native yes/no dialog on this platform, or null when there is no
// reachable display (→ caller fails closed). The message is handed to win32/darwin through
// the child's env (SPARDA_DLG_MSG), never interpolated into a script — so no argument value
// or injected string can break out into a shell. Linux passes it as a literal argv element
// (spawn does not invoke a shell), which is equally injection-safe.
export function buildDialogSpawn(platform, env, msg, title) {
  if (platform === 'win32') {
    // Windows PowerShell 5.1 (powershell.exe, always present) + WinForms MessageBox.
    // TopMost owner form so the box surfaces; default button = No (deny). Yes → exit 0.
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true};',
      '$r = [System.Windows.Forms.MessageBox]::Show($o, $env:SPARDA_DLG_MSG, $env:SPARDA_DLG_TITLE,',
      '[System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning,',
      '[System.Windows.Forms.MessageBoxDefaultButton]::Button2);',
      'if ($r -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 } else { exit 1 }',
    ].join(' ');
    return {
      cmd: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps],
    };
  }
  if (platform === 'darwin') {
    // osascript reads the message from the inherited env (system attribute) — no interpolation.
    const osa =
      'display dialog (system attribute "SPARDA_DLG_MSG") with title (system attribute "SPARDA_DLG_TITLE") ' +
      'buttons {"Deny", "Allow"} default button "Deny" cancel button "Deny" with icon caution';
    return { cmd: 'osascript', args: ['-e', osa] };
  }
  // Linux/BSD: zenity needs an X or Wayland display. Without one, fail closed.
  if (env.DISPLAY || env.WAYLAND_DISPLAY) {
    return {
      cmd: 'zenity',
      args: [
        '--question',
        `--title=${title}`,
        `--text=${msg}`,
        '--ok-label=Allow',
        '--cancel-label=Deny',
        '--width=420',
      ],
    };
  }
  return null; // headless → caller denies
}

function openOSDialog(label, token) {
  return new Promise((resolve) => {
    const title = 'SPARDA — Write confirmation';
    const msg = `${label}\nToken: ${token.slice(0, 12)}…\n\nAllow this write on your live app?`;
    const plan = buildDialogSpawn(process.platform, process.env, msg, title);
    if (!plan) {
      // R2: human log to stderr. Fail closed — no approval channel means no write.
      process.stderr.write(
        `[sparda] no desktop display — write auto-denied (Signal 2 unreachable): ${label}\n`,
      );
      return resolve(false);
    }
    let proc;
    try {
      proc = spawn(plan.cmd, plan.args, {
        env: { ...process.env, SPARDA_DLG_MSG: msg, SPARDA_DLG_TITLE: title },
        windowsHide: true, // hide the helper console; the GUI dialog still shows
      });
    } catch {
      return resolve(false); // spawner missing → deny
    }
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      resolve(false);
    }, TIMEOUT_MS);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    }); // binary absent (e.g. no zenity) → deny
  });
}

// test hooks: inject a fake dialog, inspect/clear the pending map. Never used in production.
export const _confirmTestHooks = {
  setDialogProvider: (fn) => {
    dialogProvider = fn;
  },
  clearDialogProvider: () => {
    dialogProvider = null;
  },
  getPendingCount: () => pendingWrites.size,
  clearAll: () => pendingWrites.clear(),
  TIMEOUT_MS,
  MAX_PENDING,
};
