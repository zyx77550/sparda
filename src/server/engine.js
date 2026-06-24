// server/engine.js — the living engine (Bloc B), slice 1: the stability brain.
// A passive, per-tool read of which response fields stay put across calls and
// which move. It feeds the eventual "serve a stable answer without paying the
// host again" flywheel, but slice 1 only OBSERVES and CLASSIFIES — it never
// serves, never blocks.
//
// Three invariants keep it honest:
//   - off the hot path: stdio.js feeds it through the idle harvester (rule #1);
//   - value-free: it keeps a fixed-size fingerprint per field, never the value
//     itself — so nothing it holds can leak PII (ADR-014 ethos). We keep hashed
//     fingerprints and emit changed field NAMES only — never {from,to} values —
//     which is stricter and all the brain needs;
//   - runtime-only: nothing here is persisted, so there is no carry-over to
//     protect (rule #5) — same posture as the router's purity detector.

// bounded memory, same philosophy as antibodies (ADR-010) and circuits.
export const ENGINE_LIMITS = {
  MAX_TOOLS: 100,
  MAX_FIELDS: 60,
  MAX_TS: 50,
  MAX_AXONS: 200,
  MAX_GHOSTS: 200,
};

// FNV-1a 32-bit: collapses a field's value to a fixed token so change can be
// detected without retaining the value. Non-crypto on purpose — nothing heavy,
// and it runs in idle time anyway.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

function safeStringify(v) {
  try {
    return JSON.stringify(v) ?? 'null';
  } catch {
    return String(v);
  }
}

// top-level field fingerprints only — bounded, value-free. A non-object body
// (array, scalar) is one synthetic field: we can still tell if it moved, just
// not which part. Per-element granularity is a later slice.
function fieldHashes(result) {
  const out = new Map();
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    for (const [k, v] of Object.entries(result)) {
      if (out.size >= ENGINE_LIMITS.MAX_FIELDS) break;
      out.set(k, fnv1a(safeStringify(v)));
    }
  } else {
    out.set('__value__', fnv1a(safeStringify(result)));
  }
  return out;
}

// per-tool stability model. observe() classifies a fresh result against the last
// fingerprints; snapshot() reports names + counts only.
export function createPredictiveEngine() {
  const tools = new Map(); // tool -> { calls, fields: Map<name, {hash, seen, changed}> }
  const stats = { firstCall: 0, noChange: 0, delta: 0 };

  function observe(tool, result) {
    const hashes = fieldHashes(result);
    let rec = tools.get(tool);

    if (!rec) {
      if (tools.size >= ENGINE_LIMITS.MAX_TOOLS) return null; // bounded: stop learning new tools
      rec = { calls: 1, fields: new Map() };
      for (const [k, h] of hashes) rec.fields.set(k, { hash: h, seen: 1, changed: 0 });
      tools.set(tool, rec);
      stats.firstCall += 1;
      return { type: 'FIRST_CALL', tool };
    }

    rec.calls += 1;
    const changed = [];
    for (const [k, h] of hashes) {
      const f = rec.fields.get(k);
      if (!f) {
        // a field that wasn't there before is itself a change of shape
        if (rec.fields.size < ENGINE_LIMITS.MAX_FIELDS)
          rec.fields.set(k, { hash: h, seen: 1, changed: 0 });
        changed.push(k);
        continue;
      }
      f.seen += 1;
      if (f.hash !== h) {
        f.hash = h;
        f.changed += 1;
        changed.push(k);
      }
    }
    // a field that vanished this call also counts as movement
    for (const k of rec.fields.keys()) if (!hashes.has(k)) changed.push(k);

    if (changed.length === 0) {
      stats.noChange += 1;
      return { type: 'NO_CHANGE', tool };
    }
    stats.delta += 1;
    return { type: 'DELTA', tool, changedFields: changed };
  }

  // after a write the underlying resource may have moved — drop the model so a
  // stale "stable" reading can't survive it. (Wired later; kept faithful here.)
  function invalidate(tool) {
    tools.delete(tool);
  }

  // names + counts only — never a value. A field is "stable" once it has been
  // seen more than once without ever changing; "volatile" the moment it moves;
  // a field seen only on the first call is still unknown (reported in neither).
  function snapshot() {
    const perTool = {};
    for (const [tool, rec] of tools) {
      const stable = [];
      const volatile = [];
      for (const [name, f] of rec.fields) {
        if (f.changed > 0) volatile.push(name);
        else if (f.seen > 1) stable.push(name);
      }
      perTool[tool] = { calls: rec.calls, stable, volatile };
    }
    return { stats: { ...stats }, tools: perTool };
  }

  return { observe, invalidate, snapshot };
}

// rhythm constants. A tool needs at least MIN_TS sightings before its cadence is
// judged; a coefficient of variation (stddev/mean of the gaps between calls) at
// or under REGULARITY_THRESHOLD means the calls land on a steady beat.
const RHYTHM = { MIN_TS: 5, REGULARITY_THRESHOLD: 0.25 };

// the rhythm detector (Bloc B, slice 2 — ported from sparda.ts FourierDetector).
// It watches WHEN a tool is called, not what it returns: a steady cadence paired
// with a stable result (slice 1) is the textbook pre-fetch candidate. It keeps
// only call timestamps (plain numbers — never a payload, never PII), bounded per
// tool, runtime-only.
export function createRhythmDetector() {
  const times = new Map(); // tool -> number[] (ms timestamps, ring)
  const patterns = new Map(); // tool -> { periodMs, confidence, observations, nextPredictedMs }
  const stats = { patternsDetected: 0 };

  function record(tool, ts) {
    let arr = times.get(tool);
    if (!arr) {
      if (times.size >= ENGINE_LIMITS.MAX_TOOLS) return; // bounded: stop tracking new tools
      arr = [];
      times.set(tool, arr);
    }
    arr.push(ts);
    if (arr.length > ENGINE_LIMITS.MAX_TS) arr.shift();
    if (arr.length >= RHYTHM.MIN_TS) analyze(tool, arr);
  }

  function analyze(tool, arr) {
    const gaps = arr.slice(1).map((t, i) => t - arr[i]);
    const mean = gaps.reduce((s, x) => s + x, 0) / gaps.length;
    if (mean <= 0) return; // no forward progress — can't be a cadence
    const stdDev = Math.sqrt(gaps.reduce((s, x) => s + (x - mean) ** 2, 0) / gaps.length);
    const cv = stdDev / mean;
    if (cv <= RHYTHM.REGULARITY_THRESHOLD) {
      if (!patterns.has(tool)) stats.patternsDetected += 1;
      const last = arr[arr.length - 1];
      patterns.set(tool, {
        periodMs: Math.round(mean),
        confidence: Number((1 - cv).toFixed(3)),
        observations: arr.length,
        nextPredictedMs: Math.round(last + mean),
      });
    } else if (patterns.has(tool)) {
      // the beat broke — drop the stale pattern so the snapshot stays honest.
      // The literal port kept a pattern forever once seen; we don't.
      patterns.delete(tool);
    }
  }

  function invalidate(tool) {
    times.delete(tool);
    patterns.delete(tool);
  }

  // detected patterns only — names + cadence, never a value. nextEstimate is an
  // ISO instant so the reader can see WHEN the next call is expected.
  function snapshot() {
    const tools = {};
    for (const [tool, p] of patterns) {
      tools[tool] = {
        periodMs: p.periodMs,
        confidence: p.confidence,
        observations: p.observations,
        nextEstimate: new Date(p.nextPredictedMs).toISOString(),
      };
    }
    return { stats: { ...stats }, tools };
  }

  return { record, invalidate, snapshot };
}

// myelin constants. An edge "A-->B" (tool B called right after tool A) gains one
// layer of strength each time it is traversed; at THRESHOLD layers the path is
// "myelinated" — an entrenched habit. Strength saturates at MAX_LAYERS.
const MYELIN = { THRESHOLD: 3, MAX_LAYERS: 10 };

// the myelin tracker (Bloc A — myelination, runtime organ).
// It learns habitual tool ADJACENCY: which tool tends to follow which, and how
// entrenched that habit is. This complements the condenser, which links tools by
// DATA FLOW (an output value feeding the next call's arg) and persists/crystallizes
// them. Myelin needs no data link — pure succession — so it surfaces habits the
// condenser can't see. Runtime-only, value-free (edges are tool NAMES only),
// bounded. We deliberately drop the sandbox's simulated latency: prod measures
// real latency in the immune system and won't report an invented number.
export function createMyelinTracker() {
  const axons = new Map(); // "src-->tgt" -> { strength, traversals, lastTs, myelinated }
  let prev = null; // the previously observed tool — the chain is the session

  function observe(tool, ts) {
    if (prev !== null && prev !== tool) reinforce(`${prev}-->${tool}`, ts); // no self-edges
    prev = tool;
  }

  function reinforce(key, ts) {
    let a = axons.get(key);
    if (!a) {
      if (axons.size >= ENGINE_LIMITS.MAX_AXONS) evictWeakest();
      a = { strength: 0, traversals: 0, lastTs: ts, myelinated: false };
      axons.set(key, a);
    }
    a.traversals += 1;
    a.lastTs = ts;
    if (a.strength < MYELIN.MAX_LAYERS) a.strength += 1;
    a.myelinated = a.strength >= MYELIN.THRESHOLD;
  }

  // weakest first; among equals, the stalest — same eviction shape as circuits
  function evictWeakest() {
    let victimKey = null;
    let victim = null;
    for (const [k, a] of axons) {
      if (
        !victim ||
        a.strength < victim.strength ||
        (a.strength === victim.strength && a.lastTs < victim.lastTs)
      ) {
        victimKey = k;
        victim = a;
      }
    }
    if (victimKey !== null) axons.delete(victimKey);
  }

  function invalidate(tool) {
    if (prev === tool) prev = null;
    for (const k of [...axons.keys()]) {
      if (k.startsWith(`${tool}-->`) || k.endsWith(`-->${tool}`)) axons.delete(k);
    }
  }

  // established habits only (myelinated edges) — names + strength, never a value.
  function snapshot() {
    const edges = {};
    let myelinated = 0;
    for (const [k, a] of axons) {
      if (a.myelinated) {
        myelinated += 1;
        edges[k] = { strength: a.strength, traversals: a.traversals };
      }
    }
    return { stats: { tracked: axons.size, myelinated }, edges };
  }

  return { observe, invalidate, snapshot };
}

// the cartography of the invisible (Bloc D — slice 4, ported from sparda.ts
// NoetherScanner + GravitationalLens). The other organs read a tool in isolation
// (does ITS output move — slice 1; on what beat — slice 2) or simple succession
// (slice 3 / the condenser). Bloc D maps the relationships none of them can see:
//   - a Noether INVARIANT: a response field that stays conserved even while the app
//     is being mutated by writes — a true constant, the safest thing to cache hard;
//   - a GHOST DEPENDENCY: a write that silently MOVES some unrelated read — no data
//     flows between them (so the condenser is blind to it), they need not be adjacent
//     (so myelin is blind to it), yet the write reliably perturbs the read.
//
// Both sub-organs in the literal port retained whole result VALUES to compare them —
// a direct ADR-014 violation in prod (sparda.json is git-committed; values can be
// PII). We keep only FNV-1a fingerprints — the same trick slice 1 uses — so the map
// holds field/tool NAMES, counts and hashes, never a payload. We also drop the port's
// CategoryMapper "virtual routes": it is the 2-hop transitive closure of slice-3
// myelin (redundant), its confidence is an arbitrary min(a,b)/10, and its triple-
// nested rescan is O(E^2) on every call — the wrong trade even off the hot path.

// a field is a conserved invariant once it has held the same fingerprint across at
// least MIN_OBS reads with at least MIN_STABILITY of them unchanged. We surface it
// ONLY while writes have also been seen — without a mutation in play it is just
// slice-1 stability restated, nothing new.
const NOETHER = { MIN_OBS: 5, MIN_STABILITY: 0.85 };

export function createNoetherScanner() {
  const fields = new Map(); // tool -> Map<field, { first, total, matches }>
  const writeTools = new Set(); // names of tools observed mutating (bounded)

  function observe(tool, result, isWrite) {
    if (isWrite) {
      if (writeTools.size < ENGINE_LIMITS.MAX_TOOLS) writeTools.add(tool);
      return; // a write's own body is not a state read — it only proves mutation happened
    }
    let rec = fields.get(tool);
    if (!rec) {
      if (fields.size >= ENGINE_LIMITS.MAX_TOOLS) return; // bounded: stop learning new tools
      rec = new Map();
      fields.set(tool, rec);
    }
    for (const [k, h] of fieldHashes(result)) {
      const f = rec.get(k);
      if (!f) {
        if (rec.size < ENGINE_LIMITS.MAX_FIELDS)
          rec.set(k, { first: h, total: 1, matches: 1 });
        continue;
      }
      f.total += 1;
      if (f.first === h) f.matches += 1;
    }
  }

  function invalidate(tool) {
    fields.delete(tool);
    writeTools.delete(tool);
  }

  // conserved fields only — names + rates, never a value. Surfaced solely once writes
  // have been observed, so each invariant is a genuine "stable despite mutation" claim.
  function snapshot() {
    const invariants = [];
    if (writeTools.size > 0) {
      for (const [tool, rec] of fields) {
        for (const [field, f] of rec) {
          if (f.total < NOETHER.MIN_OBS) continue;
          const rate = f.matches / f.total;
          if (rate >= NOETHER.MIN_STABILITY) {
            invariants.push({
              tool,
              field,
              stability: Number(rate.toFixed(3)),
              observations: f.total,
            });
          }
        }
      }
    }
    return { invariants, concurrentWrites: [...writeTools] };
  }

  return { observe, invalidate, snapshot };
}

// a ghost dependency crystallizes once a write tool W has been followed by a MOVED
// read G in at least MIN_CORRELATION of MIN_OBS distinct write episodes. The literal
// port incremented hits and total together, so its correlation was always 1.0 — it
// could never see a write that DOESN'T move a read. We count every post-write sighting
// (one vote per episode) and only the moves as hits, so the rate is honest.
const GHOST = { MIN_OBS: 3, MIN_CORRELATION: 0.7 };

export function createGravitationalLens() {
  const lastHash = new Map(); // read tool -> last whole-result fingerprint
  const corr = new Map(); // "W:::G" -> { hits, total }
  let pendingWrite = null; // the write whose effect we are still attributing
  let snap = null; // fingerprint of every read at the instant W fired
  let scored = new Set(); // "W:::G" already counted this write episode

  function observe(tool, result, isWrite) {
    if (isWrite) {
      snap = new Map(lastHash); // freeze the readable world the moment W mutates it
      pendingWrite = tool;
      scored = new Set();
      return;
    }
    const h = fnv1a(safeStringify(result));
    if (pendingWrite !== null && snap.has(tool)) {
      const key = `${pendingWrite}:::${tool}`;
      if (!scored.has(key)) {
        // one vote per write episode — never inflate a repeated read
        scored.add(key);
        let c = corr.get(key);
        if (!c) {
          if (corr.size >= ENGINE_LIMITS.MAX_GHOSTS) evictWeakest();
          c = { hits: 0, total: 0 };
          corr.set(key, c);
        }
        c.total += 1;
        if (snap.get(tool) !== h) c.hits += 1; // the write moved this read
      }
    }
    if (lastHash.size < ENGINE_LIMITS.MAX_TOOLS || lastHash.has(tool))
      lastHash.set(tool, h);
  }

  // least-observed first; among equals, the least-correlated — same "weakest goes"
  // shape as circuits and axons.
  function evictWeakest() {
    let victimKey = null;
    let victim = null;
    for (const [k, c] of corr) {
      if (
        !victim ||
        c.total < victim.total ||
        (c.total === victim.total && c.hits < victim.hits)
      ) {
        victimKey = k;
        victim = c;
      }
    }
    if (victimKey !== null) corr.delete(victimKey);
  }

  function invalidate(tool) {
    lastHash.delete(tool);
    if (pendingWrite === tool) {
      pendingWrite = null;
      snap = null;
    }
    for (const k of [...corr.keys()]) {
      const [w, g] = k.split(':::');
      if (w === tool || g === tool) corr.delete(k);
    }
  }

  // crystallized ghost edges only — tool names + correlation, never a value.
  function snapshot() {
    const ghosts = [];
    for (const [k, c] of corr) {
      if (c.total < GHOST.MIN_OBS) continue;
      const rate = c.hits / c.total;
      if (rate >= GHOST.MIN_CORRELATION) {
        const [writeTool, affects] = k.split(':::');
        ghosts.push({
          writeTool,
          affects,
          correlation: Number(rate.toFixed(3)),
          observations: c.total,
        });
      }
    }
    return { ghosts };
  }

  return { observe, invalidate, snapshot };
}

// Bloc D spine — Noether invariants + ghost dependencies behind one surface, so the
// engine spine adds a single organ. (CategoryMapper deliberately omitted — see above.)
export function createDependencyMap() {
  const noether = createNoetherScanner();
  const lens = createGravitationalLens();
  return {
    observe(tool, result, isWrite) {
      noether.observe(tool, result, isWrite);
      lens.observe(tool, result, isWrite);
    },
    invalidate(tool) {
      noether.invalidate(tool);
      lens.invalidate(tool);
    },
    snapshot() {
      const n = noether.snapshot();
      const l = lens.snapshot();
      return {
        stats: { invariants: n.invariants.length, ghosts: l.ghosts.length },
        invariants: n.invariants,
        ghosts: l.ghosts,
        concurrentWrites: n.concurrentWrites,
      };
    },
  };
}

// the flywheel (Bloc B, slice 5 — ported from sparda.ts BloomGate/BlocB.preCall).
// THE turning point: every organ above only OBSERVES and reports. This one ACTS —
// preCall() can serve a proven-stable read straight from memory so the host call is
// never made (R4.3, ADR-020). It is therefore the first organ that retains result
// VALUES — it must, to hand them back. That is NOT an ADR-014 violation: ADR-014
// forbids values in PERSISTED state (sparda.json is git-committed; values can be
// PII). This cache is RAM-only, runtime-only (rule #5 — nothing to carry over),
// never serialized, and absent from snapshot() (which stays counts only). The bytes
// it holds are the same ones the host already holds before replying, memoized for
// one TTL window, dead with the process; a value is reachable ONLY through preCall
// serving it back to the same client that would have received it from the host.
//
// Three guards keep it honest: (1) it serves ONLY reads proven pure — the identical
// whole-response fingerprint seen MIN_HITS times for the exact same canonical arg
// signature (the same ≥3 bar as the router's purity detector, ADR-017); never a
// response it has not watched repeat. (2) TTL bounds staleness for ANY cause,
// including a mutation through a channel SPARDA can't see — freshness is measured
// from the last real host fetch and a hit never extends it. (3) write-invalidation
// (orchestrated by the spine via Bloc D ghost deps) purges precisely the reads an
// observed write moves. Bounded (rule #1): MAX_ENTRIES, oldest-evicted.
const FLYWHEEL = { MIN_HITS: 3, TTL_MS: 30_000, MAX_ENTRIES: 256 };

// recursively key-sorted so {a,b} and {b,a} are the SAME query (safeStringify alone
// is order-sensitive). Arrays keep order; scalars pass through.
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v;
}
function canonicalArgSig(args) {
  return safeStringify(canonicalize(args));
}

export function createFlywheel() {
  // entryKey "tool::<fnv1a(argsig)>" -> { tool, hash, hits, value, ts }. The key
  // hashes the args too, so not even a raw arg string is held — only a fixed token.
  const cache = new Map();
  const stats = { served: 0, misses: 0, evictions: 0 };

  function keyFor(tool, args) {
    return `${tool}::${fnv1a(canonicalArgSig(args))}`;
  }

  // hot-path surface (wired in 5b): return a cached value ONLY when proven pure and
  // fresh. now is injectable so freshness is deterministic in tests.
  function preCall(tool, args, now = Date.now()) {
    const e = cache.get(keyFor(tool, args));
    if (!e || e.hits < FLYWHEEL.MIN_HITS || now - e.ts > FLYWHEEL.TTL_MS) {
      stats.misses += 1;
      return { hit: false, value: null };
    }
    stats.served += 1;
    return { hit: true, value: e.value };
  }

  // population (off the hot path, reads only). An identical answer advances the
  // purity proof; a changed answer restarts it and the latest bytes win. ts is the
  // real fetch time — freshness is anchored here, never on a serve.
  function observe(tool, args, result, ts = Date.now()) {
    const k = keyFor(tool, args);
    const h = fnv1a(safeStringify(result));
    let e = cache.get(k);
    if (!e) {
      if (cache.size >= FLYWHEEL.MAX_ENTRIES) evictOldest();
      cache.set(k, { tool, hash: h, hits: 1, value: result, ts });
      return;
    }
    if (e.hash === h)
      e.hits += 1; // another identical sighting — closer to / past the bar
    else {
      e.hash = h;
      e.hits = 1;
    } // the answer moved — restart the proof
    e.value = result; // latest bytes always win
    e.ts = ts; // freshness from this real fetch
  }

  // oldest fetch goes first — same "weakest goes" shape as circuits/axons/ghosts.
  function evictOldest() {
    let victimKey = null;
    let oldest = Infinity;
    for (const [k, e] of cache)
      if (e.ts < oldest) {
        oldest = e.ts;
        victimKey = k;
      }
    if (victimKey !== null) {
      cache.delete(victimKey);
      stats.evictions += 1;
    }
  }

  // drop every entry for a tool — used by the spine to purge reads a write moved.
  function invalidate(tool) {
    for (const [k, e] of cache) if (e.tool === tool) cache.delete(k);
  }

  // counts only — never a value, never an arg. ready = entries currently serveable
  // (pure AND fresh), the honest "how much is live right now".
  function snapshot(now = Date.now()) {
    let ready = 0;
    for (const e of cache.values()) {
      if (e.hits >= FLYWHEEL.MIN_HITS && now - e.ts <= FLYWHEEL.TTL_MS) ready += 1;
    }
    return { stats: { ...stats, entries: cache.size, ready } };
  }

  return { preCall, observe, invalidate, snapshot };
}

// the engine spine. Slices 1 (stability), 2 (rhythm), 3 (myelin), 4 (dependency
// map) and 5 (flywheel) all hang off one observe/snapshot surface, so the bridge
// wiring stays minimal as slices land.
export function createSpardaEngine() {
  const predictive = createPredictiveEngine();
  const rhythm = createRhythmDetector();
  const myelin = createMyelinTracker();
  const deps = createDependencyMap();
  const flywheel = createFlywheel();
  return {
    // hot-path serve (R4.3): ask the flywheel for a proven-stable answer before the
    // bridge pays the host. Always safe to call — returns {hit:false} until an organ
    // has proof. The bridge gates the *use* of a hit behind SPARDA_FLYWHEEL (5b).
    preCall(tool, args) {
      return flywheel.preCall(tool, args);
    },
    // ts is captured on the hot path (a cheap clock read) and passed in, so the
    // cadence reflects real call times — not whenever the idle harvester drains.
    // isWrite lets Bloc D separate state reads from mutations (a GET can't move the
    // app; a write can); the other organs treat every successful call the same. args
    // feeds only the flywheel (its cache key); the rest ignore it.
    observe(tool, result, ts = Date.now(), isWrite = false, args = undefined) {
      rhythm.record(tool, ts);
      myelin.observe(tool, ts);
      deps.observe(tool, result, isWrite);
      if (isWrite) {
        // a write may silently move cached reads. Purge precisely via the learned
        // ghost map (the slice-4 payoff) instead of nuking the whole cache. Runs in
        // idle, so the bounded ghost scan never touches a request (rule #1).
        flywheel.invalidate(tool);
        for (const g of deps.snapshot().ghosts)
          if (g.writeTool === tool) flywheel.invalidate(g.affects);
      } else {
        flywheel.observe(tool, args, result, ts);
      }
      return predictive.observe(tool, result);
    },
    invalidate(tool) {
      predictive.invalidate(tool);
      rhythm.invalidate(tool);
      myelin.invalidate(tool);
      deps.invalidate(tool);
      flywheel.invalidate(tool);
    },
    // structural cache purge (5b): only the bridge knows HTTP paths, so when a write
    // hits a path it asks us to drop the cached GET on that SAME path. Flywheel-only —
    // unlike invalidate(), it must NOT erase the sibling read's learned rhythm/myelin/
    // deps, only its now-stale cached answer.
    invalidateCache(tool) {
      flywheel.invalidate(tool);
    },
    snapshot() {
      return {
        stability: predictive.snapshot(),
        rhythm: rhythm.snapshot(),
        myelin: myelin.snapshot(),
        dependencies: deps.snapshot(),
        flywheel: flywheel.snapshot(),
      };
    },
  };
}
