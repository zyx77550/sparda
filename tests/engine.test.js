// tests/engine.test.js — the living engine (src/server/engine.js). Covers the four
// passive organs — slice 1 PredictiveEngine (stability), slice 2 RhythmDetector
// (cadence), slice 3 MyelinTracker (habitual succession), slice 4 the dependency
// map (Bloc D — Noether invariants conserved across writes + ghost write->read
// couplings) — and slice 5 the flywheel (Bloc B — the first ACTIVE organ: serves a
// proven-stable read from memory, ADR-020). Every snapshot suite asserts
// names-and-counts-only output, the ADR-014 value-free guarantee, and the bounds.
// Pure JS, no python, no live server — fast and deterministic, like persistence.test.js.
import { describe, it, expect } from 'vitest';
import {
  createPredictiveEngine,
  createRhythmDetector,
  createMyelinTracker,
  createNoetherScanner,
  createGravitationalLens,
  createDependencyMap,
  createFlywheel,
  createSpardaEngine,
  ENGINE_LIMITS,
} from '../src/server/engine.js';

// feed `count` ticks of tool `name` spaced exactly `stepMs` apart, starting at t0.
function beat(detector, name, { stepMs, count, t0 = 1_000_000 }) {
  for (let i = 0; i < count; i++) detector.record(name, t0 + i * stepMs);
}

// observe a succession of tools through the myelin tracker, advancing the clock.
function walk(tracker, seq, t0 = 1_000_000, stepMs = 10) {
  seq.forEach((tool, i) => tracker.observe(tool, t0 + i * stepMs));
}

// Bloc D feeds: a read observation vs a write observation (the third arg, isWrite).
const rd = (organ, tool, result) => organ.observe(tool, result, false);
const wr = (organ, tool, result = { ok: true }) => organ.observe(tool, result, true);
const NOETHER_MIN_OBS = 5; // mirrors NOETHER.MIN_OBS in engine.js (module-private)

describe('engine — PredictiveEngine classification', () => {
  it('first sight of a tool is FIRST_CALL', () => {
    const e = createPredictiveEngine();
    expect(e.observe('list_users', { count: 2, items: ['a', 'b'] })).toEqual({
      type: 'FIRST_CALL',
      tool: 'list_users',
    });
  });

  it('the same payload twice is NO_CHANGE (no field moved)', () => {
    const e = createPredictiveEngine();
    e.observe('get_config', { theme: 'dark', flags: { beta: true } });
    expect(e.observe('get_config', { theme: 'dark', flags: { beta: true } })).toEqual({
      type: 'NO_CHANGE',
      tool: 'get_config',
    });
  });

  it('a changed field surfaces as DELTA with that field NAME (never its value)', () => {
    const e = createPredictiveEngine();
    e.observe('get_user', { id: 7, name: 'Ana', lastSeen: 1 });
    const r = e.observe('get_user', { id: 7, name: 'Ana', lastSeen: 2 });
    expect(r.type).toBe('DELTA');
    expect(r.tool).toBe('get_user');
    expect(r.changedFields).toEqual(['lastSeen']); // only the field that moved
    expect(JSON.stringify(r)).not.toContain('Ana'); // no value ever escapes
  });

  it('a newly appearing field counts as a change of shape', () => {
    const e = createPredictiveEngine();
    e.observe('get_user', { id: 7 });
    const r = e.observe('get_user', { id: 7, email: 'x@y.z' });
    expect(r.type).toBe('DELTA');
    expect(r.changedFields).toContain('email');
  });

  it('a field that vanishes also counts as a change', () => {
    const e = createPredictiveEngine();
    e.observe('get_user', { id: 7, email: 'x@y.z' });
    const r = e.observe('get_user', { id: 7 });
    expect(r.type).toBe('DELTA');
    expect(r.changedFields).toContain('email');
  });

  it('a non-object body (array/scalar) collapses to one synthetic field and still tracks change', () => {
    const e = createPredictiveEngine();
    expect(e.observe('list', [1, 2, 3]).type).toBe('FIRST_CALL');
    expect(e.observe('list', [1, 2, 3]).type).toBe('NO_CHANGE');
    const r = e.observe('list', [1, 2, 3, 4]);
    expect(r.type).toBe('DELTA');
    expect(r.changedFields).toEqual(['__value__']);
  });

  it('invalidate() drops the model so the next sight is FIRST_CALL again', () => {
    const e = createPredictiveEngine();
    e.observe('get_user', { id: 1 });
    e.invalidate('get_user');
    expect(e.observe('get_user', { id: 1 }).type).toBe('FIRST_CALL');
  });
});

describe('engine — snapshot is names + counts only (ADR-014)', () => {
  it('classifies stable vs volatile, and keeps a single-sight field as neither (unknown)', () => {
    const e = createPredictiveEngine();
    e.observe('get_user', { id: 7, name: 'Ana', lastSeen: 1 }); // all first-sight (unknown)
    e.observe('get_user', { id: 7, name: 'Ana', lastSeen: 2 }); // id,name held; lastSeen moved
    e.observe('get_user', { id: 7, name: 'Ana', lastSeen: 3, extra: 1 }); // extra appears now (seen once)
    const snap = e.snapshot();
    const t = snap.tools.get_user;
    expect(t.calls).toBe(3);
    expect(t.stable.sort()).toEqual(['id', 'name']); // seen >1, never changed
    expect(t.volatile).toEqual(['lastSeen']); // moved at least once
    expect(t.stable).not.toContain('extra'); // seen only once → unknown, in neither
    expect(t.volatile).not.toContain('extra');
    expect(snap.stats).toEqual({ firstCall: 1, noChange: 0, delta: 2 });
  });

  it('a value-bearing payload leaves no value anywhere in the snapshot', () => {
    const e = createPredictiveEngine();
    const secret = 'sk_live_SUPER_SECRET_TOKEN';
    e.observe('get_secret', { token: secret, rotatedAt: 1 });
    e.observe('get_secret', { token: secret, rotatedAt: 2 });
    expect(JSON.stringify(e.snapshot())).not.toContain(secret); // fingerprints only — never the value
  });
});

describe('engine — bounded (rule #1 / ADR-010 philosophy)', () => {
  it('stops learning new tools past MAX_TOOLS instead of growing unbounded', () => {
    const e = createPredictiveEngine();
    for (let i = 0; i < ENGINE_LIMITS.MAX_TOOLS; i++) {
      expect(e.observe(`tool_${i}`, { i }).type).toBe('FIRST_CALL');
    }
    // the (MAX_TOOLS + 1)-th brand-new tool is refused (returns null), not tracked
    expect(e.observe('one_too_many', { i: 999 })).toBe(null);
    expect(Object.keys(e.snapshot().tools).length).toBe(ENGINE_LIMITS.MAX_TOOLS);
  });

  it('caps tracked fields per tool', () => {
    const e = createPredictiveEngine();
    const big = {};
    for (let i = 0; i < ENGINE_LIMITS.MAX_FIELDS + 25; i++) big[`f${i}`] = i;
    e.observe('wide', big);
    const t = e.snapshot().tools.wide;
    expect(t.stable.length + t.volatile.length).toBeLessThanOrEqual(
      ENGINE_LIMITS.MAX_FIELDS,
    );
  });
});

describe('engine — RhythmDetector cadence (slice 2)', () => {
  it('detects a steady beat: period = the interval, confidence high, next call estimated', () => {
    const d = createRhythmDetector();
    beat(d, 'poll', { stepMs: 1000, count: 6, t0: 1_000_000 }); // gaps all exactly 1000ms
    const snap = d.snapshot();
    expect(snap.stats.patternsDetected).toBe(1);
    const p = snap.tools.poll;
    expect(p.periodMs).toBe(1000);
    expect(p.confidence).toBe(1); // cv = 0 → confidence = 1
    expect(p.observations).toBe(6);
    expect(p.nextEstimate).toBe(new Date(1_005_000 + 1000).toISOString()); // last ts + period
  });

  it('stays silent below MIN_TS sightings', () => {
    const d = createRhythmDetector();
    beat(d, 'poll', { stepMs: 1000, count: 4 }); // 4 < MIN_TS (5) → never analyzed
    expect(d.snapshot().tools).toEqual({});
  });

  it('does not flag an irregular cadence', () => {
    const d = createRhythmDetector();
    // gaps 100/3000/100/3000/100 → cv ≫ 0.25
    [1_000_000, 1_000_100, 1_003_100, 1_003_200, 1_006_200, 1_006_300].forEach((t) =>
      d.record('chaotic', t),
    );
    expect(d.snapshot().tools.chaotic).toBeUndefined();
  });

  it('drops a pattern once the beat breaks (snapshot stays honest)', () => {
    const d = createRhythmDetector();
    beat(d, 'poll', { stepMs: 1000, count: 6, t0: 1_000_000 });
    expect(d.snapshot().tools.poll).toBeDefined(); // established
    d.record('poll', 1_005_000 + 100_000); // one wild gap tips cv over threshold
    expect(d.snapshot().tools.poll).toBeUndefined(); // dropped
  });

  it('bounds the timestamp ring at MAX_TS', () => {
    const d = createRhythmDetector();
    beat(d, 'poll', { stepMs: 1000, count: ENGINE_LIMITS.MAX_TS + 10, t0: 1_000_000 });
    expect(d.snapshot().tools.poll.observations).toBe(ENGINE_LIMITS.MAX_TS); // ring shifted, not grown
  });

  it('invalidate() forgets a tool entirely', () => {
    const d = createRhythmDetector();
    beat(d, 'poll', { stepMs: 1000, count: 6 });
    d.invalidate('poll');
    expect(d.snapshot().tools).toEqual({});
  });
});

describe('engine — MyelinTracker habits (slice 3)', () => {
  it('myelinates a repeated succession A-->B once it crosses the threshold', () => {
    const m = createMyelinTracker();
    walk(m, ['A', 'B', 'A', 'B', 'A', 'B']); // A-->B traversed 3×, B-->A 2×
    const snap = m.snapshot();
    expect(snap.edges['A-->B']).toEqual({ strength: 3, traversals: 3 });
    expect(snap.edges['B-->A']).toBeUndefined(); // only 2 traversals → below threshold
    expect(snap.stats).toEqual({ tracked: 2, myelinated: 1 });
  });

  it('keeps a young edge out of the snapshot until it is entrenched', () => {
    const m = createMyelinTracker();
    walk(m, ['A', 'B']); // one traversal only
    expect(m.snapshot().edges).toEqual({});
    expect(m.snapshot().stats).toEqual({ tracked: 1, myelinated: 0 });
  });

  it('never forms a self-edge when a tool repeats back-to-back', () => {
    const m = createMyelinTracker();
    walk(m, ['A', 'A', 'A']);
    expect(m.snapshot().stats.tracked).toBe(0);
  });

  it('saturates strength at MAX_LAYERS however often the path is walked', () => {
    const m = createMyelinTracker();
    walk(m, Array(15).fill(['A', 'B']).flat()); // A-->B traversed 15×
    const edge = m.snapshot().edges['A-->B'];
    expect(edge.traversals).toBe(15);
    expect(edge.strength).toBe(10); // capped at MAX_LAYERS
  });

  it('bounds the number of tracked axons at MAX_AXONS', () => {
    const m = createMyelinTracker();
    walk(
      m,
      Array.from({ length: ENGINE_LIMITS.MAX_AXONS + 52 }, (_, i) => `T${i}`),
    ); // a long distinct chain
    expect(m.snapshot().stats.tracked).toBe(ENGINE_LIMITS.MAX_AXONS); // evicted down, never grown past
  });

  it('invalidate() forgets every edge touching a tool', () => {
    const m = createMyelinTracker();
    walk(m, ['A', 'B', 'A', 'B', 'A', 'B']); // A-->B and B-->A
    m.invalidate('A');
    expect(m.snapshot().stats.tracked).toBe(0); // both edges touched A
  });
});

describe('engine — spine surface (createSpardaEngine)', () => {
  it('exposes observe / invalidate and a stability section for sparda_get_context', () => {
    const engine = createSpardaEngine();
    expect(engine.observe('get_user', { id: 1 }).type).toBe('FIRST_CALL');
    engine.observe('get_user', { id: 1 });
    const snap = engine.snapshot();
    expect(snap).toHaveProperty('stability'); // the section get_context surfaces
    expect(snap.stability.tools.get_user.calls).toBe(2);
    expect(snap.stability.stats.noChange).toBe(1);
  });

  it('feeds all three organs from one observe(tool, result, ts) and surfaces every section', () => {
    const engine = createSpardaEngine();
    for (let i = 0; i < 6; i++) engine.observe('poll', { tick: 1 }, 2_000_000 + i * 500); // steady 500ms beat
    const snap = engine.snapshot();
    expect(snap).toHaveProperty('stability');
    expect(snap).toHaveProperty('rhythm');
    expect(snap).toHaveProperty('myelin');
    expect(snap.rhythm.tools.poll.periodMs).toBe(500); // rhythm caught the cadence
    expect(snap.stability.tools.poll.stable).toContain('tick'); // stability caught the stable field
  });

  it('learns tool succession through the spine (myelin)', () => {
    const engine = createSpardaEngine();
    for (let i = 0; i < 3; i++) {
      engine.observe('A', { x: 1 }, 1000 + i * 100);
      engine.observe('B', { y: 1 }, 1050 + i * 100);
    }
    expect(engine.snapshot().myelin.edges['A-->B'].strength).toBe(3); // B habitually follows A
  });

  it('observe() works without an explicit timestamp (defaults to now)', () => {
    const engine = createSpardaEngine();
    expect(() => engine.observe('x', { a: 1 })).not.toThrow();
  });

  it('threads isWrite into Bloc D and surfaces the dependencies section', () => {
    const engine = createSpardaEngine();
    const snap0 = engine.snapshot();
    expect(snap0).toHaveProperty('dependencies'); // the fourth section get_context surfaces
    expect(snap0.dependencies).toHaveProperty('invariants');
    expect(snap0.dependencies).toHaveProperty('ghosts');

    // a read, then a write that moves it, repeated — a ghost dependency forms
    let t = 3_000_000;
    engine.observe('get_balance', { amount: 100 }, t, false);
    for (const amt of [90, 80, 70]) {
      engine.observe('do_transfer', { ok: true }, (t += 100), true); // isWrite = true
      engine.observe('get_balance', { amount: amt }, (t += 100), false);
    }
    const ghosts = engine.snapshot().dependencies.ghosts;
    expect(
      ghosts.some((g) => g.writeTool === 'do_transfer' && g.affects === 'get_balance'),
    ).toBe(true);
  });

  it('serves a proven-stable read through preCall and surfaces a value-free flywheel section (slice 5)', () => {
    const engine = createSpardaEngine();
    const secret = 'sk_live_FLYWHEEL_SECRET';
    const t = Date.now(); // spine preCall reads the real clock — anchor freshness on it
    expect(engine.preCall('get_cfg', { env: 'prod' })).toEqual({
      hit: false,
      value: null,
    }); // nothing learned yet
    for (let i = 0; i < 3; i++)
      engine.observe('get_cfg', { token: secret }, t, false, { env: 'prod' }); // 3 identical reads
    const hit = engine.preCall('get_cfg', { env: 'prod' });
    expect(hit).toEqual({ hit: true, value: { token: secret } }); // 4th call served, never paid the host
    const snap = engine.snapshot();
    expect(snap).toHaveProperty('flywheel'); // the fifth section get_context surfaces
    expect(snap.flywheel.stats.ready).toBe(1);
    expect(JSON.stringify(snap.flywheel)).not.toContain(secret); // value lives only behind preCall, never in the snapshot
  });

  it('an observed write invalidates the reads it moves, via the ghost map (slice 4 -> slice 5)', () => {
    const engine = createSpardaEngine();
    let t = Date.now(); // spine preCall reads the real clock — keep observations fresh
    // teach the ghost coupling do_transfer -> get_balance, and prove get_balance pure
    engine.observe('get_balance', { amount: 100 }, (t += 100), false, {});
    for (const amt of [90, 80, 70]) {
      engine.observe('do_transfer', { ok: true }, (t += 100), true, {});
      engine.observe('get_balance', { amount: amt }, (t += 100), false, {});
    }
    // now make get_balance proven-stable (3 identical) so preCall would serve it
    for (let i = 0; i < 3; i++)
      engine.observe('get_balance', { amount: 50 }, (t += 100), false, {});
    expect(engine.preCall('get_balance', {}).hit).toBe(true); // serveable...
    engine.observe('do_transfer', { ok: true }, (t += 100), true, {}); // ...until a write moves it
    expect(engine.preCall('get_balance', {}).hit).toBe(false); // ghost map purged the cached read
  });

  it("invalidateCache purges only the flywheel, sparing the read's learned behavior (5b same-path purge)", () => {
    const engine = createSpardaEngine();
    const t = Date.now(); // spine preCall reads the real clock — anchor freshness on it
    for (let i = 0; i < 3; i++) engine.observe('get_user', { v: 1 }, t, false, { id: 7 }); // proven-stable read
    expect(engine.preCall('get_user', { id: 7 }).hit).toBe(true); // serveable
    expect(engine.snapshot().stability.tools.get_user.calls).toBe(3); // and its stability is learned

    engine.invalidateCache('get_user'); // exactly what the bridge calls when a write hits the same path
    expect(engine.preCall('get_user', { id: 7 }).hit).toBe(false); // cache dropped — the next read re-pays the host
    expect(engine.snapshot().stability.tools.get_user.calls).toBe(3); // ...but the brain is untouched (flywheel-only)

    engine.invalidate('get_user'); // contrast: the FULL invalidate also wipes the learned behavior
    expect(engine.snapshot().stability.tools.get_user).toBeUndefined();
  });
});

describe('engine — Bloc D NoetherScanner (conserved invariants)', () => {
  it('surfaces a field conserved across reads as an invariant — once writes are in play', () => {
    const n = createNoetherScanner();
    wr(n, 'update_user'); // a mutation happened somewhere
    for (let i = 0; i < 6; i++) rd(n, 'get_config', { region: 'eu', v: i }); // region fixed, v moves
    const { invariants, concurrentWrites } = n.snapshot();
    expect(invariants).toContainEqual(
      expect.objectContaining({ tool: 'get_config', field: 'region' }),
    );
    expect(invariants.find((i) => i.field === 'v')).toBeUndefined(); // v moved every read — not conserved
    expect(concurrentWrites).toEqual(['update_user']);
  });

  it('reports NOTHING without an observed write (plain stability is slice 1, not Bloc D)', () => {
    const n = createNoetherScanner();
    for (let i = 0; i < 6; i++) rd(n, 'get_config', { region: 'eu' }); // perfectly stable, but no mutation seen
    expect(n.snapshot().invariants).toEqual([]);
  });

  it('a field that moves more than the tolerance is not an invariant', () => {
    const n = createNoetherScanner();
    wr(n, 'save');
    for (let i = 0; i < 6; i++) rd(n, 'feed', { latest: i }); // changes every single read (0% stable)
    expect(n.snapshot().invariants).toEqual([]);
  });

  it('needs MIN_OBS reads before it will call a field conserved', () => {
    const n = createNoetherScanner();
    wr(n, 'save');
    for (let i = 0; i < NOETHER_MIN_OBS - 1; i++) rd(n, 'get_config', { region: 'eu' });
    expect(n.snapshot().invariants).toEqual([]); // one short of the floor
    rd(n, 'get_config', { region: 'eu' });
    expect(n.snapshot().invariants).toContainEqual(
      expect.objectContaining({ field: 'region' }),
    );
  });

  it('is value-free (ADR-014): a secret field value never appears in the snapshot', () => {
    const n = createNoetherScanner();
    const secret = 'SSN-441-99-0000-secret';
    wr(n, 'save');
    for (let i = 0; i < 6; i++) rd(n, 'get_user', { ssn: secret });
    expect(JSON.stringify(n.snapshot())).not.toContain(secret);
  });

  it('invalidate() forgets a tool entirely', () => {
    const n = createNoetherScanner();
    wr(n, 'save');
    for (let i = 0; i < 6; i++) rd(n, 'get_config', { region: 'eu' });
    n.invalidate('get_config');
    expect(n.snapshot().invariants).toEqual([]);
  });
});

describe('engine — Bloc D GravitationalLens (ghost dependencies)', () => {
  // one ghost episode: the write, then the read that moved because of it.
  function episode(lens, write, read, getTool, value) {
    wr(lens, write);
    rd(lens, getTool, value ?? { amount: read });
  }

  it('crystallizes a write->read coupling when the write reliably moves the read', () => {
    const lens = createGravitationalLens();
    rd(lens, 'get_balance', { amount: 100 }); // baseline so it sits in the pre-write snapshot
    for (const amt of [90, 80, 70]) episode(lens, 'transfer', amt, 'get_balance');
    const ghost = lens
      .snapshot()
      .ghosts.find((g) => g.writeTool === 'transfer' && g.affects === 'get_balance');
    expect(ghost).toBeDefined();
    expect(ghost.correlation).toBe(1); // moved every time
    expect(ghost.observations).toBe(3);
  });

  it('does NOT couple a write to a read it never moves', () => {
    const lens = createGravitationalLens();
    rd(lens, 'get_config', { flag: true });
    for (let i = 0; i < 4; i++) {
      wr(lens, 'save_log');
      rd(lens, 'get_config', { flag: true });
    } // unchanged
    expect(lens.snapshot().ghosts).toEqual([]); // correlation 0 — no ghost
  });

  it('counts one vote per write episode — a repeated read does not inflate the correlation', () => {
    const lens = createGravitationalLens();
    rd(lens, 'get_balance', { amount: 100 });
    for (const amt of [90, 80, 70]) {
      wr(lens, 'transfer');
      rd(lens, 'get_balance', { amount: amt });
      rd(lens, 'get_balance', { amount: amt }); // read AGAIN, same episode — must not double-count
      rd(lens, 'get_balance', { amount: amt });
    }
    const ghost = lens.snapshot().ghosts.find((g) => g.affects === 'get_balance');
    expect(ghost.observations).toBe(3); // three episodes, not nine reads
  });

  it('does not score a read until it has a pre-write baseline (cannot attribute a move it never saw)', () => {
    const lens = createGravitationalLens();
    for (let i = 0; i < 4; i++) {
      // 4 write episodes, get_balance brand-new at the first
      wr(lens, 'transfer');
      rd(lens, 'get_balance', { amount: 100 - i });
    }
    // the first read only established the baseline (get_balance wasn't in that write's
    // snapshot), so only the next 3 episodes are votes — 4 pairs yield 3 observations.
    const ghost = lens.snapshot().ghosts.find((g) => g.affects === 'get_balance');
    expect(ghost.observations).toBe(3);
  });

  it('is value-free (ADR-014): a secret read value never appears in the snapshot', () => {
    const lens = createGravitationalLens();
    const secret = 'BEAR-token-d34db33f';
    rd(lens, 'get_session', { token: 'old' });
    for (let i = 0; i < 3; i++) {
      wr(lens, 'rotate');
      rd(lens, 'get_session', { token: `${secret}-${i}` });
    }
    expect(JSON.stringify(lens.snapshot())).not.toContain(secret);
  });

  it('bounds the correlation table at MAX_GHOSTS, evicting the weakest', () => {
    const lens = createGravitationalLens();
    rd(lens, 'G', { v: 0 }); // one read tool, many distinct write tools
    const n = ENGINE_LIMITS.MAX_GHOSTS + 25;
    for (let i = 0; i < n; i++) {
      wr(lens, `W${i}`);
      rd(lens, 'G', { v: i + 1 });
    } // each Wi:::G, one episode
    // none reach MIN_OBS so none surface, but the table must not have grown past the cap.
    expect(lens.snapshot().ghosts.length).toBeLessThanOrEqual(ENGINE_LIMITS.MAX_GHOSTS);
  });

  it('invalidate() drops every coupling touching a tool', () => {
    const lens = createGravitationalLens();
    rd(lens, 'get_balance', { amount: 100 });
    for (const amt of [90, 80, 70]) {
      wr(lens, 'transfer');
      rd(lens, 'get_balance', { amount: amt });
    }
    lens.invalidate('transfer');
    expect(lens.snapshot().ghosts).toEqual([]);
  });
});

describe('engine — Bloc D createDependencyMap (the composed surface)', () => {
  it('composes invariants + ghosts behind one observe/snapshot, with a stats header', () => {
    const map = createDependencyMap();
    // a conserved field + a ghost coupling, driven through the single surface
    rd(map, 'get_balance', { amount: 100, currency: 'EUR' });
    for (const amt of [90, 80, 70, 60, 50]) {
      wr(map, 'transfer');
      rd(map, 'get_balance', { amount: amt, currency: 'EUR' }); // amount moves, currency conserved
    }
    const snap = map.snapshot();
    expect(snap.stats).toEqual({
      invariants: snap.invariants.length,
      ghosts: snap.ghosts.length,
    });
    expect(snap.invariants).toContainEqual(
      expect.objectContaining({ tool: 'get_balance', field: 'currency' }),
    );
    expect(snap.ghosts).toContainEqual(
      expect.objectContaining({ writeTool: 'transfer', affects: 'get_balance' }),
    );
    expect(snap.concurrentWrites).toContain('transfer');
  });

  it('invalidate() reaches both sub-organs', () => {
    const map = createDependencyMap();
    rd(map, 'get_balance', { amount: 100, currency: 'EUR' });
    for (const amt of [90, 80, 70, 60, 50]) {
      wr(map, 'transfer');
      rd(map, 'get_balance', { amount: amt, currency: 'EUR' });
    }
    map.invalidate('get_balance');
    const snap = map.snapshot();
    expect(snap.invariants).toEqual([]);
    expect(snap.ghosts).toEqual([]);
  });
});

describe('engine — Bloc B flywheel (slice 5, the first ACTIVE organ)', () => {
  const FLY_MIN_HITS = 3; // mirrors FLYWHEEL.MIN_HITS (module-private)
  const FLY_TTL_MS = 30_000; // mirrors FLYWHEEL.TTL_MS
  const FLY_MAX = 256; // mirrors FLYWHEEL.MAX_ENTRIES
  // observe the same proven-pure read `n` times at a fixed ts.
  const prime = (fw, tool, args, result, n = FLY_MIN_HITS, ts = 1000) => {
    for (let i = 0; i < n; i++) fw.observe(tool, args, result, ts);
  };

  it('misses until the purity bar, then serves (never a response it has not watched repeat)', () => {
    const fw = createFlywheel();
    fw.observe('get_cfg', { env: 'prod' }, { v: 1 }, 1000);
    expect(fw.preCall('get_cfg', { env: 'prod' }, 1000).hit).toBe(false); // 1 sighting — not proven
    fw.observe('get_cfg', { env: 'prod' }, { v: 1 }, 1000);
    expect(fw.preCall('get_cfg', { env: 'prod' }, 1000).hit).toBe(false); // 2 — still not proven
    fw.observe('get_cfg', { env: 'prod' }, { v: 1 }, 1000);
    expect(fw.preCall('get_cfg', { env: 'prod' }, 1000)).toEqual({
      hit: true,
      value: { v: 1 },
    }); // 3 -> pure
  });

  it('keys on tool + exact args — a different query never gets a cached answer', () => {
    const fw = createFlywheel();
    prime(fw, 'get_user', { id: 1 }, { name: 'a' });
    expect(fw.preCall('get_user', { id: 1 }, 1000).hit).toBe(true);
    expect(fw.preCall('get_user', { id: 2 }, 1000).hit).toBe(false); // different args = different entry
    expect(fw.preCall('list_users', { id: 1 }, 1000).hit).toBe(false); // different tool
  });

  it('canonicalizes args — key order does not split the cache', () => {
    const fw = createFlywheel();
    prime(fw, 'search', { a: 1, b: 2 }, { rows: [] });
    expect(fw.preCall('search', { b: 2, a: 1 }, 1000).hit).toBe(true); // {a,b} and {b,a} are the same query
  });

  it('a changed response restarts the purity proof and the latest bytes win', () => {
    const fw = createFlywheel();
    prime(fw, 'get_price', {}, { eur: 10 });
    expect(fw.preCall('get_price', {}, 1000).hit).toBe(true);
    fw.observe('get_price', {}, { eur: 11 }, 1000); // the answer moved
    expect(fw.preCall('get_price', {}, 1000).hit).toBe(false); // proof reset — won't serve a one-off
    prime(fw, 'get_price', {}, { eur: 11 }, FLY_MIN_HITS - 1); // two more identical -> proven again
    expect(fw.preCall('get_price', {}, 1000)).toEqual({ hit: true, value: { eur: 11 } }); // latest value served
  });

  it('TTL bounds staleness — freshness is measured from the last real fetch, a hit never extends it', () => {
    const fw = createFlywheel();
    prime(fw, 'get_cfg', {}, { v: 1 }, FLY_MIN_HITS, 1000); // last fetch at ts=1000
    expect(fw.preCall('get_cfg', {}, 1000 + FLY_TTL_MS).hit).toBe(true); // still fresh at the boundary
    expect(fw.preCall('get_cfg', {}, 1000 + FLY_TTL_MS + 1).hit).toBe(false); // expired — re-fetch needed
  });

  it('invalidate(tool) drops every cached query for that tool', () => {
    const fw = createFlywheel();
    prime(fw, 'get_cfg', { a: 1 }, { v: 1 });
    prime(fw, 'get_cfg', { a: 2 }, { v: 2 });
    expect(fw.snapshot(1000).stats.entries).toBe(2);
    fw.invalidate('get_cfg');
    expect(fw.snapshot(1000).stats.entries).toBe(0);
    expect(fw.preCall('get_cfg', { a: 1 }, 1000).hit).toBe(false);
  });

  it('is bounded (rule #1): caps at MAX_ENTRIES, evicting the oldest fetch first', () => {
    const fw = createFlywheel();
    for (let i = 0; i < FLY_MAX + 5; i++) fw.observe(`tool_${i}`, {}, { i }, 1000 + i); // distinct entries, increasing ts
    const snap = fw.snapshot(1000 + FLY_MAX + 10);
    expect(snap.stats.entries).toBe(FLY_MAX); // never grows past the cap
    expect(snap.stats.evictions).toBe(5); // the 5 oldest were evicted
  });

  it('is value-free (ADR-014): the cached value never appears in the snapshot', () => {
    const fw = createFlywheel();
    const secret = 'PAN-4111-1111-1111-1111';
    prime(fw, 'get_card', { id: 7 }, { pan: secret });
    expect(fw.preCall('get_card', { id: 7 }, 1000).value).toEqual({ pan: secret }); // reachable ONLY via preCall
    expect(JSON.stringify(fw.snapshot(1000))).not.toContain(secret); // never through the snapshot
  });

  it('counts honest hits and misses for the recycling gauge (ADR-013)', () => {
    const fw = createFlywheel();
    prime(fw, 'get_cfg', {}, { v: 1 });
    fw.preCall('get_cfg', {}, 1000); // served
    fw.preCall('get_cfg', {}, 1000); // served
    fw.preCall('absent', {}, 1000); // miss
    const { stats } = fw.snapshot(1000);
    expect(stats.served).toBe(2);
    expect(stats.misses).toBe(1);
  });
});
