// server/persistence.js — durable, pluggable state persistence (Chantier 1).
//
// Two clearly-separated concerns live here:
//
//   1. THE MANIFEST (`sparda.json`) is a LOCAL git artifact: `remove`, `sync`,
//      `doctor` and carry-over all read it from disk, and it is committed. It
//      must never move to a remote store. What it needs is durability — a crash
//      mid-write must never leave it truncated. `atomicWriteFileSync` writes to
//      a temp file, fsyncs it, then renames (rename is atomic on POSIX/NTFS), so
//      a reader sees either the old bytes or the new bytes, never a half-file.
//
//   2. PLUGGABLE STATE DRIVERS (Memory / LocalFile / Redis) persist arbitrary,
//      engine-agnostic state by instanceId. This is the seam for the future
//      living-engine state (the bounded brain snapshot) and for multi-node
//      deployments — not for `sparda.json`. Redis is a LAZY import: it is never
//      a hard dependency (hard rule #8 — the 4 pinned deps stay 4), it only
//      loads if a user explicitly selects SPARDA_DRIVER=redis.
//
// Host never pays (hard rule #1): nothing here sits on the request path.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// ───────────────────────────────────────────────────────────────────────────
// ATOMIC FILE WRITE  (the single source of truth — generators + bridge use it)
// temp file → fsync → rename. fsync is the part the old `atomicWrite` lacked:
// without it, rename can land before the data is flushed and a power loss
// leaves a zero-length file. The temp sits next to the target (same fs) so the
// rename is a real atomic move, not a cross-device copy.
// ───────────────────────────────────────────────────────────────────────────

// Windows reality: Defender or the search indexer can hold a sub-second lock on the
// target mid-rename, surfacing as a transient EPERM/EACCES/EBUSY (seen as a ~1-in-N
// flake in the byte-for-byte fixture tests). A bounded retry with a short, non-
// spinning backoff clears it. A genuine failure (ENOENT, ENOSPC, EROFS) is NOT a
// lock — it is surfaced immediately, never retried. Off the hot path (rule #1), so
// the few ms of blocking on the rare retry never touch a request.
export const RENAME_MAX_ATTEMPTS = 5;
const RENAME_BACKOFF_MS = 10;
const TRANSIENT_LOCK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

// synchronous, non-spinning wait — blocks this thread for ms without burning CPU.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function atomicWriteFileSync(file, content) {
  const tmp = `${file}.sparda-tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!TRANSIENT_LOCK_CODES.has(err.code) || attempt >= RENAME_MAX_ATTEMPTS) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* best effort */
        }
        throw err;
      }
      sleepSync(RENAME_BACKOFF_MS * attempt); // 10, 20, 30, 40 ms — clears a brief AV/indexer lock
    }
  }
}

// Convenience for the manifest: pretty JSON + trailing newline, written atomically.
// Mirrors the exact byte shape the generators produce so diffs stay clean.
export function writeManifestSync(manifestPath, manifest) {
  atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

// Merge-write a single top-level key into the on-disk manifest without
// clobbering keys another writer (immune, sparding, labs, semantic) may have
// touched since. Re-reads, sets one field, writes atomically. Silent on a brief
// disk hiccup — the in-memory copy is the source of truth and will retry.
export function mergeManifestKeySync(manifestPath, key, value) {
  try {
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    onDisk[key] = value;
    writeManifestSync(manifestPath, onDisk);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PLUGGABLE STATE DRIVERS  (engine-agnostic key/value by instanceId)
// Interface: save(id, data) load(id) delete(id) listInstances()  → all async.
// ───────────────────────────────────────────────────────────────────────────

// Driver 1 — in-memory. Zero setup, ephemeral. Default for tests and for runs
// that don't want any state on disk.
export class MemoryDriver {
  #store = new Map();
  async save(instanceId, data) {
    this.#store.set(instanceId, JSON.parse(JSON.stringify(data)));
    return true;
  }
  async load(instanceId) {
    return this.#store.get(instanceId) ?? null;
  }
  async delete(instanceId) {
    return this.#store.delete(instanceId);
  }
  async listInstances() {
    return [...this.#store.keys()];
  }
}

// Driver 2 — local file, one JSON per instance under baseDir, written with the
// same atomic+fsync guarantee as the manifest. Filenames are hashed so an
// instanceId can be any string without path-injection risk.
export class LocalFileDriver {
  #baseDir;
  #ttlMs;
  constructor(baseDir = './sparda_state/', ttlDays = 0) {
    this.#baseDir = path.resolve(baseDir);
    this.#ttlMs = ttlDays > 0 ? ttlDays * 86_400_000 : 0;
    fs.mkdirSync(this.#baseDir, { recursive: true });
  }
  #filePath(instanceId) {
    const hash = crypto
      .createHash('sha256')
      .update(instanceId)
      .digest('hex')
      .slice(0, 16);
    return path.join(this.#baseDir, `sparda_${hash}.json`);
  }
  async save(instanceId, data) {
    try {
      atomicWriteFileSync(this.#filePath(instanceId), JSON.stringify(data, null, 2));
      return true;
    } catch {
      return false;
    }
  }
  async load(instanceId) {
    const target = this.#filePath(instanceId);
    try {
      if (this.#ttlMs > 0) {
        const stat = await fsp.stat(target);
        if (Date.now() - stat.mtimeMs > this.#ttlMs) {
          await fsp.unlink(target).catch(() => {});
          return null;
        }
      }
      return JSON.parse(await fsp.readFile(target, 'utf8'));
    } catch {
      return null;
    }
  }
  async delete(instanceId) {
    try {
      await fsp.unlink(this.#filePath(instanceId));
      return true;
    } catch {
      return false;
    }
  }
  async listInstances() {
    try {
      const files = await fsp.readdir(this.#baseDir);
      return files
        .filter((f) => f.startsWith('sparda_') && f.endsWith('.json'))
        .map((f) => f.slice('sparda_'.length, -'.json'.length));
    } catch {
      return [];
    }
  }
}

// Driver 3 — Redis, for distributed/multi-pod nodes. ioredis is imported lazily
// and is NOT a package dependency: selecting this driver without ioredis
// installed throws a clear, actionable error rather than failing at import.
export class RedisDriver {
  #prefix;
  #ttl;
  #client = null;
  #ready;
  constructor(options = {}) {
    this.#prefix = options.keyPrefix ?? 'sparda:';
    this.#ttl = options.ttlSeconds ?? 0;
    this.#ready = this.#init(options);
  }
  async #init(options) {
    let Redis;
    try {
      ({ default: Redis } = await import('ioredis'));
    } catch {
      throw Object.assign(
        new Error('RedisDriver requires the optional "ioredis" package.'),
        {
          code: 'USER',
          hint: 'Run `npm install ioredis`, or use the default file driver.',
        },
      );
    }
    this.#client = new Redis({
      host: options.host ?? 'localhost',
      port: options.port ?? 6379,
      password: options.password,
      db: options.db ?? 0,
      tls: options.tls ? {} : undefined,
      lazyConnect: true,
    });
  }
  #key(instanceId) {
    return `${this.#prefix}${instanceId}`;
  }
  async save(instanceId, data) {
    try {
      await this.#ready;
      const payload = JSON.stringify(data);
      if (this.#ttl > 0)
        await this.#client.setex(this.#key(instanceId), this.#ttl, payload);
      else await this.#client.set(this.#key(instanceId), payload);
      return true;
    } catch {
      return false;
    }
  }
  async load(instanceId) {
    try {
      await this.#ready;
      const raw = await this.#client.get(this.#key(instanceId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  async delete(instanceId) {
    try {
      await this.#ready;
      return (await this.#client.del(this.#key(instanceId))) > 0;
    } catch {
      return false;
    }
  }
  async listInstances() {
    try {
      await this.#ready;
      const keys = await this.#client.keys(`${this.#prefix}*`);
      return keys.map((k) => k.slice(this.#prefix.length));
    } catch {
      return [];
    }
  }
}

// Factory from env. Default is the local file driver — survives restarts with
// zero setup, no new dependency. `memory` for tests, `redis` opts into the lazy
// dependency. Unknown values fall back to file (fail safe, not silent crash).
export function createStateDriverFromEnv(env = process.env) {
  switch ((env.SPARDA_DRIVER ?? 'file').toLowerCase()) {
    case 'memory':
      return new MemoryDriver();
    case 'redis':
      return new RedisDriver({
        host: env.SPARDA_REDIS_HOST ?? 'localhost',
        port: env.SPARDA_REDIS_PORT ? Number(env.SPARDA_REDIS_PORT) : 6379,
        password: env.SPARDA_REDIS_PASSWORD,
        keyPrefix: env.SPARDA_REDIS_PREFIX ?? 'sparda:',
      });
    case 'file':
    default:
      return new LocalFileDriver(env.SPARDA_STATE_DIR ?? './sparda_state/');
  }
}
