// ubg/fingerprint.js — portable behavior fingerprints (ADR-035, Brick 1).
//
// The UBG's node ids are content-derived but REPO-LOCAL: `logic:src/index.ts#foo:44`
// names a file, a line, a symbol. Two codebases that share the exact same behavior
// still get different ids. A *behavior fingerprint* erases those coordinates and
// keeps only the behavioral SHAPE of an entrypoint's reachable subgraph — verb,
// guard presence, validation, the kinds of effects it runs, and the invariant
// classes on the state it writes. Same shape in two different repos → same hash.
//
// That hash is an ADDRESS. It turns "a behavior" into something you can look up:
// the key under which a diagnosis (an antibody) learned once, anywhere, applies
// everywhere the same shape occurs. This file only computes the address; it makes
// no network call and stores nothing (hard rule #1). Deterministic, locale-
// independent, byte-stable machine to machine (the same promise as the graph).
import crypto from 'node:crypto';
import { indexGraph, reachOf } from './apocalypse.js';
import { cmp, stableStringify } from './schema.js';

export const FINGERPRINT_VERSION = 'bh1'; // behavior-hash v1 — bump on shape change

// entrypoint id is `entrypoint:${METHOD} ${path}`. The verb is behavioral; the
// literal path segments are repo-local, but the *arity* of its parameters
// (`:id`, `{id}`) is part of the shape.
function entrypointShape(ep) {
  const m = /^entrypoint:(\S+)\s+(.*)$/.exec(ep.id);
  const method = (m?.[1] ?? ep.meta?.method ?? 'GET').toUpperCase();
  const path = m?.[2] ?? '';
  const pathParams = (path.match(/:(\w+)|\{(\w+)\}/g) ?? []).length;
  return { method, pathParams };
}

// One entrypoint → { behaviorHash, descriptor }. The descriptor is the inspectable
// pre-image (so a human/agent can see WHY two things share an address); the hash is
// sha256 over its canonical bytes. Everything here is coordinate-free by design.
export function fingerprintEntrypoint(indexed, ep) {
  const { nodes, cfOut, mutOut } = indexed;
  const reached = [...reachOf(ep.id, cfOut)].map((id) => nodes.get(id)).filter(Boolean);

  const guards = reached.filter((n) => n.kind === 'guard').length;

  const effects = []; // sorted multiset of effect atoms, e.g. "db_write:update"
  const writes = []; // per-write: invariant CLASSES touched + tx/member flags
  let observable = false;

  for (const n of reached) {
    if (n.kind !== 'effect') continue;
    const type = n.meta?.effectType ?? n.id.split(':')[1] ?? 'effect';
    const op = n.meta?.op ?? null;
    effects.push(op ? `${type}:${op}` : type);
    if (n.meta?.observable) observable = true;
    for (const e of mutOut.get(n.id) ?? []) {
      const state = nodes.get(e.to);
      const invariants = [
        ...new Set((state?.meta?.invariants ?? []).map((i) => i.type)),
      ].sort(cmp); // classes only (check/unique/notnull) — never the table or expr
      writes.push({
        op: op ?? 'write',
        invariants,
        tx: Boolean(n.meta?.transaction),
        member: state?.meta?.role === 'member',
      });
    }
  }

  effects.sort(cmp);
  writes.sort((a, b) => cmp(stableStringify(a), stableStringify(b)));

  const { method, pathParams } = entrypointShape(ep);
  const descriptor = {
    v: FINGERPRINT_VERSION,
    method,
    pathParams,
    guards,
    validated: Boolean(ep.meta?.inputValidated),
    observable,
    effects,
    writes,
  };
  return { behaviorHash: hashOf(descriptor), descriptor };
}

// Whole graph → one fingerprint per entrypoint, sorted by id (deterministic).
export function fingerprintGraph(graph) {
  const indexed = indexGraph(graph);
  return indexed.entrypoints
    .map((ep) => ({ entrypoint: ep.id, ...fingerprintEntrypoint(indexed, ep) }))
    .sort((a, b) => cmp(a.entrypoint, b.entrypoint));
}

function hashOf(descriptor) {
  const digest = crypto
    .createHash('sha256')
    .update(stableStringify(descriptor))
    .digest('hex')
    .slice(0, 32);
  return `${FINGERPRINT_VERSION}_${digest}`;
}
