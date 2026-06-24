// server/condenser.js — call-sequence recording (Labs): detect tool-call circuits.
// Deterministic, zero LLM, default OFF. Observes the session's current of tool
// calls and detects circuits — an output value of call A feeding an argument of
// a later call B. Persists STRUCTURE only (tool names, arg names, counts) into
// sparda.json: payload values can be PII and the manifest is committed to git.
import fs from 'node:fs';
import { writeManifestSync } from './persistence.js';

const WINDOW = 20; // calls remembered per session (ring)
const MAX_VALUES = 50; // scalars kept per payload
const MAX_NODES = 200; // payload walk budget — nothing heavy, ever
const MAX_DEPTH = 4;
const MAX_CHAIN = 5; // a circuit longer than this is noise, not a workflow
const MAX_LINKS = 10;
const MAX_CIRCUITS = 30; // bounded memory, same philosophy as antibodies (ADR-010)
// an emergent capability is a suggestion only after N observations (survival rule)
export const CIRCUIT_OBSERVED_THRESHOLD = 3;

// Labs gate: explicit opt-in in sparda.json, or env override for one session.
export function sequenceRecordingEnabled(manifest, env = process.env) {
  return manifest?.labs?.recordSequences === true || env.SPARDA_RECORD_SEQUENCES === '1';
}

export function createSequenceRecorder({ manifest, manifestPath, harvester, onCircuit }) {
  manifest.labs ??= {};
  manifest.labs.circuits ??= {};
  const ring = [];

  // hot path stays free: capture references, walk + match in idle (R4.4)
  function record(tool, args, output) {
    harvester.enqueue(() => analyze(tool, args, output));
  }

  function analyze(tool, args, output) {
    const argEntries = extractArgEntries(args);
    let link = null;
    // most recent producer wins: the freshest output is the likeliest source
    outer: for (let i = ring.length - 1; i >= 0; i--) {
      for (const [argName, value] of argEntries) {
        if (ring[i].outValues.has(value)) {
          // fromKey = where the value lived in the producer's output — the structure
          // crystallization needs to re-feed the same arg at composite run time
          link = { from: ring[i], arg: argName, fromKey: ring[i].outValues.get(value) };
          break outer;
        }
      }
    }
    const chain = link ? [...link.from.chain.slice(-(MAX_CHAIN - 1)), tool] : [tool];
    ring.push({ tool, chain, outValues: extractValues(output) });
    if (ring.length > WINDOW) ring.shift();
    if (!link) return;

    const sig = chain.join('>');
    const now = new Date().toISOString();
    const circuits = manifest.labs.circuits;
    const c =
      circuits[sig] ??
      (circuits[sig] = {
        steps: chain,
        links: [],
        seen: 0,
        firstSeen: now,
        lastSeen: now,
      });
    c.seen += 1;
    c.lastSeen = now;
    if (
      c.links.length < MAX_LINKS &&
      !c.links.some(
        (l) => l.from === link.from.tool && l.to === tool && l.arg === link.arg,
      )
    ) {
      c.links.push({
        from: link.from.tool,
        to: tool,
        arg: link.arg,
        fromKey: link.fromKey,
      });
    }
    evict(circuits);
    persist();
    if (c.seen === CIRCUIT_OBSERVED_THRESHOLD) onCircuit?.(sig, c);
  }

  // least-observed circuits make room first; among equals, the stalest
  function evict(circuits) {
    const keys = Object.keys(circuits);
    if (keys.length <= MAX_CIRCUITS) return;
    keys
      .sort(
        (a, b) =>
          circuits[a].seen - circuits[b].seen ||
          circuits[a].lastSeen.localeCompare(circuits[b].lastSeen),
      )
      .slice(0, keys.length - MAX_CIRCUITS)
      .forEach((k) => delete circuits[k]);
  }

  // merge-write like persistImmune: never clobber fields written by others
  function persist() {
    try {
      const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      onDisk.labs = { ...onDisk.labs, circuits: manifest.labs.circuits };
      writeManifestSync(manifestPath, onDisk);
    } catch {
      /* disk briefly unavailable — circuits stay in memory */
    }
  }

  return { record, circuits: () => manifest.labs.circuits };
}

// A scalar is link-worthy when it can plausibly be an identifier. Small ints
// (counts, pages, flags) and 1-char strings are the noise floor — excluded,
// unless a single digit sits under an id-ish key (id, userId, orderId…).
function candidateValue(key, v) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.length < 2 || s.length > 200) return null;
    if (['true', 'false', 'null', 'undefined'].includes(s.toLowerCase())) return null;
    return s;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (Math.abs(v) >= 10 || /id$/i.test(key ?? '')) return String(v);
  }
  return null;
}

// bounded iterative walk; array elements inherit the parent key (indices carry no
// meaning). Shared with crystallize.js (findByKey) — same budget everywhere.
export function walkPayload(node, visit) {
  const stack = [[null, node, 0]];
  let seen = 0;
  while (stack.length && seen < MAX_NODES) {
    const [key, v, depth] = stack.pop();
    seen += 1;
    if (v && typeof v === 'object') {
      if (depth >= MAX_DEPTH) continue;
      for (const [k, child] of Object.entries(v)) {
        stack.push([Array.isArray(v) ? key : k, child, depth + 1]);
      }
      continue;
    }
    if (visit(key, v) === false) return;
  }
}

// value → key it lived under (first sighting wins): has() drives link detection,
// get() gives crystallization its fromKey
function extractValues(output) {
  const values = new Map();
  walkPayload(output, (key, v) => {
    const c = candidateValue(key, v);
    if (c !== null && !values.has(c)) values.set(c, key ?? null);
    return values.size < MAX_VALUES;
  });
  return values;
}

function extractArgEntries(args) {
  const entries = [];
  walkPayload(args, (key, v) => {
    const c = candidateValue(key, v);
    if (c !== null && key) entries.push([key, c]);
    return entries.length < 20;
  });
  return entries;
}
