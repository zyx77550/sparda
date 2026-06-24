// tests/persistence.test.js — durable manifest writes + pluggable driver seam.
// Covers ADR-019 (Chantier 1): the single atomic+fsync writer that every
// sparda.json write now shares, the merge-write helper the bridge uses, and the
// engine-agnostic Memory / LocalFile / lazy-Redis drivers. No python, no live
// server — pure fs + in-memory, so this file stays fast and deterministic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  atomicWriteFileSync,
  writeManifestSync,
  mergeManifestKeySync,
  RENAME_MAX_ATTEMPTS,
  MemoryDriver,
  LocalFileDriver,
  RedisDriver,
  createStateDriverFromEnv,
} from '../src/server/persistence.js';

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-persist-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('persistence — atomic manifest writes (ADR-019)', () => {
  it('round-trips content and leaves no temp file behind', () => {
    const file = path.join(tmpDir, 'sparda.json');
    atomicWriteFileSync(file, '{"a":1}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}');
    // a stray .sparda-tmp would mean a half-write was observable to a reader
    expect(fs.existsSync(`${file}.sparda-tmp`)).toBe(false);
  });

  it('overwrites existing bytes wholesale (never appends or leaves a tail)', () => {
    const file = path.join(tmpDir, 'sparda.json');
    atomicWriteFileSync(file, 'first-and-longer-content');
    atomicWriteFileSync(file, 'second');
    expect(fs.readFileSync(file, 'utf8')).toBe('second');
  });

  it('writeManifestSync emits pretty JSON + trailing newline (the generator byte shape)', () => {
    const file = path.join(tmpDir, 'sparda.json');
    const manifest = { version: 1, framework: 'express' };
    writeManifestSync(file, manifest);
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).toBe(JSON.stringify(manifest, null, 2) + '\n'); // clean diffs depend on this exact shape
  });

  it('mergeManifestKeySync sets one key without clobbering siblings', () => {
    const file = path.join(tmpDir, 'sparda.json');
    writeManifestSync(file, { version: 1, localKey: 'abc', immune: { old: true } });
    expect(mergeManifestKeySync(file, 'immune', { fresh: 1 })).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.localKey).toBe('abc'); // carry-over field untouched
    expect(onDisk.version).toBe(1); // untouched
    expect(onDisk.immune).toEqual({ fresh: 1 }); // only this key replaced
  });

  it('mergeManifestKeySync fails soft (false) when the manifest cannot be read', () => {
    const missing = path.join(tmpDir, 'nope', 'sparda.json');
    expect(mergeManifestKeySync(missing, 'immune', {})).toBe(false);
  });
});

describe('persistence — rename retry on transient Windows locks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a transient EPERM on rename, then succeeds (no lost write)', () => {
    const file = path.join(tmpDir, 'sparda.json');
    const realRename = fs.renameSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('EPERM: lock'), { code: 'EPERM' }); // AV holds it twice
      return realRename(from, to); // then lets go
    });
    atomicWriteFileSync(file, 'survived');
    expect(calls).toBe(3);
    expect(fs.readFileSync(file, 'utf8')).toBe('survived');
    expect(fs.existsSync(`${file}.sparda-tmp`)).toBe(false); // temp consumed by the successful rename
  });

  it('does NOT retry a genuine (non-lock) rename error, and cleans up the temp', () => {
    const file = path.join(tmpDir, 'sparda.json');
    let calls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      calls += 1;
      throw Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' });
    });
    expect(() => atomicWriteFileSync(file, 'x')).toThrow(/ENOENT/);
    expect(calls).toBe(1); // surfaced immediately, no pointless retries
    expect(fs.existsSync(`${file}.sparda-tmp`)).toBe(false); // temp not left behind
  });

  it('gives up after RENAME_MAX_ATTEMPTS on a persistent lock and surfaces the error', () => {
    const file = path.join(tmpDir, 'sparda.json');
    let calls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      calls += 1;
      throw Object.assign(new Error('EBUSY: stuck'), { code: 'EBUSY' });
    });
    expect(() => atomicWriteFileSync(file, 'x')).toThrow(/EBUSY/);
    expect(calls).toBe(RENAME_MAX_ATTEMPTS); // bounded — never an unbounded spin
    expect(fs.existsSync(`${file}.sparda-tmp`)).toBe(false);
  });
});

describe('persistence — MemoryDriver', () => {
  it('round-trips save / load / delete / listInstances', async () => {
    const d = new MemoryDriver();
    expect(await d.load('i1')).toBe(null);
    await d.save('i1', { n: 1 });
    await d.save('i2', { n: 2 });
    expect(await d.load('i1')).toEqual({ n: 1 });
    expect((await d.listInstances()).sort()).toEqual(['i1', 'i2']);
    expect(await d.delete('i1')).toBe(true);
    expect(await d.load('i1')).toBe(null);
  });

  it('deep-copies on save — a later mutation of the source never leaks in', async () => {
    const d = new MemoryDriver();
    const data = { nested: { v: 1 } };
    await d.save('i', data);
    data.nested.v = 999; // mutate AFTER save
    expect((await d.load('i')).nested.v).toBe(1);
  });
});

describe('persistence — LocalFileDriver', () => {
  it('round-trips through hashed files under its baseDir (no raw id on disk)', async () => {
    const dir = path.join(tmpDir, 'state');
    const d = new LocalFileDriver(dir);
    expect(await d.load('inst-A')).toBe(null);
    await d.save('inst-A', { hello: 'world' });
    expect(await d.load('inst-A')).toEqual({ hello: 'world' });
    const files = fs.readdirSync(dir);
    // the id is hashed into the filename — never written raw (no path injection)
    expect(files.some((f) => f.includes('inst-A'))).toBe(false);
    expect(files.every((f) => /^sparda_[0-9a-f]{16}\.json$/.test(f))).toBe(true);
  });

  it('lists and deletes instances, bounded to its own files', async () => {
    const d = new LocalFileDriver(path.join(tmpDir, 'state2'));
    await d.save('one', { a: 1 });
    await d.save('two', { b: 2 });
    expect((await d.listInstances()).length).toBe(2);
    expect(await d.delete('one')).toBe(true);
    expect((await d.listInstances()).length).toBe(1);
  });
});

describe('persistence — RedisDriver stays optional (hard rule #8)', () => {
  // ioredis is NOT a package dependency. Selecting Redis without it installed
  // must fail soft on the data path (save→false, load→null) — never crash at
  // import, never add a 5th runtime dep. (No redis server runs in CI either,
  // so even a transitively-present ioredis would still fail soft here.)
  it('save / load / delete / listInstances fail soft when ioredis is absent', async () => {
    const d = new RedisDriver({ host: 'localhost' });
    expect(await d.save('i', { a: 1 })).toBe(false);
    expect(await d.load('i')).toBe(null);
    expect(await d.delete('i')).toBe(false);
    expect(await d.listInstances()).toEqual([]);
  });
});

describe('persistence — createStateDriverFromEnv', () => {
  it('maps SPARDA_DRIVER to the right driver, defaulting to file, fail-safe on unknown', async () => {
    const stateDir = path.join(tmpDir, 's'); // keep LocalFileDriver off the repo root
    expect(createStateDriverFromEnv({ SPARDA_DRIVER: 'memory' })).toBeInstanceOf(
      MemoryDriver,
    );

    const redis = createStateDriverFromEnv({ SPARDA_DRIVER: 'redis' });
    expect(redis).toBeInstanceOf(RedisDriver);
    await redis.load('_'); // consume the lazy-import rejection so it never surfaces as unhandled

    expect(
      createStateDriverFromEnv({ SPARDA_DRIVER: 'file', SPARDA_STATE_DIR: stateDir }),
    ).toBeInstanceOf(LocalFileDriver);
    expect(createStateDriverFromEnv({ SPARDA_STATE_DIR: stateDir })).toBeInstanceOf(
      LocalFileDriver,
    ); // default
    expect(
      createStateDriverFromEnv({ SPARDA_DRIVER: 'banana', SPARDA_STATE_DIR: stateDir }),
    ).toBeInstanceOf(LocalFileDriver); // unknown → file
  });
});
