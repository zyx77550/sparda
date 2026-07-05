// flight.test.js — the Timeless contract: record once, replay identically,
// diverge loudly. The chaos test is the whole product: after recording we
// sabotage the database, the webhook AND the clock — the replay must still
// reproduce the original response byte-for-byte, because every
// nondeterminism point is virtualized from the flight.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createFlightBox, getFlightBox, FlightDivergence } from '../src/flight/box.js';
import { replayFlight, rawRequest } from '../src/flight/replayer.js';
import { flightIdOf, loadFlight, listFlights } from '../src/flight/format.js';

const REAL_FETCH = globalThis.fetch;
const tmpDirs = [];
const makeTmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-flight-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

// a fake upstream so record mode never touches the network
const fakeUpstream = (status, payload) => async () =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function buildApp(box, db, { record = null } = {}) {
  const app = express();
  app.use(express.json());
  if (record) app.use(box.middleware(record));
  const wdb = box.wrapClient(db, 'db');
  app.post('/checkout', async (req, res) => {
    try {
      const user = await wdb.query('SELECT email FROM users WHERE id = $1', [
        req.body.userId,
      ]);
      const hook = await fetch('https://hooks.example.com/checkout', {
        method: 'POST',
      });
      res.json({
        email: user.rows[0].email,
        at: Date.now(),
        jitter: Math.random(),
        ref: crypto.randomUUID(),
        webhook: hook.status,
        echo: req.body.note,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  return app;
}

// raw http client — immune to the fetch patching this suite plays with
async function fire(app, body) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await rawRequest({
      port,
      method: 'POST',
      path: '/checkout',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function recordOneFlight() {
  const cwd = makeTmp();
  globalThis.fetch = fakeUpstream(201, { ok: true });
  const box = createFlightBox();
  box.arm();
  try {
    let resolveSaved;
    const savedP = new Promise((resolve) => (resolveSaved = resolve));
    const db = { query: async () => ({ rows: [{ email: 'zak@residual-labs.fr' }] }) };
    const app = buildApp(box, db, {
      record: { cwd, onFlight: (saved) => resolveSaved(saved) },
    });
    const live = await fire(app, { userId: 7, note: 'prod bug' });
    const saved = await savedP;
    return { cwd, saved, live };
  } finally {
    box.disarm();
  }
}

describe('Flight: record', () => {
  it('captures request, response and every nondeterminism tap', async () => {
    const { cwd, saved } = await recordOneFlight();
    expect(listFlights(cwd)).toEqual([saved.id]);
    const flight = loadFlight(cwd, saved.id);
    const kinds = flight.taps.map((t) => t.kind);
    expect(kinds).toEqual(['db', 'http', 'time', 'random', 'uuid']);
    expect(flight.request).toMatchObject({
      method: 'POST',
      url: '/checkout',
      body: { userId: 7, note: 'prod bug' },
    });
    expect(flight.response.status).toBe(200);
    expect(JSON.parse(flight.response.body).email).toBe('zak@residual-labs.fr');
  });

  it('flight identity is content, not time', async () => {
    const { cwd, saved } = await recordOneFlight();
    const flight = loadFlight(cwd, saved.id);
    expect(flightIdOf(flight)).toBe(saved.id);
    expect(flightIdOf(flight)).toBe(flightIdOf(loadFlight(cwd, saved.id)));
  });
});

describe('Flight: chaos replay — the product', () => {
  it('reproduces the response although db, webhook and clock all changed', async () => {
    const { cwd, saved } = await recordOneFlight();
    const flight = loadFlight(cwd, saved.id);

    // sabotage everything the code depends on
    globalThis.fetch = fakeUpstream(500, { down: true });
    const evilDb = { query: async () => ({ rows: [{ email: 'HACKED@nope' }] }) };

    const box = createFlightBox();
    box.arm();
    try {
      const app = buildApp(box, evilDb);
      const result = await replayFlight(app, flight, box);
      expect(result.divergences).toEqual([]);
      expect(result.leftover).toEqual([]);
      expect(result.statusMatch).toBe(true);
      expect(result.bodyMatch).toBe(true);
      expect(result.match).toBe(true);
      // the recorded truth won over the sabotaged present
      expect(JSON.parse(result.actual.body).email).toBe('zak@residual-labs.fr');
      expect(JSON.parse(result.actual.body).webhook).toBe(201);
    } finally {
      box.disarm();
    }
  });

  it('diverges loudly when the code asks different questions', async () => {
    const { cwd, saved } = await recordOneFlight();
    const flight = loadFlight(cwd, saved.id);

    const box = createFlightBox();
    box.arm();
    try {
      const db = { query: async () => ({ rows: [{ email: 'x@y.z' }] }) };
      const app = express();
      app.use(express.json());
      const wdb = box.wrapClient(db, 'db');
      // a "refactor" that now queries twice — the flight only has one db tap
      app.post('/checkout', async (req, res) => {
        try {
          await wdb.query('SELECT email FROM users WHERE id = $1', [req.body.userId]);
          await wdb.query('SELECT email FROM users WHERE id = $1', [req.body.userId]);
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      });
      const result = await replayFlight(app, flight, box);
      expect(result.match).toBe(false);
      expect(result.divergences.length).toBeGreaterThan(0);
      expect(result.divergences[0].kind).toBe('db');
    } finally {
      box.disarm();
    }
  });

  it('reports unconsumed taps when the code skips steps', async () => {
    const { cwd, saved } = await recordOneFlight();
    const flight = loadFlight(cwd, saved.id);

    const box = createFlightBox();
    box.arm();
    try {
      const app = express();
      app.use(express.json());
      app.post('/checkout', async (req, res) => res.json({ shortcut: true }));
      const result = await replayFlight(app, flight, box);
      expect(result.match).toBe(false);
      expect(result.leftover.map((l) => l.kind).sort()).toEqual([
        'db',
        'http',
        'random',
        'time',
        'uuid',
      ]);
    } finally {
      box.disarm();
    }
  });
});

describe('Flight: singleton & recorder/replay coexistence', () => {
  it('getFlightBox is one box per process — app and CLI share the ALS', () => {
    expect(getFlightBox()).toBe(getFlightBox());
  });

  it('replay wins over record: replaying THROUGH a recording app neither re-records nor diverges', async () => {
    const { cwd, saved } = await recordOneFlight();
    const flight = loadFlight(cwd, saved.id);

    globalThis.fetch = fakeUpstream(500, { down: true });
    const box = createFlightBox();
    box.arm();
    try {
      // the app still mounts the RECORD middleware, like a real integrated app
      const db = { query: async () => ({ rows: [{ email: 'live@now' }] }) };
      const app = buildApp(box, db, { record: { cwd } });
      const result = await replayFlight(app, flight, box);
      expect(result.match).toBe(true);
      expect(JSON.parse(result.actual.body).email).toBe('zak@residual-labs.fr');
      expect(listFlights(cwd)).toEqual([saved.id]); // no parasite flight written
    } finally {
      box.disarm();
    }
  });

  it('SPARDA_FLIGHT=off disables recording entirely', async () => {
    const cwd = makeTmp();
    process.env.SPARDA_FLIGHT = 'off';
    globalThis.fetch = fakeUpstream(201, { ok: true });
    const box = createFlightBox();
    box.arm();
    try {
      const db = { query: async () => ({ rows: [{ email: 'x@y.z' }] }) };
      const app = buildApp(box, db, { record: { cwd } });
      const res = await fire(app, { userId: 1, note: 'n' });
      expect(res.status).toBe(200);
      expect(listFlights(cwd)).toEqual([]);
    } finally {
      delete process.env.SPARDA_FLIGHT;
      box.disarm();
    }
  });
});

describe('Flight: production hygiene', () => {
  it('redacts sensitive body keys before the flight touches disk', async () => {
    const cwd = makeTmp();
    globalThis.fetch = fakeUpstream(201, { ok: true });
    const box = createFlightBox();
    box.arm();
    try {
      let resolveSaved;
      const savedP = new Promise((r) => (resolveSaved = r));
      const db = { query: async () => ({ rows: [{ email: 'a@b.c' }] }) };
      const app = buildApp(box, db, {
        record: { cwd, onFlight: (s) => resolveSaved(s) },
      });
      await fire(app, {
        userId: 1,
        note: 'x',
        password: 'hunter2',
        nested: { token: 'sk-123' },
      });
      const saved = await savedP;
      const flight = loadFlight(cwd, saved.id);
      expect(flight.request.body.password).toBe('[REDACTED]');
      expect(flight.request.body.nested.token).toBe('[REDACTED]');
      expect(flight.request.body.note).toBe('x'); // non-sensitive survives
      expect(JSON.stringify(flight)).not.toContain('hunter2');
      expect(JSON.stringify(flight)).not.toContain('sk-123');
    } finally {
      box.disarm();
    }
  });

  it('sample: N records exactly every Nth request, deterministically', async () => {
    const cwd = makeTmp();
    globalThis.fetch = fakeUpstream(201, { ok: true });
    const box = createFlightBox();
    box.arm();
    try {
      const db = { query: async () => ({ rows: [{ email: 'a@b.c' }] }) };
      const app = buildApp(box, db, { record: { cwd, sample: 3 } });
      for (let i = 0; i < 6; i++) await fire(app, { userId: i, note: `r${i}` });
      await new Promise((r) => setTimeout(r, 200)); // let finish handlers flush
      expect(listFlights(cwd)).toHaveLength(2); // requests 0 and 3
    } finally {
      box.disarm();
    }
  });
});

describe('Flight: fail-loud primitives', () => {
  it('FlightDivergence carries the exact mismatch', () => {
    const box = createFlightBox();
    const store = box.makeReplayStore({
      taps: [{ seq: 0, kind: 'db', label: 'db.query:SELECT 1', result: 1 }],
    });
    expect(() =>
      box.runWith(store, () => {
        throw new FlightDivergence('manual', {});
      }),
    ).toThrow(FlightDivergence);
  });
});
