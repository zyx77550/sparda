// heal.test.js — the closed loop's brain: same recorded inputs, NEW expected
// output. The core scenario: record a 500 from a buggy app, "fix" the app
// (which reformulates its SQL — lenient replay tolerates the relabel), and
// the healing evaluation must say HEALED; sneaky non-fixes must stay caught.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createFlightBox } from '../src/flight/box.js';
import { replayFlight, rawRequest } from '../src/flight/replayer.js';
import { loadFlight } from '../src/flight/format.js';
import { evaluateHealing, buildBrief } from '../src/flight/heal.js';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_FETCH = globalThis.fetch;
const tmpDirs = [];
const makeTmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-heal-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

async function fire(app, body) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await rawRequest({
      port,
      method: 'POST',
      path: '/pay',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// the buggy app: crashes on a null row (the classic prod 500)
function buggyApp(box, db, record = null) {
  const app = express();
  app.use(express.json());
  if (record) app.use(box.middleware(record));
  const wdb = box.wrapClient(db, 'db');
  app.post('/pay', async (req, res) => {
    try {
      const r = await wdb.query('SELECT balance FROM users WHERE id = $1', [
        req.body.userId,
      ]);
      // BUG: r.rows[0] can be undefined — this throws
      res.json({ balance: r.rows[0].balance });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  return app;
}

// the fixed app: guards the null row AND reformulates its SQL (relabel)
function fixedApp(box, db) {
  const app = express();
  app.use(express.json());
  const wdb = box.wrapClient(db, 'db');
  app.post('/pay', async (req, res) => {
    const r = await wdb.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [
      req.body.userId,
    ]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'no such user' });
    res.json({ balance: row.balance });
  });
  return app;
}

async function recordBugFlight() {
  const cwd = makeTmp();
  const box = createFlightBox();
  box.arm();
  try {
    let resolveSaved;
    const savedP = new Promise((r) => (resolveSaved = r));
    const emptyDb = { query: async () => ({ rows: [] }) }; // the row is missing → crash
    const app = buggyApp(box, emptyDb, { cwd, onFlight: (s) => resolveSaved(s) });
    const live = await fire(app, { userId: 999 });
    expect(live.status).toBe(500); // the bug is real
    const saved = await savedP;
    return { cwd, saved };
  } finally {
    box.disarm();
  }
}

describe('Heal: the closed loop decision', () => {
  it('HEALED — fix guards the crash, lenient replay tolerates the new SQL', async () => {
    const { cwd, saved } = await recordBugFlight();
    const flight = loadFlight(cwd, saved.id);

    const box = createFlightBox();
    box.arm();
    try {
      const app = fixedApp(box, { query: async () => ({ rows: [] }) });
      const replay = await replayFlight(app, flight, box, { lenient: true });
      const healing = evaluateHealing(flight, replay); // default: 5xx → non-5xx
      expect(healing.healed).toBe(true);
      expect(healing.before.status).toBe(500);
      expect(healing.after.status).toBe(404);
      expect(healing.relabels).toHaveLength(1); // the reformulated SELECT
      expect(healing.relabels[0].kind).toBe('db');
    } finally {
      box.disarm();
    }
  });

  it('NOT healed — same code, same crash', async () => {
    const { cwd, saved } = await recordBugFlight();
    const flight = loadFlight(cwd, saved.id);
    const box = createFlightBox();
    box.arm();
    try {
      const app = buggyApp(box, { query: async () => ({ rows: [] }) });
      const replay = await replayFlight(app, flight, box, { lenient: true });
      const healing = evaluateHealing(flight, replay);
      expect(healing.healed).toBe(false);
      expect(healing.reasons.join(' ')).toMatch(/identical|still failing/);
    } finally {
      box.disarm();
    }
  });

  it('explicit --expect wins: status + body subset must match', async () => {
    const { cwd, saved } = await recordBugFlight();
    const flight = loadFlight(cwd, saved.id);
    const box = createFlightBox();
    box.arm();
    try {
      const app = fixedApp(box, { query: async () => ({ rows: [] }) });
      const replay = await replayFlight(app, flight, box, { lenient: true });
      // demanding 200 when the fix answers 404 → gate stays closed
      const strictExpect = evaluateHealing(flight, replay, { status: 200 });
      expect(strictExpect.healed).toBe(false);
      // the honest expectation passes
      const rightExpect = evaluateHealing(flight, replay, {
        status: 404,
        body: { error: 'no such user' },
      });
      expect(rightExpect.healed).toBe(true);
    } finally {
      box.disarm();
    }
  });

  it('a non-5xx recording without --expect refuses to guess', async () => {
    const fakeFlight = {
      response: { status: 200, body: '{"wrong":"value"}' },
    };
    const fakeReplay = {
      actual: { status: 200, body: '{"right":"value"}' },
      divergences: [],
      relabels: [],
      leftover: [],
    };
    const healing = evaluateHealing(fakeFlight, fakeReplay);
    expect(healing.healed).toBe(false);
    expect(healing.reasons.join(' ')).toContain('--expect');
  });
});

describe('Heal: the brief carries the compiler’s knowledge', () => {
  it('includes handler location, guards and acceptance criteria', () => {
    const graph = canonicalizeGraph(
      compileUBG(path.join(here, 'fixtures', 'ubg-express'), { write: false }).graph,
    );
    const flight = {
      request: { method: 'POST', url: '/users', body: { email: 'x@y.z' } },
      response: { status: 500, body: '{"error":"boom"}' },
      taps: [{ kind: 'db' }],
    };
    const strict = {
      match: true,
      actual: { status: 500, body: '' },
      divergences: [],
    };
    const brief = buildBrief(flight, graph, strict, 'abc123');
    expect(brief).toContain('POST /users');
    expect(brief).toContain('requireAuth');
    expect(brief).toContain('REMOVING A GUARD FAILS THE GATE');
    expect(brief).toContain('src/app.js');
    expect(brief).toContain('sparda verify');
    expect(brief).toContain('apocalypse');
  });
});
