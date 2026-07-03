// tests/negentropy.test.js — the Maxwell's demon pass (doctor --app).
// Pure-core coverage plus one integration through the real doctor on the
// nextjs fixture: rot is injected on purpose, the demon must smell it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildNegentropy,
  renderNegentropy,
  fingerprintFor,
} from '../src/commands/negentropy.js';
import { parseNextProject } from '../src/parser/nextjs.js';
import { generateNext } from '../src/generator/nextjs.js';
import { runDoctor } from '../src/commands/doctor.js';

const FIXTURE = path.join(__dirname, 'fixtures', 'nextjs-basic');

const route = (method, p, params = []) => ({
  method,
  path: p,
  params,
  mutating: method !== 'get',
  confidence: 'high',
});

function baseManifest() {
  return {
    version: 1,
    framework: 'express',
    entryFile: 'src/app.js',
    port: 3000,
    localKey: 'key-123',
    generatedFiles: [],
    tools: {
      get_api_users: { method: 'GET', path: '/api/users', enabled: true },
      get_api_health: { method: 'GET', path: '/api/health', enabled: true },
      post_api_users: { method: 'POST', path: '/api/users', enabled: false },
    },
    sparding: {
      toolFingerprints: {
        get_api_users: fingerprintFor({ method: 'GET', path: '/api/users', params: [] }),
      },
      failures: {},
      events: [],
    },
    immune: { antibodies: {} },
  };
}

describe('buildNegentropy — drift', () => {
  it('flags stale tools (in manifest, gone from code) as high severity', () => {
    const r = buildNegentropy({
      manifest: baseManifest(),
      currentRoutes: [route('get', '/api/users')], // health + post vanished
      live: null,
      detectedPort: 3000,
      cwd: os.tmpdir(),
    });
    const stale = r.findings.filter((f) => f.title.startsWith('stale tool'));
    expect(stale.map((f) => f.title).sort()).toEqual([
      'stale tool: get_api_health',
      'stale tool: post_api_users',
    ]);
    expect(stale.every((f) => f.severity === 'high' && f.fix.includes('sync'))).toBe(
      true,
    );
  });

  it('flags unsynced routes (in code, not in manifest)', () => {
    const r = buildNegentropy({
      manifest: baseManifest(),
      currentRoutes: [
        route('get', '/api/users'),
        route('get', '/api/health'),
        route('post', '/api/users'),
        route('get', '/api/new-thing'),
      ],
      live: null,
      detectedPort: 3000,
      cwd: os.tmpdir(),
    });
    expect(r.findings.some((f) => f.title === 'unsynced route: GET /api/new-thing')).toBe(
      true,
    );
  });

  it('detects shape drift via fingerprints', () => {
    const changed = route('get', '/api/users', [
      { name: 'limit', in: 'query', type: 'string', required: false, description: 'q' },
    ]);
    const r = buildNegentropy({
      manifest: baseManifest(),
      currentRoutes: [changed, route('get', '/api/health'), route('post', '/api/users')],
      live: null,
      detectedPort: 3000,
      cwd: os.tmpdir(),
    });
    const drift = r.findings.find((f) => f.title === 'shape drift: get_api_users');
    expect(drift).toBeDefined();
    expect(drift.severity).toBe('medium');
  });

  it('says drift is not measurable when the parse failed — never guesses', () => {
    const r = buildNegentropy({
      manifest: baseManifest(),
      currentRoutes: null,
      live: null,
      detectedPort: null,
      cwd: os.tmpdir(),
    });
    expect(r.findings.some((f) => f.title === 'drift not measurable')).toBe(true);
  });
});

describe('buildNegentropy — dead current & sickness', () => {
  it('flags zero-call enabled tools only with enough observation, honestly scoped', () => {
    const live = {
      uptimeSec: 3600,
      stats: { get_api_users: { calls: 50, errors: 0 } },
      quarantine: {},
    };
    const r = buildNegentropy({
      manifest: baseManifest(),
      currentRoutes: null,
      live,
      detectedPort: 3000,
      cwd: os.tmpdir(),
    });
    const dead = r.findings.find((f) => f.title === 'no current: get_api_health');
    expect(dead).toBeDefined();
    expect(dead.severity).toBe('info');
    expect(dead.detail).toContain('this session only');
    // disabled write is never called dead — it is gated, not dead
    expect(r.findings.some((f) => f.title === 'no current: post_api_users')).toBe(false);
  });

  it('refuses the dead verdict without observation', () => {
    const r = buildNegentropy({
      manifest: baseManifest(),
      currentRoutes: null,
      live: { uptimeSec: 5, stats: {}, quarantine: {} },
      detectedPort: 3000,
      cwd: os.tmpdir(),
    });
    expect(r.findings.some((f) => f.title === 'current not measurable yet')).toBe(true);
    expect(r.findings.some((f) => f.title.startsWith('no current:'))).toBe(false);
  });

  it('surfaces quarantine, recurring failures and chronic antibodies', () => {
    const m = baseManifest();
    m.sparding.failures = {
      'post_api_users|write_disabled': { count: 6, lesson: 'stays opt-in' },
    };
    m.immune.antibodies = {
      'router|get_api_users|500': { diagnosis: 'db pool exhausted', hits: 11 },
    };
    const r = buildNegentropy({
      manifest: m,
      currentRoutes: null,
      live: {
        uptimeSec: 3600,
        stats: { get_api_users: { calls: 9 } },
        quarantine: { get_api_health: { reason: '3 consecutive 5xx' } },
      },
      detectedPort: 3000,
      cwd: os.tmpdir(),
    });
    expect(
      r.findings.some(
        (f) => f.title === 'quarantined: get_api_health' && f.severity === 'high',
      ),
    ).toBe(true);
    const rec = r.findings.find((f) => f.title.startsWith('recurring failure'));
    expect(rec.fix).toContain('write-safety');
    const chronic = r.findings.find((f) => f.title.startsWith('chronic antigen'));
    expect(chronic.detail).toContain('11 zero-token diagnoses');
  });
});

describe('buildNegentropy — zombie config', () => {
  it('flags port drift and a missing router file as high severity', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-neg-'));
    const m = baseManifest();
    m.generatedFiles = ['src/sparda-router.js']; // never written on disk
    const r = buildNegentropy({
      manifest: m,
      currentRoutes: null,
      live: null,
      detectedPort: 4000, // manifest says 3000
      cwd: dir,
    });
    expect(
      r.findings.some((f) => f.title === 'port drift' && f.severity === 'high'),
    ).toBe(true);
    expect(
      r.findings.some((f) => f.title === 'router file missing' && f.severity === 'high'),
    ).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags a stale router that lost the manifest key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-neg-'));
    fs.writeFileSync(path.join(dir, 'router.js'), '// old router, key-OLD inside');
    const m = baseManifest();
    m.generatedFiles = ['router.js'];
    const r = buildNegentropy({
      manifest: m,
      currentRoutes: null,
      live: null,
      detectedPort: 3000,
      cwd: dir,
    });
    expect(r.findings.some((f) => f.title === 'router/manifest key mismatch')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('renderNegentropy', () => {
  it('high severity fails, info alone does not', () => {
    const high = renderNegentropy({
      findings: [{ kind: 'zombie', severity: 'high', title: 'x', detail: 'd', fix: 'f' }],
      summary: { drift: 0, dead: 0, sick: 0, zombie: 1 },
      actionable: 1,
    });
    expect(high.failing).toBe(true);
    const info = renderNegentropy({
      findings: [{ kind: 'dead', severity: 'info', title: 'x', detail: 'd', fix: 'f' }],
      summary: { drift: 0, dead: 1, sick: 0, zombie: 0 },
      actionable: 0,
    });
    expect(info.failing).toBe(false);
    expect(info.lines.join('\n')).toContain('drift 0 · dead 1');
  });
});

describe('doctor --app — integration on the nextjs fixture', () => {
  it('smells injected rot: an unsynced route and a stale tool', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-neg-int-'));
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const { routes } = parseNextProject(dir, 'app');
    generateNext({ cwd: dir, appDir: 'app', port: 3456, routes });

    // rot #1: a new route appears after init (unsynced)
    fs.mkdirSync(path.join(dir, 'app', 'api', 'fresh'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'app', 'api', 'fresh', 'route.js'),
      'export async function GET() { return Response.json({}); }\n',
    );
    // rot #2: a route the manifest knows disappears (stale tool)
    fs.rmSync(path.join(dir, 'app', '(internal)'), { recursive: true, force: true });

    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    let healthy;
    try {
      ({ healthy } = await runDoctor({ cwd: dir, app: true }));
    } finally {
      console.log = orig;
    }
    const out = logs.join('\n');
    expect(out).toContain('unsynced route: GET /api/fresh');
    expect(out).toContain('stale tool: get_health');
    expect(healthy).toBe(false); // stale tool is high severity → CI gate
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
