// flight/box.js — the FlightBox: one set of patches, two modes.
// In RECORD mode every nondeterminism point (fetch, Date.now, Math.random,
// crypto.randomUUID, wrapped db clients) passes through to reality and leaves
// a tap behind. In REPLAY mode the same points are fed the recorded values in
// strict FIFO order per kind — label-checked, fail-loud: any mismatch is a
// FlightDivergence, never a silent fuzzy match. Code OUTSIDE a request
// context is untouched (AsyncLocalStorage decides), so arming the box in
// production changes nothing for non-instrumented paths.
import { AsyncLocalStorage } from 'node:async_hooks';
import { saveFlight } from './format.js';

const MAX_BODY_BYTES = 262144; // 256 KB per recorded http body — bounded flights

export class FlightDivergence extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'FlightDivergence';
    this.detail = detail;
  }
}

export function createFlightBox() {
  const als = new AsyncLocalStorage();
  const originals = {};
  let armed = false;

  function arm() {
    if (armed) return;
    armed = true;
    originals.fetch = globalThis.fetch;
    originals.dateNow = Date.now;
    originals.random = Math.random;
    originals.randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);

    Date.now = function spardaDateNow() {
      const store = als.getStore();
      if (!store) return originals.dateNow();
      if (store.mode === 'record') {
        const v = originals.dateNow();
        tapOut(store, 'time', 'Date.now', v);
        return v;
      }
      return takeTap(store, 'time', 'Date.now');
    };

    Math.random = function spardaRandom() {
      const store = als.getStore();
      if (!store) return originals.random();
      if (store.mode === 'record') {
        const v = originals.random();
        tapOut(store, 'random', 'Math.random', v);
        return v;
      }
      return takeTap(store, 'random', 'Math.random');
    };

    if (originals.randomUUID) {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: function spardaRandomUUID() {
          const store = als.getStore();
          if (!store) return originals.randomUUID();
          if (store.mode === 'record') {
            const v = originals.randomUUID();
            tapOut(store, 'uuid', 'crypto.randomUUID', v);
            return v;
          }
          return takeTap(store, 'uuid', 'crypto.randomUUID');
        },
      });
    }

    globalThis.fetch = async function spardaFetch(input, init) {
      const store = als.getStore();
      if (!store) return originals.fetch(input, init);
      const url = typeof input === 'string' ? input : (input?.url ?? String(input));
      const method = (init?.method ?? 'GET').toUpperCase();
      const label = `${method} ${url}`;
      if (store.mode === 'record') {
        const res = await originals.fetch(input, init);
        const text = (await res.text()).slice(0, MAX_BODY_BYTES);
        const headers = { 'content-type': res.headers.get('content-type') ?? '' };
        tapOut(store, 'http', label, { status: res.status, headers, body: text });
        return new Response(text, { status: res.status, headers });
      }
      const rec = takeTap(store, 'http', label);
      return new Response(rec.body, { status: rec.status, headers: rec.headers });
    };
  }

  function disarm() {
    if (!armed) return;
    armed = false;
    globalThis.fetch = originals.fetch;
    Date.now = originals.dateNow;
    Math.random = originals.random;
    if (originals.randomUUID)
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: originals.randomUUID,
      });
  }

  // any client exposing .query()/.execute() — pg, mysql2, sqlite wrappers …
  function wrapClient(client, name = 'db') {
    const wrapMethod = (method) =>
      async function spardaQuery(...args) {
        const store = als.getStore();
        if (!store) return client[method](...args);
        const label = `${name}.${method}:${String(args[0]).slice(0, 60)}`;
        if (store.mode === 'record') {
          const result = await client[method](...args);
          tapOut(store, 'db', label, jsonClone(result, label));
          return result;
        }
        return takeTap(store, 'db', label);
      };
    return new Proxy(client, {
      get(target, prop, receiver) {
        if (
          (prop === 'query' || prop === 'execute') &&
          typeof target[prop] === 'function'
        )
          return wrapMethod(prop);
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  // Express middleware — mount early; the request's whole async tree records.
  // The flight is finalized and written on response finish.
  function middleware({ cwd = process.cwd(), onFlight = null } = {}) {
    return function spardaFlightRecorder(req, res, next) {
      const store = { mode: 'record', taps: [] };
      const chunks = [];
      const origWrite = res.write.bind(res);
      const origEnd = res.end.bind(res);
      res.write = (chunk, ...rest) => {
        if (chunk) chunks.push(Buffer.from(chunk));
        return origWrite(chunk, ...rest);
      };
      res.end = (chunk, ...rest) => {
        if (chunk && typeof chunk !== 'function') chunks.push(Buffer.from(chunk));
        return origEnd(chunk, ...rest);
      };
      res.on('finish', () => {
        const flight = {
          request: {
            method: req.method,
            url: req.originalUrl ?? req.url,
            headers: { 'content-type': req.headers['content-type'] ?? '' },
            body: req.body ?? null,
          },
          response: {
            status: res.statusCode,
            headers: { 'content-type': res.getHeader('content-type') ?? '' },
            body: Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY_BYTES),
          },
          taps: store.taps,
        };
        const saved = saveFlight(cwd, flight);
        if (onFlight) onFlight(saved, flight);
      });
      als.run(store, next);
    };
  }

  // replay plumbing — one store per replayed request
  function makeReplayStore(flight) {
    const queues = new Map();
    for (const tap of flight.taps) {
      if (!queues.has(tap.kind)) queues.set(tap.kind, []);
      queues.get(tap.kind).push(tap);
    }
    return { mode: 'replay', queues, divergences: [] };
  }

  const runWith = (store, fn) => als.run(store, fn);

  return { arm, disarm, wrapClient, middleware, makeReplayStore, runWith };
}

function tapOut(store, kind, label, result) {
  store.taps.push({ seq: store.taps.length, kind, label, result });
}

// strict FIFO per kind, label-checked — the "quasi infallible" contract:
// the replayed code must ask reality the SAME questions in the SAME order
function takeTap(store, kind, label) {
  const queue = store.queues.get(kind);
  const tap = queue?.shift();
  if (!tap) {
    const d = { kind, expected: null, got: label };
    store.divergences.push(d);
    throw new FlightDivergence(
      `replay diverged: code asked for ${kind} "${label}" but the flight has no more ${kind} taps`,
      d,
    );
  }
  if (tap.label !== label) {
    const d = { kind, expected: tap.label, got: label };
    store.divergences.push(d);
    throw new FlightDivergence(
      `replay diverged: flight expected ${kind} "${tap.label}", code asked for "${label}"`,
      d,
    );
  }
  return tap.result;
}

function jsonClone(value, label) {
  try {
    const s = JSON.stringify(value);
    if (s === undefined) throw new Error('undefined');
    return JSON.parse(s);
  } catch {
    // honesty over convenience: an unserializable tap cannot replay — record
    // the fact so replay fails loudly instead of returning garbage
    throw new FlightDivergence(`tap "${label}" returned an unserializable value`, {
      label,
    });
  }
}
