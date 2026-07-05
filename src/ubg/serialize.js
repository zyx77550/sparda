// ubg/serialize.js — canonical bytes out.
// The determinism contract ends here: canonicalizeGraph() fixes node order,
// edge order and key order; this file fixes the bytes (2-space JSON, trailing
// newline, atomic write). No timestamps anywhere in the artifact — identity
// comes from sourceHash, so `sparda ubg` twice on an unchanged repo produces
// byte-identical files and a clean git diff.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalizeGraph } from './schema.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

export function serializeGraph(graph) {
  return JSON.stringify(canonicalizeGraph(graph), null, 2) + '\n';
}

export function writeGraph(graph, cwd, outPath = null) {
  const target = outPath
    ? path.resolve(cwd, outPath)
    : path.join(cwd, '.sparda', 'ubg.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  atomicWrite(target, serializeGraph(graph));
  return target;
}

// content identity of the compilation inputs: sha256 over (relPath, fileHash)
// pairs in sorted path order — same sources, same hash, any machine
export function sourceHashOf(cwd, relFiles) {
  const h = crypto.createHash('sha256');
  for (const relFile of [...new Set(relFiles)].sort()) {
    h.update(relFile);
    h.update('\0');
    try {
      h.update(fs.readFileSync(path.resolve(cwd, relFile)));
    } catch {
      h.update('<unreadable>');
    }
    h.update('\0');
  }
  return h.digest('hex');
}
