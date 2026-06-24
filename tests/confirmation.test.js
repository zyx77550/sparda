// tests/confirmation.test.js — Brief #1, the two-signal write gate (src/server/confirmation.js).
// Signal 1 (the host confirm token) is reachable by the AI over stdio; Signal 2 (a click on a
// native OS dialog) is NOT. confirmWrite() succeeds only with BOTH — necessary-but-not-sufficient.
// These tests inject a fake dialog provider so `vitest run` NEVER spawns a real dialog, prove the
// AI cannot force a write through by replay, prove R1 (initiate never blocks), and cover the
// cross-platform dialog builder + the headless fail-closed path — without spawning anything.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initiateWrite,
  preapproveWrite,
  confirmWrite,
  buildDialogSpawn,
  _confirmTestHooks,
} from '../src/server/confirmation.js';

const { setDialogProvider, clearDialogProvider, getPendingCount, clearAll, MAX_PENDING } =
  _confirmTestHooks;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const approve = async () => true;
const deny = async () => false;
const slowHuman = () => sleep(200).then(() => true); // a human who hasn't clicked yet
const tick = () => sleep(10); // let setImmediate fire requestSignal2

beforeEach(() => {
  clearAll();
});
afterEach(async () => {
  clearDialogProvider();
  clearAll();
  await sleep(0);
}); // drain stray setImmediates

describe('confirmation — two-signal state machine (the forge is closed)', () => {
  it('the AI holding the token is NOT enough — confirmWrite is awaiting_human until the click', async () => {
    setDialogProvider(slowHuman);
    initiateWrite({ token: 'T1', label: 'PUT /users/42' });
    await tick(); // dialog is open but the operator has not clicked
    expect(confirmWrite('T1')).toEqual({ ok: false, reason: 'awaiting_human' });
  });

  it('replay spam cannot flip the state — only the human dialog can (security heart)', async () => {
    setDialogProvider(slowHuman);
    initiateWrite({ token: 'T2', label: 'PUT /x' });
    await tick();
    for (let i = 0; i < 50; i++) expect(confirmWrite('T2').ok).toBe(false); // hammering does nothing
    expect(getPendingCount()).toBe(1); // entry survived — still waiting on the human, never burned
  });

  it('Signal 2 approve → confirmWrite ok, and the token is single-use (burned)', async () => {
    setDialogProvider(approve);
    initiateWrite({ token: 'T3', label: 'PUT /users/42' });
    await tick();
    expect(confirmWrite('T3')).toEqual({ ok: true });
    expect(confirmWrite('T3')).toEqual({ ok: false, reason: 'unknown_token' }); // replay fails
    expect(getPendingCount()).toBe(0);
  });

  it('Signal 2 deny → human_denied, token burned (no second chance on the same token)', async () => {
    setDialogProvider(deny);
    initiateWrite({ token: 'T4', label: 'DELETE /users/42' });
    await tick();
    expect(confirmWrite('T4')).toEqual({ ok: false, reason: 'human_denied' });
    expect(confirmWrite('T4')).toEqual({ ok: false, reason: 'unknown_token' });
    expect(getPendingCount()).toBe(0);
  });

  it('a token the bridge never armed is unknown — an AI-invented token cannot pass', () => {
    expect(confirmWrite('deadbeef'.repeat(8))).toEqual({
      ok: false,
      reason: 'unknown_token',
    });
  });

  it('rejects malformed input before touching the map', () => {
    expect(confirmWrite(null)).toEqual({ ok: false, reason: 'invalid_input' });
    expect(confirmWrite('')).toEqual({ ok: false, reason: 'invalid_input' });
    expect(confirmWrite(42)).toEqual({ ok: false, reason: 'invalid_input' });
  });
});

describe('confirmation — R1: the hot path never pays for Signal 2', () => {
  it('initiateWrite returns immediately even when the human takes seconds', () => {
    setDialogProvider(() => sleep(5000).then(() => true)); // 5s human — must NOT be awaited inline
    const t0 = performance.now();
    initiateWrite({ token: 'T5', label: 'POST /x' });
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(5); // the MCP response is not blocked by the dialog
  });

  it('is bounded: the pending map caps at MAX_PENDING, evicting the oldest', () => {
    setDialogProvider(approve);
    for (let i = 0; i < MAX_PENDING + 5; i++)
      initiateWrite({ token: `tok_${i}`, label: 'POST /x' });
    expect(getPendingCount()).toBe(MAX_PENDING); // never grows past the cap
  });

  it('initiateWrite is a no-op for a missing/blank token', () => {
    initiateWrite({});
    initiateWrite({ token: '' });
    initiateWrite();
    expect(getPendingCount()).toBe(0);
  });
});

describe('confirmation — elicitation pre-approval (no double prompt)', () => {
  it('a native-elicitation accept pre-satisfies Signal 2 with no OS dialog', () => {
    preapproveWrite('E1'); // synchronous — no dialog spawned
    expect(confirmWrite('E1')).toEqual({ ok: true });
    expect(getPendingCount()).toBe(0); // burned on confirm
  });

  it('preapprove ignores a blank token', () => {
    preapproveWrite('');
    preapproveWrite(null);
    expect(getPendingCount()).toBe(0);
  });
});

describe('confirmation — cross-platform OS dialog (built, never spawned)', () => {
  const MSG =
    'POST /api/products\nToken: abc123def456…\n\nAllow this write on your live app?';
  const TITLE = 'SPARDA — Write confirmation';

  it('win32 → Windows PowerShell MessageBox, default Deny, message via env (no interpolation)', () => {
    const plan = buildDialogSpawn('win32', {}, MSG, TITLE);
    expect(plan.cmd).toBe('powershell');
    expect(plan.args).toContain('-NoProfile');
    const script = plan.args.at(-1);
    expect(script).toContain('System.Windows.Forms.MessageBox');
    expect(script).toContain('$env:SPARDA_DLG_MSG'); // message read from env, never inlined
    expect(script).toContain('Button2'); // default highlighted button = No (deny)
    expect(script).not.toContain(MSG); // the (potentially injected) message is NOT in the script
  });

  it('darwin → osascript reading the message from the environment', () => {
    const plan = buildDialogSpawn('darwin', {}, MSG, TITLE);
    expect(plan.cmd).toBe('osascript');
    const joined = plan.args.join(' ');
    expect(joined).toContain('system attribute "SPARDA_DLG_MSG"');
    expect(joined).toContain('default button "Deny"'); // safe default
    expect(joined).not.toContain(MSG);
  });

  it('linux with an X display → zenity question', () => {
    const plan = buildDialogSpawn('linux', { DISPLAY: ':0' }, MSG, TITLE);
    expect(plan.cmd).toBe('zenity');
    expect(plan.args).toContain('--question');
    expect(plan.args.some((a) => a.startsWith('--text='))).toBe(true);
  });

  it('linux under Wayland (no X DISPLAY) still gets a dialog', () => {
    const plan = buildDialogSpawn('linux', { WAYLAND_DISPLAY: 'wayland-0' }, MSG, TITLE);
    expect(plan?.cmd).toBe('zenity');
  });

  it('headless (no display, not mac/win) → null → caller fails CLOSED', () => {
    expect(buildDialogSpawn('linux', {}, MSG, TITLE)).toBe(null);
    expect(buildDialogSpawn('freebsd', {}, MSG, TITLE)).toBe(null);
  });
});

describe('confirmation — degradation: when the environment will not cooperate, deny', () => {
  it('a dialog that resolves false (headless / killed / no zenity) blocks the write', async () => {
    setDialogProvider(deny); // models openOSDialog resolving false on a headless host
    initiateWrite({ token: 'D1', label: 'POST /x' });
    await tick();
    expect(confirmWrite('D1')).toEqual({ ok: false, reason: 'human_denied' });
  });
});
