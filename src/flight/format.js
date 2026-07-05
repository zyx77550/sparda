// flight/format.js — the flight file: one production request, replayable.
// A flight is the ENTIRE nondeterminism of one request: the input, the final
// response, and every tap (db, http, time, random, uuid) in execution order.
// Identity is content: id = sha256 of the canonical JSON — no timestamps, no
// counters, so the same request recorded twice on two machines is the same
// flight. Everything between the taps is deterministic code; that is the
// compiler's guarantee (SBIR §2.8) and the whole reason this file can exist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

export const FLIGHT_VERSION = 'sparda-flight/v1';

export function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value), null, 2) + '\n';
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep); // tap ORDER is meaning
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}

export function flightIdOf(flight) {
  const { id: _drop, ...body } = flight;
  return crypto
    .createHash('sha256')
    .update(canonicalJson(body))
    .digest('hex')
    .slice(0, 16);
}

export function flightDir(cwd) {
  return path.join(cwd, '.sparda', 'flight');
}

export function saveFlight(cwd, flight) {
  const body = { version: FLIGHT_VERSION, ...flight };
  const id = flightIdOf(body);
  const dir = flightDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  atomicWrite(file, canonicalJson({ ...body, id }));
  return { id, file };
}

export function loadFlight(cwd, id) {
  const file = path.join(flightDir(cwd), `${id}.json`);
  const flight = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (flight.version !== FLIGHT_VERSION)
    throw Object.assign(
      new Error(`flight ${id} has version ${flight.version}, expected ${FLIGHT_VERSION}`),
      { code: 'USER' },
    );
  return flight;
}

export function listFlights(cwd) {
  const dir = flightDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}
