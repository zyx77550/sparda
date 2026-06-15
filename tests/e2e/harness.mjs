// E2E MCP harness for SPARDA — Voie B (scripted real MCP client over stdio).
// Orchestrates: the host demo app + the `sparda dev` bridge, and acts as a
// genuine MCP client that declares sampling+elicitation and answers them.
//
// stdout of THIS process is reserved for the final JSON report. All human
// logging goes to stderr. The bridge's stdout is the MCP protocol; its stderr
// is captured into `bridgeStderr` for the stdout-discipline check.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve SPARDA's CLI relative to this file (tests/e2e/ -> repo root -> src).
// Override either path with SPARDA_E2E_CLI / SPARDA_E2E_APP if your layout differs.
export const SPARDA = process.env.SPARDA_E2E_CLI
  ?? fileURLToPath(new URL('../../src/index.js', import.meta.url));
export const APP = process.env.SPARDA_E2E_APP
  ?? 'C:/Users/zakwi/Desktop/sparda-demo-app';

const log = (...a) => console.error('[harness]', ...a);

export class Harness {
  constructor(opts = {}) {
    this.appDir = opts.appDir ?? APP;
    this.port = opts.port ?? 4477;
    this.quarantineMs = opts.quarantineMs ?? 3000;
    this.eventPollMs = opts.eventPollMs ?? 500;
    this.protocolVersion = opts.protocolVersion ?? '2025-06-18';
    this.entry = opts.entry ?? 'app.js';

    this.host = null;
    this.bridge = null;
    this.id = 0;
    this.pending = new Map();
    this.notifications = [];
    this.samplingRequests = [];   // {prompt, kind, response}
    this.elicitationRequests = []; // {message, response}
    this.bridgeStderr = '';
    this.hostStderr = '';
    this.hostStdout = '';
    this.stdoutViolations = []; // non-JSON lines seen on the bridge's stdout
    this.buf = '';

    // responder hooks (overridable per scenario)
    this.samplingResponder = defaultSamplingResponder;
    this.elicitationResponder = () => ({ action: 'accept', content: { confirm: true } });
  }

  async startHost() {
    // host and bridge must agree on the port; the bridge reads it from sparda.json
    try { const m = this.manifest(); if (m.port) this.port = m.port; } catch {}
    log(`starting host: node ${this.entry} on :${this.port} (QUARANTINE_MS=${this.quarantineMs})`);
    this.host = spawn(process.execPath, [this.entry], {
      cwd: this.appDir,
      env: { ...process.env, PORT: String(this.port), SPARDA_QUARANTINE_MS: String(this.quarantineMs) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.host.stdout.on('data', (d) => { this.hostStdout += d.toString(); });
    this.host.stderr.on('data', (d) => { this.hostStderr += d.toString(); });
    await this.waitForHealth();
  }

  async waitForHealth() {
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(800) });
        if (r.ok) { log('host healthy'); return; }
      } catch {}
      await sleep(200);
    }
    throw new Error('host never became healthy');
  }

  startBridge() {
    log(`starting bridge: node src/index.js dev (EVENT_POLL_MS=${this.eventPollMs})`);
    this.bridge = spawn(process.execPath, [SPARDA, 'dev'], {
      cwd: this.appDir,
      env: { ...process.env, SPARDA_EVENT_POLL_MS: String(this.eventPollMs) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.bridge.stderr.on('data', (d) => { this.bridgeStderr += d.toString(); });
    this.bridge.stdout.on('data', (d) => this._onStdout(d));
  }

  _onStdout(d) {
    this.buf += d.toString();
    let idx;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); }
      catch { this.stdoutViolations.push(line); continue; } // STDOUT DISCIPLINE: non-JSON on stdout = P0
      this._handle(msg);
    }
  }

  _handle(msg) {
    // a response to one of our requests
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      this.pending.get(msg.id)(msg);
      this.pending.delete(msg.id);
      return;
    }
    // a request FROM the server (sampling / elicitation / ping / roots)
    if (msg.method && msg.id !== undefined) {
      this._handleServerRequest(msg);
      return;
    }
    // a notification
    if (msg.method) this.notifications.push(msg);
  }

  _handleServerRequest(msg) {
    const reply = (result) => this._send({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'sampling/createMessage') {
      const prompt = msg.params?.messages?.map((m) => m.content?.text ?? '').join('\n') ?? '';
      const kind = prompt.includes('Reply with ONLY a JSON object') ? 'semantic'
        : prompt.includes('most likely root cause') ? 'diagnosis' : 'other';
      const responseText = this.samplingResponder(kind, prompt, msg.params);
      this.samplingRequests.push({ kind, prompt, responseText });
      log(`sampling/createMessage [${kind}] answered (${responseText.length} chars)`);
      reply({ role: 'assistant', content: { type: 'text', text: responseText }, model: 'manual-e2e-claude', stopReason: 'endTurn' });
      return;
    }
    if (msg.method === 'elicitation/create') {
      const answer = this.elicitationResponder(msg.params);
      this.elicitationRequests.push({ message: msg.params?.message, answer });
      log(`elicitation/create answered: ${JSON.stringify(answer)}`);
      reply(answer);
      return;
    }
    if (msg.method === 'ping') { reply({}); return; }
    if (msg.method === 'roots/list') { reply({ roots: [] }); return; }
    // unknown server request — respond with empty result so we don't hang it
    log(`unknown server request: ${msg.method}`);
    reply({});
  }

  async restartBridge() {
    const ex = new Promise((r) => this.bridge.once('close', r));
    this.bridge.kill('SIGKILL');
    await Promise.race([ex, sleep(2000)]);
    this.buf = '';
    this.pending.clear();
    this.startBridge();
    return this.initialize();
  }

  _send(obj) { this.bridge.stdin.write(JSON.stringify(obj) + '\n'); }

  request(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id;
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout on ${method}\n--- bridge stderr ---\n${this.bridgeStderr}`)); } }, timeoutMs);
    });
    this._send({ jsonrpc: '2.0', id, method, params });
    return p;
  }

  async initialize() {
    const init = await this.request('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: { sampling: {}, elicitation: {}, roots: { listChanged: true } },
      clientInfo: { name: 'sparda-e2e-claude', version: '1.0.0' },
    });
    this._send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return init;
  }

  // direct HTTP to the injected router (for [HTTP direct] cross-checks)
  async http(pathname, { method = 'GET', body } = {}) {
    const manifest = JSON.parse(fs.readFileSync(path.join(this.appDir, 'sparda.json'), 'utf8'));
    const r = await fetch(`http://127.0.0.1:${this.port}${pathname}`, {
      method,
      headers: { 'x-sparda-key': manifest.localKey, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  }

  manifest() { return JSON.parse(fs.readFileSync(path.join(this.appDir, 'sparda.json'), 'utf8')); }

  async waitFor(fn, { timeoutMs = 8000, intervalMs = 150 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (await fn()) return true; await sleep(intervalMs); }
    return false;
  }

  async stop() {
    try { if (this.bridge) { const ex = new Promise((r) => this.bridge.once('close', r)); this.bridge.kill('SIGKILL'); await Promise.race([ex, sleep(2000)]); } } catch {}
    try { if (this.host) { const ex = new Promise((r) => this.host.once('close', r)); this.host.kill('SIGKILL'); await Promise.race([ex, sleep(2000)]); } } catch {}
  }
}

// Default: play the client LLM honestly.
function defaultSamplingResponder(kind, prompt) {
  if (kind === 'semantic') {
    // parse the tool inventory lines: "- <name>: <METHOD> <path> — <desc>"
    const names = [];
    for (const line of prompt.split('\n')) {
      const m = line.match(/^\s*-\s+([a-z0-9_]+):\s+(GET|POST|PUT|PATCH|DELETE)\s/i);
      if (m) names.push(m[1]);
    }
    const descriptions = {};
    for (const n of names) descriptions[n] = `Business action exposed by ${n} (clarified by the E2E client LLM).`;
    const gets = names.filter((n) => n.startsWith('get_'));
    const workflows = [];
    if (gets.length >= 2) workflows.push({ name: 'inspect_then_list', description: 'Check health, then list the main resource.', steps: gets.slice(0, 2) });
    return JSON.stringify({ descriptions, workflows });
  }
  if (kind === 'diagnosis') {
    return 'Upstream route returns 5xx repeatedly — check the failing dependency or the broken sentinel and restore it.';
  }
  return 'ok';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
