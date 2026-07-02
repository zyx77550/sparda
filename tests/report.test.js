// tests/report.test.js — the readable black box (commands/report.js).
// Pure-function coverage (buildReport / renderTerminal / renderHtml) plus the
// command's USER-error contract on missing/corrupt manifests.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildReport,
  renderTerminal,
  renderHtml,
  runReport,
} from '../src/commands/report.js';

const richManifest = {
  version: 1,
  framework: 'express',
  entryFile: 'src/app.js',
  port: 65530, // nothing listens here — live fetch must fail silently
  localKey: 'test-key',
  createdAt: '2026-07-01T00:00:00.000Z',
  tools: {
    get_api_users: { method: 'GET', path: '/api/users', enabled: true },
    get_api_health: { method: 'GET', path: '/api/health', enabled: true },
    post_api_users: { method: 'POST', path: '/api/users', enabled: false },
    delete_api_users_by_id: { method: 'DELETE', path: '/api/users/:id', enabled: true },
  },
  semantic: {
    descriptions: { get_api_users: 'List users' },
    workflows: [{ name: 'wf1' }, { name: 'wf2' }],
  },
  immune: {
    antibodies: {
      'router|get_api_users|500': {
        diagnosis: 'DB pool exhausted',
        hits: 7,
        firstSeen: 'x',
        lastSeen: 'y',
      },
      'router|get_api_health|503': { diagnosis: 'upstream down', hits: 2 },
    },
  },
  sparding: {
    events: [
      {
        ts: '2026-07-01T10:00:00Z',
        tool: 'get_api_users',
        decision: 'allow',
        risk: 'low',
        reasons: [],
      },
      {
        ts: '2026-07-01T10:01:00Z',
        tool: 'post_api_users',
        decision: 'block',
        risk: 'high',
        reasons: ['write disabled'],
      },
      {
        ts: '2026-07-01T10:02:00Z',
        tool: 'get_api_users',
        decision: 'allow',
        risk: 'low',
        reasons: [],
      },
    ],
    failures: {
      'post_api_users|write_disabled': { count: 4, lesson: 'enable the tool first' },
    },
  },
  labs: {
    recordSequences: true,
    circuits: {
      'get_api_users>get_api_health': {
        steps: [],
        links: [],
        seen: 3,
        composite: {
          name: 'circuit_users_then_health',
          description: '<script>alert(1)</script> chained lookup',
        },
      },
      'get_api_health>get_api_users': { steps: [], links: [], seen: 1 },
    },
  },
};

const liveStats = {
  uptimeSec: 120,
  stats: {
    get_api_users: { calls: 10, errors: 1, totalMs: 500 },
    get_api_health: { calls: 4, errors: 0, totalMs: 40 },
  },
  quarantine: { get_api_health: { reason: '3 consecutive 5xx' } },
  recycle: { servedByCircle: 6, paidFull: 8, ratePct: 43 },
  purity: {
    get_api_users: { class: 'pure', repeats: 3, mismatches: 0 },
    get_api_health: { class: 'unknown', repeats: 0, mismatches: 0 },
  },
};

describe('buildReport', () => {
  it('aggregates manifest memory correctly', () => {
    const r = buildReport(richManifest);
    expect(r.tools).toEqual({ total: 4, enabled: 3, writes: 2, writesEnabled: 1 });
    expect(r.semantic).toEqual({ descriptions: 1, workflows: 2 });
    expect(r.proof.events).toBe(3);
    expect(r.proof.byDecision).toEqual({ allow: 2, block: 1 });
    expect(r.proof.lastEventAt).toBe('2026-07-01T10:02:00Z');
    expect(r.proof.failureCount).toBe(1);
    expect(r.proof.failures[0]).toMatchObject({
      count: 4,
      lesson: 'enable the tool first',
    });
    expect(r.immunity.antibodies).toBe(2);
    expect(r.immunity.hits).toBe(9);
    expect(r.immunity.top[0].diagnosis).toBe('DB pool exhausted'); // sorted by hits
    expect(r.organs.circuits).toBe(2);
    expect(r.organs.composites).toHaveLength(1);
    expect(r.live).toBeNull();
  });

  it('summarizes live gauges when provided', () => {
    const r = buildReport(richManifest, liveStats);
    expect(r.live.totals).toEqual({ calls: 14, errors: 1 });
    expect(r.live.topTools[0]).toMatchObject({ name: 'get_api_users', avgMs: 50 });
    expect(r.live.quarantine).toEqual([
      { tool: 'get_api_health', reason: '3 consecutive 5xx' },
    ]);
    expect(r.live.recycle.ratePct).toBe(43);
    expect(r.live.purityCount).toEqual({ pure: 1, unknown: 1 });
  });

  it('is safe on a minimal manifest (empty organism)', () => {
    const r = buildReport({ framework: 'fastapi' });
    expect(r.tools.total).toBe(0);
    expect(r.proof.events).toBe(0);
    expect(r.proof.lastEventAt).toBeNull();
    expect(r.immunity.antibodies).toBe(0);
    expect(r.organs.circuits).toBe(0);
    // renderers must not throw on the empty organism
    expect(() => renderTerminal(r)).not.toThrow();
    expect(() => renderHtml(r)).not.toThrow();
  });
});

describe('renderTerminal', () => {
  it('tells the story with the real numbers', () => {
    const out = renderTerminal(buildReport(richManifest, liveStats));
    expect(out).toContain('3/4 exposed to AI');
    expect(out).toContain('1/2 write tools opted in');
    expect(out).toContain('3 proofed invocations');
    expect(out).toContain('2 antibodies');
    expect(out).toContain('zero tokens');
    expect(out).toContain('circuit_users_then_health');
    expect(out).toContain('43% served by the circle');
    expect(out).toContain('quarantined: get_api_health');
  });

  it('shows honest empty states instead of zeros-as-success', () => {
    const out = renderTerminal(buildReport({}));
    expect(out).toContain('no agent activity recorded yet');
    expect(out).toContain('no antibodies yet');
    expect(out).toContain('host not running');
  });
});

describe('renderHtml', () => {
  it('is self-contained and escapes hostile values', () => {
    const html = renderHtml(buildReport(richManifest, liveStats));
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('<script>alert(1)</script>'); // escaped
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/src=|href=/); // no external assets, no links out
    expect(html).toContain('no data left this machine');
  });
});

describe('runReport', () => {
  it('throws a USER error without sparda.json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-report-'));
    await expect(runReport({ cwd: dir, json: true })).rejects.toMatchObject({
      code: 'USER',
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws a USER error on corrupt sparda.json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-report-'));
    fs.writeFileSync(path.join(dir, 'sparda.json'), '{not json', 'utf8');
    await expect(runReport({ cwd: dir, json: true })).rejects.toMatchObject({
      code: 'USER',
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports from the manifest alone when the host is down, and writes HTML', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparda-report-'));
    fs.writeFileSync(path.join(dir, 'sparda.json'), JSON.stringify(richManifest), 'utf8');
    const { report } = await runReport({ cwd: dir, html: true });
    expect(report.live).toBeNull(); // port 65530 answers nothing → silent fallback
    expect(report.tools.total).toBe(4);
    const htmlPath = path.join(dir, '.sparda', 'report.html');
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(fs.readFileSync(htmlPath, 'utf8')).toContain('SPARDA');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
